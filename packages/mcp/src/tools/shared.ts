/**
 * Shared helpers for MCP tool handlers.
 *
 * Every handler returns MCP content blocks. Project asset URIs never leave this
 * process: tool payloads are built from labels, ids and timeline numbers only.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { clipTimelineDurationMs } from '@editbay/core';
import type { Clip, EffectInstance, Project, Track } from '@editbay/core';

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
 * Timeline start of a clip. The main video track is sequential; other tracks
 * use the clip's own `startMs`.
 */
export function clipStartMs(track: Track, index: number): number {
  if (track.kind !== 'video') {
    const clip = track.clips[index];
    return Math.round(clip?.startMs ?? 0);
  }
  let start = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    const clip = track.clips[cursor];
    if (clip) start += clipTimelineDurationMs(clip);
  }
  return start;
}

/** Model-safe effect references (id + type, no implementation details). */
export function effectRefs(effects: EffectInstance[] | undefined): Array<{ id: string; type: string }> {
  return (effects ?? []).map((effect) => ({ id: effect.id, type: effect.type }));
}

/** Compact, model-safe view of a clip for `get_project`. */
export function clipView(project: Project, track: Track, clip: Clip, index: number) {
  return {
    id: clip.id,
    assetId: clip.assetId,
    label: assetLabel(project, clip.assetId),
    inMs: clip.inMs,
    outMs: clip.outMs,
    startMs: clipStartMs(track, index),
    effects: effectRefs(clip.effects),
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
