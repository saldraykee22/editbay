import type { AgentCommand, ApplyResult, BatchResult, Project } from '@editbay/core';
import type {
  EffectCatalog,
  EffectDefinition,
  TransitionDefinition,
} from '@editbay/effects';
import type { AgentRuntime, ToolCall, ToolSpec } from './types';
import { asRecord } from './providers/base';

export interface ToolContext {
  runtime?: AgentRuntime;
}

export interface ToolResult {
  ok: boolean;
  /** One-line human summary used by the agent's tool_end event. */
  summary: string;
  /** Structured result sent back to the model. Never contains asset URIs. */
  data?: unknown;
  /** Set by ask_user so the agent can stop and surface the question. */
  clarification?: string;
  /** Commands applied by this tool call (apply_commands / undo). */
  commands?: AgentCommand[];
  applied?: ApplyResult[];
}

export const AGENT_TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'read_project',
    description:
      'Read the current project state: canvas, assets (labels only, never file paths), tracks, clips, text items and effects. Call this before editing when ids are unknown.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_assets',
    description: 'List project media assets with ids, kinds, labels and durations. File paths are never exposed.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'apply_commands',
    description:
      'Apply one or more editing commands in order. Use only ids that exist in the project. Commands stop at the first failure: earlier commands in the batch stay applied and the rest are skipped. Returns a per-command result list plus a skipped count. This tool is the only way to change the project.',
    parameters: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          description: 'Ordered array of editing command objects (op + fields).',
          items: { type: 'object', additionalProperties: true },
        },
      },
      required: ['commands'],
      additionalProperties: false,
    },
  },
  {
    name: 'undo',
    description: 'Undo the most recent applied command batch. Use only when the user explicitly asks to undo.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_memory',
    description: 'Search saved brand notes and preferences. Use before making brand-sensitive creative decisions.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to search for.' },
        limit: { type: 'number', description: 'Maximum number of notes (default 5).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'remember',
    description: 'Save a durable user preference, brand fact or production decision for future turns.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short descriptive title.' },
        body: { type: 'string', description: 'The fact or preference, with enough context to be useful later.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional keywords.' },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_skills',
    description: 'List available editing skills (workflows, style guides, brand playbooks).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_skill',
    description: 'Read a skill and follow its instructions for the current task.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id from list_skills.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_skill',
    description:
      'Create or update a reusable skill with markdown instructions. Use when the user asks to save a workflow or style as a skill.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Lowercase kebab-case id.' },
        name: { type: 'string', description: 'Human name.' },
        description: { type: 'string', description: 'One sentence describing when to use it.' },
        triggers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Phrases that should activate this skill.',
        },
        body: { type: 'string', description: 'Markdown instructions.' },
        version: { type: 'string', description: 'Optional version label.' },
      },
      required: ['id', 'name', 'description', 'triggers', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_effects',
    description: 'List valid effect and transition type ids with their parameters and defaults.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ask_user',
    description:
      'Ask the user a clarifying question when the request is ambiguous and a wrong edit would be costly. Do not guess.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'One focused question.' },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
];

export interface ToolSpecOptions {
  /**
   * When false (proposal mode), `apply_commands` is omitted because the model
   * must not be able to change the project without user approval.
   */
  autoApply?: boolean;
}

export function buildToolSpecs(options: ToolSpecOptions = {}): ToolSpec[] {
  return AGENT_TOOL_SPECS.filter(
    (spec) => options.autoApply !== false || spec.name !== 'apply_commands',
  ).map((spec) => ({ ...spec }));
}

export function createToolExecutor(
  context: ToolContext,
): (call: ToolCall) => Promise<ToolResult> {
  return (call) => executeTool(call, context);
}

/** Execute one tool call. Never throws: errors become `ok: false` results. */
export async function executeTool(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  try {
    switch (call.name) {
      case 'read_project':
        return readProject(context);
      case 'list_assets':
        return listAssets(context);
      case 'apply_commands':
        return applyCommands(call.arguments, context);
      case 'undo':
        return undo(context);
      case 'search_memory':
        return searchMemory(call.arguments, context);
      case 'remember':
        return remember(call.arguments, context);
      case 'list_skills':
        return listSkills(context);
      case 'read_skill':
        return readSkill(call.arguments, context);
      case 'write_skill':
        return writeSkill(call.arguments, context);
      case 'list_effects':
        return listEffects(context);
      case 'ask_user':
        return askUser(call.arguments);
      default:
        return failure(`Unknown tool: ${call.name}`);
    }
  } catch (error) {
    return failure(errorMessage(error));
  }
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

function readProject(context: ToolContext): ToolResult {
  const runtime = requireRuntime(context);
  const project = runtime.project();
  const clipCount = project.tracks.reduce((sum, track) => sum + track.clips.length, 0);
  const textCount = project.tracks.reduce((sum, track) => sum + track.items.length, 0);
  return {
    ok: true,
    summary: `Read project "${project.name}" (${project.assets.length} assets, ${clipCount} clips, ${textCount} texts).`,
    data: { project: safeProject(project) },
  };
}

function listAssets(context: ToolContext): ToolResult {
  const runtime = requireRuntime(context);
  const assets = safeAssets(runtime.project());
  return {
    ok: true,
    summary: `Listed ${assets.length} assets.`,
    data: { assets },
  };
}

function applyCommands(
  input: Record<string, unknown>,
  context: ToolContext,
): ToolResult {
  const runtime = requireRuntime(context);
  // Proposal mode is enforced here as well as in the tool schema: even a model
  // that emits a stale tool call cannot mutate the project.
  if (runtime.settings.autoApply === false) {
    return failure(
      'Proposal mode is on (autoApply is false): apply_commands cannot change the project. Return the commands as a JSON proposal instead.',
    );
  }
  const rawCommands = input.commands;
  if (!Array.isArray(rawCommands)) {
    return failure('apply_commands expects { commands: [...] }');
  }
  if (rawCommands.length === 0) {
    return { ok: true, summary: 'No commands to apply.', data: { ok: true, results: [], skipped: 0 } };
  }

  const commands: AgentCommand[] = [];
  for (const [index, raw] of rawCommands.entries()) {
    const record = asRecord(raw);
    if (!record || typeof record.op !== 'string' || record.op.trim() === '') {
      return failure(`Command at index ${index} is not an object with a string "op" field`);
    }
    // The runtime validates the concrete command shape and ranges.
    commands.push(record as unknown as AgentCommand);
  }

  // `clarify` / `unsupported` are replies, not edits. They must reach the user
  // instead of being filtered out as "Applied 0 of 0" and looping the model.
  const reply = commands.find(
    (command) => command.op === 'clarify' || command.op === 'unsupported',
  );
  if (reply) {
    const text = reply.op === 'clarify' ? reply.question : reply.reason;
    if (typeof text !== 'string' || text.trim() === '') {
      return failure(
        `apply_commands: "${reply.op}" needs a non-empty ${
          reply.op === 'clarify' ? 'question' : 'reason'
        }`,
      );
    }
    return {
      ok: true,
      summary: text,
      data: { ok: true, reply: { op: reply.op, text }, results: [], skipped: 0 },
      clarification: text,
    };
  }

  const batch: BatchResult = runtime.applyCommands(commands);
  const perCommand = batch.results.map((result) =>
    result.ok
      ? {
          ok: true,
          op: result.command.op,
          changes: result.changes,
          createdIds: result.createdIds,
        }
      : { ok: false, op: result.command.op, error: result.error },
  );
  const failed = perCommand.filter((result) => !result.ok).length;
  const applied = perCommand.length - failed;
  // The core batch stops at the first failure and keeps the successful prefix,
  // so any command after the failure never ran.
  const skipped = Math.max(0, commands.length - perCommand.length);

  const summary = batch.ok
    ? `Applied ${applied} command${applied === 1 ? '' : 's'}.`
    : skipped > 0
      ? `Applied ${applied} of ${commands.length} commands; ${failed} failed and ${skipped} skipped because the batch stops at the first failure.`
      : `Applied ${applied} of ${perCommand.length} commands; ${failed} failed.`;

  return {
    ok: batch.ok,
    summary,
    data: { ok: batch.ok, results: perCommand, changes: batch.changes, skipped },
    commands,
    applied: batch.results,
  };
}

function undo(context: ToolContext): ToolResult {
  const runtime = requireRuntime(context);
  const undoable = runtime as AgentRuntime & { undo?: () => BatchResult };
  if (typeof undoable.undo !== 'function') {
    return failure('Undo is not available in this runtime.');
  }
  const batch = undoable.undo();
  return {
    ok: batch.ok,
    summary: batch.ok ? 'Undid the last command batch.' : 'Undo failed.',
    data: {
      ok: batch.ok,
      changes: batch.changes,
      results: batch.results.map((result) =>
        result.ok
          ? { ok: true, op: result.command.op, changes: result.changes }
          : { ok: false, op: result.command.op, error: result.error },
      ),
    },
  };
}

async function searchMemory(
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const runtime = requireRuntime(context);
  const query = typeof input.query === 'string' ? input.query : '';
  if (query.trim() === '') return failure('search_memory needs a non-empty "query"');
  const limit = clampInt(input.limit, 5, 1, 20);
  const entries = await runtime.memory.search(query, limit);
  return {
    ok: true,
    summary: `Found ${entries.length} memory note${entries.length === 1 ? '' : 's'}.`,
    data: { entries },
  };
}

async function remember(
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const runtime = requireRuntime(context);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body : '';
  if (title === '') return failure('remember needs a non-empty "title"');
  if (body.trim() === '') return failure('remember needs a non-empty "body"');
  const entry = await runtime.memory.remember({
    title,
    body,
    tags: stringList(input.tags),
    source: 'agent',
  });
  return {
    ok: true,
    summary: `Saved memory note "${entry.title}".`,
    data: { entry },
  };
}

async function listSkills(context: ToolContext): Promise<ToolResult> {
  const runtime = requireRuntime(context);
  const skills = await runtime.skills.list();
  return {
    ok: true,
    summary: `Listed ${skills.length} skills.`,
    data: {
      skills: skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        triggers: skill.triggers,
        builtin: skill.builtin ?? false,
        hasCode: skill.hasCode,
      })),
    },
  };
}

async function readSkill(
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const runtime = requireRuntime(context);
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (id === '') return failure('read_skill needs a skill "id"');
  const skill = await runtime.skills.get(id);
  if (!skill) return failure(`Skill not found: ${id}`);
  return {
    ok: true,
    summary: `Read skill "${skill.name}".`,
    data: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      triggers: skill.triggers,
      body: skill.body,
      hasCode: skill.hasCode,
    },
  };
}

async function writeSkill(
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const runtime = requireRuntime(context);
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const description = typeof input.description === 'string' ? input.description : '';
  const body = typeof input.body === 'string' ? input.body : '';
  if (id === '') return failure('write_skill needs an "id"');
  if (name === '') return failure('write_skill needs a "name"');
  if (body.trim() === '') return failure('write_skill needs a markdown "body"');

  const skill = await runtime.skills.save({
    id,
    name,
    description,
    triggers: stringList(input.triggers),
    body,
    ...(typeof input.version === 'string' ? { version: input.version } : {}),
  });
  return {
    ok: true,
    summary: `Saved skill "${skill.name}".`,
    data: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      triggers: skill.triggers,
      hasCode: skill.hasCode,
    },
  };
}

function listEffects(context: ToolContext): ToolResult {
  const runtime = requireRuntime(context);
  const { effects, transitions } = catalogContents(runtime.effects);
  return {
    ok: true,
    summary: `Listed ${effects.length} effects and ${transitions.length} transitions.`,
    data: {
      effects: effects.map((effect) => ({
        id: effect.id,
        name: effect.name,
        category: effect.category,
        description: effect.description,
        params: effect.params.map((param) => ({
          key: param.key,
          label: param.label,
          type: param.type,
          default: param.default,
          ...(param.min !== undefined ? { min: param.min } : {}),
          ...(param.max !== undefined ? { max: param.max } : {}),
          ...(param.unit !== undefined ? { unit: param.unit } : {}),
          ...(param.options !== undefined ? { options: param.options } : {}),
        })),
      })),
      transitions: transitions.map((transition) => ({
        id: transition.id,
        name: transition.name,
        description: transition.description,
        defaultDurationMs: transition.defaultDurationMs,
      })),
    },
  };
}

function askUser(input: Record<string, unknown>): ToolResult {
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (question === '') return failure('ask_user needs a non-empty "question"');
  return {
    ok: true,
    summary: question,
    data: { question },
    clarification: question,
  };
}

/* ------------------------------------------------------------------ */
/* Project sanitizing                                                  */
/* ------------------------------------------------------------------ */

/** Project snapshot with every asset URI removed. */
export function safeProject(project: Project): Record<string, unknown> {
  return { ...project, assets: safeAssets(project) };
}

export function safeAssets(project: Project): Array<Record<string, unknown>> {
  return project.assets.map((asset) => {
    const { uri: _uri, thumbnailUri: _thumbnailUri, ...safe } = asset;
    return safe as Record<string, unknown>;
  });
}

/* ------------------------------------------------------------------ */
/* Effect catalog access                                               */
/* ------------------------------------------------------------------ */

interface EffectCatalogLike {
  listEffects?: () => EffectDefinition[];
  listTransitions?: () => TransitionDefinition[];
  effects?: EffectDefinition[];
  transitions?: TransitionDefinition[];
}

/**
 * Read effects from either the current class-based catalog or a plain
 * `{ effects, transitions }` test double.
 */
export function catalogContents(catalog: EffectCatalog): {
  effects: EffectDefinition[];
  transitions: TransitionDefinition[];
} {
  const like = catalog as unknown as EffectCatalogLike;
  const effects =
    typeof like.listEffects === 'function' ? like.listEffects() : like.effects ?? [];
  const transitions =
    typeof like.listTransitions === 'function'
      ? like.listTransitions()
      : like.transitions ?? [];
  return { effects, transitions };
}

export function effectIdsFromCatalog(catalog: EffectCatalog): string[] {
  return catalogContents(catalog).effects.map((effect) => effect.id);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function requireRuntime(context: ToolContext): AgentRuntime {
  if (!context.runtime) {
    throw new Error('Agent runtime is not available for tool execution');
  }
  return context.runtime;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function failure(message: string): ToolResult {
  return { ok: false, summary: message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
