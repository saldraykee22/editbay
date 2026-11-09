/**
 * H.264 encoder discovery and quality mapping.
 *
 * Editbay ships an LGPL FFmpeg build (`--disable-gpl`), which has no `libx264`.
 * Hardcoding it made every export fail on a compliant binary. The engine now
 * probes `ffmpeg -encoders` once per binary and picks the best available
 * encoder in a fixed preference order; `EDITBAY_VIDEO_ENCODER` always wins.
 *
 * The probe is synchronous and cached because `buildRenderPlan` is a pure,
 * synchronous function. One `ffmpeg -encoders` call costs ~80 ms; every later
 * plan reuses the cached list for that binary path.
 */
import { spawnSync } from 'node:child_process';
import { resolveFfmpeg } from './ffmpeg';
import type { ExportQuality } from './types';

/** Preference order: GPL libx264 first, then LGPL/hardware alternatives. */
export const VIDEO_ENCODER_CANDIDATES = [
  'libx264',
  'libopenh264',
  'h264_videotoolbox',
  'h264_mf',
  'h264_nvenc',
] as const;

export type KnownVideoEncoder = (typeof VIDEO_ENCODER_CANDIDATES)[number];

export interface VideoEncoderChoice {
  encoder: string;
  /** How the encoder was chosen. */
  source: 'option' | 'env' | 'auto' | 'fallback';
  /** Set whenever the chosen encoder is not the preferred libx264. */
  warning?: string;
}

const encoderCache = new Map<string, readonly string[]>();

/** Extract video encoder names from `ffmpeg -encoders` output. */
export function parseEncoderNames(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    // Encoder rows look like ` V....D libx264   H.264 / AVC ...`.
    const match = /^\s*V\S*\s+(\S+)/.exec(line);
    const name = match?.[1];
    // Skip the legend rows (` V..... = Video`), which parse as "=".
    if (name && name !== '=') names.push(name);
  }
  return names;
}

/** Video encoders compiled into the resolved binary (cached per path). */
export function availableVideoEncoders(ffmpegPath: string = resolveFfmpeg()): readonly string[] {
  const cached = encoderCache.get(ffmpegPath);
  if (cached) return cached;

  const result = spawnSync(ffmpegPath, ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const names = result.status === 0 ? parseEncoderNames(stdout) : [];
  const frozen = Object.freeze(names);
  encoderCache.set(ffmpegPath, frozen);
  return frozen;
}

/** Drop the probe cache (tests and binary hot-swaps). */
export function clearEncoderCache(): void {
  encoderCache.clear();
}

export interface SelectVideoEncoderOptions {
  /** Explicit encoder from the caller; beats the environment variable. */
  override?: string;
  ffmpegPath?: string;
  /** Probed encoder names; defaults to a cached probe of the resolved binary. */
  available?: readonly string[];
}

/**
 * Resolve the video encoder for an export.
 *
 * `EDITBAY_VIDEO_ENCODER` / an explicit option are trusted as-is; otherwise the
 * first candidate present in the probed encoder list wins.
 */
export function selectVideoEncoder(options: SelectVideoEncoderOptions = {}): VideoEncoderChoice {
  const explicitOption = options.override?.trim();
  const explicitEnv = process.env.EDITBAY_VIDEO_ENCODER?.trim();
  const explicit = explicitOption || explicitEnv;
  if (explicit) {
    return { encoder: explicit, source: explicitOption ? 'option' : 'env' };
  }

  const available = options.available ?? availableVideoEncoders(options.ffmpegPath);
  const preferred = VIDEO_ENCODER_CANDIDATES.find((candidate) => available.includes(candidate));

  if (!preferred) {
    // Either the probe failed or the build has no known H.264 encoder. Keep the
    // historical behaviour so the user sees ffmpeg's own error instead of ours.
    return {
      encoder: 'libx264',
      source: 'fallback',
      warning: 'No supported H.264 encoder was detected in this FFmpeg build; falling back to libx264.',
    };
  }

  if (preferred === 'libx264') return { encoder: preferred, source: 'auto' };

  return {
    encoder: preferred,
    source: 'auto',
    warning: `libx264 is not available in this FFmpeg build; using ${preferred} instead.`,
  };
}

/** Quality preset for x264-like encoders (`-preset` / `-crf`). */
export interface EncoderQualityPreset {
  preset: string;
  crf: string;
}

export interface VideoEncoderArgsInput {
  encoder: string;
  quality: ExportQuality;
  preset: EncoderQualityPreset;
  width: number;
  height: number;
  fps: number;
}

/** Encoders that understand x264's `-preset` and `-crf` private options. */
export function isX264Like(encoder: string): boolean {
  return encoder === 'libx264' || encoder === 'libx264rgb';
}

/**
 * Target bitrate for encoders without a CRF mode. Derived from pixel throughput
 * so a 4K export gets a proportionally larger budget than a thumbnail test.
 */
export function videoBitrateKbps(quality: ExportQuality, width: number, height: number, fps: number): number {
  const bitsPerPixel = quality === 'draft' ? 0.05 : quality === 'high' ? 0.16 : 0.1;
  const pixels = Math.max(1, Math.round(width)) * Math.max(1, Math.round(height));
  const rate = Math.round((pixels * Math.max(1, fps) * bitsPerPixel) / 1000);
  return Math.min(40_000, Math.max(600, rate));
}

/**
 * `-c:v` plus quality flags for the chosen encoder. x264-like encoders keep the
 * preset/crf mapping; everything else gets an explicit bitrate budget.
 */
export function videoEncoderArgs(input: VideoEncoderArgsInput): string[] {
  const args = ['-c:v', input.encoder];
  if (isX264Like(input.encoder)) {
    args.push('-preset', input.preset.preset, '-crf', input.preset.crf);
    return args;
  }

  const kbps = videoBitrateKbps(input.quality, input.width, input.height, input.fps);
  args.push('-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`);
  return args;
}
