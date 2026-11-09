/**
 * Read-only timeline math.
 *
 * The main video track is sequential: a clip's timeline start is the sum of
 * the durations of the clips before it. Overlay, audio and text entities are
 * placed with absolute `startMs` values instead.
 */

import type { Asset, Clip, Project, TextItem, Track } from './types';

export interface ClipLocation {
  track: Track;
  clip: Clip;
  index: number;
}

export interface TextLocation {
  track: Track;
  item: TextItem;
  index: number;
}

/** A clip is sequential only on the main video track. */
export function isSequentialTrack(track: Track): boolean {
  return track.kind === 'video';
}

/** Timeline duration of a clip after applying its speed. */
export function clipTimelineDurationMs(clip: Clip): number {
  const speed = typeof clip.speed === 'number' && clip.speed > 0 ? clip.speed : 1;
  return Math.max(0, Math.round((clip.outMs - clip.inMs) / speed));
}

/** A transition may not eat a whole clip: it leaves at least one millisecond. */
export const MIN_TRANSITION_MARGIN_MS = 1;

/**
 * Usable transition overlap between two sequential clips. This is the single
 * source of truth shared by the editor, the agent prompt, the MCP server and
 * the export engine.
 */
export function clampTransitionOverlapMs(requestedMs: number, prevDurationMs: number, nextDurationMs: number): number {
  if (!Number.isFinite(requestedMs) || requestedMs <= 0) return 0;
  const max = Math.floor(Math.min(prevDurationMs, nextDurationMs) / 2);
  if (max <= 0) return 0;
  return Math.min(Math.round(requestedMs), max);
}

/** Overlap produced by `clip.transitionOut` towards the next clip. */
export function transitionOverlapMs(clip: Clip, next: Clip | undefined): number {
  if (!clip.transitionOut || !next) return 0;
  return clampTransitionOverlapMs(
    clip.transitionOut.durationMs,
    clipTimelineDurationMs(clip),
    clipTimelineDurationMs(next),
  );
}

/**
 * Timeline start of the clip at `index` on `track`. Sequential tracks pull each
 * following clip back by the previous clip's transition overlap.
 */
export function clipStartMsOnTrack(track: Track, index: number): number {
  if (!isSequentialTrack(track)) {
    const clip = track.clips[index];
    return Math.round(clip?.startMs ?? 0);
  }
  let start = 0;
  for (let i = 0; i < index; i += 1) {
    const clip = track.clips[i];
    if (!clip) continue;
    start += clipTimelineDurationMs(clip) - transitionOverlapMs(clip, track.clips[i + 1]);
  }
  return start;
}

/** Full extent of a track, in ms. */
export function trackDurationMs(track: Track): number {
  if (track.kind === 'text') {
    let end = 0;
    for (const item of track.items) {
      end = Math.max(end, item.startMs + item.durationMs);
    }
    return Math.round(end);
  }
  if (isSequentialTrack(track)) {
    const lastIndex = track.clips.length - 1;
    const last = track.clips[lastIndex];
    if (!last) return 0;
    return Math.round(clipStartMsOnTrack(track, lastIndex) + clipTimelineDurationMs(last));
  }
  let end = 0;
  for (const clip of track.clips) {
    end = Math.max(end, (clip.startMs ?? 0) + clipTimelineDurationMs(clip));
  }
  return Math.round(end);
}

/**
 * End of the visible picture: video tracks (transition overlaps already
 * subtracted), overlay clips and text items. Audio tracks never contribute.
 */
export function visualDurationMs(project: Project): number {
  let end = 0;
  for (const track of project.tracks) {
    if (track.hidden) continue;
    if (track.kind === 'audio') continue;
    end = Math.max(end, trackDurationMs(track));
  }
  return Math.round(end);
}

/**
 * Project duration: the furthest end of the visible content.
 *
 * Audio tracks deliberately do not extend the project — a music bed longer
 * than the picture is trimmed at export (with an automatic fade-out) instead
 * of leaving a black tail. A muted track never counts. Only when there is no
 * video, overlay or text at all does the audio define the duration, so an
 * audio-only project still has a length.
 */
export function projectDurationMs(project: Project): number {
  const visual = visualDurationMs(project);
  if (visual > 0) return visual;

  let end = 0;
  for (const track of project.tracks) {
    if (track.hidden || track.kind !== 'audio' || track.muted) continue;
    end = Math.max(end, trackDurationMs(track));
  }
  return Math.round(end);
}

/** Backwards-compatible alias used across the app. */
export function timelineDurationMs(project: Project): number {
  return projectDurationMs(project);
}

/** Timeline start of a clip on the main video track, or null if not there. */
export function videoClipStartMs(project: Project, clipId: string): number | null {
  for (const track of project.tracks) {
    if (track.kind !== 'video') continue;
    const index = track.clips.findIndex((clip) => clip.id === clipId);
    if (index >= 0) return clipStartMsOnTrack(track, index);
  }
  return null;
}

/** Finds a clip on any clip-bearing track. */
export function findClip(project: Project, clipId: string): ClipLocation | null {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((clip) => clip.id === clipId);
    if (index >= 0) {
      const clip = track.clips[index];
      if (clip) return { track, clip, index };
    }
  }
  return null;
}

/** Finds a text item on any text track. */
export function findTextItem(project: Project, itemId: string): TextLocation | null {
  for (const track of project.tracks) {
    if (track.kind !== 'text') continue;
    const index = track.items.findIndex((item) => item.id === itemId);
    if (index >= 0) {
      const item = track.items[index];
      if (item) return { track, item, index };
    }
  }
  return null;
}

export function findAsset(project: Project, assetId: string): Asset | null {
  return project.assets.find((asset) => asset.id === assetId) ?? null;
}

/** First track of a given kind, if any. */
export function trackByKind(project: Project, kind: Track['kind']): Track | null {
  return project.tracks.find((track) => track.kind === kind) ?? null;
}

export function trackById(project: Project, trackId: string): Track | null {
  return project.tracks.find((track) => track.id === trackId) ?? null;
}

export function mainVideoTrack(project: Project): Track {
  const track = trackByKind(project, 'video');
  if (!track) throw new Error('Project has no video track');
  return track;
}

export function textTrack(project: Project): Track {
  const track = trackByKind(project, 'text');
  if (!track) throw new Error('Project has no text track');
  return track;
}

export function audioTrack(project: Project): Track {
  const track = trackByKind(project, 'audio');
  if (!track) throw new Error('Project has no audio track');
  return track;
}
