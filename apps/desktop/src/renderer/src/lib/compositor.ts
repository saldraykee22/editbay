import type { Asset, Clip, Project, TextItem } from '@editbay/core';
import type { EffectCatalog, FrameStyle } from '@editbay/effects';
import { DEFAULT_TRANSFORM } from '@editbay/core';

export type MediaElement = HTMLVideoElement | HTMLImageElement;

export interface MediaRegistry {
  get(assetId: string): MediaElement | undefined;
}

export interface ActiveClip {
  clip: Clip;
  asset: Asset;
  trackId: string;
  /** Timeline start of the clip. */
  startMs: number;
  /** Time inside the clip. */
  localMs: number;
  durationMs: number;
}

export function clipDurationMs(clip: Clip): number {
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  return Math.max(1, Math.round((clip.outMs - clip.inMs) / speed));
}

export function videoClips(project: Project): Array<{ clip: Clip; startMs: number; durationMs: number; trackId: string }> {
  const track = project.tracks.find((t) => t.kind === 'video');
  if (!track) return [];
  let cursor = 0;
  return track.clips.map((clip) => {
    const durationMs = clipDurationMs(clip);
    const entry = { clip, startMs: cursor, durationMs, trackId: track.id };
    cursor += durationMs;
    return entry;
  });
}

export function activeClipAt(project: Project, timeMs: number): ActiveClip | null {
  const entries = videoClips(project);
  for (const entry of entries) {
    if (timeMs >= entry.startMs && timeMs < entry.startMs + entry.durationMs) {
      const asset = project.assets.find((a) => a.id === entry.clip.assetId);
      if (!asset) continue;
      return {
        clip: entry.clip,
        asset,
        trackId: entry.trackId,
        startMs: entry.startMs,
        localMs: timeMs - entry.startMs,
        durationMs: entry.durationMs,
      };
    }
  }
  return null;
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
  const clipDuration = clipDurationMs(clip);
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
  const lineHeight = size * (style.lineHeight ?? 1.15);
  const lines = text.split('\n');
  const x = style.x * projectWidth;
  const y = style.y * projectHeight + offsetY;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${style.fontWeight} ${size}px "${style.fontFamily}", "IBM Plex Sans", sans-serif`;
  ctx.textAlign = style.align;
  ctx.textBaseline = 'middle';
  if (style.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = Math.max(6, size * 0.12);
    ctx.shadowOffsetY = Math.max(1, size * 0.03);
  }

  const blockHeight = lines.length * lineHeight;
  let startY = y - blockHeight / 2 + lineHeight / 2;

  if (style.background) {
    const widths = lines.map((line) => ctx.measureText(line).width);
    const maxWidth = Math.max(...widths, 0);
    const pad = style.padding ?? size * 0.4;
    const radius = style.radius ?? Math.min(14, pad);
    const boxW = maxWidth + pad * 2;
    const boxH = blockHeight + pad * 1.2;
    const boxX = style.align === 'center' ? x - boxW / 2 : style.align === 'right' ? x - boxW : x;
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = style.background;
    ctx.beginPath();
    ctx.roundRect(boxX, startY - lineHeight / 2 - pad * 0.6, boxW, boxH, radius);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = style.color;
  for (const line of lines) {
    ctx.fillText(line, x, startY);
    startY += lineHeight;
  }
  ctx.restore();
}

export interface DrawOptions {
  width: number;
  height: number;
  catalog: EffectCatalog;
  media: MediaRegistry;
  showSafeArea?: boolean;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  timeMs: number,
  options: DrawOptions,
): void {
  const { width, height, catalog, media } = options;
  const projectWidth = project.canvas.width;
  const projectHeight = project.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(width / projectWidth, 0, 0, height / projectHeight, 0, 0);
  ctx.imageSmoothingQuality = 'high';

  const active = activeClipAt(project, timeMs);
  if (active) {
    const element = media.get(active.asset.id);
    const transform = { ...DEFAULT_TRANSFORM, ...(active.clip.transform ?? {}) };
    const windows = effectWindows(active.clip, catalog);
    const style = combinedStyle(windows, active.localMs, active.durationMs, catalog, projectWidth, projectHeight);
    const opacity = (transform.opacity ?? 1) * (style.opacity ?? 1);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
    if (style.filter) ctx.filter = style.filter;
    ctx.translate(
      projectWidth / 2 + (transform.x + (style.translateX ?? 0)) * projectWidth,
      projectHeight / 2 + (transform.y + (style.translateY ?? 0)) * projectHeight,
    );
    const rotation = ((transform.rotation ?? 0) + (style.rotate ?? 0)) * (Math.PI / 180);
    if (rotation) ctx.rotate(rotation);

    let mediaWidth = 0;
    let mediaHeight = 0;
    if (element instanceof HTMLVideoElement) {
      mediaWidth = element.videoWidth;
      mediaHeight = element.videoHeight;
    } else if (element instanceof HTMLImageElement) {
      mediaWidth = element.naturalWidth;
      mediaHeight = element.naturalHeight;
    }

    if (element && mediaWidth > 0 && mediaHeight > 0) {
      const coverScale = Math.max(projectWidth / mediaWidth, projectHeight / mediaHeight) * (transform.scale ?? 1) * (style.scale ?? 1);
      const drawWidth = mediaWidth * coverScale;
      const drawHeight = mediaHeight * coverScale;
      try {
        ctx.drawImage(element, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      } catch {
        // video not ready yet
      }
    } else {
      ctx.fillStyle = '#0b100d';
      ctx.fillRect(-projectWidth / 2, -projectHeight / 2, projectWidth, projectHeight);
    }
    ctx.restore();
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
