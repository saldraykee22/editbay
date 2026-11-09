import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatUsage,
  ModelInfo,
  Provider,
  ProviderConfig,
  ToolCall,
  ToolSpec,
} from '../types';
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  emptyResponseError,
  joinUrl,
  mergeHeaders,
  sendRequest,
  type FetchLike,
} from './base';

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-5';
export const ANTHROPIC_API_VERSION = '2023-06-01';

export interface AnthropicProviderOptions {
  id?: string;
  label?: string;
  requiresApiKey?: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
  /** Injection point for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
}

/**
 * Anthropic Messages API provider.
 *
 * The harness keeps `system` messages in the message list; this adapter moves
 * them into the top-level `system` field and maps tool messages to
 * `tool_result` blocks inside user turns.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions = {}): Provider {
  const id = options.id ?? 'anthropic';
  const label = options.label ?? 'Anthropic';
  const defaultBaseUrl = options.defaultBaseUrl ?? ANTHROPIC_DEFAULT_BASE_URL;
  const defaultModel = options.defaultModel ?? ANTHROPIC_DEFAULT_MODEL;
  const requiresApiKey = options.requiresApiKey ?? true;

  const chat = async (req: ChatRequest, config: ProviderConfig = {}): Promise<ChatResponse> => {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const baseUrl = config.baseUrl?.trim() || defaultBaseUrl;
    const url = joinUrl(baseUrl, 'messages');
    const model = config.model?.trim() || req.model?.trim() || defaultModel;
    const { system, messages } = toAnthropicMessages(req.messages);

    const headers = mergeHeaders(
      {
        'content-type': 'application/json',
        'anthropic-version': ANTHROPIC_API_VERSION,
        ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
      },
      config.headers,
    );

    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 4096,
      messages,
    };
    if (system !== '') body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools !== undefined && req.tools.length > 0) {
      body.tools = req.tools.map(toAnthropicTool);
    }

    const parsed = await sendRequest(
      fetchImpl,
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(req.signal !== undefined ? { signal: req.signal } : {}),
      },
      label,
    );

    return parseAnthropicResponse(parsed.payload, label);
  };

  const listModels = async (config: ProviderConfig = {}): Promise<ModelInfo[]> => {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const baseUrl = config.baseUrl?.trim() || defaultBaseUrl;
    const url = joinUrl(baseUrl, 'models');
    const headers = mergeHeaders(
      {
        'anthropic-version': ANTHROPIC_API_VERSION,
        ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
      },
      config.headers,
    );
    const parsed = await sendRequest(fetchImpl, url, { method: 'GET', headers }, label);
    const record = asRecord(parsed.payload);
    const models: ModelInfo[] = [];
    for (const item of asArray(record?.data)) {
      const entry = asRecord(item);
      const modelId = asString(entry?.id);
      if (!modelId) continue;
      models.push({
        id: modelId,
        label: asString(entry?.display_name) ?? modelId,
        ...(asNumber(entry?.context_window) !== undefined
          ? { contextWindow: asNumber(entry?.context_window) }
          : {}),
      });
    }
    return models;
  };

  return {
    id,
    label,
    requiresApiKey,
    defaultBaseUrl,
    defaultModel,
    chat,
    listModels,
  };
}

export const anthropicProvider: Provider = createAnthropicProvider();

/* ------------------------------------------------------------------ */
/* Request mapping                                                     */
/* ------------------------------------------------------------------ */

function toAnthropicTool(tool: ToolSpec): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

interface AnthropicConversation {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: Array<Record<string, unknown>> }>;
}

function toAnthropicMessages(messages: ChatMessage[]): AnthropicConversation {
  const systems: string[] = [];
  const conversation: AnthropicConversation['messages'] = [];

  const push = (role: 'user' | 'assistant', blocks: Array<Record<string, unknown>>): void => {
    if (blocks.length === 0) return;
    const last = conversation[conversation.length - 1];
    if (last && last.role === role) {
      last.content.push(...blocks);
      return;
    }
    conversation.push({ role, content: blocks });
  };

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim() !== '') systems.push(message.content);
      continue;
    }
    if (message.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId ?? '',
          content: message.content,
        },
      ]);
      continue;
    }
    if (message.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = [];
      if (message.content !== '') blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      push('assistant', blocks);
      continue;
    }
    push('user', [{ type: 'text', text: message.content }]);
  }

  return { system: systems.join('\n\n'), messages: conversation };
}

/* ------------------------------------------------------------------ */
/* Response mapping                                                    */
/* ------------------------------------------------------------------ */

function parseAnthropicResponse(payload: unknown, label: string): ChatResponse {
  const record = asRecord(payload);
  if (!record) {
    throw new Error(`Unexpected response shape from ${label}: expected a JSON object`);
  }

  const texts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const [index, rawBlock] of asArray(record.content).entries()) {
    const block = asRecord(rawBlock);
    const type = asString(block?.type);
    if (type === 'text') {
      texts.push(asString(block?.text) ?? '');
    } else if (type === 'tool_use') {
      const name = asString(block?.name);
      if (!name) continue;
      toolCalls.push({
        id: asString(block?.id) ?? `toolu_${index}`,
        name,
        arguments: asRecord(block?.input) ?? {},
      });
    }
  }

  const text = texts.join('');
  if (text === '' && toolCalls.length === 0) throw emptyResponseError(label);

  const usage: ChatUsage | undefined = parseUsage(record.usage);
  const finishReason = asString(record.stop_reason);

  return {
    text,
    toolCalls,
    ...(usage !== undefined ? { usage } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
  };
}

function parseUsage(value: unknown): ChatUsage | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    inputTokens: asNumber(record.input_tokens) ?? 0,
    outputTokens: asNumber(record.output_tokens) ?? 0,
  };
}
