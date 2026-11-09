import type { Project } from '@editbay/core';

export interface ProbeResult {
  durationMs: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  rotation?: number;
}

export type ExportQuality = 'draft' | 'standard' | 'high';

export interface ExportProgress {
  /** 0..1 */
  fraction: number;
  frame?: number;
  fps?: number;
  speed?: string;
  outTimeMs?: number;
}

export interface ExportOptions {
  outPath: string;
  /** assetId -> absolute file path. */
  assetPaths: Record<string, string>;
  quality?: ExportQuality;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  outPath: string;
  durationMs: number;
  sizeBytes: number;
  elapsedMs: number;
  /** H.264 encoder used for this export (e.g. `libx264`, `libopenh264`). */
  videoEncoder: string;
}

export interface RenderPlan {
  /** Full argv for ffmpeg (without the binary). */
  args: string[];
  filterGraph: string;
  durationMs: number;
  /** Input file paths in ffmpeg input order. */
  inputs: string[];
  /** H.264 encoder chosen for this plan. */
  videoEncoder: string;
}

export interface ThumbnailOptions {
  atMs?: number;
  width?: number;
  height?: number;
  outPath?: string;
}

export interface FfmpegInfo {
  path: string;
  version: string;
  source: 'env' | 'bundled' | 'path';
}

export type { Project };
