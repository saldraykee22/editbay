/**
 * Human-readable change descriptions.
 *
 * Used in agent replies and receipts: short English sentences in a stable
 * order (project, canvas, assets, clips, text), capped at eight lines.
 */

import { clipStartMsOnTrack, clipTimelineDurationMs } from './timeline';
import type { Clip, Project, TextItem, Track } from './types';

interface ClipRef {
  track: Track;
  clip: Clip;
  index: number;
}

interface TextRef {
  track: Track;
  item: TextItem;
  index: number;
}

function seconds(ms: number): string {
  const rounded = Math.round(ms / 100) / 10;
  return `${rounded.toFixed(1)}s`;
}

function short(value: string, max = 40): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function assetLabel(project: Project, assetId: string): string {
  const asset = project.assets.find((candidate) => candidate.id === assetId);
  return asset ? short(asset.label) : assetId;
}

function collectClips(project: Project): ClipRef[] {
  const refs: ClipRef[] = [];
  for (const track of project.tracks) {
    for (let index = 0; index < track.clips.length; index += 1) {
      const clip = track.clips[index];
      if (clip) refs.push({ track, clip, index });
    }
  }
  return refs;
}

function collectText(project: Project): TextRef[] {
  const refs: TextRef[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'text') continue;
    for (let index = 0; index < track.items.length; index += 1) {
      const item = track.items[index];
      if (item) refs.push({ track, item, index });
    }
  }
  return refs;
}

function sameTransform(a: Clip, b: Clip): boolean {
  return JSON.stringify(a.transform ?? null) === JSON.stringify(b.transform ?? null);
}

function sameEffects(a: Clip, b: Clip): boolean {
  return JSON.stringify(a.effects ?? []) === JSON.stringify(b.effects ?? []);
}

function sameTransition(a: Clip, b: Clip): boolean {
  return JSON.stringify(a.transitionOut ?? null) === JSON.stringify(b.transitionOut ?? null);
}

function effectTypes(clip: Clip): string[] {
  return (clip.effects ?? []).map((effect) => effect.type);
}

/**
 * Compares two project snapshots and returns at most eight short sentences.
 * Returns an empty array when nothing meaningful changed.
 */
export function describeChanges(before: Project, after: Project): string[] {
  const changes: string[] = [];

  if (before.name !== after.name) {
    changes.push(`Renamed project to "${short(after.name, 60)}"`);
  }

  if (
    before.canvas.width !== after.canvas.width ||
    before.canvas.height !== after.canvas.height ||
    before.canvas.fps !== after.canvas.fps
  ) {
    changes.push(
      `Set canvas to ${after.canvas.width}x${after.canvas.height} at ${after.canvas.fps}fps`,
    );
  }

  const beforeTracks = new Map(before.tracks.map((track) => [track.id, track]));
  for (const track of after.tracks) {
    const previous = beforeTracks.get(track.id);
    if (!previous) continue;
    if (Boolean(previous.muted) !== Boolean(track.muted)) {
      changes.push(`${track.muted ? 'Muted' : 'Unmuted'} ${track.kind} track`);
    }
    if (Boolean(previous.hidden) !== Boolean(track.hidden)) {
      changes.push(`${track.hidden ? 'Hid' : 'Showed'} ${track.kind} track`);
    }
  }

  const beforeAssets = new Map(before.assets.map((asset) => [asset.id, asset]));
  const afterAssets = new Map(after.assets.map((asset) => [asset.id, asset]));
  for (const asset of after.assets) {
    if (!beforeAssets.has(asset.id)) changes.push(`Added asset '${short(asset.label)}'`);
  }
  for (const asset of before.assets) {
    if (!afterAssets.has(asset.id)) changes.push(`Removed asset '${short(asset.label)}'`);
  }

  const beforeClips = new Map(collectClips(before).map((ref) => [ref.clip.id, ref]));
  const afterClips = collectClips(after);
  const afterClipIds = new Set(afterClips.map((ref) => ref.clip.id));

  for (const ref of afterClips) {
    const previous = beforeClips.get(ref.clip.id);
    const label = assetLabel(after, ref.clip.assetId);
    if (!previous) {
      const start = clipStartMsOnTrack(ref.track, ref.index);
      const noun = ref.track.kind === 'audio' ? 'audio' : ref.track.kind === 'overlay' ? 'overlay' : 'clip';
      changes.push(`Added ${noun} '${label}' at ${seconds(start)}`);
      continue;
    }

    const clip = ref.clip;
    const old = previous.clip;
    if (old.inMs !== clip.inMs || old.outMs !== clip.outMs) {
      changes.push(`Trimmed '${label}' to ${seconds(clipTimelineDurationMs(clip))}`);
    } else if (ref.track.kind === 'video' && previous.index !== ref.index) {
      changes.push(`Moved '${label}' to ${seconds(clipStartMsOnTrack(ref.track, ref.index))}`);
    } else if ((old.startMs ?? 0) !== (clip.startMs ?? 0)) {
      changes.push(`Moved '${label}' to ${seconds(clip.startMs ?? 0)}`);
    }

    if ((old.speed ?? 1) !== (clip.speed ?? 1)) {
      changes.push(`Set speed of '${label}' to ${String(Math.round((clip.speed ?? 1) * 100) / 100)}x`);
    }
    if ((old.volume ?? 1) !== (clip.volume ?? 1)) {
      changes.push(`Set volume of '${label}' to ${String(Math.round((clip.volume ?? 1) * 100) / 100)}`);
    }
    if (
      (old.audioFadeInMs ?? 0) !== (clip.audioFadeInMs ?? 0) ||
      (old.audioFadeOutMs ?? 0) !== (clip.audioFadeOutMs ?? 0)
    ) {
      const fadeIn = clip.audioFadeInMs ?? 0;
      const fadeOut = clip.audioFadeOutMs ?? 0;
      const parts: string[] = [];
      if (fadeIn > 0) parts.push(`in ${seconds(fadeIn)}`);
      if (fadeOut > 0) parts.push(`out ${seconds(fadeOut)}`);
      changes.push(
        parts.length > 0
          ? `Set audio fade on '${label}' (${parts.join(', ')})`
          : `Removed audio fade from '${label}'`,
      );
    }
    if (!sameTransform(old, clip)) {
      changes.push(`Adjusted transform of '${label}'`);
    }
    if (!sameEffects(old, clip)) {
      const beforeTypes = effectTypes(old);
      const afterTypes = effectTypes(clip);
      const added = afterTypes.filter((type) => !beforeTypes.includes(type));
      const removed = beforeTypes.filter((type) => !afterTypes.includes(type));
      if (added.length > 0) {
        changes.push(`Added '${added.map((type) => short(type, 24)).join("', '")}' effect to '${label}'`);
      } else if (removed.length > 0) {
        changes.push(
          `Removed '${removed.map((type) => short(type, 24)).join("', '")}' effect from '${label}'`,
        );
      } else {
        changes.push(`Updated effects on '${label}'`);
      }
    }
    if (!sameTransition(old, clip)) {
      if (!old.transitionOut && clip.transitionOut) {
        changes.push(`Added '${short(clip.transitionOut.type, 24)}' transition after '${label}'`);
      } else if (old.transitionOut && !clip.transitionOut) {
        changes.push(`Removed transition after '${label}'`);
      } else {
        changes.push(`Changed transition after '${label}'`);
      }
    }
  }

  for (const ref of beforeClips.values()) {
    if (afterClipIds.has(ref.clip.id)) continue;
    const label = assetLabel(before, ref.clip.assetId);
    const noun = ref.track.kind === 'audio' ? 'audio' : ref.track.kind === 'overlay' ? 'overlay' : 'clip';
    changes.push(`Removed ${noun} '${label}'`);
  }

  const beforeText = new Map(collectText(before).map((ref) => [ref.item.id, ref]));
  const afterText = collectText(after);
  const afterTextIds = new Set(afterText.map((ref) => ref.item.id));

  for (const ref of afterText) {
    const previous = beforeText.get(ref.item.id);
    const item = ref.item;
    if (!previous) {
      changes.push(`Added text "${short(item.text, 32)}" at ${seconds(item.startMs)}`);
      continue;
    }
    const old = previous.item;
    if (old.text !== item.text) {
      changes.push(`Changed text to "${short(item.text, 32)}"`);
    } else if (old.startMs !== item.startMs || old.durationMs !== item.durationMs) {
      changes.push(`Retimed text "${short(item.text, 32)}"`);
    } else if (
      JSON.stringify(old.style) !== JSON.stringify(item.style) ||
      old.animation !== item.animation
    ) {
      changes.push(`Restyled text "${short(item.text, 32)}"`);
    }
  }

  for (const ref of beforeText.values()) {
    if (afterTextIds.has(ref.item.id)) continue;
    changes.push(`Removed text "${short(ref.item.text, 32)}"`);
  }

  return changes.slice(0, 8);
}
