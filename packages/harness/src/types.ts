import type { AgentCommand, ApplyResult, BatchResult, Project } from '@editbay/core';
import type { EffectCatalog } from '@editbay/effects';

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export type JsonSchema = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  name?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  usage?: ChatUsage;
  finishReason?: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  contextWindow?: number;
}

export interface Provider {
  id: string;
  label: string;
  requiresApiKey: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse>;
  listModels?(config: ProviderConfig): Promise<ModelInfo[]>;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  headers?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Workspace (local, file based, human readable — like a vault)        */
/* ------------------------------------------------------------------ */

export interface WorkspaceFile {
  path: string;
  name: string;
  size: number;
  updatedAt: string;
}

export interface Workspace {
  /** Absolute root, e.g. `<userData>/workspace` or a project folder. */
  readonly root: string;
  read(relativePath: string): Promise<string | null>;
  write(relativePath: string, content: string): Promise<void>;
  append(relativePath: string, content: string): Promise<void>;
  list(relativeDir: string): Promise<WorkspaceFile[]>;
  remove(relativePath: string): Promise<boolean>;
  exists(relativePath: string): Promise<boolean>;
}

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  /** Natural-language triggers, used for lightweight matching. */
  triggers: string[];
  version?: string;
  builtin?: boolean;
  createdAt?: string;
}

export interface Skill extends SkillMeta {
  /** Markdown body (instructions for the agent). */
  body: string;
  /** Absolute directory that contains SKILL.md and optional code. */
  dir: string;
  /** True when the skill ships a code/ folder (effect modules, helpers). */
  hasCode: boolean;
}

/* ------------------------------------------------------------------ */
/* Memory (brand identity + notes + receipts)                          */
/* ------------------------------------------------------------------ */

export interface MemoryEntry {
  id: string;
  title: string;
  body: string;
  tags: string[];
  /** Where the fact came from: user, agent, import, system. */
  source: string;
  createdAt: string;
  path: string;
}

export interface BrandProfile {
  id: string;
  name: string;
  /** Free-form markdown: tone, products, audience, do/don't. */
  body: string;
  colors: string[];
  fonts: string[];
  logoPath?: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Agent                                                               */
/* ------------------------------------------------------------------ */

export interface AgentSettings {
  providerId: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Max tool round-trips per user turn. */
  maxSteps?: number;
  autoApply?: boolean;
}

export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'message'; text: string; delta?: boolean }
  | { type: 'tool_start'; call: ToolCall }
  | { type: 'tool_end'; call: ToolCall; ok: boolean; summary: string }
  | { type: 'proposal'; commands: AgentCommand[]; summary: string }
  | { type: 'applied'; results: ApplyResult[] }
  | { type: 'error'; message: string }
  | { type: 'done'; text: string };

export interface AgentRuntime {
  /** Current project snapshot. */
  project(): Project;
  /** Apply validated commands; returns per-command results. */
  applyCommands(commands: AgentCommand[]): BatchResult;
  workspace: Workspace;
  skills: SkillStore;
  memory: MemoryStore;
  effects: EffectCatalog;
  settings: AgentSettings;
}

export interface SkillStore {
  list(): Promise<Skill[]>;
  get(id: string): Promise<Skill | null>;
  save(skill: Omit<Skill, 'dir' | 'hasCode'> & { body: string }): Promise<Skill>;
  /** Skills relevant to a user request (keyword/trigger scoring). */
  match(query: string, limit?: number): Promise<Skill[]>;
}

export interface MemoryStore {
  listBrands(): Promise<BrandProfile[]>;
  getBrand(id: string): Promise<BrandProfile | null>;
  saveBrand(brand: BrandProfile): Promise<void>;
  entries(): Promise<MemoryEntry[]>;
  remember(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'path'>): Promise<MemoryEntry>;
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
}

export interface AgentTurnInput {
  text: string;
  /** Optional UI context: selected clip, playhead, etc. */
  selection?: { clipId?: string; itemId?: string; playheadMs?: number };
  attachments?: Array<{ label: string; kind: string; assetId?: string }>;
}

export interface Receipt {
  id: string;
  at: string;
  kind: 'agent_turn' | 'command_batch' | 'export' | 'skill_write' | 'memory_write';
  summary: string;
  detail?: Record<string, unknown>;
}
