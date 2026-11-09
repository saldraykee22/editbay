import {
  DEFAULT_TRANSFORM,
  clipStartMsOnTrack,
  clipTimelineDurationMs,
  transitionOverlapMs,
  type Asset,
  type Clip,
  type Project,
  type TextStyle,
  type TextItem,
} from '@editbay/core';
import type { EffectCatalog, FrameStyle } from '@editbay/effects';

export type MediaElement = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

export interface MediaRegistry {
  get(assetId: string): MediaElement | undefined;
}

export interface ClipPlacement {
  clip: Clip;
  asset: Asset;
  trackId: string;
  /** Timeline start of the clip (transitions included). */
  startMs: number;
  /** Rendered length on the timeline. */
  durationMs: number;
  endMs: number;
  /** Overlap with the following clip, driven by `transitionOut`. */
  transitionOutMs: number;
  trackMuted: boolean;
}

export interface ActiveClip extends ClipPlacement {
  /** Time inside the clip. */
  localMs: number;
}

/**
 * Main video track layout. All timing comes from `@editbay/core` so the
 * preview subtracts transition overlaps exactly like the export engine.
 */
export function videoClips(project: Project): ClipPlacement[] {
  const track = project.tracks.find((t) => t.kind === 'video' && !t.hidden);
  if (!track) return [];
  const clips: ClipPlacement[] = [];
  for (let index = 0; index < track.clips.length; index += 1) {
    const clip = track.clips[index];
    if (!clip) continue;
    const asset = project.assets.find((a) => a.id === clip.assetId);
    if (!asset) continue;
    const durationMs = clipTimelineDurationMs(clip);
    const startMs = clipStartMsOnTrack(track, index);
    clips.push({
      clip,
      asset,
      trackId: track.id,
      startMs,
      durationMs,
      endMs: startMs + durationMs,
      transitionOutMs: transitionOverlapMs(clip, track.clips[index + 1]),
      trackMuted: track.muted === true,
    });
  }
  return clips;
}

/** Every video clip visible at `timeMs`. Two entries overlap during a transition. */
export function activeClipsAt(project: Project, timeMs: number): ActiveClip[] {
  const active: ActiveClip[] = [];
  for (const entry of videoClips(project)) {
    if (timeMs < entry.startMs || timeMs >= entry.endMs) continue;
    active.push({ ...entry, localMs: timeMs - entry.startMs });
  }
  return active.sort((a, b) => a.startMs - b.startMs);
}

/** Clip visible at `timeMs` (the incoming clip wins during a transition). */
export function activeClipAt(project: Project, timeMs: number): ActiveClip | null {
  const active = activeClipsAt(project, timeMs);
  return active[active.length - 1] ?? null;
}

/** Audio-track clips audible at `timeMs` on visible, unmuted tracks. */
export function activeAudioClipsAt(project: Project, timeMs: number): ActiveClip[] {
  const active: ActiveClip[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'audio' || track.hidden) continue;
    for (const clip of track.clips) {
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (!asset) continue;
      const startMs = Math.max(0, clip.startMs ?? 0);
      const durationMs = clipTimelineDurationMs(clip);
      if (timeMs < startMs || timeMs >= startMs + durationMs) continue;
      active.push({
        clip,
        asset,
        trackId: track.id,
        startMs,
        durationMs,
        endMs: startMs + durationMs,
        transitionOutMs: 0,
        trackMuted: track.muted === true,
        localMs: timeMs - startMs,
      });
    }
  }
  return active;
}

export function sourceTimeMs(active: ActiveClip): number {
  const speed = active.clip.speed && active.clip.speed > 0 ? active.clip.speed : 1;
  return active.clip.inMs + active.localMs * speed;
}

export function textItemsAt(project: Project, timeMs: number): TextItem[] {
  const items: TextItem[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'text' || track.hidden) continue;
    for (const item of track.items) {
      if (timeMs >= item.startMs && timeMs <= item.startMs + item.durationMs) items.push(item);
    }
  }
  return items;
}

export interface EffectWindow {
  type: string;
  params: Record<string, number | string | boolean>;
  startMs: number;
  durationMs: number;
}

export function effectWindows(clip: Clip, catalog: EffectCatalog): EffectWindow[] {
  const clipDuration = clipTimelineDurationMs(clip);
  return clip.effects.map((instance) => {
    const startMs = instance.startMs ?? 0;
    const durationMs = instance.durationMs ?? Math.max(1, clipDuration - startMs);
    return {
      type: instance.type,
      params: catalog.resolveParams(instance),
      startMs,
      durationMs,
    };
  });
}

function numericParam(params: Record<string, number | string | boolean>, key: string, fallback: number): number {
  const value = params[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function combinedStyle(
  windows: EffectWindow[],
  localMs: number,
  clipDuration: number,
  catalog: EffectCatalog,
  width: number,
  height: number,
): FrameStyle {
  let opacity = 1;
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let rotate = 0;
  const filters: string[] = [];
  for (const window of windows) {
    if (localMs < window.startMs || localMs > window.startMs + window.durationMs) continue;
    const definition = catalog.effect(window.type);
    if (!definition?.style) continue;
    const style = definition.style({
      progress: (localMs - window.startMs) / Math.max(1, window.durationMs),
      timeMs: localMs - window.startMs,
      durationMs: window.durationMs,
      clipDurationMs: clipDuration,
      width,
      height,
      params: window.params,
    });
    opacity *= style.opacity ?? 1;
    scale *= style.scale ?? 1;
    translateX += style.translateX ?? 0;
    translateY += style.translateY ?? 0;
    rotate += style.rotate ?? 0;
    if (style.filter) filters.push(style.filter);
  }
  return { opacity, scale, translateX, translateY, rotate, filter: filters.join(' ') || undefined };
}

/* ------------------------------------------------------------------ */
/* Text placement (must match the export drawtext math)                */
/* ------------------------------------------------------------------ */

/**
 * Horizontal safe margin used by `packages/engine/src/plan.ts` for
 * `drawtext`. Keep the two constants in sync.
 */
export const TEXT_MARGIN_PX = 48;

export interface TextPlacement {
  lines: string[];
  lineHeight: number;
  /** Top of the first line, in project pixels. */
  top: number;
  margin: number;
  /** 0 for left, 0.5 for centre, 1 for right. */
  anchorX: 0 | 0.5 | 1;
  /** `(style.x - anchorX) * width`, matching drawtext's offset. */
  offsetX: number;
  padding: number;
  align: TextStyle['align'];
}

export function textPlacement(
  style: TextStyle,
  text: string,
  width: number,
  height: number,
  offsetY = 0,
): TextPlacement {
  const align = style.align ?? 'center';
  const anchorX: TextPlacement['anchorX'] = align === 'center' ? 0.5 : align === 'right' ? 1 : 0;
  const lines = text.split('\n');
  const lineHeight = style.fontSize * (style.lineHeight ?? 1.15);
  return {
    lines,
    lineHeight,
    top: Math.max(0, Math.round((style.y ?? 0.5) * height)) + offsetY,
    margin: TEXT_MARGIN_PX,
    anchorX,
    offsetX: Math.round(((style.x ?? anchorX) - anchorX) * width),
    padding: Math.max(0, style.padding ?? 12),
    align,
  };
}

/** Left edge of one text line, matching the engine's drawtext expression. */
export function textLineX(placement: TextPlacement, lineWidth: number, width: number): number {
  const base =
    placement.anchorX === 0.5
      ? (width - lineWidth) / 2
      : placement.anchorX === 1
        ? width - lineWidth - placement.margin
        : placement.margin;
  return base + placement.offsetX;
}

export function drawTextItem(
  ctx: CanvasRenderingContext2D,
  item: TextItem,
  timeMs: number,
  projectWidth: number,
  projectHeight: number,
): void {
  const style = item.style;
  const localMs = timeMs - item.startMs;
  const progress = Math.min(1, Math.max(0, localMs / Math.max(1, item.durationMs)));
  const animation = item.animation ?? 'none';

  let alpha = 1;
  let offsetY = 0;
  if (animation === 'fade') {
    const fadeIn = Math.min(1, localMs / 320);
    const fadeOut = Math.min(1, (item.durationMs - localMs) / 320);
    alpha = Math.max(0, Math.min(fadeIn, fadeOut));
  }
  if (animation === 'rise') {
    const rise = Math.min(1, localMs / 420);
    alpha = rise;
    offsetY = (1 - rise) * 28;
  }

  let text = item.text;
  if (animation === 'typewriter') {
    const chars = Math.ceil(text.length * Math.min(1, progress * 1.15));
    text = text.slice(0, chars);
  }

  const size = style.fontSize;
  const placement = textPlacement(style, text, projectWidth, projectHeight, offsetY);
  const lineHeight = placement.lineHeight;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${style.fontWeight} ${size}px "${style.fontFamily}", "IBM Plex Sans", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  if (style.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = Math.max(6, size * 0.12);
    ctx.shadowOffsetY = Math.max(1, size * 0.03);
  }

  for (let index = 0; index < placement.lines.length; index += 1) {
    const line = placement.lines[index] ?? '';
    const lineWidth = ctx.measureText(line).width;
    const x = textLineX(placement, lineWidth, projectWidth);
    const y = placement.top + index * lineHeight;

    if (style.background) {
      const pad = placement.padding;
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = style.background;
      ctx.beginPath();
      ctx.roundRect(x - pad, y - pad * 0.25, lineWidth + pad * 2, lineHeight + pad * 0.5, Math.min(14, pad));
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = style.color;
    ctx.fillText(line, x, y);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Style-less effect previews                                          */
/* ------------------------------------------------------------------ */

/**
 * `vignette`, `grain` and `glitch` have no `style()` in `@editbay/effects`, so
 * the preview draws a neutral approximation of their look rather than hiding
 * the effect. Effects that do provide `style()` take precedence.
 */
function drawStylelessPreviews(
  ctx: CanvasRenderingContext2D,
  windows: EffectWindow[],
  localMs: number,
  catalog: EffectCatalog,
  width: number,
  height: number,
): void {
  const active = windows.filter(
    (window) =>
      localMs >= window.startMs &&
      localMs <= window.startMs + window.durationMs &&
      !catalog.effect(window.type)?.style,
  );
  if (active.length === 0) return;

  ctx.save();
  for (const window of active) {
    if (window.type === 'vignette') {
      const strength = Math.min(1, Math.max(0, numericParam(window.params, 'angle', 0.6)));
      if (strength <= 0) continue;
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.35,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.75,
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, `rgba(0,0,0,${(strength * 0.75).toFixed(3)})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      continue;
    }
    if (window.type === 'grain') {
      const amount = Math.min(60, Math.max(1, numericParam(window.params, 'amount', 18)));
      const count = Math.round(amount * 2.5);
      const frame = Math.floor(localMs / 33);
      let seed = frame * 9301 + 49297;
      const next = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.08, amount / 700).toFixed(3)})`;
      for (let index = 0; index < count; index += 1) {
        ctx.fillRect(next() * width, next() * height, 2, 2);
      }
      continue;
    }
    if (window.type === 'glitch') {
      const frame = Math.floor(localMs / 90);
      const amount = Math.min(12, Math.max(1, numericParam(window.params, 'amount', 3)));
      let seed = frame * 7919 + 104729;
      const next = () => {
        seed = (seed * 7919 + 104729) % 233280;
        return seed / 233280;
      };
      ctx.fillStyle = 'rgba(91,233,166,0.12)';
      ctx.fillRect(0, next() * height, width, 2 + amount * 0.4);
      ctx.fillStyle = 'rgba(233,91,166,0.10)';
      ctx.fillRect(0, next() * height, width, 2 + amount * 0.3);
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Frame compositor                                                    */
/* ------------------------------------------------------------------ */

export interface DrawOptions {
  width: number;
  height: number;
  catalog: EffectCatalog;
  media: MediaRegistry;
  showSafeArea?: boolean;
}

function isDrawableMedia(element: MediaElement | undefined): element is HTMLVideoElement | HTMLImageElement {
  if (!element) return false;
  if (typeof HTMLVideoElement !== 'undefined' && element instanceof HTMLVideoElement) return true;
  if (typeof HTMLImageElement !== 'undefined' && element instanceof HTMLImageElement) return true;
  return false;
}

function mediaSize(element: MediaElement | undefined): { width: number; height: number } {
  if (!isDrawableMedia(element)) return { width: 0, height: 0 };
  if (typeof HTMLVideoElement !== 'undefined' && element instanceof HTMLVideoElement) {
    return { width: element.videoWidth, height: element.videoHeight };
  }
  if (typeof HTMLImageElement !== 'undefined' && element instanceof HTMLImageElement) {
    return { width: element.naturalWidth, height: element.naturalHeight };
  }
  return { width: 0, height: 0 };
}

function drawClipLayer(
  ctx: CanvasRenderingContext2D,
  active: ActiveClip,
  alpha: number,
  projectWidth: number,
  projectHeight: number,
  options: DrawOptions,
): void {
  const element = options.media.get(active.asset.id);
  const transform = { ...DEFAULT_TRANSFORM, ...(active.clip.transform ?? {}) };
  const windows = effectWindows(active.clip, options.catalog);
  const style = combinedStyle(
    windows,
    active.localMs,
    active.durationMs,
    options.catalog,
    projectWidth,
    projectHeight,
  );
  const opacity = (transform.opacity ?? 1) * (style.opacity ?? 1) * alpha;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  if (style.filter) ctx.filter = style.filter;
  ctx.translate(
    projectWidth / 2 + (transform.x + (style.translateX ?? 0)) * projectWidth,
    projectHeight / 2 + (transform.y + (style.translateY ?? 0)) * projectHeight,
  );
  const rotation = ((transform.rotation ?? 0) + (style.rotate ?? 0)) * (Math.PI / 180);
  if (rotation) ctx.rotate(rotation);

  const size = mediaSize(element);
  if (isDrawableMedia(element) && size.width > 0 && size.height > 0) {
    const coverScale =
      Math.max(projectWidth / size.width, projectHeight / size.height) *
      (transform.scale ?? 1) *
      (style.scale ?? 1);
    const drawWidth = size.width * coverScale;
    const drawHeight = size.height * coverScale;
    try {
      ctx.drawImage(element, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    } catch {
      // Video not ready yet.
    }
  } else {
    ctx.fillStyle = '#0b100d';
    ctx.fillRect(-projectWidth / 2, -projectHeight / 2, projectWidth, projectHeight);
  }
  drawStylelessPreviews(ctx, windows, active.localMs, options.catalog, projectWidth, projectHeight);
  ctx.restore();
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  timeMs: number,
  options: DrawOptions,
): void {
  const { width, height, catalog } = options;
  const projectWidth = project.canvas.width;
  const projectHeight = project.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(width / projectWidth, 0, 0, height / projectHeight, 0, 0);
  ctx.imageSmoothingQuality = 'high';

  const active = activeClipsAt(project, timeMs);
  if (active.length === 1 && active[0]) {
    drawClipLayer(ctx, active[0], 1, projectWidth, projectHeight, options);
  } else if (active.length > 1) {
    // Crossfade preview across `transitionOut`. Non-fade transition names share
    // this neutral dissolve; the export still applies the real xfade.
    const first = active[0];
    const second = active[1];
    if (first && second) {
      const overlap = Math.max(1, first.endMs - second.startMs);
      const progress = Math.max(0, Math.min(1, (timeMs - second.startMs) / overlap));
      drawClipLayer(ctx, first, 1 - progress, projectWidth, projectHeight, options);
      drawClipLayer(ctx, second, progress, projectWidth, projectHeight, options);
    }
  }

  for (const item of textItemsAt(project, timeMs)) {
    drawTextItem(ctx, item, timeMs, projectWidth, projectHeight);
  }

  if (options.showSafeArea) {
    ctx.save();
    ctx.strokeStyle = 'rgba(91,233,166,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(projectWidth * 0.05, projectHeight * 0.05, projectWidth * 0.9, projectHeight * 0.9);
    ctx.restore();
  }
}
