import type { Project } from '@editbay/core';

export type MediaKind = 'video' | 'image' | 'audio';

export interface PickedMedia {
  path: string;
  label: string;
  kind: MediaKind;
  durationMs?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  thumbnail?: string;
}

export interface ProbeDTO {
  durationMs: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
}

export interface FilmstripOptionsDTO {
  inMs?: number;
  outMs?: number;
  count?: number;
  width?: number;
}

export interface PeaksOptionsDTO {
  buckets?: number;
  inMs?: number;
  outMs?: number;
}

export interface ExportRequestDTO {
  project: Project;
  assetPaths: Record<string, string>;
  outPath: string;
  quality: 'draft' | 'standard' | 'high';
}

export interface ExportProgressDTO {
  fraction: number;
  frame?: number;
  fps?: number;
  speed?: string;
}

export interface ExportDoneDTO {
  ok: boolean;
  outPath?: string;
  error?: string;
  elapsedMs?: number;
}

export interface AppInfoDTO {
  version: string;
  platform: string;
  arch: string;
  ffmpegPath: string | null;
  ffmpegVersion: string | null;
  workspaceRoot: string;
  userData: string;
}

export interface ChatMessageDTO {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  name?: string;
}

export interface ChatRequestDTO {
  /** Correlates the request with `llm.abort` so the main process can cancel it. */
  requestId?: string;
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  messages: ChatMessageDTO[];
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponseDTO {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
}

export interface EditbayApi {
  appInfo(): Promise<AppInfoDTO>;
  pickMedia(): Promise<PickedMedia[]>;
  pickLogo(): Promise<string | null>;
  probeMedia(path: string): Promise<ProbeDTO>;
  thumbnail(path: string, atMs?: number, width?: number): Promise<string>;
  filmstrip(path: string, opts?: FilmstripOptionsDTO | number[], width?: number): Promise<string[]>;
  peaks(path: string, opts?: PeaksOptionsDTO | number): Promise<number[]>;
  mediaUrl(path: string): string;
  saveVideoDialog(defaultName: string): Promise<string | null>;
  exportVideo(req: ExportRequestDTO): Promise<ExportDoneDTO>;
  onExportProgress(cb: (p: ExportProgressDTO) => void): () => void;
  openProjectDialog(): Promise<{ path: string; content: string } | null>;
  saveProject(content: string, path?: string): Promise<string | null>;
  saveProjectAs(content: string, defaultName: string): Promise<string | null>;
  secrets: {
    /** Never returns key material; only whether a key is stored. */
    has(key: string): Promise<boolean>;
    set(key: string, value: string): Promise<{ encrypted: boolean }>;
    delete(key: string): Promise<void>;
  };
  workspace: {
    root(): Promise<string>;
    read(rel: string): Promise<string | null>;
    write(rel: string, content: string): Promise<void>;
    append(rel: string, content: string): Promise<void>;
    list(rel: string): Promise<Array<{ path: string; name: string; size: number; updatedAt: string }>>;
    remove(rel: string): Promise<boolean>;
    exists(rel: string): Promise<boolean>;
  };
  llm: {
    chat(req: ChatRequestDTO): Promise<ChatResponseDTO>;
    abort(requestId: string): Promise<void>;
    listModels(providerId: string, apiKey: string, baseUrl?: string): Promise<Array<{ id: string; label: string }>>;
  };
  auth: {
    openrouter(): Promise<{ ok: boolean; error?: string }>;
  };
  openExternal(url: string): Promise<void>;
  revealInFolder(path: string): Promise<void>;
}
