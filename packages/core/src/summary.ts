/**
 * Compact, model-safe project summaries.
 *
 * The summary is JSON-ish text (valid JSON) built from labels only: file
 * paths, URIs and thumbnail locations are never included. Times are rounded to
 * 0.1s so a whole project stays cheap to read.
 */

import { clipStartMsOnTrack, clipTimelineDurationMs, timelineDurationMs } from './timeline';
import type { Project } from './types';

const DEFAULT_MAX_ASSETS = 12;

function trimText(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function sec(ms: number): number {
  return Math.round(ms / 100) / 10;
}

function effectLabel(effect: { type: string; startMs?: number; durationMs?: number }): string {
  let window = '';
  if (effect.startMs !== undefined) window += `@${sec(effect.startMs)}s`;
  if (effect.durationMs !== undefined) window += `+${sec(effect.durationMs)}s`;
  return `${effect.type}${window}`;
}

/** Builds a compact JSON summary that is safe to send to a model provider. */
export function projectSummary(project: Project, opts: { maxAssets?: number } = {}): string {
  const rawLimit = opts.maxAssets;
  const maxAssets =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? Math.max(0, Math.floor(rawLimit))
      : DEFAULT_MAX_ASSETS;

  const assetById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const visibleAssets = project.assets.slice(0, maxAssets);
  const omittedAssets = project.assets.length - visibleAssets.length;

  const assets = visibleAssets.map((asset) => ({
    id: asset.id,
    label: trimText(asset.label, 60),
    kind: asset.kind,
    duration: sec(asset.durationMs),
  }));

  const tracks = project.tracks.map((track) => {
    const meta: Record<string, unknown> = {
      id: track.id,
      kind: track.kind,
    };
    if (track.name) meta.name = trimText(track.name, 40);
    if (track.muted) meta.muted = true;
    if (track.hidden) meta.hidden = true;

    if (track.kind === 'text') {
      meta.items = track.items.map((item) => ({
        id: item.id,
        text: trimText(item.text, 60),
        start: sec(item.startMs),
        duration: sec(item.durationMs),
        animation: item.animation ?? 'none',
        style: {
          fontSize: item.style.fontSize,
          color: item.style.color,
          align: item.style.align,
        },
      }));
      return meta;
    }

    meta.clips = track.clips.map((clip, index) => {
      const asset = assetById.get(clip.assetId);
      const entry: Record<string, unknown> = {
        id: clip.id,
        asset: asset ? trimText(asset.label, 60) : clip.assetId,
        start: sec(clipStartMsOnTrack(track, index)),
        duration: sec(clipTimelineDurationMs(clip)),
        in: sec(clip.inMs),
        speed: clip.speed ?? 1,
      };
      if (clip.volume !== undefined) entry.volume = clip.volume;
      if (clip.transform) entry.transform = clip.transform;
      const effects = (clip.effects ?? []).map(effectLabel);
      if (effects.length > 0) entry.effects = effects;
      if (clip.transitionOut) {
        entry.transition = `${clip.transitionOut.type} ${sec(clip.transitionOut.durationMs)}s`;
      }
      return entry;
    });
    return meta;
  });

  const summary: Record<string, unknown> = {
    project: trimText(project.name, 120),
    id: project.id,
    canvas: `${project.canvas.width}x${project.canvas.height}@${project.canvas.fps}fps`,
    duration: sec(timelineDurationMs(project)),
    assets,
    tracks,
  };
  if (omittedAssets > 0) summary.assetsOmitted = omittedAssets;

  return JSON.stringify(summary);
}
