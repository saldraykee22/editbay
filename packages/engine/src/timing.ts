/**
 * Project timing helpers for the export engine.
 *
 * Kept local to `@editbay/engine` on purpose: the core package owns the
 * editable project model, the engine owns the render-time arithmetic. Nothing
 * here touches the filesystem and every function is deterministic.
 *
 * All values are integer milliseconds unless a name ends in `Sec`.
 */
import type { Clip, Project, TextItem, Track } from '@editbay/core';
import { clampTransitionOverlapMs, projectDurationMs as coreProjectDurationMs } from '@editbay/core';
import { effectCatalog } from '@editbay/effects';

export const DEFAULT_TRANSITION_MS = 400;

/** A transition needs at least this much room on both sides to be legal. */
export const MIN_TRANSITION_MARGIN_MS = 1;

export interface TimelineClip {
  clip: Clip;
  /** Rendered length on the timeline (source length divided by speed). */
  durationMs: number;
  /** Start on the sequential track timeline, overlapping the previous clip. */
  startMs: number;
  /** End on the sequential track timeline. */
  endMs: number;
  /** Overlap with the following clip, driven by `transitionOut`. */
  transitionOutMs: number;
}

export interface TrackTimeline {
  clips: TimelineClip[];
  /** Total rendered length of the track including transition overlaps. */
  durationMs: number;
}

/** Clamp a clip speed into the supported 0.25..4 range. */
export function clampSpeed(speed: number | undefined): number {
  if (speed === undefined || !Number.isFinite(speed) || speed <= 0) return 1;
  return Math.min(4, Math.max(0.25, speed));
}

/** Rendered duration of a single clip: `(outMs - inMs) / speed`. */
export function clipDurationMs(clip: Clip): number {
  const span = clip.outMs - clip.inMs;
  if (!Number.isFinite(span) || span <= 0) return 0;
  return Math.max(0, Math.round(span / clampSpeed(clip.speed)));
}

/** Requested transition length, falling back to the catalog default. */
export function requestedTransitionMs(clip: Clip): number {
  const transition = clip.transitionOut;
  if (!transition) return 0;
  if (Number.isFinite(transition.durationMs) && transition.durationMs > 0) {
    return Math.round(transition.durationMs);
  }
  return effectCatalog.transition(transition.type)?.defaultDurationMs ?? DEFAULT_TRANSITION_MS;
}

/**
 * Resolve the usable xfade name for a transition. Unknown ids fall back to
 * `fade`; callers collect a warning so the user knows the look was substituted.
 */
export function transitionXfadeName(type: string): string {
  return effectCatalog.transition(type)?.xfade ?? 'fade';
}

/** A transition may not eat a whole clip: it is clamped to leave a frame. */
export function clampTransitionMs(requestedMs: number, prevDurationMs: number, nextDurationMs: number): number {
  return clampTransitionOverlapMs(requestedMs, prevDurationMs, nextDurationMs);
}

/**
 * Lay clips out sequentially, pulling each following clip back by the
 * transition overlap. Clip 0 starts at 0; every other clip starts where the
 * previous clip's xfade begins.
 */
export function timelineOf(clips: readonly Clip[]): TrackTimeline {
  const result: TimelineClip[] = [];
  let cursor = 0;

  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    if (!clip) continue;
    const durationMs = clipDurationMs(clip);
    const next = clips[index + 1];
    const transitionOutMs = next ? clampTransitionMs(requestedTransitionMs(clip), durationMs, clipDurationMs(next)) : 0;
    const startMs = cursor;
    const endMs = startMs + durationMs;
    result.push({ clip, durationMs, startMs, endMs, transitionOutMs });
    cursor = endMs - transitionOutMs;
  }

  const last = result[result.length - 1];
  return { clips: result, durationMs: last ? last.endMs : 0 };
}

/** Sequential starts only — convenient for callers that do not need transitions. */
export function sequentialStarts(clips: readonly Clip[]): number[] {
  return timelineOf(clips).clips.map((entry) => entry.startMs);
}

/** First visible video track, the one that defines the base render. */
export function mainVideoTrack(project: Project): Track | undefined {
  return project.tracks.find((track) => track.kind === 'video' && !track.hidden);
}

/** Visible overlay tracks (rendered above the main video). */
export function overlayTracks(project: Project): Track[] {
  return project.tracks.filter((track) => track.kind === 'overlay' && !track.hidden);
}

/** Audible audio tracks. */
export function audibleTracks(project: Project): Track[] {
  return project.tracks.filter((track) => track.kind === 'audio' && !track.muted);
}

/** All text items of visible text tracks, sorted by start time. */
export function textItems(project: Project): TextItem[] {
  const items: TextItem[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'text' || track.hidden) continue;
    for (const item of track.items) items.push(item);
  }
  return items.sort((a, b) => a.startMs - b.startMs);
}

/** Timeline end of any track clip: audio and overlay clips use `startMs`. */
export function placedClipEndMs(clip: Clip): number {
  return Math.max(0, clip.startMs ?? 0) + clipDurationMs(clip);
}

/**
 * Full project duration. Delegates to `@editbay/core` so the export, the
 * preview, the agent summary and the CLI can never disagree: the picture
 * (video with transitions, overlay, text) defines the length, audio is cut at
 * that point, and only an audio-only project is measured by its audio.
 */
export function projectDurationMs(project: Project): number {
  return coreProjectDurationMs(project);
}
