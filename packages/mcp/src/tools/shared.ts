/**
 * Shared helpers for MCP tool handlers.
 *
 * Every handler returns MCP content blocks. Project asset URIs never leave this
 * process: tool payloads are built from labels, ids and timeline numbers only.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_TRANSFORM, clipStartMsOnTrack } from '@editbay/core';
import type { Clip, EffectInstance, EffectParam, Project, TextItem, Track } from '@editbay/core';

/** Serializes a tool result as a single JSON text block. */
export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** Serializes an error as a JSON text block flagged with `isError`. */
export function errorResult(message: string, details?: unknown): CallToolResult {
  const payload = details === undefined ? { error: message } : { error: message, details };
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
}

/** Extracts a readable message from an unknown throwable. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Label for an asset id; falls back to the id when the asset is gone. */
export function assetLabel(project: Project, assetId: string): string {
  const asset = project.assets.find((entry) => entry.id === assetId);
  return asset?.label ?? assetId;
}

/**
 * Model-safe effect references: id, type, params and the optional in-clip
 * window. Params are primitives, so they are safe to send to a model.
 */
export function effectRefs(effects: EffectInstance[] | undefined): Array<{
  id: string;
  type: string;
  params: Record<string, EffectParam>;
  startMs?: number;
  durationMs?: number;
}> {
  return (effects ?? []).map((effect) => ({
    id: effect.id,
    type: effect.type,
    params: { ...effect.params },
    ...(effect.startMs === undefined ? {} : { startMs: effect.startMs }),
    ...(effect.durationMs === undefined ? {} : { durationMs: effect.durationMs }),
  }));
}

/**
 * Compact, model-safe view of a clip for `get_project`. Timeline numbers come
 * from `@editbay/core` so transitions and speed match the engine exactly.
 */
export function clipView(project: Project, track: Track, clip: Clip, index: number) {
  return {
    id: clip.id,
    assetId: clip.assetId,
    label: assetLabel(project, clip.assetId),
    inMs: clip.inMs,
    outMs: clip.outMs,
    startMs: clipStartMsOnTrack(track, index),
    speed: clip.speed ?? 1,
    volume: clip.volume ?? 1,
    transform: clip.transform ?? DEFAULT_TRANSFORM,
    ...(clip.transitionOut === undefined
      ? {}
      : {
          transitionOut: {
            id: clip.transitionOut.id,
            type: clip.transitionOut.type,
            durationMs: clip.transitionOut.durationMs,
            params: { ...(clip.transitionOut.params ?? {}) },
          },
        }),
    audioFadeInMs: clip.audioFadeInMs ?? 0,
    audioFadeOutMs: clip.audioFadeOutMs ?? 0,
    effects: effectRefs(clip.effects),
  };
}

/** Compact, model-safe view of a text item (style is plain JSON). */
export function textView(item: TextItem) {
  return {
    id: item.id,
    text: item.text,
    startMs: item.startMs,
    durationMs: item.durationMs,
    style: { ...item.style },
    animation: item.animation ?? 'none',
  };
}

/**
 * Lists valid ids so a failed command can tell the agent what to retry with.
 * Never includes file paths.
 */
export function availableIds(project: Project): string {
  const clips = project.tracks.flatMap((track) => track.clips.map((clip) => clip.id));
  const texts = project.tracks.flatMap((track) => track.items.map((item) => item.id));
  const assets = project.assets.map((asset) => asset.id);
  const tracks = project.tracks.map((track) => track.id);
  return [
    `assetIds: ${assets.length > 0 ? assets.join(', ') : '(none)'}`,
    `clipIds: ${clips.length > 0 ? clips.join(', ') : '(none)'}`,
    `textItemIds: ${texts.length > 0 ? texts.join(', ') : '(none)'}`,
    `trackIds: ${tracks.length > 0 ? tracks.join(', ') : '(none)'}`,
  ].join('; ');
}
