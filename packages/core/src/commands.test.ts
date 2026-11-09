import { describe, expect, it } from 'vitest';

import {
  applyCommand,
  createEmptyProject,
  EditSession,
  findAsset,
  findClip,
  mainVideoTrack,
  timelineDurationMs,
  videoClipStartMs,
} from './index';
import type { ApplySuccess, Asset, EditCommand, Project } from './index';

const VIDEO: Asset = {
  id: 'a_v1',
  kind: 'video',
  uri: 'C:/media/intro.mp4',
  label: 'intro.mp4',
  durationMs: 5000,
};

const BROLL: Asset = {
  id: 'a_v2',
  kind: 'video',
  uri: 'C:/media/broll.mp4',
  label: 'broll.mp4',
  durationMs: 3000,
};

const MUSIC: Asset = {
  id: 'a_audio',
  kind: 'audio',
  uri: 'C:/media/music.mp3',
  label: 'music.mp3',
  durationMs: 8000,
};

const IMAGE: Asset = {
  id: 'a_img',
  kind: 'image',
  uri: 'C:/media/still.png',
  label: 'still.png',
  durationMs: 100,
};

function applyOk(project: Project, command: EditCommand): ApplySuccess {
  const result = applyCommand(project, command);
  if (!result.ok) {
    throw new Error(`${command.op} failed: ${result.error.code} ${result.error.message}`);
  }
  return result;
}

function baseProject(): Project {
  let project = createEmptyProject('Demo');
  for (const asset of [VIDEO, BROLL, MUSIC, IMAGE]) {
    project = applyOk(project, { op: 'add_asset', asset }).project;
  }
  return project;
}

function projectWithClip(assetId = VIDEO.id): { project: Project; clipId: string } {
  const result = applyOk(baseProject(), { op: 'import_clip', assetId });
  return { project: result.project, clipId: result.createdIds.clip ?? '' };
}

function firstClipId(project: Project): string {
  return mainVideoTrack(project).clips[0]?.id ?? '';
}

describe('add_asset', () => {
  it('adds an asset and derives the label from the uri basename', () => {
    const project = createEmptyProject();
    const result = applyOk(project, {
      op: 'add_asset',
      asset: {
        id: 'a_new',
        kind: 'video',
        uri: 'C:\\clips\\my clip.final.mp4',
        label: '',
        durationMs: 1200,
      },
    });
    expect(result.createdIds.asset).toBe('a_new');
    expect(result.project.assets).toHaveLength(1);
    expect(result.project.assets[0]?.label).toBe('my clip.final');
  });

  it('rejects a duplicate asset id with a conflict', () => {
    const result = applyCommand(baseProject(), { op: 'add_asset', asset: VIDEO });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('conflict');
  });

  it('rejects a non-positive duration', () => {
    const result = applyCommand(createEmptyProject(), {
      op: 'add_asset',
      asset: { ...VIDEO, id: 'a_zero', durationMs: 0 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('out_of_range');
  });
});

describe('import_clip', () => {
  it('appends a clip to the main video track covering the whole asset', () => {
    const result = applyOk(baseProject(), { op: 'import_clip', assetId: VIDEO.id });
    const clips = mainVideoTrack(result.project).clips;
    expect(clips).toHaveLength(1);
    expect(clips[0]?.id).toBe(result.createdIds.clip);
    expect(clips[0]?.inMs).toBe(0);
    expect(clips[0]?.outMs).toBe(5000);
    expect(timelineDurationMs(result.project)).toBe(5000);
  });

  it('inserts at an explicit video index and shifts later clips', () => {
    const first = applyOk(baseProject(), { op: 'import_clip', assetId: VIDEO.id });
    const second = applyOk(first.project, { op: 'import_clip', assetId: BROLL.id, index: 0 });
    const clips = mainVideoTrack(second.project).clips;
    expect(clips[0]?.assetId).toBe(BROLL.id);
    expect(clips[1]?.assetId).toBe(VIDEO.id);
    const introId = clips[1]?.id ?? '';
    expect(videoClipStartMs(second.project, introId)).toBe(3000);
  });

  it('returns not_found for a missing asset', () => {
    const result = applyCommand(baseProject(), { op: 'import_clip', assetId: 'a_missing' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });

  it('routes audio assets to the audio track with startMs 0', () => {
    const result = applyOk(baseProject(), { op: 'import_clip', assetId: MUSIC.id });
    const audio = result.project.tracks.find((track) => track.kind === 'audio');
    expect(audio?.clips).toHaveLength(1);
    expect(audio?.clips[0]?.startMs).toBe(0);
  });

  it('rejects an audio asset on the video track', () => {
    const project = baseProject();
    const videoTrack = mainVideoTrack(project);
    const result = applyCommand(project, {
      op: 'import_clip',
      assetId: MUSIC.id,
      trackId: videoTrack.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid');
  });
});

describe('delete_asset', () => {
  it('refuses to delete an asset referenced by a clip', () => {
    const { project } = projectWithClip();
    const result = applyCommand(project, { op: 'delete_asset', assetId: VIDEO.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('conflict');
  });

  it('deletes an unused asset', () => {
    const project = baseProject();
    const result = applyOk(project, { op: 'delete_asset', assetId: IMAGE.id });
    expect(findAsset(result.project, IMAGE.id)).toBeNull();
  });
});

describe('trim_clip', () => {
  it('updates in/out points', () => {
    const { project, clipId } = projectWithClip();
    const result = applyOk(project, { op: 'trim_clip', clipId, inMs: 500, outMs: 2500 });
    const clip = findClip(result.project, clipId)?.clip;
    expect(clip?.inMs).toBe(500);
    expect(clip?.outMs).toBe(2500);
    expect(timelineDurationMs(result.project)).toBe(2000);
  });

  it('rejects an out point beyond the source asset', () => {
    const { project, clipId } = projectWithClip();
    const result = applyCommand(project, { op: 'trim_clip', clipId, outMs: 5001 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('out_of_range');
  });

  it('rejects trims that leave less than 100ms', () => {
    const { project, clipId } = projectWithClip();
    const result = applyCommand(project, { op: 'trim_clip', clipId, inMs: 4950, outMs: 5000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('out_of_range');
  });

  it('applies no source limit to image assets', () => {
    const imported = applyOk(baseProject(), { op: 'import_clip', assetId: IMAGE.id });
    const clipId = imported.createdIds.clip ?? '';
    const result = applyOk(imported.project, {
      op: 'trim_clip',
      clipId,
      inMs: 0,
      outMs: 4000,
    });
    expect(findClip(result.project, clipId)?.clip.outMs).toBe(4000);
  });

  it('points text items at edit_text instead', () => {
    const withText = applyOk(baseProject(), {
      op: 'add_text',
      text: 'hello',
      startMs: 0,
      durationMs: 1000,
    });
    const itemId = withText.createdIds.item ?? '';
    const result = applyCommand(withText.project, {
      op: 'trim_clip',
      clipId: itemId,
      outMs: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid');
  });
});

describe('move_clip', () => {
  function twoClips(): { project: Project; first: string; second: string } {
    const one = applyOk(baseProject(), { op: 'import_clip', assetId: VIDEO.id });
    const two = applyOk(one.project, { op: 'import_clip', assetId: BROLL.id });
    return {
      project: two.project,
      first: one.createdIds.clip ?? '',
      second: two.createdIds.clip ?? '',
    };
  }

  it('moves a clip to the start with after: null', () => {
    const { project, first, second } = twoClips();
    const result = applyOk(project, { op: 'move_clip', clipId: second, after: null });
    expect(mainVideoTrack(result.project).clips[0]?.id).toBe(second);
    expect(videoClipStartMs(result.project, first)).toBe(3000);
  });

  it('moves a clip after another clip id', () => {
    const { project, first, second } = twoClips();
    const result = applyOk(project, { op: 'move_clip', clipId: first, after: second });
    expect(mainVideoTrack(result.project).clips.map((clip) => clip.id)).toEqual([second, first]);
  });

  it('moves a clip to an index', () => {
    const { project, first, second } = twoClips();
    const result = applyOk(project, { op: 'move_clip', clipId: first, toIndex: 1 });
    expect(mainVideoTrack(result.project).clips.map((clip) => clip.id)).toEqual([second, first]);
  });

  it('rejects providing both after and toIndex', () => {
    const { project, first, second } = twoClips();
    const result = applyCommand(project, { op: 'move_clip', clipId: first, after: second, toIndex: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid');
  });

  it('treats moving a clip onto its own position as a successful no-op', () => {
    const { project, first } = twoClips();
    const before = JSON.stringify(project);
    const result = applyOk(project, { op: 'move_clip', clipId: first, after: first });
    expect(JSON.stringify(result.project)).toBe(before);
    expect(result.changes).toEqual([]);
  });
});

describe('split_clip', () => {
  function splitFixture(): { project: Project; clipId: string } {
    const { project, clipId } = projectWithClip(VIDEO.id);
    let next = applyOk(project, { op: 'import_clip', assetId: BROLL.id }).project;
    next = applyOk(next, {
      op: 'add_effect',
      clipId,
      effect: { type: 'fade', startMs: 500, durationMs: 800 },
    }).project;
    next = applyOk(next, {
      op: 'add_effect',
      clipId,
      effect: { type: 'grain', startMs: 2100, durationMs: 800 },
    }).project;
    next = applyOk(next, {
      op: 'add_transition',
      clipId,
      transition: { type: 'crossfade', durationMs: 500 },
    }).project;
    return { project: next, clipId };
  }

  it('keeps the first id, creates a second clip and shifts source points', () => {
    const { project, clipId } = splitFixture();
    const result = applyOk(project, { op: 'split_clip', clipId, atMs: 2000 });
    const clips = mainVideoTrack(result.project).clips;
    expect(clips).toHaveLength(3);
    expect(clips[0]?.id).toBe(clipId);
    expect(clips[0]?.outMs).toBe(2000);
    expect(clips[1]?.id).toBe(result.createdIds.clip);
    expect(clips[1]?.inMs).toBe(2000);
    expect(clips[1]?.outMs).toBe(5000);
  });

  it('distributes effect windows and moves transitionOut to the second clip', () => {
    const { project, clipId } = splitFixture();
    const result = applyOk(project, { op: 'split_clip', clipId, atMs: 2000 });
    const [first, second] = mainVideoTrack(result.project).clips;
    expect(first?.effects.map((effect) => effect.type)).toEqual(['fade']);
    expect(second?.effects.map((effect) => effect.type)).toEqual(['grain']);
    expect(second?.effects[0]?.startMs).toBe(100);
    expect(first?.transitionOut).toBeUndefined();
    expect(second?.transitionOut?.type).toBe('crossfade');
  });

  it('rejects split points too close to either edge', () => {
    const { project, clipId } = splitFixture();
    for (const atMs of [50, 4950]) {
      const result = applyCommand(project, { op: 'split_clip', clipId, atMs });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('out_of_range');
    }
  });

  it('inherits speed and volume', () => {
    const { project, clipId } = projectWithClip();
    let next = applyOk(project, { op: 'set_clip_speed', clipId, speed: 2 }).project;
    next = applyOk(next, { op: 'set_volume', clipId, volume: 0.5 }).project;
    const result = applyOk(next, { op: 'split_clip', clipId, atMs: 1000 });
    const second = mainVideoTrack(result.project).clips[1];
    expect(second?.speed).toBe(2);
    expect(second?.volume).toBe(0.5);
    expect(second?.inMs).toBe(2000);
  });
});

describe('duplicate_clip', () => {
  it('inserts a deep copy right after the original with new ids', () => {
    const { project, clipId } = projectWithClip();
    const withEffect = applyOk(project, {
      op: 'add_effect',
      clipId,
      effect: { type: 'fade' },
    });
    const originalEffectId = findClip(withEffect.project, clipId)?.clip.effects[0]?.id;
    const result = applyOk(withEffect.project, { op: 'duplicate_clip', clipId });
    const clips = mainVideoTrack(result.project).clips;
    expect(clips).toHaveLength(2);
    expect(clips[1]?.id).toBe(result.createdIds.clip);
    expect(clips[1]?.id).not.toBe(clipId);
    expect(clips[1]?.effects[0]?.id).not.toBe(originalEffectId);
    expect(clips[1]?.outMs).toBe(clips[0]?.outMs);
  });
});

describe('clip properties', () => {
  it('sets volume within 0..2', () => {
    const { project, clipId } = projectWithClip();
    expect(applyOk(project, { op: 'set_volume', clipId, volume: 1.5 }).project).toBeTruthy();
    const bad = applyCommand(project, { op: 'set_volume', clipId, volume: 3 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('out_of_range');
  });

  it('sets audio start only on audio or overlay clips', () => {
    const { project, clipId } = projectWithClip();
    const rejected = applyCommand(project, { op: 'set_audio_start', clipId, startMs: 1000 });
    expect(rejected.ok).toBe(false);

    const audio = applyOk(project, { op: 'import_clip', assetId: MUSIC.id });
    const audioClipId = audio.createdIds.clip ?? '';
    const result = applyOk(audio.project, {
      op: 'set_audio_start',
      clipId: audioClipId,
      startMs: 2500,
    });
    expect(findClip(result.project, audioClipId)?.clip.startMs).toBe(2500);
  });

  it('rejects audio starts beyond 600000ms', () => {
    const audio = applyOk(baseProject(), { op: 'import_clip', assetId: MUSIC.id });
    const audioClipId = audio.createdIds.clip ?? '';
    const result = applyCommand(audio.project, {
      op: 'set_audio_start',
      clipId: audioClipId,
      startMs: 600_001,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('out_of_range');
  });

  it('retimes clips and ignores startMs for video clips', () => {
    const { project, clipId } = projectWithClip();
    const result = applyOk(project, {
      op: 'retime_clip',
      clipId,
      inMs: 1000,
      outMs: 3000,
      startMs: 5000,
    });
    const clip = findClip(result.project, clipId)?.clip;
    expect(clip?.inMs).toBe(1000);
    expect(clip?.outMs).toBe(3000);
    expect(clip?.startMs).toBeUndefined();
  });

  it('applies startMs when retiming audio clips', () => {
    const audio = applyOk(baseProject(), { op: 'import_clip', assetId: MUSIC.id });
    const audioClipId = audio.createdIds.clip ?? '';
    const result = applyOk(audio.project, {
      op: 'retime_clip',
      clipId: audioClipId,
      inMs: 0,
      outMs: 4000,
      startMs: 1500,
    });
    expect(findClip(result.project, audioClipId)?.clip.startMs).toBe(1500);
  });

  it('enforces the speed range', () => {
    const { project, clipId } = projectWithClip();
    expect(applyOk(project, { op: 'set_clip_speed', clipId, speed: 4 }).project).toBeTruthy();
    for (const speed of [0.2, 4.1]) {
      const result = applyCommand(project, { op: 'set_clip_speed', clipId, speed });
      expect(result.ok).toBe(false);
    }
  });

  it('merges partial transforms onto defaults and validates ranges', () => {
    const { project, clipId } = projectWithClip();
    const first = applyOk(project, {
      op: 'set_clip_transform',
      clipId,
      transform: { scale: 2 },
    });
    const second = applyOk(first.project, {
      op: 'set_clip_transform',
      clipId,
      transform: { x: 0.25, opacity: 0.5 },
    });
    const transform = findClip(second.project, clipId)?.clip.transform;
    expect(transform).toEqual({ x: 0.25, y: 0, scale: 2, rotation: 0, opacity: 0.5 });

    const bad = applyCommand(project, {
      op: 'set_clip_transform',
      clipId,
      transform: { scale: 9 },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('out_of_range');
  });
});

describe('overlay clips', () => {
  const overlayClipOf = (project: Project, clipId: string) => findClip(project, clipId);

  it('adds an overlay and maps canvas coordinates onto the clip transform', () => {
    const result = applyOk(baseProject(), {
      op: 'add_overlay',
      assetId: IMAGE.id,
      startMs: 1000,
      durationMs: 4000,
      x: 0.85,
      y: 0.1,
      scale: 0.2,
    });

    const clipId = result.createdIds.clip ?? '';
    const location = overlayClipOf(result.project, clipId);
    expect(location?.track.kind).toBe('overlay');
    expect(location?.clip.startMs).toBe(1000);
    expect(location?.clip.inMs).toBe(0);
    expect(location?.clip.outMs).toBe(4000);
    expect(location?.clip.transform).toEqual({
      x: 0.35,
      y: -0.4,
      scale: 0.2,
      rotation: 0,
      opacity: 1,
    });
    expect(result.changes.join(' ')).toContain('Added overlay');
  });

  it('keeps an explicit opacity', () => {
    const result = applyOk(baseProject(), {
      op: 'add_overlay',
      assetId: IMAGE.id,
      startMs: 0,
      durationMs: 1000,
      x: 0.5,
      y: 0.5,
      scale: 0.3,
      opacity: 0.4,
    });
    expect(overlayClipOf(result.project, result.createdIds.clip ?? '')?.clip.transform?.opacity).toBe(0.4);
  });

  it('rejects audio assets and geometry outside the allowed ranges', () => {
    const project = baseProject();
    const base = {
      op: 'add_overlay' as const,
      assetId: IMAGE.id,
      startMs: 0,
      durationMs: 1000,
      x: 0.5,
      y: 0.5,
      scale: 0.2,
    };

    const audio = applyCommand(project, { ...base, assetId: MUSIC.id });
    expect(audio.ok).toBe(false);
    if (!audio.ok) expect(audio.error.code).toBe('invalid');

    for (const patch of [
      { x: 1.2 },
      { x: -0.1 },
      { y: 1.5 },
      { scale: 0.01 },
      { scale: 1.5 },
      { opacity: 1.5 },
      { startMs: 600_001 },
      { durationMs: 50 },
    ]) {
      const result = applyCommand(project, { ...base, ...patch });
      expect(result.ok, JSON.stringify(patch)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('out_of_range');
    }

    const missingRange = applyCommand(project, { ...base, scale: Number.NaN });
    expect(missingRange.ok).toBe(false);
  });

  it('limits a video overlay to the source length but leaves images unbounded', () => {
    const project = baseProject();
    const tooLong = applyCommand(project, {
      op: 'add_overlay',
      assetId: VIDEO.id,
      startMs: 0,
      durationMs: 5001,
      x: 0.5,
      y: 0.5,
      scale: 0.2,
    });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.code).toBe('out_of_range');

    const video = applyOk(project, {
      op: 'add_overlay',
      assetId: VIDEO.id,
      startMs: 0,
      durationMs: 5000,
      x: 0.5,
      y: 0.5,
      scale: 0.2,
    });
    expect(overlayClipOf(video.project, video.createdIds.clip ?? '')?.clip.outMs).toBe(5000);

    // An image has no source timeline, so its overlay duration is free.
    const image = applyOk(project, {
      op: 'add_overlay',
      assetId: IMAGE.id,
      startMs: 0,
      durationMs: 9000,
      x: 0.5,
      y: 0.5,
      scale: 0.2,
    });
    expect(overlayClipOf(image.project, image.createdIds.clip ?? '')?.clip.outMs).toBe(9000);
  });

  it('updates position, scale, opacity, timing and duration in place', () => {
    const added = applyOk(baseProject(), {
      op: 'add_overlay',
      assetId: IMAGE.id,
      startMs: 1000,
      durationMs: 2000,
      x: 0.85,
      y: 0.1,
      scale: 0.2,
    });
    const clipId = added.createdIds.clip ?? '';

    const updated = applyOk(added.project, {
      op: 'set_overlay',
      clipId,
      startMs: 2500,
      durationMs: 1500,
      x: 0.2,
      y: 0.3,
      scale: 0.5,
      opacity: 0.5,
    });
    const clip = overlayClipOf(updated.project, clipId)?.clip;
    expect(clip?.startMs).toBe(2500);
    expect((clip?.outMs ?? 0) - (clip?.inMs ?? 0)).toBe(1500);
    expect(clip?.transform).toEqual({
      x: -0.3,
      y: -0.2,
      scale: 0.5,
      rotation: 0,
      opacity: 0.5,
    });
    expect(updated.changes.join(' ')).toContain('Adjusted transform');
  });

  it('validates set_overlay ranges, target track and video duration', () => {
    const added = applyOk(baseProject(), {
      op: 'add_overlay',
      assetId: VIDEO.id,
      startMs: 0,
      durationMs: 3000,
      x: 0.5,
      y: 0.5,
      scale: 0.2,
    });
    const clipId = added.createdIds.clip ?? '';

    for (const patch of [
      { x: 2 },
      { y: -1 },
      { scale: 0 },
      { opacity: -0.1 },
      { durationMs: 5001 },
      { startMs: -1 },
    ]) {
      const result = applyCommand(added.project, { op: 'set_overlay', clipId, ...patch });
      expect(result.ok, JSON.stringify(patch)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('out_of_range');
    }

    const empty = applyCommand(added.project, { op: 'set_overlay', clipId });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('invalid');

    const { project, clipId: videoClipId } = projectWithClip();
    const wrongTrack = applyCommand(project, { op: 'set_overlay', clipId: videoClipId, x: 0.5 });
    expect(wrongTrack.ok).toBe(false);
    if (!wrongTrack.ok) expect(wrongTrack.error.code).toBe('invalid');
  });

  it('deletes overlay clips with the shared delete_clip command', () => {
    const added = applyOk(baseProject(), {
      op: 'add_overlay',
      assetId: IMAGE.id,
      startMs: 0,
      durationMs: 1000,
      x: 0.5,
      y: 0.5,
      scale: 0.2,
    });
    const clipId = added.createdIds.clip ?? '';
    const deleted = applyOk(added.project, { op: 'delete_clip', clipId });
    expect(overlayClipOf(deleted.project, clipId)).toBeNull();
    expect(deleted.changes.join(' ')).toContain('Removed overlay');
  });

  it('undoes and redoes an overlay edit', () => {
    const session = new EditSession(baseProject());
    const result = session.apply({
      op: 'add_overlay',
      assetId: IMAGE.id,
      startMs: 500,
      durationMs: 1000,
      x: 0.5,
      y: 0.5,
      scale: 0.25,
    });
    expect(result.ok).toBe(true);
    const clipId = result.ok ? result.createdIds.clip ?? '' : '';
    const overlayClips = () => session.project.tracks.find((track) => track.kind === 'overlay')?.clips ?? [];
    expect(overlayClips()).toHaveLength(1);

    expect(session.undo()).toBe(true);
    expect(overlayClips()).toHaveLength(0);

    expect(session.redo()).toBe(true);
    expect(overlayClips().map((clip) => clip.id)).toEqual([clipId]);
  });
});

describe('text items', () => {
  it('adds text with default style and animation', () => {
    const result = applyOk(createEmptyProject(), {
      op: 'add_text',
      text: '  Hello world  ',
      startMs: 500,
      durationMs: 1500,
      style: { color: '#ff0000' },
    });
    const itemId = result.createdIds.item ?? '';
    const textTrack = result.project.tracks.find((track) => track.kind === 'text');
    const item = textTrack?.items[0];
    expect(item?.id).toBe(itemId);
    expect(item?.text).toBe('Hello world');
    expect(item?.animation).toBe('none');
    expect(item?.style.fontFamily).toBe('IBM Plex Sans');
    expect(item?.style.color).toBe('#ff0000');
  });

  it('rejects empty text and short durations', () => {
    for (const command of [
      { op: 'add_text' as const, text: '   ', startMs: 0, durationMs: 1000 },
      { op: 'add_text' as const, text: 'hi', startMs: 0, durationMs: 199 },
    ]) {
      const result = applyCommand(createEmptyProject(), command);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('out_of_range');
    }
  });

  it('edits and deletes text items', () => {
    const added = applyOk(baseProject(), {
      op: 'add_text',
      text: 'first',
      startMs: 0,
      durationMs: 1000,
    });
    const itemId = added.createdIds.item ?? '';
    const edited = applyOk(added.project, {
      op: 'edit_text',
      itemId,
      text: 'second',
      style: { fontSize: 80 },
    });
    const textTrack = edited.project.tracks.find((track) => track.kind === 'text');
    expect(textTrack?.items[0]?.text).toBe('second');
    expect(textTrack?.items[0]?.style.fontSize).toBe(80);

    const deleted = applyOk(edited.project, { op: 'delete_text', itemId });
    expect(deleted.project.tracks.find((track) => track.kind === 'text')?.items).toHaveLength(0);

    const missing = applyCommand(deleted.project, { op: 'delete_text', itemId });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('not_found');
  });
});

describe('add_audio', () => {
  it('adds an audio clip with sensible defaults', () => {
    const result = applyOk(baseProject(), { op: 'add_audio', assetId: MUSIC.id });
    const audioTrack = result.project.tracks.find((track) => track.kind === 'audio');
    const clip = audioTrack?.clips[0];
    expect(clip?.id).toBe(result.createdIds.clip);
    expect(clip?.inMs).toBe(0);
    expect(clip?.outMs).toBe(8000);
    expect(clip?.startMs).toBe(0);
    expect(clip?.volume).toBe(1);
    expect(clip?.audioFadeInMs).toBe(0);
  });

  it('allows video assets as audio sources', () => {
    const result = applyOk(baseProject(), { op: 'add_audio', assetId: VIDEO.id });
    expect(result.project.tracks.find((track) => track.kind === 'audio')?.clips).toHaveLength(1);
  });

  it('rejects image assets and fades longer than the clip', () => {
    const image = applyCommand(baseProject(), { op: 'add_audio', assetId: IMAGE.id });
    expect(image.ok).toBe(false);

    const fade = applyCommand(baseProject(), {
      op: 'add_audio',
      assetId: MUSIC.id,
      outMs: 1000,
      fadeInMs: 1500,
    });
    expect(fade.ok).toBe(false);
    if (!fade.ok) expect(fade.error.code).toBe('out_of_range');
  });
});

describe('set_audio_fade', () => {
  function projectWithAudio(): { project: Project; clipId: string } {
    const added = applyOk(baseProject(), { op: 'add_audio', assetId: MUSIC.id });
    return { project: added.project, clipId: added.createdIds.clip ?? '' };
  }

  it('sets the fade-out on an audio clip and reports it in the change summary', () => {
    const { project, clipId } = projectWithAudio();
    const result = applyOk(project, { op: 'set_audio_fade', clipId, fadeOutMs: 1000 });
    expect(findClip(result.project, clipId)?.clip.audioFadeOutMs).toBe(1000);
    expect(result.changes).toContain("Set audio fade on 'music.mp3' (out 1.0s)");
  });

  it('keeps an omitted fade field unchanged', () => {
    const { project, clipId } = projectWithAudio();
    const faded = applyOk(project, {
      op: 'set_audio_fade',
      clipId,
      fadeInMs: 500,
      fadeOutMs: 1200,
    });
    const updated = applyOk(faded.project, { op: 'set_audio_fade', clipId, fadeInMs: 0 });
    const clip = findClip(updated.project, clipId)?.clip;
    expect(clip?.audioFadeInMs).toBe(0);
    expect(clip?.audioFadeOutMs).toBe(1200);
    expect(updated.changes).toEqual(["Set audio fade on 'music.mp3' (out 1.2s)"]);
  });

  it('works on a main video clip (clip audio)', () => {
    const { project, clipId } = projectWithClip();
    const result = applyOk(project, {
      op: 'set_audio_fade',
      clipId,
      fadeInMs: 400,
      fadeOutMs: 800,
    });
    const clip = findClip(result.project, clipId)?.clip;
    expect(clip?.audioFadeInMs).toBe(400);
    expect(clip?.audioFadeOutMs).toBe(800);
  });

  it('rejects empty, too-long and above-maximum fades', () => {
    const { project, clipId } = projectWithAudio();

    const empty = applyCommand(project, { op: 'set_audio_fade', clipId });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('invalid');

    const tooLong = applyCommand(project, { op: 'set_audio_fade', clipId, fadeOutMs: 9000 });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.error.code).toBe('out_of_range');
      expect(tooLong.error.message).toContain('8000ms');
    }

    const aboveMax = applyCommand(project, { op: 'set_audio_fade', clipId, fadeInMs: 11_000 });
    expect(aboveMax.ok).toBe(false);
    if (!aboveMax.ok) expect(aboveMax.error.code).toBe('out_of_range');
  });

  it('rejects overlay clips and unknown clip ids', () => {
    const overlay = applyOk(baseProject(), {
      op: 'add_overlay',
      assetId: IMAGE.id,
      startMs: 0,
      durationMs: 1000,
      x: 0.5,
      y: 0.5,
      scale: 0.3,
    });
    const rejected = applyCommand(overlay.project, {
      op: 'set_audio_fade',
      clipId: overlay.createdIds.clip ?? '',
      fadeOutMs: 500,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe('invalid');

    const missing = applyCommand(baseProject(), {
      op: 'set_audio_fade',
      clipId: 'c_missing',
      fadeOutMs: 500,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('not_found');

    const still = applyOk(baseProject(), { op: 'import_clip', assetId: IMAGE.id });
    const silent = applyCommand(still.project, {
      op: 'set_audio_fade',
      clipId: still.createdIds.clip ?? '',
      fadeOutMs: 500,
    });
    expect(silent.ok).toBe(false);
    if (!silent.ok) expect(silent.error.message).toContain('has no audio');
  });

  it('round-trips through undo and redo in the session', () => {
    const session = new EditSession(baseProject());
    const added = session.apply({ op: 'add_audio', assetId: MUSIC.id });
    expect(added.ok).toBe(true);
    const clipId = added.ok ? added.createdIds.clip ?? '' : '';
    const fade = session.apply({ op: 'set_audio_fade', clipId, fadeOutMs: 1500 });
    expect(fade.ok).toBe(true);
    expect(findClip(session.project, clipId)?.clip.audioFadeOutMs).toBe(1500);
    expect(session.undo()).toBe(true);
    expect(findClip(session.project, clipId)?.clip.audioFadeOutMs).toBe(0);
    expect(session.redo()).toBe(true);
    expect(findClip(session.project, clipId)?.clip.audioFadeOutMs).toBe(1500);
  });
});

describe('effects and transitions', () => {
  it('adds an effect with a window inside the clip', () => {
    const { project, clipId } = projectWithClip();
    const result = applyOk(project, {
      op: 'add_effect',
      clipId,
      effect: { type: 'fade', startMs: 100, durationMs: 500, params: { strength: 0.5 } },
    });
    const effect = findClip(result.project, clipId)?.clip.effects[0];
    expect(effect?.id).toBe(result.createdIds.effect);
    expect(effect?.startMs).toBe(100);
    expect(effect?.params.strength).toBe(0.5);
  });

  it('rejects effect windows outside the clip', () => {
    const { project, clipId } = projectWithClip();
    const result = applyCommand(project, {
      op: 'add_effect',
      clipId,
      effect: { type: 'fade', startMs: 4000, durationMs: 2000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('out_of_range');
  });

  it('rejects a video effect on an audio clip and points at set_audio_fade', () => {
    const added = applyOk(baseProject(), { op: 'add_audio', assetId: MUSIC.id });
    const audioClipId = added.createdIds.clip ?? '';
    const fade = {
      op: 'add_effect',
      clipId: audioClipId,
      effect: { type: 'fade', params: { outMs: 1000 } },
    } as const;

    // A declared video target and the default (no declared target) both reject.
    for (const options of [undefined, { effectTarget: () => 'video' as const }]) {
      const result = applyCommand(added.project, fade, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid');
        expect(result.error.message).toContain('cannot be added to audio clip');
        expect(result.error.message).toContain('use set_audio_fade for audio fades');
      }
    }
    expect(findClip(added.project, audioClipId)?.clip.effects).toHaveLength(0);
  });

  it('accepts audio-targeted effects on audio clips and video effects on video clips', () => {
    const added = applyOk(baseProject(), { op: 'add_audio', assetId: MUSIC.id });
    const audioClipId = added.createdIds.clip ?? '';
    const onAudio = applyCommand(
      added.project,
      { op: 'add_effect', clipId: audioClipId, effect: { type: 'duck' } },
      { effectTarget: () => 'audio' },
    );
    expect(onAudio.ok).toBe(true);

    const { project, clipId } = projectWithClip();
    const onVideo = applyCommand(
      project,
      { op: 'add_effect', clipId, effect: { type: 'duck' } },
      { effectTarget: () => 'both' },
    );
    expect(onVideo.ok).toBe(true);

    const audioOnlyOnVideo = applyCommand(
      project,
      { op: 'add_effect', clipId, effect: { type: 'duck' } },
      { effectTarget: () => 'audio' },
    );
    expect(audioOnlyOnVideo.ok).toBe(false);
    if (!audioOnlyOnVideo.ok) expect(audioOnlyOnVideo.error.code).toBe('invalid');
  });

  it('reports not_found when removing a missing effect', () => {
    const { project, clipId } = projectWithClip();
    const result = applyCommand(project, {
      op: 'remove_effect',
      clipId,
      effectId: 'fx_missing',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });

  it('adds a transition only when a following clip exists and it fits', () => {
    const single = projectWithClip();
    const noNext = applyCommand(single.project, {
      op: 'add_transition',
      clipId: single.clipId,
      transition: { type: 'crossfade', durationMs: 500 },
    });
    expect(noNext.ok).toBe(false);

    const { project, clipId } = splitFixtureProject();
    const tooLong = applyCommand(project, {
      op: 'add_transition',
      clipId,
      transition: { type: 'crossfade', durationMs: 2000 },
    });
    expect(tooLong.ok).toBe(false);

    const ok = applyOk(project, {
      op: 'add_transition',
      clipId,
      transition: { type: 'crossfade', durationMs: 800 },
    });
    expect(findClip(ok.project, clipId)?.clip.transitionOut?.type).toBe('crossfade');
    expect(findClip(ok.project, clipId)?.clip.transitionOut?.id).toMatch(/^tr_/);
  });

  it('removes a transition and errors when there is none', () => {
    const { project, clipId } = splitFixtureProject();
    const added = applyOk(project, {
      op: 'add_transition',
      clipId,
      transition: { type: 'crossfade', durationMs: 500 },
    });
    const removed = applyOk(added.project, { op: 'remove_transition', clipId });
    expect(findClip(removed.project, clipId)?.clip.transitionOut).toBeUndefined();

    const again = applyCommand(removed.project, { op: 'remove_transition', clipId });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('not_found');
  });
});

function splitFixtureProject(): { project: Project; clipId: string } {
  const first = applyOk(baseProject(), { op: 'import_clip', assetId: VIDEO.id });
  const second = applyOk(first.project, { op: 'import_clip', assetId: BROLL.id });
  return { project: second.project, clipId: first.createdIds.clip ?? '' };
}

describe('canvas and project name', () => {
  it('sets an even canvas with an optional fps', () => {
    const project = createEmptyProject();
    const result = applyOk(project, { op: 'set_canvas', width: 1920, height: 1080, fps: 60 });
    expect(result.project.canvas).toEqual({ width: 1920, height: 1080, fps: 60 });
  });

  it('rejects odd sizes and invalid fps', () => {
    const project = createEmptyProject();
    for (const command of [
      { op: 'set_canvas' as const, width: 1921, height: 1080 },
      { op: 'set_canvas' as const, width: 1920, height: 1080, fps: 0 },
    ]) {
      const result = applyCommand(project, command);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('out_of_range');
    }
  });

  it('trims the project name and rejects empty names', () => {
    const project = createEmptyProject('Old');
    const result = applyOk(project, { op: 'set_project_name', name: '  New name  ' });
    expect(result.project.name).toBe('New name');

    const empty = applyCommand(project, { op: 'set_project_name', name: '   ' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('out_of_range');
  });
});

describe('set_track', () => {
  it('mutes and unmutes audio and video tracks with change summaries', () => {
    const project = createEmptyProject();
    const audioId = project.tracks.find((track) => track.kind === 'audio')?.id ?? '';
    const videoId = project.tracks.find((track) => track.kind === 'video')?.id ?? '';

    const mutedAudio = applyOk(project, { op: 'set_track', trackId: audioId, muted: true });
    expect(mutedAudio.project.tracks.find((track) => track.id === audioId)?.muted).toBe(true);
    expect(mutedAudio.changes).toEqual(['Muted audio track']);

    const unmutedAudio = applyOk(mutedAudio.project, { op: 'set_track', trackId: audioId, muted: false });
    expect(unmutedAudio.project.tracks.find((track) => track.id === audioId)?.muted).toBe(false);
    expect(unmutedAudio.changes).toEqual(['Unmuted audio track']);

    const mutedVideo = applyOk(project, { op: 'set_track', trackId: videoId, muted: true });
    expect(mutedVideo.project.tracks.find((track) => track.id === videoId)?.muted).toBe(true);
    expect(mutedVideo.changes).toEqual(['Muted video track']);
  });

  it('hides and shows video, overlay and text tracks with change summaries', () => {
    const project = createEmptyProject();
    for (const kind of ['video', 'overlay', 'text'] as const) {
      const trackId = project.tracks.find((track) => track.kind === kind)?.id ?? '';
      const hidden = applyOk(project, { op: 'set_track', trackId, hidden: true });
      expect(hidden.project.tracks.find((track) => track.id === trackId)?.hidden).toBe(true);
      expect(hidden.changes).toEqual([`Hid ${kind} track`]);

      const shown = applyOk(hidden.project, { op: 'set_track', trackId, hidden: false });
      expect(shown.project.tracks.find((track) => track.id === trackId)?.hidden).toBe(false);
      expect(shown.changes).toEqual([`Showed ${kind} track`]);
    }
  });

  it('rejects invalid muted/hidden and track kind combinations', () => {
    const project = createEmptyProject();
    const audioId = project.tracks.find((track) => track.kind === 'audio')?.id ?? '';
    const overlayId = project.tracks.find((track) => track.kind === 'overlay')?.id ?? '';
    const textId = project.tracks.find((track) => track.kind === 'text')?.id ?? '';

    for (const command of [
      { op: 'set_track' as const, trackId: audioId, hidden: true },
      { op: 'set_track' as const, trackId: overlayId, muted: true },
      { op: 'set_track' as const, trackId: textId, muted: true },
    ]) {
      const result = applyCommand(project, command);
      expect(result.ok, JSON.stringify(command)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid');
    }
  });

  it('rejects missing fields and non-existent tracks', () => {
    const project = createEmptyProject();
    const audioId = project.tracks.find((track) => track.kind === 'audio')?.id ?? '';

    const empty = applyCommand(project, { op: 'set_track', trackId: audioId });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('invalid');

    const missing = applyCommand(project, { op: 'set_track', trackId: 't_missing', muted: true });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('not_found');
  });

  it('supports undo and redo through EditSession', () => {
    const session = new EditSession(createEmptyProject());
    const audioId = session.project.tracks.find((track) => track.kind === 'audio')?.id ?? '';

    const result = session.apply({ op: 'set_track', trackId: audioId, muted: true });
    expect(result.ok).toBe(true);
    expect(session.project.tracks.find((track) => track.id === audioId)?.muted).toBe(true);

    expect(session.undo()).toBe(true);
    expect(Boolean(session.project.tracks.find((track) => track.id === audioId)?.muted)).toBe(false);

    expect(session.redo()).toBe(true);
    expect(session.project.tracks.find((track) => track.id === audioId)?.muted).toBe(true);
  });
});

describe('engine contracts', () => {
  it('returns unsupported for unknown ops without throwing', () => {
    const command = { op: 'teleport' } as unknown as EditCommand;
    const result = applyCommand(createEmptyProject(), command);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported');
  });

  it('never mutates the input project', () => {
    const { project, clipId } = projectWithClip();
    const before = JSON.stringify(project);
    applyCommand(project, { op: 'trim_clip', clipId, inMs: 100, outMs: 2000 });
    applyCommand(project, { op: 'split_clip', clipId, atMs: 500 });
    applyCommand(project, { op: 'set_volume', clipId, volume: 9 });
    expect(JSON.stringify(project)).toBe(before);
  });

  it('includes created ids and change descriptions on success', () => {
    const result = applyOk(baseProject(), { op: 'import_clip', assetId: VIDEO.id });
    expect(result.createdIds.clip).toBe(firstClipId(result.project));
    expect(result.changes).toContain(`Added clip 'intro.mp4' at 0.0s`);
  });

  it('keeps the source uri out of change descriptions', () => {
    const result = applyOk(baseProject(), { op: 'import_clip', assetId: VIDEO.id });
    expect(result.changes.join(' ')).not.toContain('C:/media');
  });
});
