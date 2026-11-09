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

/** Timeline start of the clip at `index` on `track`. */
export function clipStartMsOnTrack(track: Track, index: number): number {
  if (!isSequentialTrack(track)) {
    const clip = track.clips[index];
    return Math.round(clip?.startMs ?? 0);
  }
  let start = 0;
  for (let i = 0; i < index; i += 1) {
    const clip = track.clips[i];
    if (clip) start += clipTimelineDurationMs(clip);
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
    return clipStartMsOnTrack(track, track.clips.length);
  }
  let end = 0;
  for (const clip of track.clips) {
    end = Math.max(end, (clip.startMs ?? 0) + clipTimelineDurationMs(clip));
  }
  return Math.round(end);
}

/** Project duration: the furthest end point across all tracks. */
export function timelineDurationMs(project: Project): number {
  let end = 0;
  for (const track of project.tracks) {
    end = Math.max(end, trackDurationMs(track));
  }
  return Math.round(end);
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
