import type { EffectParam } from '@editbay/core';

export type { EffectParam };

export type EffectCategory = 'motion' | 'color' | 'texture' | 'audio';

export interface EffectParamSpec {
  key: string;
  label: string;
  type: 'number' | 'color' | 'select' | 'boolean' | 'text';
  default: EffectParam;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
}

/**
 * Frame styling computed from an effect. The compositor applies these on top
 * of the clip transform; export maps the same definition to an ffmpeg filter.
 */
export interface FrameStyle {
  /** Multiplied with the clip opacity. */
  opacity?: number;
  /** Multiplied with the clip scale. */
  scale?: number;
  /** Canvas-relative translation. */
  translateX?: number;
  translateY?: number;
  /** Degrees added to the clip rotation. */
  rotate?: number;
  /** CSS/canvas filter string, e.g. "blur(6px) saturate(1.2)". */
  filter?: string;
}

export interface EffectRenderContext {
  /** Normalized progress inside the effect window, 0..1. */
  progress: number;
  /** Milliseconds since the effect window started. */
  timeMs: number;
  /** Effect window length. */
  durationMs: number;
  /** Full clip length. */
  clipDurationMs: number;
  width: number;
  height: number;
  params: Record<string, EffectParam>;
}

export interface FfmpegEffectMeta {
  /** Effect window in seconds. */
  startSec: number;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
}

export interface EffectDefinition {
  id: string;
  name: string;
  category: EffectCategory;
  description: string;
  params: EffectParamSpec[];
  builtin: boolean;
  /** Preview styling. Must be pure and cheap (runs per frame). */
  style?: (ctx: EffectRenderContext) => FrameStyle;
  /**
   * ffmpeg video filter expression for export, applied to the clip stream after
   * scale/pad. Return null when the effect cannot be expressed; the exporter
   * then falls back to preview-quality approximation.
   */
  ffmpeg?: (params: Record<string, EffectParam>, meta: FfmpegEffectMeta) => string | null;
}

export interface TransitionDefinition {
  id: string;
  name: string;
  description: string;
  defaultDurationMs: number;
  /** ffmpeg xfade transition name. */
  xfade: string;
  builtin: boolean;
}


