/**
 * The pure command engine.
 *
 * `applyCommand` clones the project, applies one edit and reports what
 * changed. It never mutates its input and never throws for invalid agent/user
 * input: domain problems come back as `{ ok: false, error }`.
 */

import { describeChanges } from './changes';
import { createId } from './ids';
import {
  clampTransitionOverlapMs,
  clipTimelineDurationMs,
  findAsset,
  findClip,
  findTextItem,
  trackByKind,
  trackById,
} from './timeline';
import type {
  ApplyFailure,
  ApplyResult,
  ApplySuccess,
  Asset,
  AssetKind,
  BatchResult,
  Clip,
  CommandError,
  EditCommand,
  EffectInstance,
  EffectParam,
  ErrorCode,
  Id,
  Project,
  TextAnimation,
  TextItem,
  TextStyle,
  Track,
  Transform,
} from './types';
import { DEFAULT_TEXT_STYLE, DEFAULT_TRANSFORM } from './types';

const MIN_CLIP_MS = 100;
const MIN_TEXT_MS = 200;
const MAX_TEXT_CHARS = 500;
const MAX_START_MS = 600_000;
const MAX_FADE_MS = 10_000;
const MIN_OVERLAY_SCALE = 0.05;
const MAX_OVERLAY_SCALE = 1;
const ANIMATIONS: readonly TextAnimation[] = ['none', 'fade', 'rise', 'typewriter'];
const ALIGNMENTS: readonly TextStyle['align'][] = ['left', 'center', 'right'];

/* ------------------------------------------------------------------ */
/* Small validation helpers                                            */
/* ------------------------------------------------------------------ */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Normalizes a millisecond value; returns null for non-finite input. */
function toMs(value: unknown): number | null {
  return isFiniteNumber(value) ? Math.round(value) : null;
}

function errorWith(code: ErrorCode, message: string, hint?: string): CommandError {
  return hint === undefined ? { code, message } : { code, message, hint };
}

type CommandOutcome =
  | { ok: true; createdIds: Record<string, Id> }
  | { ok: false; error: CommandError };

function okOutcome(createdIds: Record<string, Id> = {}): CommandOutcome {
  return { ok: true, createdIds };
}

function failOutcome(code: ErrorCode, message: string, hint?: string): CommandOutcome {
  return { ok: false, error: errorWith(code, message, hint) };
}

function clipHint(project: Project): string {
  const ids: string[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) ids.push(clip.id);
  }
  return ids.length > 0 ? `Available clip ids: ${ids.join(', ')}` : 'The project has no clips';
}

function assetHint(project: Project): string {
  const ids = project.assets.map((asset) => asset.id);
  return ids.length > 0 ? `Available asset ids: ${ids.join(', ')}` : 'The project has no assets';
}

function labelFromUri(uri: string): string {
  const clean = uri.split('#')[0]?.split('?')[0] ?? uri;
  const parts = clean.split(/[\\/]/);
  const base = parts[parts.length - 1] ?? '';
  const dot = base.lastIndexOf('.');
  const name = dot > 0 ? base.slice(0, dot) : base;
  return name.trim() || 'asset';
}

function isTextAnimation(value: unknown): value is TextAnimation {
  return typeof value === 'string' && (ANIMATIONS as readonly string[]).includes(value);
}

function validateParams(params: unknown): CommandError | null {
  if (params === undefined) return null;
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return errorWith('invalid', 'params must be an object');
  }
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return errorWith('invalid', `Param '${key}' must be a finite number`);
      }
    } else if (typeof value !== 'string' && typeof value !== 'boolean') {
      return errorWith('invalid', `Param '${key}' must be number, string or boolean`);
    }
  }
  return null;
}

function cloneParams(
  params: Record<string, EffectParam> | undefined,
): Record<string, EffectParam> | undefined {
  return params === undefined ? undefined : structuredClone(params);
}

function applyStylePatch(
  style: TextStyle,
  patch: Partial<TextStyle> | undefined,
): CommandError | null {
  if (patch === undefined) return null;
  const raw = patch as unknown;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return errorWith('invalid', 'style must be an object');
  }

  if (patch.fontFamily !== undefined) {
    if (typeof patch.fontFamily !== 'string' || patch.fontFamily.trim() === '') {
      return errorWith('invalid', 'style.fontFamily must be a non-empty string');
    }
    style.fontFamily = patch.fontFamily;
  }
  if (patch.fontSize !== undefined) {
    if (!isFiniteNumber(patch.fontSize) || patch.fontSize <= 0) {
      return errorWith('out_of_range', 'style.fontSize must be greater than 0');
    }
    style.fontSize = patch.fontSize;
  }
  if (patch.fontWeight !== undefined) {
    if (!isFiniteNumber(patch.fontWeight) || patch.fontWeight <= 0) {
      return errorWith('out_of_range', 'style.fontWeight must be greater than 0');
    }
    style.fontWeight = patch.fontWeight;
  }
  if (patch.color !== undefined) {
    if (typeof patch.color !== 'string' || patch.color.trim() === '') {
      return errorWith('invalid', 'style.color must be a non-empty string');
    }
    style.color = patch.color;
  }
  if (patch.align !== undefined) {
    if (!ALIGNMENTS.includes(patch.align)) {
      return errorWith('invalid', 'style.align must be left, center or right');
    }
    style.align = patch.align;
  }
  if (patch.x !== undefined) {
    if (!isFiniteNumber(patch.x)) return errorWith('invalid', 'style.x must be a number');
    style.x = patch.x;
  }
  if (patch.y !== undefined) {
    if (!isFiniteNumber(patch.y)) return errorWith('invalid', 'style.y must be a number');
    style.y = patch.y;
  }
  if (patch.background !== undefined) {
    if (typeof patch.background !== 'string') {
      return errorWith('invalid', 'style.background must be a string');
    }
    style.background = patch.background;
  }
  if (patch.shadow !== undefined) {
    if (typeof patch.shadow !== 'boolean') {
      return errorWith('invalid', 'style.shadow must be a boolean');
    }
    style.shadow = patch.shadow;
  }
  const numericOptional: (keyof Pick<
    TextStyle,
    'padding' | 'radius' | 'letterSpacing' | 'lineHeight'
  >)[] = ['padding', 'radius', 'letterSpacing', 'lineHeight'];
  for (const key of numericOptional) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!isFiniteNumber(value) || value < 0) {
      return errorWith('out_of_range', `style.${key} must be a non-negative number`);
    }
    style[key] = value;
  }
  return null;
}

function applyTransformPatch(
  clip: Clip,
  patch: Partial<Transform> | undefined,
): CommandError | null {
  if (patch === undefined) return errorWith('invalid', 'transform is required');
  const raw = patch as unknown;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return errorWith('invalid', 'transform must be an object');
  }
  const merged: Transform = { ...DEFAULT_TRANSFORM, ...(clip.transform ?? {}) };

  if (patch.x !== undefined) {
    if (!isFiniteNumber(patch.x) || patch.x < -1 || patch.x > 1) {
      return errorWith('out_of_range', 'transform.x must be between -1 and 1');
    }
    merged.x = patch.x;
  }
  if (patch.y !== undefined) {
    if (!isFiniteNumber(patch.y) || patch.y < -1 || patch.y > 1) {
      return errorWith('out_of_range', 'transform.y must be between -1 and 1');
    }
    merged.y = patch.y;
  }
  if (patch.scale !== undefined) {
    if (!isFiniteNumber(patch.scale) || patch.scale < 0.05 || patch.scale > 8) {
      return errorWith('out_of_range', 'transform.scale must be between 0.05 and 8');
    }
    merged.scale = patch.scale;
  }
  if (patch.rotation !== undefined) {
    if (!isFiniteNumber(patch.rotation) || patch.rotation < -360 || patch.rotation > 360) {
      return errorWith('out_of_range', 'transform.rotation must be between -360 and 360');
    }
    merged.rotation = patch.rotation;
  }
  if (patch.opacity !== undefined) {
    if (!isFiniteNumber(patch.opacity) || patch.opacity < 0 || patch.opacity > 1) {
      return errorWith('out_of_range', 'transform.opacity must be between 0 and 1');
    }
    merged.opacity = patch.opacity;
  }

  clip.transform = merged;
  return null;
}

/** Validated overlay placement fields, as accepted by add_overlay/set_overlay. */
interface OverlayPatch {
  startMs?: number | null;
  durationMs?: number | null;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
}

/**
 * Range checks shared by `add_overlay` and `set_overlay`. `x`/`y` are canvas
 * normalized (0..1) and `scale` is a fraction of the canvas width, so an
 * out-of-range value is rejected instead of silently clamped.
 */
function validateOverlayPatch(patch: OverlayPatch): CommandError | null {
  if (patch.startMs !== undefined) {
    if (patch.startMs === null || patch.startMs < 0 || patch.startMs > MAX_START_MS) {
      return errorWith('out_of_range', `startMs must be between 0 and ${MAX_START_MS}`);
    }
  }
  if (patch.durationMs !== undefined) {
    if (patch.durationMs === null || patch.durationMs < MIN_CLIP_MS) {
      return errorWith('out_of_range', `durationMs must be at least ${MIN_CLIP_MS}`);
    }
    if (patch.durationMs > MAX_START_MS) {
      return errorWith('out_of_range', `durationMs must be at most ${MAX_START_MS}`);
    }
  }
  if (patch.x !== undefined && (!isFiniteNumber(patch.x) || patch.x < 0 || patch.x > 1)) {
    return errorWith('out_of_range', 'x must be between 0 and 1 (normalized canvas position)');
  }
  if (patch.y !== undefined && (!isFiniteNumber(patch.y) || patch.y < 0 || patch.y > 1)) {
    return errorWith('out_of_range', 'y must be between 0 and 1 (normalized canvas position)');
  }
  if (
    patch.scale !== undefined &&
    (!isFiniteNumber(patch.scale) || patch.scale < MIN_OVERLAY_SCALE || patch.scale > MAX_OVERLAY_SCALE)
  ) {
    return errorWith(
      'out_of_range',
      `scale must be between ${MIN_OVERLAY_SCALE} and ${MAX_OVERLAY_SCALE} (fraction of canvas width)`,
    );
  }
  if (patch.opacity !== undefined && (!isFiniteNumber(patch.opacity) || patch.opacity < 0 || patch.opacity > 1)) {
    return errorWith('out_of_range', 'opacity must be between 0 and 1');
  }
  return null;
}

/**
 * Overlay clips keep their placement in `Transform`, whose `x`/`y` are offsets
 * from the canvas centre. The command surface exposes plain canvas
 * coordinates, so 0.5 becomes 0 and 0.85 becomes 0.35.
 */
function overlayTransform(
  base: Transform,
  x: number | undefined,
  y: number | undefined,
  scale: number | undefined,
  opacity: number | undefined,
): Transform {
  const next: Transform = { ...base };
  if (x !== undefined) next.x = x - 0.5;
  if (y !== undefined) next.y = y - 0.5;
  if (scale !== undefined) next.scale = scale;
  if (opacity !== undefined) next.opacity = opacity;
  return next;
}

function transformDefaults(clip: Clip): Transform {
  return { ...DEFAULT_TRANSFORM, ...(clip.transform ?? {}) };
}

/** Validates in/out points against the source asset and the 100ms floor. */
function validateTrim(
  project: Project,
  clip: Clip,
  inMs: number | null,
  outMs: number | null,
): CommandError | null {
  if (inMs === null || outMs === null) {
    return errorWith('invalid', 'inMs and outMs must be finite numbers');
  }
  if (inMs < 0) return errorWith('out_of_range', 'inMs must not be negative');
  if (outMs <= inMs) return errorWith('invalid', 'outMs must be greater than inMs');

  const asset = findAsset(project, clip.assetId);
  if (asset && asset.kind !== 'image' && asset.durationMs > 0 && outMs > asset.durationMs) {
    return errorWith(
      'out_of_range',
      `outMs ${outMs} exceeds asset duration ${asset.durationMs}`,
      `Asset '${asset.label}' (${asset.id}) is ${asset.durationMs}ms long`,
    );
  }

  const duration = clipTimelineDurationMs({ ...clip, inMs, outMs });
  if (duration < MIN_CLIP_MS) {
    return errorWith(
      'out_of_range',
      `Clip would be ${duration}ms; the minimum duration is ${MIN_CLIP_MS}ms`,
    );
  }
  return null;
}

function acceptsAsset(track: Track, asset: Asset): boolean {
  if (track.kind === 'video' || track.kind === 'overlay') return asset.kind !== 'audio';
  if (track.kind === 'audio') return asset.kind === 'audio';
  return false;
}

interface SplitEffectsResult {
  first: EffectInstance[];
  second: EffectInstance[];
}

/** Splits effect windows at a timeline offset, shifting the second half. */
function splitEffects(
  effects: EffectInstance[],
  atMs: number,
  clipDuration: number,
): SplitEffectsResult {
  const first: EffectInstance[] = [];
  const second: EffectInstance[] = [];

  for (const effect of effects) {
    const explicitStart = effect.startMs;
    const explicitDuration = effect.durationMs;
    const start = explicitStart ?? 0;
    const end = explicitDuration !== undefined ? start + explicitDuration : clipDuration;

    if (start < atMs) {
      const copy = structuredClone(effect);
      if (explicitDuration !== undefined) {
        const firstDuration = Math.min(start + explicitDuration, atMs) - start;
        if (firstDuration >= 50) {
          copy.durationMs = firstDuration;
          first.push(copy);
        }
      } else {
        first.push(copy);
      }
    }

    if (end > atMs) {
      const copy = structuredClone(effect);
      copy.id = createId('fx');
      const newStart = Math.max(0, start - atMs);
      if (explicitStart !== undefined) copy.startMs = newStart;
      if (explicitDuration !== undefined) {
        const newEnd = Math.min(end, clipDuration) - atMs;
        const newDuration = newEnd - newStart;
        if (newDuration >= 50) {
          copy.durationMs = newDuration;
          second.push(copy);
        }
      } else {
        second.push(copy);
      }
    }
  }

  return { first, second };
}

/**
 * Keep a track self-consistent after any mutation: no dangling transition on
 * the last clip, no transition that eats a clip, fades inside the clip, effect
 * windows inside the clip. Runs after every successful command.
 */
function normalizeTrack(track: Track): void {
  const clips = track.clips;
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    if (!clip) continue;
    const duration = clipTimelineDurationMs(clip);
    const next = clips[index + 1];

    if (clip.transitionOut) {
      if (!next) {
        delete clip.transitionOut;
      } else {
        const clamped = clampTransitionOverlapMs(
          clip.transitionOut.durationMs,
          duration,
          clipTimelineDurationMs(next),
        );
        if (clamped < 50) delete clip.transitionOut;
        else clip.transitionOut.durationMs = clamped;
      }
    }

    if (clip.audioFadeInMs !== undefined) clip.audioFadeInMs = Math.min(clip.audioFadeInMs, duration);
    if (clip.audioFadeOutMs !== undefined) clip.audioFadeOutMs = Math.min(clip.audioFadeOutMs, duration);

    if (clip.effects && clip.effects.length > 0) {
      clip.effects = clip.effects.filter((effect) => {
        const start = effect.startMs ?? 0;
        if (start >= duration) return false;
        const available = duration - start;
        if (effect.durationMs !== undefined) effect.durationMs = Math.min(effect.durationMs, available);
        return (effect.durationMs ?? available) >= 50;
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Command handlers                                                    */
/* ------------------------------------------------------------------ */function runCommand(draft: Project, command: EditCommand): CommandOutcome {
  switch (command.op) {
    case 'import_clip': {
      const asset = findAsset(draft, command.assetId);
      if (!asset) {
        return failOutcome(
          'not_found',
          `Asset '${command.assetId}' not found`,
          assetHint(draft),
        );
      }

      let track: Track | null;
      if (command.trackId !== undefined) {
        track = trackById(draft, command.trackId);
        if (!track) {
          return failOutcome('not_found', `Track '${command.trackId}' not found`);
        }
      } else {
        track = trackByKind(draft, asset.kind === 'audio' ? 'audio' : 'video');
      }
      if (!track) {
        return failOutcome('not_found', 'No suitable track is available for this asset');
      }
      if (!acceptsAsset(track, asset)) {
        return failOutcome(
          'invalid',
          `Asset '${asset.label}' cannot be placed on a ${track.kind} track`,
        );
      }

      const outMs = asset.durationMs > 0 ? asset.durationMs : 1000;
      const clip: Clip = {
        id: createId('c'),
        assetId: asset.id,
        inMs: 0,
        outMs,
        effects: [],
      };
      if (track.kind !== 'video') clip.startMs = 0;

      if (command.index !== undefined) {
        const index = command.index;
        if (!isInteger(index) || index < 0) {
          return failOutcome('invalid', 'index must be a non-negative integer');
        }
        if (index > track.clips.length) {
          return failOutcome(
            'out_of_range',
            `index ${index} is past the end of the track`,
            `Valid insert positions are 0..${track.clips.length}`,
          );
        }
        track.clips.splice(index, 0, clip);
      } else {
        track.clips.push(clip);
      }

      return okOutcome({ clip: clip.id });
    }

    case 'add_asset': {
      const input = command.asset as Asset | null | undefined;
      if (!input || typeof input !== 'object') {
        return failOutcome('invalid', 'asset is required');
      }

      const id = typeof input.id === 'string' ? input.id.trim() : '';
      if (id === '') return failOutcome('invalid', 'asset.id is required');
      if (draft.assets.some((asset) => asset.id === id)) {
        return failOutcome('conflict', `Asset '${id}' already exists`, assetHint(draft));
      }

      const validKinds: AssetKind[] = ['video', 'image', 'audio'];
      if (!validKinds.includes(input.kind)) {
        return failOutcome('invalid', 'asset.kind must be video, image or audio');
      }

      const uri = typeof input.uri === 'string' ? input.uri.trim() : '';
      if (uri === '') return failOutcome('invalid', 'asset.uri is required');

      const durationMs = toMs(input.durationMs);
      if (durationMs === null || durationMs <= 0) {
        return failOutcome('out_of_range', 'asset.durationMs must be greater than 0');
      }

      const suppliedLabel = typeof input.label === 'string' ? input.label.trim() : '';
      const label = suppliedLabel === '' ? labelFromUri(uri) : suppliedLabel;

      const asset: Asset = {
        id,
        kind: input.kind,
        uri,
        label,
        durationMs,
      };
      if (isFiniteNumber(input.width) && input.width > 0) asset.width = Math.round(input.width);
      if (isFiniteNumber(input.height) && input.height > 0) asset.height = Math.round(input.height);
      if (isFiniteNumber(input.fps) && input.fps > 0) asset.fps = input.fps;
      if (typeof input.hasAudio === 'boolean') asset.hasAudio = input.hasAudio;
      if (typeof input.thumbnailUri === 'string' && input.thumbnailUri !== '') {
        asset.thumbnailUri = input.thumbnailUri;
      }
      if (input.origin !== undefined) {
        const origins = ['imported', 'generated', 'stock'];
        if (!origins.includes(input.origin)) {
          return failOutcome('invalid', 'asset.origin must be imported, generated or stock');
        }
        asset.origin = input.origin;
      }
      if (typeof input.createdAt === 'string') asset.createdAt = input.createdAt;

      draft.assets.push(asset);
      return okOutcome({ asset: asset.id });
    }

    case 'delete_asset': {
      const index = draft.assets.findIndex((asset) => asset.id === command.assetId);
      if (index < 0) {
        return failOutcome(
          'not_found',
          `Asset '${command.assetId}' not found`,
          assetHint(draft),
        );
      }
      const referencing = draft.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.assetId === command.assetId);
      if (referencing) {
        return failOutcome(
          'conflict',
          `Asset '${command.assetId}' is used by clip '${referencing.id}'`,
          'Delete the clip first',
        );
      }
      draft.assets.splice(index, 1);
      return okOutcome();
    }

    case 'trim_clip': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        if (findTextItem(draft, command.clipId)) {
          return failOutcome('invalid', 'Text items are edited with edit_text');
        }
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }

      const inMs = command.inMs === undefined ? location.clip.inMs : toMs(command.inMs);
      const outMs = command.outMs === undefined ? location.clip.outMs : toMs(command.outMs);
      const problem = validateTrim(draft, location.clip, inMs, outMs);
      if (problem) return { ok: false, error: problem };
      if (inMs === null || outMs === null) {
        return failOutcome('invalid', 'inMs and outMs must be finite numbers');
      }

      location.clip.inMs = inMs;
      location.clip.outMs = outMs;
      return okOutcome();
    }

    case 'move_clip': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      const hasAfter = command.after !== undefined;
      const hasIndex = command.toIndex !== undefined;
      if (hasAfter === hasIndex) {
        return failOutcome('invalid', 'Provide exactly one of after or toIndex');
      }

      const clips = location.track.clips;
      if (hasIndex) {
        const toIndex = command.toIndex;
        if (!isInteger(toIndex) || toIndex < 0 || toIndex >= clips.length) {
          return failOutcome(
            'out_of_range',
            `toIndex must be between 0 and ${clips.length - 1}`,
          );
        }
        if (toIndex === location.index) return okOutcome();
        const [moved] = clips.splice(location.index, 1);
        if (moved) clips.splice(toIndex, 0, moved);
        return okOutcome();
      }

      if (command.after === null) {
        const [moved] = clips.splice(location.index, 1);
        if (moved) clips.splice(0, 0, moved);
        return okOutcome();
      }

      if (command.after === command.clipId) return okOutcome();
      const anchorBefore = clips.findIndex((clip) => clip.id === command.after);
      if (anchorBefore < 0) {
        return failOutcome(
          'not_found',
          `Clip '${command.after}' not found on the same track`,
          `Clips on this track: ${clips.map((clip) => clip.id).join(', ')}`,
        );
      }
      const [moved] = clips.splice(location.index, 1);
      const anchorAfter = clips.findIndex((clip) => clip.id === command.after);
      if (moved) clips.splice(anchorAfter + 1, 0, moved);
      return okOutcome();
    }

    case 'delete_clip': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      location.track.clips.splice(location.index, 1);
      return okOutcome();
    }

    case 'split_clip': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      const clip = location.clip;
      const duration = clipTimelineDurationMs(clip);
      const atMs = toMs(command.atMs);
      if (atMs === null || atMs < MIN_CLIP_MS || atMs > duration - MIN_CLIP_MS) {
        return failOutcome(
          'out_of_range',
          `atMs must be between ${MIN_CLIP_MS} and ${duration - MIN_CLIP_MS}`,
          `The clip is ${duration}ms long`,
        );
      }

      const speed = clip.speed ?? 1;
      const sourceOffset = Math.round(atMs * speed);
      const firstOut = clip.inMs + sourceOffset;
      if (firstOut <= clip.inMs || firstOut >= clip.outMs) {
        return failOutcome('invalid', 'Split point does not fall inside the source range');
      }

      const originalOut = clip.outMs;
      const transition = clip.transitionOut;
      const fadeOut = clip.audioFadeOutMs;
      const split = splitEffects(clip.effects ?? [], atMs, duration);

      clip.outMs = firstOut;
      clip.effects = split.first;
      delete clip.transitionOut;
      delete clip.audioFadeOutMs;

      const second: Clip = {
        id: createId('c'),
        assetId: clip.assetId,
        inMs: firstOut,
        outMs: originalOut,
        effects: split.second,
      };
      if (location.track.kind !== 'video') {
        second.startMs = (clip.startMs ?? 0) + atMs;
      }
      if (clip.speed !== undefined) second.speed = clip.speed;
      if (clip.volume !== undefined) second.volume = clip.volume;
      if (clip.transform !== undefined) second.transform = structuredClone(clip.transform);
      if (transition !== undefined) second.transitionOut = structuredClone(transition);
      if (fadeOut !== undefined) second.audioFadeOutMs = fadeOut;

      location.track.clips.splice(location.index + 1, 0, second);
      return okOutcome({ clip: second.id });
    }

    case 'duplicate_clip': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      const copy: Clip = structuredClone(location.clip);
      copy.id = createId('c');
      copy.effects = (copy.effects ?? []).map((effect) => ({
        ...effect,
        id: createId('fx'),
      }));
      if (copy.transitionOut) {
        copy.transitionOut = { ...copy.transitionOut, id: createId('tr') };
      }
      if (location.track.kind !== 'video') {
        copy.startMs = (copy.startMs ?? 0) + clipTimelineDurationMs(copy);
      }
      location.track.clips.splice(location.index + 1, 0, copy);
      return okOutcome({ clip: copy.id });
    }

    case 'set_volume': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      if (!isFiniteNumber(command.volume) || command.volume < 0 || command.volume > 2) {
        return failOutcome('out_of_range', 'volume must be between 0 and 2');
      }
      location.clip.volume = command.volume;
      return okOutcome();
    }

    case 'set_audio_start': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      if (location.track.kind !== 'audio' && location.track.kind !== 'overlay') {
        return failOutcome(
          'invalid',
          'startMs can only be set on audio or overlay clips',
        );
      }
      const startMs = toMs(command.startMs);
      if (startMs === null || startMs < 0 || startMs > MAX_START_MS) {
        return failOutcome(
          'out_of_range',
          `startMs must be between 0 and ${MAX_START_MS}`,
        );
      }
      location.clip.startMs = startMs;
      return okOutcome();
    }

    case 'retime_clip': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      const inMs = toMs(command.inMs);
      const outMs = toMs(command.outMs);
      const problem = validateTrim(draft, location.clip, inMs, outMs);
      if (problem) return { ok: false, error: problem };
      if (inMs === null || outMs === null) {
        return failOutcome('invalid', 'inMs and outMs must be finite numbers');
      }
      location.clip.inMs = inMs;
      location.clip.outMs = outMs;

      if (location.track.kind !== 'video' && command.startMs !== undefined) {
        const startMs = toMs(command.startMs);
        if (startMs === null || startMs < 0 || startMs > MAX_START_MS) {
          return failOutcome(
            'out_of_range',
            `startMs must be between 0 and ${MAX_START_MS}`,
          );
        }
        location.clip.startMs = startMs;
      }
      return okOutcome();
    }

    case 'set_clip_speed': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      if (!isFiniteNumber(command.speed) || command.speed < 0.25 || command.speed > 4) {
        return failOutcome('out_of_range', 'speed must be between 0.25 and 4');
      }
      location.clip.speed = command.speed;
      return okOutcome();
    }

    case 'set_clip_transform': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      const problem = applyTransformPatch(location.clip, command.transform);
      if (problem) return { ok: false, error: problem };
      return okOutcome();
    }

    case 'add_overlay': {
      const asset = findAsset(draft, command.assetId);
      if (!asset) {
        return failOutcome(
          'not_found',
          `Asset '${command.assetId}' not found`,
          assetHint(draft),
        );
      }
      if (asset.kind === 'audio') {
        return failOutcome(
          'invalid',
          `Asset '${asset.label}' is audio; overlays need an image or video asset`,
        );
      }
      const track = trackByKind(draft, 'overlay');
      if (!track) return failOutcome('not_found', 'The project has no overlay track');

      if (
        !isFiniteNumber(command.x) ||
        !isFiniteNumber(command.y) ||
        !isFiniteNumber(command.scale)
      ) {
        return failOutcome('invalid', 'x, y and scale are required numbers for add_overlay');
      }

      const startMs = toMs(command.startMs);
      const durationMs = toMs(command.durationMs);
      const problem = validateOverlayPatch({
        startMs,
        durationMs,
        x: command.x,
        y: command.y,
        scale: command.scale,
        opacity: command.opacity,
      });
      if (problem) return { ok: false, error: problem };
      if (startMs === null || durationMs === null) {
        return failOutcome('invalid', 'startMs and durationMs must be finite numbers');
      }
      if (asset.kind === 'video' && asset.durationMs > 0 && durationMs > asset.durationMs) {
        return failOutcome(
          'out_of_range',
          `durationMs ${durationMs} exceeds asset duration ${asset.durationMs}`,
          `Asset '${asset.label}' (${asset.id}) is ${asset.durationMs}ms long`,
        );
      }

      const transform = overlayTransform(
        DEFAULT_TRANSFORM,
        command.x,
        command.y,
        command.scale,
        command.opacity === undefined ? 1 : command.opacity,
      );
      const clip: Clip = {
        id: createId('c'),
        assetId: asset.id,
        inMs: 0,
        outMs: durationMs,
        startMs,
        effects: [],
        transform,
      };
      track.clips.push(clip);
      return okOutcome({ clip: clip.id });
    }

    case 'set_overlay': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        if (findTextItem(draft, command.clipId)) {
          return failOutcome('invalid', 'Text items are edited with edit_text');
        }
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      if (location.track.kind !== 'overlay') {
        return failOutcome(
          'invalid',
          `Clip '${command.clipId}' is not on an overlay track; use set_clip_transform or set_audio_start for other clips`,
        );
      }

      const hasField =
        command.startMs !== undefined ||
        command.durationMs !== undefined ||
        command.x !== undefined ||
        command.y !== undefined ||
        command.scale !== undefined ||
        command.opacity !== undefined;
      if (!hasField) {
        return failOutcome(
          'invalid',
          'set_overlay needs at least one of startMs, durationMs, x, y, scale or opacity',
        );
      }

      const startMs = command.startMs === undefined ? undefined : toMs(command.startMs);
      const durationMs = command.durationMs === undefined ? undefined : toMs(command.durationMs);
      const problem = validateOverlayPatch({
        startMs,
        durationMs,
        x: command.x,
        y: command.y,
        scale: command.scale,
        opacity: command.opacity,
      });
      if (problem) return { ok: false, error: problem };

      const clip = location.clip;
      if (startMs !== undefined) {
        if (startMs === null) return failOutcome('invalid', 'startMs must be a finite number');
        clip.startMs = startMs;
      }
      if (durationMs !== undefined) {
        if (durationMs === null) return failOutcome('invalid', 'durationMs must be a finite number');
        const asset = findAsset(draft, clip.assetId);
        const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
        const outMs = clip.inMs + Math.round(durationMs * speed);
        if (asset && asset.kind !== 'image' && asset.durationMs > 0 && outMs > asset.durationMs) {
          return failOutcome(
            'out_of_range',
            `durationMs ${durationMs} exceeds the source remaining from inMs (${Math.max(
              0,
              asset.durationMs - clip.inMs,
            )}ms)`,
            `Asset '${asset.label}' (${asset.id}) is ${asset.durationMs}ms long`,
          );
        }
        clip.outMs = outMs;
      }
      clip.transform = overlayTransform(
        transformDefaults(clip),
        command.x,
        command.y,
        command.scale,
        command.opacity,
      );
      return okOutcome();
    }

    case 'add_text': {
      let track: Track | null;
      if (command.trackId !== undefined) {
        track = trackById(draft, command.trackId);
        if (!track) {
          return failOutcome('not_found', `Track '${command.trackId}' not found`);
        }
        if (track.kind !== 'text') {
          return failOutcome('invalid', 'Text items can only be added to a text track');
        }
      } else {
        track = trackByKind(draft, 'text');
        if (!track) return failOutcome('not_found', 'The project has no text track');
      }

      if (typeof command.text !== 'string') {
        return failOutcome('invalid', 'text is required');
      }
      const text = command.text.trim();
      if (text.length < 1 || text.length > MAX_TEXT_CHARS) {
        return failOutcome(
          'out_of_range',
          `text must be 1..${MAX_TEXT_CHARS} characters`,
        );
      }

      const startMs = toMs(command.startMs);
      if (startMs === null || startMs < 0) {
        return failOutcome('out_of_range', 'startMs must not be negative');
      }
      const durationMs = toMs(command.durationMs);
      if (durationMs === null || durationMs < MIN_TEXT_MS) {
        return failOutcome(
          'out_of_range',
          `durationMs must be at least ${MIN_TEXT_MS}`,
        );
      }

      const style: TextStyle = structuredClone(DEFAULT_TEXT_STYLE);
      const styleProblem = applyStylePatch(style, command.style);
      if (styleProblem) return { ok: false, error: styleProblem };

      let animation: TextAnimation = 'none';
      if (command.animation !== undefined) {
        if (!isTextAnimation(command.animation)) {
          return failOutcome('invalid', 'animation is not supported');
        }
        animation = command.animation;
      }

      const item: TextItem = {
        id: createId('ti'),
        text,
        startMs,
        durationMs,
        style,
        animation,
      };
      track.items.push(item);
      return okOutcome({ item: item.id });
    }

    case 'edit_text': {
      const location = findTextItem(draft, command.itemId);
      if (!location) {
        return failOutcome('not_found', `Text item '${command.itemId}' not found`);
      }
      const item = location.item;

      if (command.text !== undefined) {
        if (typeof command.text !== 'string') {
          return failOutcome('invalid', 'text must be a string');
        }
        const text = command.text.trim();
        if (text.length < 1 || text.length > MAX_TEXT_CHARS) {
          return failOutcome(
            'out_of_range',
            `text must be 1..${MAX_TEXT_CHARS} characters`,
          );
        }
        item.text = text;
      }

      if (command.startMs !== undefined) {
        const startMs = toMs(command.startMs);
        if (startMs === null || startMs < 0) {
          return failOutcome('out_of_range', 'startMs must not be negative');
        }
        item.startMs = startMs;
      }

      if (command.durationMs !== undefined) {
        const durationMs = toMs(command.durationMs);
        if (durationMs === null || durationMs < MIN_TEXT_MS) {
          return failOutcome(
            'out_of_range',
            `durationMs must be at least ${MIN_TEXT_MS}`,
          );
        }
        item.durationMs = durationMs;
      }

      if (command.style !== undefined) {
        const style: TextStyle = {
          ...structuredClone(DEFAULT_TEXT_STYLE),
          ...(item.style ?? {}),
        };
        const styleProblem = applyStylePatch(style, command.style);
        if (styleProblem) return { ok: false, error: styleProblem };
        item.style = style;
      }

      if (command.animation !== undefined) {
        if (!isTextAnimation(command.animation)) {
          return failOutcome('invalid', 'animation is not supported');
        }
        item.animation = command.animation;
      }

      return okOutcome();
    }

    case 'delete_text': {
      const location = findTextItem(draft, command.itemId);
      if (!location) {
        return failOutcome('not_found', `Text item '${command.itemId}' not found`);
      }
      location.track.items.splice(location.index, 1);
      return okOutcome();
    }

    case 'add_audio': {
      const asset = findAsset(draft, command.assetId);
      if (!asset) {
        return failOutcome(
          'not_found',
          `Asset '${command.assetId}' not found`,
          assetHint(draft),
        );
      }
      if (asset.kind !== 'audio' && asset.kind !== 'video') {
        return failOutcome('invalid', 'Audio can only be added from audio or video assets');
      }
      if (asset.kind === 'video' && asset.hasAudio === false) {
        return failOutcome('invalid', `Asset '${asset.label}' has no audio track`);
      }

      let track: Track | null;
      if (command.trackId !== undefined) {
        track = trackById(draft, command.trackId);
        if (!track) {
          return failOutcome('not_found', `Track '${command.trackId}' not found`);
        }
        if (track.kind !== 'audio') {
          return failOutcome('invalid', 'add_audio needs an audio track');
        }
      } else {
        track = trackByKind(draft, 'audio');
        if (!track) return failOutcome('not_found', 'The project has no audio track');
      }

      const inMs = command.inMs === undefined ? 0 : toMs(command.inMs);
      const outMs = command.outMs === undefined ? asset.durationMs : toMs(command.outMs);
      if (inMs === null || outMs === null) {
        return failOutcome('invalid', 'inMs and outMs must be finite numbers');
      }
      if (inMs < 0) return failOutcome('out_of_range', 'inMs must not be negative');
      if (outMs <= inMs) {
        return failOutcome('invalid', 'outMs must be greater than inMs');
      }
      if (outMs - inMs < MIN_CLIP_MS) {
        return failOutcome('out_of_range', `The audio clip must be at least ${MIN_CLIP_MS}ms`);
      }
      if (asset.durationMs > 0 && outMs > asset.durationMs) {
        return failOutcome(
          'out_of_range',
          `outMs ${outMs} exceeds asset duration ${asset.durationMs}`,
        );
      }
      const duration = outMs - inMs;

      const volume = command.volume === undefined ? 1 : command.volume;
      if (!isFiniteNumber(volume) || volume < 0 || volume > 2) {
        return failOutcome('out_of_range', 'volume must be between 0 and 2');
      }

      const startMs = command.startMs === undefined ? 0 : toMs(command.startMs);
      if (startMs === null || startMs < 0 || startMs > MAX_START_MS) {
        return failOutcome(
          'out_of_range',
          `startMs must be between 0 and ${MAX_START_MS}`,
        );
      }

      const fadeInMs = command.fadeInMs === undefined ? 0 : toMs(command.fadeInMs);
      const fadeOutMs = command.fadeOutMs === undefined ? 0 : toMs(command.fadeOutMs);
      for (const [name, value] of [
        ['fadeInMs', fadeInMs],
        ['fadeOutMs', fadeOutMs],
      ] as const) {
        if (value === null || value < 0 || value > MAX_FADE_MS) {
          return failOutcome('out_of_range', `${name} must be between 0 and ${MAX_FADE_MS}`);
        }
        if (value > duration) {
          return failOutcome('out_of_range', `${name} cannot exceed the clip duration`);
        }
      }

      const clip: Clip = {
        id: createId('c'),
        assetId: asset.id,
        inMs,
        outMs,
        startMs,
        volume,
        effects: [],
        audioFadeInMs: fadeInMs ?? 0,
        audioFadeOutMs: fadeOutMs ?? 0,
      };
      track.clips.push(clip);
      return okOutcome({ clip: clip.id });
    }

    case 'add_effect': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      const definition = command.effect as
        | { type?: unknown; params?: unknown; startMs?: unknown; durationMs?: unknown }
        | null
        | undefined;
      if (!definition || typeof definition !== 'object') {
        return failOutcome('invalid', 'effect is required');
      }
      const type = typeof definition.type === 'string' ? definition.type.trim() : '';
      if (type === '') return failOutcome('invalid', 'effect.type must be a non-empty string');

      const paramsProblem = validateParams(definition.params);
      if (paramsProblem) return { ok: false, error: paramsProblem };

      const clipDuration = clipTimelineDurationMs(location.clip);
      let startMs: number | undefined;
      if (definition.startMs !== undefined) {
        const parsed = toMs(definition.startMs);
        if (parsed === null || parsed < 0) {
          return failOutcome('out_of_range', 'effect.startMs must not be negative');
        }
        startMs = parsed;
      }
      let durationMs: number | undefined;
      if (definition.durationMs !== undefined) {
        const parsed = toMs(definition.durationMs);
        if (parsed === null || parsed < 50) {
          return failOutcome('out_of_range', 'effect.durationMs must be at least 50');
        }
        durationMs = parsed;
      }
      if (startMs !== undefined && startMs > clipDuration) {
        return failOutcome('out_of_range', 'effect.startMs must fall inside the clip');
      }
      if (durationMs !== undefined && (startMs ?? 0) + durationMs > clipDuration) {
        return failOutcome('out_of_range', 'effect window must fit inside the clip');
      }

      const effect: EffectInstance = {
        id: createId('fx'),
        type,
        params: cloneParams(definition.params as Record<string, EffectParam> | undefined) ?? {},
      };
      if (startMs !== undefined) effect.startMs = startMs;
      if (durationMs !== undefined) effect.durationMs = durationMs;
      location.clip.effects = location.clip.effects ?? [];
      location.clip.effects.push(effect);
      return okOutcome({ effect: effect.id });
    }

    case 'remove_effect': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      const effects = location.clip.effects ?? [];
      const index = effects.findIndex((effect) => effect.id === command.effectId);
      if (index < 0) {
        return failOutcome(
          'not_found',
          `Effect '${command.effectId}' not found on clip '${command.clipId}'`,
          effects.length > 0
            ? `Effect ids: ${effects.map((effect) => effect.id).join(', ')}`
            : 'The clip has no effects',
        );
      }
      effects.splice(index, 1);
      return okOutcome();
    }

    case 'add_transition': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      const definition = command.transition as
        | { type?: unknown; durationMs?: unknown; params?: unknown }
        | null
        | undefined;
      if (!definition || typeof definition !== 'object') {
        return failOutcome('invalid', 'transition is required');
      }
      const type = typeof definition.type === 'string' ? definition.type.trim() : '';
      if (type === '') {
        return failOutcome('invalid', 'transition.type must be a non-empty string');
      }
      const paramsProblem = validateParams(definition.params);
      if (paramsProblem) return { ok: false, error: paramsProblem };

      const durationMs = toMs(definition.durationMs);
      if (durationMs === null || durationMs < 50 || durationMs > 3000) {
        return failOutcome('out_of_range', 'transition durationMs must be between 50 and 3000');
      }
      if (location.index >= location.track.clips.length - 1) {
        return failOutcome(
          'invalid',
          'A transition needs a following clip on the same track',
        );
      }
      const next = location.track.clips[location.index + 1];
      const nextDuration = next ? clipTimelineDurationMs(next) : 0;
      const shorter = Math.min(clipTimelineDurationMs(location.clip), nextDuration);
      if (durationMs * 2 > shorter) {
        return failOutcome(
          'out_of_range',
          `Transition must be at most half of the shorter neighbouring clip (${shorter}ms)`,
        );
      }

      const transition = {
        id: createId('tr'),
        type,
        durationMs,
        ...(definition.params !== undefined
          ? { params: cloneParams(definition.params as Record<string, EffectParam>) ?? {} }
          : {}),
      };
      location.clip.transitionOut = transition;
      return okOutcome();
    }

    case 'remove_transition': {
      const location = findClip(draft, command.clipId);
      if (!location) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' not found`,
          clipHint(draft),
        );
      }
      if (!location.clip.transitionOut) {
        return failOutcome(
          'not_found',
          `Clip '${command.clipId}' has no outgoing transition`,
        );
      }
      delete location.clip.transitionOut;
      return okOutcome();
    }

    case 'set_canvas': {
      const { width, height } = command;
      if (!isInteger(width) || width < 240 || width > 7680 || width % 2 !== 0) {
        return failOutcome('out_of_range', 'width must be an even integer between 240 and 7680');
      }
      if (!isInteger(height) || height < 240 || height > 7680 || height % 2 !== 0) {
        return failOutcome('out_of_range', 'height must be an even integer between 240 and 7680');
      }
      if (command.fps !== undefined) {
        if (!isInteger(command.fps) || command.fps < 1 || command.fps > 120) {
          return failOutcome('out_of_range', 'fps must be an integer between 1 and 120');
        }
        draft.canvas.fps = command.fps;
      }
      draft.canvas.width = width;
      draft.canvas.height = height;
      return okOutcome();
    }

    case 'set_project_name': {
      if (typeof command.name !== 'string') {
        return failOutcome('invalid', 'name is required');
      }
      const name = command.name.trim();
      if (name.length < 1 || name.length > 120) {
        return failOutcome('out_of_range', 'name must be 1..120 characters');
      }
      draft.name = name;
      return okOutcome();
    }

    case 'set_track': {
      const track = trackById(draft, command.trackId);
      if (!track) {
        return failOutcome('not_found', `Track '${command.trackId}' not found`);
      }
      if (command.muted === undefined && command.hidden === undefined) {
        return failOutcome('invalid', 'set_track needs at least one of muted or hidden');
      }
      if (command.muted !== undefined) {
        if (typeof command.muted !== 'boolean') {
          return failOutcome('invalid', 'muted must be a boolean');
        }
        if (track.kind !== 'audio' && track.kind !== 'video') {
          return failOutcome('invalid', `Cannot set muted on a ${track.kind} track`);
        }
      }
      if (command.hidden !== undefined) {
        if (typeof command.hidden !== 'boolean') {
          return failOutcome('invalid', 'hidden must be a boolean');
        }
        if (track.kind !== 'video' && track.kind !== 'overlay' && track.kind !== 'text') {
          return failOutcome('invalid', `Cannot set hidden on a ${track.kind} track`);
        }
      }
      if (command.muted !== undefined) track.muted = command.muted;
      if (command.hidden !== undefined) track.hidden = command.hidden;
      return okOutcome();
    }

    default: {
      const op = (command as { op?: unknown }).op;
      return failOutcome(
        'unsupported',
        `Unsupported command op: ${String(op)}`,
        'Supported ops include import_clip, add_asset, trim_clip, split_clip and add_text',
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

function contentSignature(project: Project): string {
  return JSON.stringify({ ...project, updatedAt: '' });
}

/** Applies one command to a clone of the project. Never mutates the input. */
export function applyCommand(project: Project, command: EditCommand): ApplyResult {
  const draft = structuredClone(project);
  const outcome = runCommand(draft, command);

  if (!outcome.ok) {
    const failure: ApplyFailure = { ok: false, command, error: outcome.error };
    return failure;
  }

  for (const track of draft.tracks) normalizeTrack(track);

  if (contentSignature(project) !== contentSignature(draft)) {
    draft.updatedAt = new Date().toISOString();
  }

  const changes = describeChanges(project, draft);
  const success: ApplySuccess = {
    ok: true,
    command,
    project: draft,
    changes,
    createdIds: outcome.createdIds,
  };
  return success;
}

/**
 * Applies commands in order. Stops at the first failure and keeps the
 * successful prefix, so an agent can retry the failed step with fresh ids.
 */
export function applyCommands(project: Project, commands: EditCommand[]): BatchResult {
  let current = project;
  const results: ApplyResult[] = [];

  for (const command of commands) {
    const result = applyCommand(current, command);
    results.push(result);
    if (!result.ok) {
      return {
        ok: false,
        project: current,
        results,
        changes: describeChanges(project, current),
      };
    }
    current = result.project;
  }

  return {
    ok: true,
    project: current,
    results,
    changes: describeChanges(project, current),
  };
}
