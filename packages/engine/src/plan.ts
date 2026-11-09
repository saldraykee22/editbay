/**
 * Pure render-plan builder: project JSON in, ffmpeg argv + filter graph out.
 *
 * No filesystem writes happen here. Text overlays need real `.txt` files for
 * `drawtext=textfile=...`, so the plan returns their contents and paths as
 * `textFiles`; `export.ts` materialises them in a throwaway directory.
 */
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Asset, Clip, Project, TextStyle } from '@editbay/core';
import { effectCatalog } from '@editbay/effects';
import type { EffectCatalog, FfmpegEffectMeta } from '@editbay/effects';
import { selectVideoEncoder, videoEncoderArgs } from './encoder';
import { repoRoot } from './ffmpeg';
import {
  audibleTracks,
  clampSpeed,
  clipDurationMs,
  mainVideoTrack,
  overlayTracks,
  projectDurationMs,
  textItems,
  timelineOf,
  transitionXfadeName,
} from './timing';
import type { ExportQuality, RenderPlan } from './types';

export type RenderErrorCode = 'invalid' | 'missing_asset' | 'unsupported';

/** Validation failure that the UI can show verbatim. */
export class RenderError extends Error {
  readonly code: RenderErrorCode;

  constructor(message: string, code: RenderErrorCode = 'invalid') {
    super(message);
    this.name = 'RenderError';
    this.code = code;
  }
}

export interface RenderPlanOptions {
  /** assetId -> absolute file path. */
  assetPaths: Record<string, string>;
  quality?: ExportQuality;
  /**
   * Output path baked into the argv. Export always passes its temp path so the
   * plan is a complete, replayable command line. Defaults to `output.mp4`.
   */
  outPath?: string;
  /** Directory used for drawtext text files. Defaults to the OS temp dir. */
  textFileDir?: string;
  /** Explicit font file; defaults to `resolveFontPath()`. */
  fontPath?: string;
  /** Catalog override for workspaces and tests. */
  catalog?: EffectCatalog;
  /**
   * Pin the H.264 encoder instead of probing the binary. `EDITBAY_VIDEO_ENCODER`
   * has the same effect at the process level.
   */
  videoEncoder?: string;
  /** Probed encoder list override (tests avoid spawning ffmpeg). */
  availableEncoders?: readonly string[];
}

export interface TextFile {
  path: string;
  content: string;
}

/** RenderPlan plus the engine-only extras (text payloads, warnings, canvas). */
export interface EngineRenderPlan extends RenderPlan {
  textFiles: TextFile[];
  warnings: string[];
  width: number;
  height: number;
  fps: number;
  quality: ExportQuality;
}

export interface QualityPreset {
  preset: string;
  crf: string;
}

export const QUALITY_PRESETS: Record<ExportQuality, QualityPreset> = {
  draft: { preset: 'ultrafast', crf: '28' },
  standard: { preset: 'medium', crf: '21' },
  high: { preset: 'slow', crf: '18' },
};

const TEXT_MARGIN_PX = 48;

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

/** Milliseconds as seconds with 3 decimals. */
function sec(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/** Compact numeric literal for filter arguments. */
function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(rounded);
}

/**
 * Escape a filesystem path for use inside a filter option value.
 * Forward slashes avoid backslash madness; the Windows drive colon and quote
 * characters are backslash-escaped so the filtergraph parser keeps them.
 */
export function escapeFilterPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function filterPath(filePath: string): string {
  return `'${escapeFilterPath(filePath)}'`;
}

/** `#RRGGBB`, `#RRGGBBAA` or a plain name -> ffmpeg drawtext colour. */
export function toFfmpegColor(color: string | undefined): string {
  if (!color) return 'white';
  const clean = color.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(clean)) return `0x${clean.toUpperCase()}`;
  if (/^[0-9a-fA-F]{8}$/.test(clean)) {
    const alpha = parseInt(clean.slice(6), 16) / 255;
    return `0x${clean.slice(0, 6).toUpperCase()}@${alpha.toFixed(3)}`;
  }
  return color;
}

/* ------------------------------------------------------------------ */
/* Font resolution                                                     */
/* ------------------------------------------------------------------ */

const PLATFORM_FONT_FALLBACKS: Record<string, string[]> = {
  win32: ['C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf'],
  darwin: ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'],
  linux: ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'],
};

const BUNDLED_FONT_FILE = 'IBMPlexSans-SemiBold.ttf';

/**
 * `process.resourcesPath` only exists inside Electron. Read it defensively so
 * the engine stays a plain Node package.
 */
function electronResourcesPath(): string | undefined {
  const value = (process as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Bundled font locations, in priority order:
 *   1. Electron's `process.resourcesPath` (packaged desktop app)
 *   2. `EDITBAY_RESOURCES_DIR` (ported bundles, CLI/MCP installs)
 *   3. the monorepo's `apps/desktop/resources/fonts`
 */
function bundledFontCandidates(): string[] {
  const roots: string[] = [];
  const resourcesPath = electronResourcesPath();
  if (resourcesPath) roots.push(resourcesPath);
  const envDir = process.env.EDITBAY_RESOURCES_DIR;
  if (envDir) roots.push(envDir);

  const candidates: string[] = [];
  for (const root of roots) {
    candidates.push(path.join(root, 'fonts', BUNDLED_FONT_FILE));
    candidates.push(path.join(root, BUNDLED_FONT_FILE));
  }
  candidates.push(path.join(repoRoot(), 'apps', 'desktop', 'resources', 'fonts', BUNDLED_FONT_FILE));
  return candidates;
}

/**
 * Resolve a usable font file: explicit option, `EDITBAY_FONT`, a packaged
 * resource directory, the monorepo bundle, then platform fallbacks. Returns
 * undefined when nothing exists; drawtext then relies on fontconfig.
 */
export function resolveFontPath(explicit?: string): string | undefined {
  const candidates: Array<string | undefined> = [
    explicit,
    process.env.EDITBAY_FONT,
    ...bundledFontCandidates(),
    ...(PLATFORM_FONT_FALLBACKS[process.platform] ?? []),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Text overlays                                                       */
/* ------------------------------------------------------------------ */

function drawtextOptions(
  item: { style: TextStyle },
  textFile: TextFile,
  fontPath: string | undefined,
  width: number,
  height: number,
): string {
  const style = item.style;
  const options: string[] = [];
  if (fontPath) options.push(`fontfile=${filterPath(fontPath)}`);
  options.push(`textfile=${filterPath(textFile.path)}`);
  options.push(`fontsize=${Math.max(1, Math.round(style.fontSize))}`);
  options.push(`fontcolor=${toFfmpegColor(style.color)}`);

  const align = style.align ?? 'center';
  const anchorX = align === 'center' ? 0.5 : align === 'right' ? 1 : 0;
  const base =
    align === 'center'
      ? '(w-text_w)/2'
      : align === 'right'
        ? `w-text_w-${TEXT_MARGIN_PX}`
        : String(TEXT_MARGIN_PX);
  // `style.x` is a normalized anchor; only apply it when it moves away from the
  // alignment default, so the common case stays the plain spec expression.
  const offsetPx = Math.round(((style.x ?? anchorX) - anchorX) * width);
  const x = offsetPx === 0 ? base : `${base}${offsetPx > 0 ? '+' : '-'}${Math.abs(offsetPx)}`;
  const y = Math.max(0, Math.round((style.y ?? 0.5) * height));
  options.push(`x=${x}`);
  options.push(`y=${y}`);

  if (style.background) {
    options.push('box=1');
    options.push(`boxcolor=${toFfmpegColor(style.background)}`);
    options.push(`boxborderw=${Math.max(0, Math.round(style.padding ?? 12))}`);
  }
  if (style.shadow) {
    options.push('shadowcolor=black@0.6');
    options.push('shadowx=2');
    options.push('shadowy=2');
  }
  return `drawtext=${options.join(':')}`;
}

/* ------------------------------------------------------------------ */
/* Effects                                                            */
/* ------------------------------------------------------------------ */

/**
 * Split an ffmpeg filter chain on top-level commas. Commas inside single or
 * double quotes, parentheses or brackets belong to an expression argument and
 * must not split the chain (e.g. `drawtext=text='a,b'`).
 */
export function splitFilterChain(filter: string): string[] {
  const segments: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < filter.length; index += 1) {
    const char = filter[index];
    if (char === undefined) continue;

    if (quote) {
      current += char;
      if (char === '\\') {
        const escaped = filter[index + 1];
        if (escaped !== undefined) {
          current += escaped;
          index += 1;
        }
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    else if ((char === ')' || char === ']') && depth > 0) depth -= 1;

    if (char === ',' && depth === 0) {
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  segments.push(current);
  return segments;
}

/**
 * `:enable='between(t,a,b)'` on each top-level filter in a chain.
 *
 * `zoompan` is deliberately left alone: it rebuilds PTS from the frame counter
 * and cannot honour a timeline window, so the caller warns instead.
 */
export function withEnableWindow(filter: string, startSec: number, endSec: number): string {
  const window = `:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'`;
  return splitFilterChain(filter)
    .map((segment) => {
      if (segment.trimStart().startsWith('zoompan')) return segment;
      return segment.includes('enable=') ? segment : `${segment}${window}`;
    })
    .join(',');
}

/** True when a chain contains a filter that bakes absolute times into args. */
function hasOwnTimeWindow(filter: string): boolean {
  return splitFilterChain(filter).some((segment) => /^\s*(?:fade|zoompan)=/.test(segment));
}

function effectFilters(
  clip: Clip,
  catalog: EffectCatalog,
  meta: FfmpegEffectMeta,
  warnings: string[],
): string[] {
  const filters: string[] = [];
  const clipDurMs = clipDurationMs(clip);

  for (const instance of clip.effects ?? []) {
    const definition = catalog.effect(instance.type);
    if (!definition) {
      warnings.push(`Unknown effect "${instance.type}" on clip ${clip.id} was skipped.`);
      continue;
    }
    if (!definition.ffmpeg) {
      warnings.push(`Effect "${instance.type}" has no FFmpeg mapping and was skipped.`);
      continue;
    }

    const startMs = Math.max(0, instance.startMs ?? 0);
    if (startMs >= clipDurMs) {
      warnings.push(`Effect "${instance.type}" starts after its clip ends and was skipped.`);
      continue;
    }
    const windowMs = Math.min(clipDurMs - startMs, Math.max(1, instance.durationMs ?? clipDurMs));

    const params = catalog.resolveParams(instance);
    const effectMeta: FfmpegEffectMeta = {
      startSec: startMs / 1000,
      durationSec: windowMs / 1000,
      fps: meta.fps,
      width: meta.width,
      height: meta.height,
    };

    const filter = definition.ffmpeg(params, effectMeta);
    if (!filter) {
      warnings.push(`Effect "${instance.type}" returned no FFmpeg filter and was skipped.`);
      continue;
    }

    // A window smaller than the clip can only be honoured by timeline-aware
    // filters. fade/zoompan bake absolute times into their arguments, so the
    // window is ignored for them (documented engine limitation).
    const partialWindow = startMs > 0 || windowMs < clipDurMs;
    if (partialWindow) {
      if (hasOwnTimeWindow(filter)) {
        warnings.push(
          `Effect "${instance.type}" window was ignored: its FFmpeg filter is not timeline-aware, so it applies to the whole clip.`,
        );
      } else {
        filters.push(withEnableWindow(filter, startMs / 1000, (startMs + windowMs) / 1000));
        continue;
      }
    }
    filters.push(filter);
  }

  return filters;
}

/* ------------------------------------------------------------------ */
/* Transform                                                          */
/* ------------------------------------------------------------------ */

function isDefaultTransform(clip: Clip): boolean {
  const t = clip.transform;
  if (!t) return true;
  return t.x === 0 && t.y === 0 && t.scale === 1 && t.rotation === 0 && t.opacity === 1;
}

function transformFilters(clip: Clip): string[] {
  const t = clip.transform;
  if (!t) return [];
  // `format=rgba` first: scaling a yuv420p stream to an odd width/height (e.g.
  // 1080 * 0.501 = 541) fails chroma subsampling before any conversion happens.
  const filters: string[] = ['format=rgba'];
  if (t.scale !== 1) {
    const scale = Math.min(8, Math.max(0.05, t.scale));
    // Round down to even pixels, never below 2, so the scaled layer can always
    // be composited back onto the yuv420p canvas.
    filters.push(
      `scale=w='max(2,trunc(iw*${num(scale)}/2)*2)':h='max(2,trunc(ih*${num(scale)}/2)*2)'`,
    );
  }
  if (t.rotation !== 0) {
    filters.push(`rotate=${num((t.rotation * Math.PI) / 180)}:c=none:ow=rotw(iw):oh=roth(ih)`);
  }
  if (t.opacity < 1) filters.push(`colorchannelmixer=aa=${num(Math.max(0, t.opacity))}`);
  return filters;
}

/* ------------------------------------------------------------------ */
/* Audio                                                              */
/* ------------------------------------------------------------------ */

/**
 * Every audio branch is normalised to the encode target before mixing. ffmpeg
 * otherwise refuses to mix inputs with mismatched channel layouts.
 */
const AUDIO_NORMALIZE: readonly string[] = [
  'aresample=48000',
  'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo',
];

/** Fade-out applied when a music/voice-over clip is cut at the project end. */
export const AUTO_CUT_FADE_MS = 300;

/** atempo only supports 0.5..2, so extreme speeds are chained. */
export function atempoChain(speed: number): string[] {
  if (!Number.isFinite(speed) || speed <= 0) return [];
  if (Math.abs(speed - 1) < 1e-6) return [];
  const chain: string[] = [];
  let remaining = speed;
  let guard = 0;
  while ((remaining < 0.5 || remaining > 2) && guard < 8) {
    const factor = Math.max(0.5, Math.min(2, Math.sqrt(remaining)));
    chain.push(`atempo=${num(factor)}`);
    remaining /= factor;
    guard += 1;
  }
  chain.push(`atempo=${num(remaining)}`);
  return chain;
}

/* ------------------------------------------------------------------ */
/* Plan                                                               */
/* ------------------------------------------------------------------ */

export function normalizeAssetPath(uri: string): string {
  if (uri.startsWith('file://')) {
    try {
      return fileURLToPath(uri);
    } catch {
      return uri.slice('file://'.length);
    }
  }
  return uri;
}

function evenDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Build the complete ffmpeg command for a project.
 *
 * @throws {RenderError} when the project has no video clips, references an
 * unknown asset, or an asset has no resolvable file path.
 */
export function buildRenderPlan(project: Project, options: RenderPlanOptions): EngineRenderPlan {
  const warnings: string[] = [];
  const catalog = options.catalog ?? effectCatalog;
  const assetPaths = options.assetPaths ?? {};

  const main = mainVideoTrack(project);
  const videoClips = main?.clips ?? [];
  if (videoClips.length === 0) {
    throw new RenderError('Project has no video clips');
  }

  const width = evenDimension(project.canvas.width, 1080);
  const height = evenDimension(project.canvas.height, 1920);
  const fps = Number.isFinite(project.canvas.fps) && project.canvas.fps > 0 ? project.canvas.fps : 30;

  const warningsForOverlay = overlayTracks(project).some((track) => track.clips.length > 0);
  if (warningsForOverlay) {
    warnings.push('Overlay tracks are not composited by the FFmpeg engine yet; their clips were ignored.');
  }
  const videoTracks = project.tracks.filter((track) => track.kind === 'video' && !track.hidden);
  if (videoTracks.length > 1) {
    warnings.push('Only the first video track is rendered; additional video tracks were ignored.');
  }

  const assets = new Map<string, Asset>(project.assets.map((asset) => [asset.id, asset]));

  const assetFor = (clip: Clip): Asset => {
    const asset = assets.get(clip.assetId);
    if (!asset) {
      throw new RenderError(`Clip "${clip.id}" references missing asset "${clip.assetId}"`, 'missing_asset');
    }
    return asset;
  };

  const pathFor = (asset: Asset): string => {
    const fromOption = assetPaths[asset.id];
    const raw = fromOption ?? asset.uri;
    if (!raw) {
      throw new RenderError(`Asset "${asset.label}" (${asset.id}) has no file path`, 'missing_asset');
    }
    return normalizeAssetPath(raw);
  };

  const inputs: string[] = [];
  const inputArgs: string[] = [];
  const mainInputIndex = new Map<string, number>();

  const addInput = (
    assetPath: string,
    isImage: boolean,
    durationMs: number,
    seek?: { inMs: number; outMs: number },
  ): number => {
    const index = inputs.length;
    inputs.push(assetPath);
    if (isImage) {
      inputArgs.push('-loop', '1', '-t', sec(durationMs + 1000), '-i', assetPath);
    } else {
      // Input-level seeking stops each split clip from decoding its source from
      // 0. Video and its clip audio share this single input, so both branches
      // see the same timestamps and stay in sync; images have no timeline to
      // seek, and speed changes are applied after the seek (they only retime
      // the same source span), so both stay safe.
      const inMs = Math.max(0, seek?.inMs ?? 0);
      const outMs = Math.max(inMs, seek?.outMs ?? 0);
      if (inMs > 0) inputArgs.push('-ss', sec(inMs));
      if (outMs > inMs) inputArgs.push('-to', sec(outMs));
      inputArgs.push('-i', assetPath);
    }
    return index;
  };

  const lines: string[] = [];
  const mainTimeline = timelineOf(videoClips);
  const videoLabels: string[] = [];
  const singleClip = videoClips.length === 1;

  for (let index = 0; index < mainTimeline.clips.length; index += 1) {
    const entry = mainTimeline.clips[index];
    if (!entry) continue;
    const clip = entry.clip;
    const asset = assetFor(clip);
    if (asset.kind === 'audio') {
      throw new RenderError(`Asset "${asset.label}" is audio and cannot be used on a video track`);
    }
    const assetPath = pathFor(asset);
    const sourceDurationMs = asset.kind === 'image' ? clip.outMs : entry.durationMs;
    const inputIndex = addInput(assetPath, asset.kind === 'image', sourceDurationMs, {
      inMs: clip.inMs,
      outMs: clip.outMs,
    });
    mainInputIndex.set(clip.id, inputIndex);

    // Non-image inputs are pre-seeked in the demuxer, so the filter only trims
    // the zero-based remainder. Images keep their original trim window.
    const trimStartMs = asset.kind === 'image' ? clip.inMs : 0;
    const trimEndMs = asset.kind === 'image' ? clip.outMs : Math.max(0, clip.outMs - clip.inMs);

    const speed = clampSpeed(clip.speed);
    const filters: string[] = [
      `[${inputIndex}:v]trim=start=${sec(trimStartMs)}:end=${sec(trimEndMs)}`,
      speed === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${num(speed)}`,
      `fps=${num(fps)}`,
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      'setsar=1',
    ];

    filters.push(
      ...effectFilters(
        clip,
        catalog,
        { startSec: 0, durationSec: entry.durationMs / 1000, fps, width, height },
        warnings,
      ),
    );

    const label = singleClip ? 'vout' : `v${index}`;
    const chain = filters.join(',');
    if (isDefaultTransform(clip)) {
      lines.push(`${chain}[${label}]`);
    } else {
      // Non-default transform: render the clip on a transparent layer above a
      // black canvas so scale, rotation, offset and opacity all stay honest.
      const layer = `vt${index}`;
      const background = `bg${index}`;
      const transform = transformFilters(clip);
      const dx = Math.round((clip.transform?.x ?? 0) * width);
      const dy = Math.round((clip.transform?.y ?? 0) * height);
      lines.push(`${chain}${transform.length ? `,${transform.join(',')}` : ''}[${layer}]`);
      lines.push(
        `color=c=black:s=${width}x${height}:r=${num(fps)}:d=${sec(entry.durationMs)},format=rgba[${background}]`,
      );
      lines.push(
        `[${background}][${layer}]overlay=x=(main_w-overlay_w)/2+${dx}:y=(main_h-overlay_h)/2+${dy}:shortest=1,format=yuv420p[${label}]`,
      );
    }
    videoLabels.push(label);
  }

  // Assemble the main video: xfade where a transition exists, concat otherwise.
  let accumulated = videoLabels[0];
  if (!accumulated) throw new RenderError('Project has no video clips');
  const lastIndex = videoLabels.length - 1;
  for (let index = 1; index <= lastIndex; index += 1) {
    const entry = mainTimeline.clips[index];
    const previous = mainTimeline.clips[index - 1];
    const nextLabel = videoLabels[index];
    if (!entry || !previous || !nextLabel) continue;

    const outLabel = index === lastIndex ? 'vout' : `xv${index}`;
    const transition = previous.clip.transitionOut;
    const transitionMs = previous.transitionOutMs;

    if (transition && transitionMs > 0) {
      const definition = catalog.transition(transition.type);
      if (!definition) {
        warnings.push(`Unknown transition "${transition.type}" was rendered as a crossfade.`);
      }
      lines.push(
        `[${accumulated}][${nextLabel}]xfade=transition=${transitionXfadeName(transition.type)}:duration=${sec(
          transitionMs,
        )}:offset=${sec(entry.startMs)}[${outLabel}]`,
      );
    } else {
      if (transition) {
        warnings.push(
          `Transition on clip ${previous.clip.id} is longer than its clips allow and was rendered as a cut.`,
        );
      }
      lines.push(`[${accumulated}][${nextLabel}]concat=n=2:v=1:a=0[${outLabel}]`);
    }
    accumulated = outLabel;
  }

  // Text overlays ride on top of the assembled picture.
  const textFileDir = options.textFileDir ?? tmpdir();
  const fontPath = resolveFontPath(options.fontPath);
  const textFiles: TextFile[] = [];
  let videoTail = accumulated;
  let textIndex = 0;
  for (const item of textItems(project)) {
    const safeId = project.id.replace(/[^A-Za-z0-9_-]/g, '_');
    const textFile: TextFile = {
      path: path.join(textFileDir, `editbay-text-${safeId}-${textIndex}.txt`),
      content: item.text,
    };
    textFiles.push(textFile);
    const outLabel = `txt${textIndex}`;
    lines.push(`[${videoTail}]${drawtextOptions(item, textFile, fontPath, width, height)}:enable='between(t,${sec(
      Math.max(0, item.startMs),
    )},${sec(Math.max(0, item.startMs + item.durationMs))})'[${outLabel}]`);
    videoTail = outLabel;
    textIndex += 1;
  }

  lines.push(`[${videoTail}]format=yuv420p[vfinal]`);

  /* Audio ----------------------------------------------------------- */
  const audioLabels: string[] = [];
  const projectEndMs = projectDurationMs(project);

  for (let index = 0; index < mainTimeline.clips.length; index += 1) {
    const entry = mainTimeline.clips[index];
    if (!entry) continue;
    const clip = entry.clip;
    const asset = assetFor(clip);
    const volume = clip.volume ?? 1;
    if (!asset.hasAudio || volume === 0) continue;
    const inputIndex = mainInputIndex.get(clip.id);
    if (inputIndex === undefined) continue;

    const startSec = entry.startMs / 1000;
    const durationMs = entry.durationMs;
    const durationSec = durationMs / 1000;
    // The picture crossfades over the transition window, so the clip audio has
    // to do the same: the outgoing clip fades out over the overlap while the
    // incoming clip — delayed to the xfade offset by `adelay` below — fades in
    // over it. An explicit fade longer than the transition wins.
    const transitionInMs = index > 0 ? (mainTimeline.clips[index - 1]?.transitionOutMs ?? 0) : 0;
    const fadeInMs = Math.min(
      durationMs,
      Math.max(Math.max(0, clip.audioFadeInMs ?? 0), transitionInMs),
    );
    const fadeOutMs = Math.min(
      durationMs,
      Math.max(Math.max(0, clip.audioFadeOutMs ?? 0), entry.transitionOutMs),
    );

    const audioFilters = [
      `[${inputIndex}:a]atrim=start=0.000:end=${sec(clip.outMs - clip.inMs)}`,
      'asetpts=PTS-STARTPTS',
      `volume=${num(volume)}`,
      ...atempoChain(clampSpeed(clip.speed)),
      // Without an explicit delay the audio of later clips would start at 0
      // while their picture is shifted by the transition overlap.
      ...(entry.startMs > 0 ? [`adelay=${entry.startMs}|${entry.startMs}`] : []),
      // Clip-level fades apply to the clip's own audio just like audio tracks.
      ...(fadeInMs > 0
        ? [`afade=t=in:st=${startSec.toFixed(3)}:d=${(fadeInMs / 1000).toFixed(3)}`]
        : []),
      ...(fadeOutMs > 0
        ? [
            `afade=t=out:st=${(startSec + durationSec - fadeOutMs / 1000).toFixed(3)}:d=${(
              fadeOutMs / 1000
            ).toFixed(3)}`,
          ]
        : []),
      ...AUDIO_NORMALIZE,
    ];
    const label = `a${audioLabels.length}`;
    lines.push(`${audioFilters.join(',')}[${label}]`);
    audioLabels.push(label);
  }

  for (const track of audibleTracks(project)) {
    for (const clip of track.clips) {
      const asset = assetFor(clip);
      const assetPath = pathFor(asset);
      const volume = clip.volume ?? 1;
      if (volume === 0) continue;
      if (asset.kind === 'image') {
        warnings.push(`Image asset "${asset.label}" has no audio and was skipped on the audio track.`);
        continue;
      }
      // A silent video on an audio track must never produce `[N:a]`; ffmpeg
      // aborts the whole filtergraph when the stream specifier matches nothing.
      if (asset.hasAudio === false) {
        warnings.push(`Asset "${asset.label}" has no audio and was skipped on the audio track.`);
        continue;
      }
      const startMs = Math.max(0, clip.startMs ?? 0);
      const placedDurationMs = clipDurationMs(clip);
      // Audio never extends the export: a bed that runs past the picture is
      // cut at the project end, and only a clip that starts after the picture
      // is dropped altogether.
      if (startMs >= projectEndMs) {
        warnings.push(
          `Audio clip "${asset.label}" starts at ${startMs} ms, after the project ends (${projectEndMs} ms), and was skipped.`,
        );
        continue;
      }
      const cutAtProjectEnd = startMs + placedDurationMs > projectEndMs;
      const durationMs = cutAtProjectEnd ? projectEndMs - startMs : placedDurationMs;
      const speed = clampSpeed(clip.speed);
      // `atrim` works in source time, so a shortened clip keeps the matching
      // source span after the speed change.
      const sourceSpanMs = cutAtProjectEnd
        ? Math.min(clip.outMs - clip.inMs, Math.round(durationMs * speed))
        : clip.outMs - clip.inMs;
      const inputIndex = addInput(assetPath, false, durationMs, { inMs: clip.inMs, outMs: clip.outMs });
      const startSec = startMs / 1000;
      const durationSec = durationMs / 1000;
      const fadeInMs = Math.min(durationMs, Math.max(0, clip.audioFadeInMs ?? 0));
      let fadeOutMs = Math.min(durationMs, Math.max(0, clip.audioFadeOutMs ?? 0));
      if (cutAtProjectEnd) {
        // Never cut a live audio bed without a ramp: 300 ms of fade-out unless
        // the user already asked for a longer one.
        fadeOutMs = Math.max(fadeOutMs, Math.min(AUTO_CUT_FADE_MS, durationMs));
      }

      const audioFilters = [
        `[${inputIndex}:a]atrim=start=0.000:end=${sec(sourceSpanMs)}`,
        'asetpts=PTS-STARTPTS',
        `volume=${num(volume)}`,
        ...atempoChain(speed),
        `adelay=${startMs}|${startMs}`,
      ];
      if (fadeInMs > 0) {
        audioFilters.push(`afade=t=in:st=${startSec.toFixed(3)}:d=${(fadeInMs / 1000).toFixed(3)}`);
      }
      if (fadeOutMs > 0) {
        const fadeOutStart = startSec + durationSec - fadeOutMs / 1000;
        audioFilters.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${(fadeOutMs / 1000).toFixed(3)}`);
      }
      audioFilters.push(...AUDIO_NORMALIZE);
      const label = `a${audioLabels.length}`;
      lines.push(`${audioFilters.join(',')}[${label}]`);
      audioLabels.push(label);
    }
  }

  if (audioLabels.length === 1) {
    const only = audioLabels[0];
    if (only) lines.push(`[${only}]anull[aout]`);
  } else if (audioLabels.length > 1) {
    const joined = audioLabels.map((label) => `[${label}]`).join('');
    lines.push(
      `${joined}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0[aout]`,
    );
  }

  /* Args ------------------------------------------------------------ */
  const durationMs = Math.max(mainTimeline.durationMs, projectDurationMs(project));
  const quality = options.quality ?? 'standard';
  const preset = QUALITY_PRESETS[quality];
  const outPath = options.outPath ?? 'output.mp4';

  const encoderChoice = selectVideoEncoder({
    override: options.videoEncoder,
    ...(options.availableEncoders ? { available: options.availableEncoders } : {}),
  });
  if (encoderChoice.warning) warnings.push(encoderChoice.warning);
  const encodeArgs = videoEncoderArgs({
    encoder: encoderChoice.encoder,
    quality,
    preset,
    width,
    height,
    fps,
  });

  const args: string[] = [
    '-y',
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-progress',
    'pipe:1',
    ...inputArgs,
    '-filter_complex',
    lines.join(';'),
    '-map',
    '[vfinal]',
    ...(audioLabels.length > 0 ? ['-map', '[aout]'] : []),
    ...encodeArgs,
    '-pix_fmt',
    'yuv420p',
    '-r',
    num(fps),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    '-t',
    sec(durationMs),
    outPath,
  ];

  return {
    args,
    filterGraph: lines.join(';'),
    durationMs,
    inputs,
    videoEncoder: encoderChoice.encoder,
    textFiles,
    warnings,
    width,
    height,
    fps,
    quality,
  };
}
