import type { AgentCommand, BatchResult } from '@editbay/core';
import type {
  AgentEvent,
  AgentRuntime,
  AgentSettings,
  AgentTurnInput,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Provider,
  ProviderConfig,
  Receipt,
  ToolCall,
} from './types';
import { buildSystemPrompt, summarizeProject } from './prompt';
import type { CreateReceiptInput } from './receipts';
import { EMPTY_RESPONSE, abortError, errorMessage, isAbortError, ProviderError, throwIfAborted } from './providers/base';
import { buildToolSpecs, effectIdsFromCatalog, executeTool } from './tools';

export interface ReceiptRecorder {
  record(input: CreateReceiptInput): Promise<Receipt>;
}

export interface AgentOptions {
  runtime: AgentRuntime;
  provider: Provider;
  /** Default provider config (api key, baseUrl, headers). */
  providerConfig?: ProviderConfig;
  /** Optional receipt log; a turn receipt is written at the end of each run. */
  receipts?: ReceiptRecorder;
  /** Overrides settings.maxSteps. */
  maxSteps?: number;
}

interface RunStats {
  steps: number;
  toolCalls: string[];
  appliedCommands: number;
}

/** Hard cap on replayed conversation history messages. */
export const MAX_HISTORY_MESSAGES = 24;
/** Character budget for replayed history (project state is always fresh). */
export const HISTORY_CHAR_BUDGET = 60_000;

/** Retryable provider failures are retried at most this many times. */
export const MAX_PROVIDER_RETRIES = 2;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 2_000;

/**
 * The Editbay agent loop.
 *
 * The model sees tools, project state, brand, matched skills and effect ids.
 * Edits flow exclusively through the runtime, and the generator yields a
 * stable event stream even for non-streaming providers.
 */
export class Agent {
  private readonly runtime: AgentRuntime;
  private readonly provider: Provider;
  private readonly providerConfig: ProviderConfig;
  private readonly receipts: ReceiptRecorder | null;
  private readonly maxStepsOverride: number | undefined;

  constructor(options: AgentOptions);
  constructor(runtime: AgentRuntime, provider: Provider, options?: Omit<AgentOptions, 'runtime' | 'provider'>);
  constructor(
    runtimeOrOptions: AgentRuntime | AgentOptions,
    provider?: Provider,
    options?: Omit<AgentOptions, 'runtime' | 'provider'>,
  ) {
    if (isAgentOptions(runtimeOrOptions)) {
      this.runtime = runtimeOrOptions.runtime;
      this.provider = runtimeOrOptions.provider;
      this.providerConfig = runtimeOrOptions.providerConfig ?? {};
      this.receipts = runtimeOrOptions.receipts ?? null;
      this.maxStepsOverride = runtimeOrOptions.maxSteps;
      return;
    }
    if (!provider) throw new Error('Agent requires a provider');
    this.runtime = runtimeOrOptions;
    this.provider = provider;
    this.providerConfig = options?.providerConfig ?? {};
    this.receipts = options?.receipts ?? null;
    this.maxStepsOverride = options?.maxSteps;
  }

  async *run(input: AgentTurnInput): AsyncGenerator<AgentEvent> {
    const settings = this.runtime.settings;
    const maxSteps = Math.max(1, Math.floor(this.maxStepsOverride ?? settings.maxSteps ?? 8));
    const autoApply = settings.autoApply === true;
    const signal = input.signal;
    const stats: RunStats = { steps: 0, toolCalls: [], appliedCommands: 0 };
    let finalText = '';

    try {
      throwIfAborted(signal);
      const project = this.runtime.project();
      const brand = project.brandId ? await this.runtime.memory.getBrand(project.brandId) : null;
      const skills = await this.runtime.skills.match(input.text, 3);
      const prompt = buildSystemPrompt(
        settings,
        summarizeProject(project, input.selection),
        brand,
        skills,
        effectIdsFromCatalog(this.runtime.effects),
        attachmentsInstruction(input),
      );

      const messages: ChatMessage[] = [
        { role: 'system', content: prompt },
        ...capHistory(input.history ?? []),
        { role: 'user', content: input.text },
      ];

      for (let step = 0; step < maxSteps; step += 1) {
        throwIfAborted(signal);
        stats.steps = step + 1;
        yield {
          type: 'status',
          text:
            step === 0
              ? `Thinking with ${this.provider.label}…`
              : `Continuing with ${this.provider.label} (step ${step + 1}/${maxSteps})…`,
        };

        const response = await this.chat(messages, settings, signal);
        throwIfAborted(signal);
        const calls = response.toolCalls ?? [];
        stats.toolCalls.push(...calls.map((call) => call.name));

        if (calls.length === 0) {
          const commands = parseCommandPayload(response.text);
          if (commands !== null && commands.length > 0) {
            const terminal = terminalMessage(commands);
            if (terminal !== null) {
              finalText = terminal;
              yield { type: 'message', text: terminal };
              break;
            }

            if (autoApply) {
              const batch = this.runtime.applyCommands(commands);
              stats.appliedCommands += batch.results.filter((result) => result.ok).length;
              yield { type: 'applied', results: batch.results };
              finalText = batchSummary(batch);
            } else {
              const summaryText = commandsSummary(commands);
              yield { type: 'proposal', commands, summary: summaryText };
              finalText = stripJsonFromText(response.text) || summaryText;
            }
            yield { type: 'message', text: finalText };
            break;
          }

          const text = response.text.trim();
          if (text === '') {
            throw new ProviderError(
              `${EMPTY_RESPONSE}: ${this.provider.label} returned an empty response.`,
              { code: 'empty_response', retryable: true },
            );
          }
          finalText = text;
          yield { type: 'message', text };
          break;
        } else {
          messages.push({
            role: 'assistant',
            content: response.text,
            toolCalls: calls,
            ...(response.thoughts !== undefined ? { thoughts: response.thoughts } : {}),
          });
          let clarification: string | null = null;
          let proposed: AgentCommand[] | null = null;

          for (const call of calls) {
            throwIfAborted(signal);
            yield { type: 'tool_start', call };

            // Proposal mode is enforced structurally: a model that still calls
            // apply_commands gets a proposal event and never mutates anything.
            if (!autoApply && call.name === 'apply_commands') {
              const commands = commandsFromToolCall(call);
              if (commands === null) {
                const summary =
                  'apply_commands expects { commands: [...] } with objects that have a string "op".';
                yield { type: 'tool_end', call, ok: false, summary };
                messages.push({
                  role: 'tool',
                  content: JSON.stringify({ ok: false, summary }),
                  toolCallId: call.id,
                  name: call.name,
                });
                continue;
              }
              const summary = commandsSummary(commands);
              // A decline sent through the tool call must stop the turn, not
              // become a proposal the user can apply.
              const terminal = terminalMessage(commands);
              if (terminal !== null) {
                yield { type: 'tool_end', call, ok: true, summary: terminal };
                messages.push({
                  role: 'tool',
                  content: JSON.stringify({ ok: true, summary: terminal }),
                  toolCallId: call.id,
                  name: call.name,
                });
                clarification = terminal;
                continue;
              }
              yield {
                type: 'tool_end',
                call,
                ok: true,
                summary: `${summary} Proposal only: the user must approve it.`,
              };
              yield { type: 'proposal', commands, summary };
              messages.push({
                role: 'tool',
                content: JSON.stringify({ ok: true, proposal: true, summary }),
                toolCallId: call.id,
                name: call.name,
              });
              proposed = commands;
              finalText = summary;
              continue;
            }

            const result = await executeTool(call, { runtime: this.runtime });
            yield {
              type: 'tool_end',
              call,
              ok: result.ok,
              summary: result.summary,
            };

            if (result.applied) {
              stats.appliedCommands += result.applied.filter((item) => item.ok).length;
              yield { type: 'applied', results: result.applied };
            }

            messages.push({
              role: 'tool',
              content: JSON.stringify({
                ok: result.ok,
                summary: result.summary,
                ...(result.data !== undefined ? { data: result.data } : {}),
              }),
              toolCallId: call.id,
              name: call.name,
            });

            if (result.clarification) clarification = result.clarification;
          }

          if (clarification) {
            finalText = clarification;
            yield { type: 'message', text: clarification };
            break;
          }

          if (proposed) {
            yield { type: 'message', text: finalText };
            break;
          }

          if (step === maxSteps - 1) {
            finalText = `Stopped after ${maxSteps} step${maxSteps === 1 ? '' : 's'}.`;
            yield { type: 'message', text: finalText };
          }
        }
      }

      if (finalText === '') {
        finalText = 'Done.';
        yield { type: 'message', text: finalText };
      }
      await this.writeReceipt(input, stats, finalText);
      yield { type: 'done', text: finalText };
    } catch (error) {
      const message = isAbortError(error) ? 'Cancelled.' : errorMessage(error);
      yield { type: 'error', message };
      await this.writeReceipt(input, stats, message);
      yield { type: 'done', text: message };
    }
  }

  /* ---------------------------------------------------------------- */

  private async chat(
    messages: ChatMessage[],
    settings: AgentSettings,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const request: ChatRequest = {
      model: settings.model?.trim() || this.provider.defaultModel,
      messages,
      tools: buildToolSpecs({ autoApply: settings.autoApply === true }),
      ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      ...(settings.maxTokens !== undefined ? { maxTokens: settings.maxTokens } : {}),
    };

    let retries = 0;
    for (;;) {
      throwIfAborted(signal);
      try {
        const response = await this.provider.chat(
          { ...request, ...(signal !== undefined ? { signal } : {}) },
          this.providerConfig,
        );
        if (response.text.trim() === '' && (response.toolCalls?.length ?? 0) === 0) {
          throw new ProviderError(
            `${EMPTY_RESPONSE}: ${this.provider.label} returned an empty response.`,
            { code: 'empty_response', retryable: true },
          );
        }
        return response;
      } catch (error) {
        if (isAbortError(error) || signal?.aborted === true) throw abortError();
        if (
          !(error instanceof ProviderError) ||
          !error.retryable ||
          retries >= MAX_PROVIDER_RETRIES
        ) {
          throw error;
        }
        const delay = retryDelayMs(error, retries);
        retries += 1;
        await sleep(delay, signal);
      }
    }
  }

  private async writeReceipt(
    input: AgentTurnInput,
    stats: RunStats,
    finalText: string,
  ): Promise<void> {
    if (!this.receipts) return;
    try {
      await this.receipts.record({
        kind: 'agent_turn',
        summary: truncate(finalText.replace(/\s+/g, ' ').trim(), 160) || 'Agent turn',
        detail: {
          providerId: this.provider.id,
          model: this.runtime.settings.model || this.provider.defaultModel,
          steps: stats.steps,
          toolCalls: stats.toolCalls,
          appliedCommands: stats.appliedCommands,
          request: truncate(input.text.replace(/\s+/g, ' ').trim(), 240),
          ...(input.selection !== undefined ? { selection: input.selection } : {}),
        },
      });
    } catch {
      // Receipt failures must never break an editing turn.
    }
  }
}

export function createAgent(options: AgentOptions): Agent {
  return new Agent(options);
}

/* ------------------------------------------------------------------ */
/* Text JSON fallback                                                  */
/* ------------------------------------------------------------------ */

/**
 * Find and interpret a raw command payload in model text:
 * a JSON array, `{ "commands": [...] }`, or a single command object.
 */
export function parseCommandPayload(text: string): AgentCommand[] | null {
  const candidate = extractJson(text);
  if (candidate === null) return null;

  const parsed = safeParse(candidate);
  if (parsed === undefined) return null;

  if (Array.isArray(parsed)) {
    const commands = parsed
      .map((item) => toCommand(item))
      .filter((item): item is AgentCommand => item !== null);
    return commands.length > 0 ? commands : null;
  }

  const record = asRecord(parsed);
  if (!record) return null;
  if (Array.isArray(record.commands)) {
    const commands = record.commands
      .map((item) => toCommand(item))
      .filter((item): item is AgentCommand => item !== null);
    return commands.length > 0 ? commands : null;
  }

  const single = toCommand(parsed);
  return single === null ? null : [single];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isAgentOptions(value: AgentRuntime | AgentOptions): value is AgentOptions {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runtime' in value &&
    'provider' in value &&
    !('project' in value)
  );
}

/** Default receipt log under the workspace root, when one is available. */
export function defaultReceiptStore(_runtime: AgentRuntime): null {
  return null;
}

/* ------------------------------------------------------------------ */
/* Conversation history budget                                         */
/* ------------------------------------------------------------------ */

/**
 * Keep the most recent history within a message and character budget.
 * Assistant messages stay attached to their tool results so providers never
 * receive a `tool` message without the `tool_calls` that produced it.
 */
export function capHistory(
  history: ChatMessage[],
  maxMessages = MAX_HISTORY_MESSAGES,
  charBudget = HISTORY_CHAR_BUDGET,
): ChatMessage[] {
  if (history.length === 0) return [];

  const units = groupHistory(history);
  const kept: ChatMessage[][] = [];
  let messageCount = 0;
  let charCount = 0;

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (!unit) continue;
    const unitChars = unit.reduce((sum, message) => sum + messageChars(message), 0);
    // Always keep at least the newest unit, even if it alone exceeds a budget.
    if (
      kept.length > 0 &&
      (messageCount + unit.length > maxMessages || charCount + unitChars > charBudget)
    ) {
      break;
    }
    kept.unshift(unit);
    messageCount += unit.length;
    charCount += unitChars;
  }

  return kept.flat();
}

/** Group a transcript into assistant+tool units; orphan tool messages are dropped. */
function groupHistory(history: ChatMessage[]): ChatMessage[][] {
  const units: ChatMessage[][] = [];
  let current: ChatMessage[] | null = null;
  let expectsToolResults = false;

  for (const message of history) {
    if (message.role === 'tool') {
      if (expectsToolResults && current) current.push(message);
      continue;
    }
    current = [message];
    units.push(current);
    expectsToolResults = message.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0;
  }

  return units;
}

function messageChars(message: ChatMessage): number {
  const toolCalls = message.toolCalls === undefined ? '' : JSON.stringify(message.toolCalls);
  return message.content.length + toolCalls.length + (message.thoughts?.length ?? 0);
}

/* ------------------------------------------------------------------ */
/* Provider retries                                                    */
/* ------------------------------------------------------------------ */

/** Exponential backoff, honoring a server-provided Retry-After delay. */
function retryDelayMs(error: ProviderError, attempt: number): number {
  if (error.retryAfterMs !== undefined) {
    return Math.min(RETRY_MAX_MS, Math.max(0, error.retryAfterMs));
  }
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
}

/** Abortable sleep: resolves after `ms`, rejects with AbortError on cancel. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError());
      return;
    }
    function cleanup(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    function onAbort(): void {
      cleanup();
      reject(abortError());
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Extract and shape-check commands from an apply_commands tool call. */
function commandsFromToolCall(call: ToolCall): AgentCommand[] | null {
  const raw = call.arguments.commands;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const commands: AgentCommand[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record || typeof record.op !== 'string' || record.op.trim() === '') return null;
    commands.push(record as unknown as AgentCommand);
  }
  return commands;
}

function attachmentsInstruction(input: AgentTurnInput): string {
  if (!input.attachments || input.attachments.length === 0) return '';
  return [
    'The user referenced attachments (metadata only; never expose file paths):',
    ...input.attachments.map(
      (attachment) =>
        `- ${attachment.label} (${attachment.kind}${attachment.assetId ? `, assetId: ${attachment.assetId}` : ''})`,
    ),
  ].join('\n');
}

function terminalMessage(commands: AgentCommand[]): string | null {
  if (commands.length !== 1) return null;
  const command = commands[0];
  if (!command) return null;
  if (command.op === 'clarify') return command.question;
  if (command.op === 'unsupported') return command.reason;
  return null;
}

function batchSummary(batch: BatchResult): string {
  const total = batch.results.length;
  const failed = batch.results.filter((result) => !result.ok).length;
  if (total === 0) return 'No changes were needed.';
  if (failed === 0) return `Applied ${total} edit${total === 1 ? '' : 's'}.`;
  return `Applied ${total - failed} of ${total} edits; ${failed} failed.`;
}

function commandsSummary(commands: AgentCommand[]): string {
  const ops = commands.slice(0, 6).map((command) => command.op);
  const suffix = commands.length > ops.length ? ', …' : '';
  return `Proposed ${commands.length} edit${commands.length === 1 ? '' : 's'}: ${ops.join(', ')}${suffix}.`;
}

function toCommand(value: unknown): AgentCommand | null {
  const record = asRecord(value);
  if (!record) return null;
  const op = typeof record.op === 'string' ? record.op.trim() : '';
  if (op === '') return null;
  if (op === 'clarify') {
    return { op: 'clarify', question: typeof record.question === 'string' ? record.question : '' };
  }
  if (op === 'unsupported') {
    return { op: 'unsupported', reason: typeof record.reason === 'string' ? record.reason : '' };
  }
  // Concrete edit commands are shape-validated by the runtime.
  return record as unknown as AgentCommand;
}

function extractJson(text: string): string | null {
  const fenced = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1] && fenced[1].trim() !== '') {
    return fenced[1].trim();
  }

  const trimmed = text.trim();
  if (looksLikeJson(trimmed)) return trimmed;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char !== '{' && char !== '[') continue;
    const end = matchJsonEnd(trimmed, index);
    if (end !== null) return trimmed.slice(index, end + 1);
  }
  return null;
}

function stripJsonFromText(text: string): string {
  let result = text.replace(/```(?:json|JSON)?\s*[\s\S]*?```/g, ' ');
  for (let index = 0; index < result.length; index += 1) {
    const char = result[index];
    if (char !== '{' && char !== '[') continue;
    const end = matchJsonEnd(result, index);
    if (end !== null) {
      result = `${result.slice(0, index)} ${result.slice(end + 1)}`;
      break;
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}

function matchJsonEnd(text: string, start: number): number | null {
  const open = text[start];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function looksLikeJson(text: string): boolean {
  return (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  );
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}
