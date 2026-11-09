/**
 * Project construction and structural validation.
 */

import { createId } from './ids';
import { clipTimelineDurationMs } from './timeline';
import type { Clip, Project, TextAnimation, Track, Transform, TextStyle } from './types';
import { DEFAULT_CANVAS } from './types';

const TEXT_ANIMATIONS: TextAnimation[] = ['none', 'fade', 'rise', 'typewriter'];
const TEXT_ALIGNMENTS: TextStyle['align'][] = ['left', 'center', 'right'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Creates an empty, valid project with the four standard tracks. */
export function createEmptyProject(name = 'Untitled'): Project {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const projectName = trimmed.length > 0 ? trimmed.slice(0, 120) : 'Untitled';
  const now = new Date().toISOString();

  const makeTrack = (kind: Track['kind'], trackName: string): Track => ({
    id: createId('t'),
    kind,
    name: trackName,
    clips: [],
    items: [],
  });

  return {
    schemaVersion: 2,
    id: createId('p'),
    name: projectName,
    canvas: { ...DEFAULT_CANVAS },
    assets: [],
    tracks: [
      makeTrack('video', 'Main video'),
      makeTrack('overlay', 'Overlay'),
      makeTrack('text', 'Text'),
      makeTrack('audio', 'Audio'),
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function validateTransform(transform: Transform): string[] {
  const errors: string[] = [];
  if (!isFiniteNumber(transform.x) || transform.x < -1 || transform.x > 1) {
    errors.push('transform.x must be between -1 and 1');
  }
  if (!isFiniteNumber(transform.y) || transform.y < -1 || transform.y > 1) {
    errors.push('transform.y must be between -1 and 1');
  }
  if (!isFiniteNumber(transform.scale) || transform.scale < 0.05 || transform.scale > 8) {
    errors.push('transform.scale must be between 0.05 and 8');
  }
  if (!isFiniteNumber(transform.rotation) || transform.rotation < -360 || transform.rotation > 360) {
    errors.push('transform.rotation must be between -360 and 360');
  }
  if (!isFiniteNumber(transform.opacity) || transform.opacity < 0 || transform.opacity > 1) {
    errors.push('transform.opacity must be between 0 and 1');
  }
  return errors;
}

function validateClip(
  clip: Clip,
  track: Track,
  index: number,
  project: Project,
  clipIds: Set<string>,
): string[] {
  const errors: string[] = [];
  const duration = clipTimelineDurationMs(clip);
  const asset = project.assets.find((candidate) => candidate.id === clip.assetId);

  if (clipIds.has(clip.id)) errors.push(`Duplicate clip id ${clip.id}`);
  clipIds.add(clip.id);

  if (!asset) {
    errors.push(`Clip ${clip.id} references missing asset ${clip.assetId}`);
  } else if (asset.kind !== 'image' && asset.durationMs > 0 && clip.outMs > asset.durationMs) {
    errors.push(`Clip ${clip.id} outMs exceeds asset duration`);
  }

  if (!isFiniteNumber(clip.inMs) || !isFiniteNumber(clip.outMs)) {
    errors.push(`Clip ${clip.id} has non-numeric in/out points`);
  } else {
    if (clip.inMs < 0) errors.push(`Clip ${clip.id} inMs must not be negative`);
    if (clip.outMs <= clip.inMs) errors.push(`Clip ${clip.id} outMs must be greater than inMs`);
    if (duration < 100) errors.push(`Clip ${clip.id} duration must be at least 100ms`);
  }

  if (clip.speed !== undefined && (!isFiniteNumber(clip.speed) || clip.speed < 0.25 || clip.speed > 4)) {
    errors.push(`Clip ${clip.id} speed must be between 0.25 and 4`);
  }
  if (clip.volume !== undefined && (!isFiniteNumber(clip.volume) || clip.volume < 0 || clip.volume > 2)) {
    errors.push(`Clip ${clip.id} volume must be between 0 and 2`);
  }
  if (clip.transform) {
    for (const message of validateTransform(clip.transform)) {
      errors.push(`Clip ${clip.id}: ${message}`);
    }
  }
  if (track.kind === 'overlay' || track.kind === 'audio') {
    if (clip.startMs !== undefined && (!isFiniteNumber(clip.startMs) || clip.startMs < 0)) {
      errors.push(`Clip ${clip.id} startMs must not be negative`);
    }
  }

  for (const effect of clip.effects ?? []) {
    if (typeof effect.type !== 'string' || effect.type.trim() === '') {
      errors.push(`Effect ${effect.id} on clip ${clip.id} has an empty type`);
    }
    if (effect.startMs !== undefined && (!isFiniteNumber(effect.startMs) || effect.startMs < 0)) {
      errors.push(`Effect ${effect.id} on clip ${clip.id} has an invalid startMs`);
    }
    if (effect.durationMs !== undefined && (!isFiniteNumber(effect.durationMs) || effect.durationMs < 50)) {
      errors.push(`Effect ${effect.id} on clip ${clip.id} has an invalid durationMs`);
    }
    const windowStart = effect.startMs ?? 0;
    const windowDuration = effect.durationMs;
    if (windowDuration !== undefined && windowStart + windowDuration > duration) {
      errors.push(`Effect ${effect.id} on clip ${clip.id} extends past the clip`);
    }
  }

  if (clip.transitionOut) {
    const transition = clip.transitionOut;
    const isLast = index === track.clips.length - 1;
    if (isLast) {
      errors.push(`Clip ${clip.id} has a transition but no following clip`);
    } else {
      const next = track.clips[index + 1];
      const nextDuration = next ? clipTimelineDurationMs(next) : 0;
      const shorter = Math.min(duration, nextDuration);
      if (
        !isFiniteNumber(transition.durationMs) ||
        transition.durationMs < 50 ||
        transition.durationMs > 3000
      ) {
        errors.push(`Transition on clip ${clip.id} duration must be between 50 and 3000ms`);
      } else if (transition.durationMs * 2 > shorter) {
        errors.push(`Transition on clip ${clip.id} is longer than half of a neighbouring clip`);
      }
    }
  }

  return errors;
}

function validateTextStyle(style: TextStyle): string[] {
  const errors: string[] = [];
  if (typeof style.fontFamily !== 'string' || style.fontFamily.trim() === '') {
    errors.push('fontFamily must be a non-empty string');
  }
  if (!isFiniteNumber(style.fontSize) || style.fontSize <= 0) {
    errors.push('fontSize must be greater than 0');
  }
  if (!isFiniteNumber(style.fontWeight) || style.fontWeight <= 0) {
    errors.push('fontWeight must be greater than 0');
  }
  if (typeof style.color !== 'string' || style.color.trim() === '') {
    errors.push('color must be a non-empty string');
  }
  if (!TEXT_ALIGNMENTS.includes(style.align)) {
    errors.push('align must be left, center or right');
  }
  if (!isFiniteNumber(style.x)) errors.push('style.x must be a number');
  if (!isFiniteNumber(style.y)) errors.push('style.y must be a number');
  return errors;
}

/** Returns a list of human-readable problems; empty means the project is valid. */
export function validateProject(project: Project): string[] {
  const errors: string[] = [];

  if (project.schemaVersion !== 2) errors.push('schemaVersion must be 2');
  if (typeof project.id !== 'string' || project.id.trim() === '') {
    errors.push('Project id is required');
  }
  const name = typeof project.name === 'string' ? project.name.trim() : '';
  if (name.length < 1 || name.length > 120) {
    errors.push('Project name must be 1..120 characters');
  }

  const canvas = project.canvas;
  if (!canvas || !isFiniteNumber(canvas.width) || !Number.isInteger(canvas.width) || canvas.width % 2 !== 0 || canvas.width < 240 || canvas.width > 7680) {
    errors.push('Canvas width must be an even integer between 240 and 7680');
  }
  if (!canvas || !isFiniteNumber(canvas.height) || !Number.isInteger(canvas.height) || canvas.height % 2 !== 0 || canvas.height < 240 || canvas.height > 7680) {
    errors.push('Canvas height must be an even integer between 240 and 7680');
  }
  if (!canvas || !isFiniteNumber(canvas.fps) || !Number.isInteger(canvas.fps) || canvas.fps < 1 || canvas.fps > 120) {
    errors.push('Canvas fps must be an integer between 1 and 120');
  }

  const assetIds = new Set<string>();
  for (const asset of project.assets) {
    if (assetIds.has(asset.id)) errors.push(`Duplicate asset id ${asset.id}`);
    assetIds.add(asset.id);
    if (typeof asset.uri !== 'string' || asset.uri.trim() === '') {
      errors.push(`Asset ${asset.id} uri is required`);
    }
    if (typeof asset.label !== 'string' || asset.label.trim() === '') {
      errors.push(`Asset ${asset.id} label is required`);
    }
    if (!isFiniteNumber(asset.durationMs) || asset.durationMs < 0) {
      errors.push(`Asset ${asset.id} durationMs must not be negative`);
    } else if (asset.kind !== 'image' && asset.durationMs <= 0) {
      errors.push(`Asset ${asset.id} durationMs must be greater than 0`);
    }
  }

  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  const textIds = new Set<string>();

  for (const track of project.tracks) {
    if (trackIds.has(track.id)) errors.push(`Duplicate track id ${track.id}`);
    trackIds.add(track.id);

    if (track.kind === 'text') {
      for (const item of track.items) {
        if (textIds.has(item.id)) errors.push(`Duplicate text item id ${item.id}`);
        textIds.add(item.id);
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (text.length < 1 || text.length > 500) {
          errors.push(`Text item ${item.id} text must be 1..500 characters`);
        }
        if (!isFiniteNumber(item.startMs) || item.startMs < 0) {
          errors.push(`Text item ${item.id} startMs must not be negative`);
        }
        if (!isFiniteNumber(item.durationMs) || item.durationMs < 200) {
          errors.push(`Text item ${item.id} durationMs must be at least 200`);
        }
        for (const message of validateTextStyle(item.style)) {
          errors.push(`Text item ${item.id}: ${message}`);
        }
        if (item.animation !== undefined && !TEXT_ANIMATIONS.includes(item.animation)) {
          errors.push(`Text item ${item.id} has an unsupported animation`);
        }
      }
      continue;
    }

    for (let index = 0; index < track.clips.length; index += 1) {
      const clip = track.clips[index];
      if (!clip) continue;
      for (const message of validateClip(clip, track, index, project, clipIds)) {
        errors.push(message);
      }
      if (track.kind === 'video' && clip.startMs !== undefined) {
        errors.push(`Clip ${clip.id} is on the sequential video track but carries a startMs`);
      }
    }
  }

  return errors;
}
