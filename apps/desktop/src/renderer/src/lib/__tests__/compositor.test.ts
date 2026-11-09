import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXT_STYLE,
  applyCommand,
  createEmptyProject,
  type EditCommand,
  type Project,
} from '@editbay/core';
import {
  activeAudioClipsAt,
  activeClipAt,
  activeClipsAt,
  activeOverlayClipsAt,
  sourceTimeMs,
  textItemsAt,
  textLineX,
  textPlacement,
  videoClips,
} from '../compositor';

function mustApply(project: Project, command: EditCommand): Project {
  const result = applyCommand(project, command);
  if (!result.ok) throw new Error(result.error.message);
  return result.project;
}

function videoAsset(id: string, durationMs: number): EditCommand {
  return {
    op: 'add_asset',
    asset: {
      id,
      kind: 'video',
      uri: `/media/${id}.mp4`,
      label: id,
      durationMs,
      width: 1080,
      height: 1920,
      hasAudio: true,
    },
  };
}

/** Two 2s clips with a 500 ms transition: starts 0 and 1500. */
function projectWithTransition(): Project {
  let project = createEmptyProject('Transitions');
  project = mustApply(project, videoAsset('a1', 2000));
  project = mustApply(project, { op: 'import_clip', assetId: 'a1' });
  project = mustApply(project, { op: 'import_clip', assetId: 'a1' });
  const videoTrack = project.tracks.find((track) => track.kind === 'video');
  const first = videoTrack?.clips[0];
  if (!first) throw new Error('Test project has no clips');
  project = mustApply(project, {
    op: 'add_transition',
    clipId: first.id,
    transition: { type: 'fade', durationMs: 500 },
  });
  return project;
}

describe('compositor timeline math', () => {
  it('subtracts transition overlaps from clip starts', () => {
    const project = projectWithTransition();
    const clips = videoClips(project);

    expect(clips).toHaveLength(2);
    expect(clips[0]?.startMs).toBe(0);
    expect(clips[0]?.durationMs).toBe(2000);
    expect(clips[0]?.transitionOutMs).toBe(500);
    expect(clips[1]?.startMs).toBe(1500);
    expect(clips[1]?.transitionOutMs).toBe(0);
  });

  it('exposes both clips during the crossfade and the incoming clip after it', () => {
    const project = projectWithTransition();

    expect(activeClipsAt(project, 1000)).toHaveLength(1);
    expect(activeClipsAt(project, 1600).map((entry) => entry.clip.id)).toHaveLength(2);
    expect(activeClipAt(project, 1600)?.startMs).toBe(1500);
    expect(activeClipAt(project, 3600)).toBeNull();
  });

  it('maps timeline time to source time with clip speed', () => {
    const project = projectWithTransition();
    const active = activeClipAt(project, 400);
    if (!active) throw new Error('Expected an active clip');

    expect(sourceTimeMs(active)).toBe(400);
    active.clip.speed = 2;
    expect(sourceTimeMs(active)).toBe(800);
  });

  it('finds audio clips placed with an absolute start', () => {
    let project = createEmptyProject('Audio');
    project = mustApply(project, {
      op: 'add_asset',
      asset: { id: 'a_audio', kind: 'audio', uri: '/media/music.mp3', label: 'music', durationMs: 4000 },
    });
    project = mustApply(project, { op: 'import_clip', assetId: 'a_audio' });
    const audioTrack = project.tracks.find((track) => track.kind === 'audio');
    const clip = audioTrack?.clips[0];
    if (!clip) throw new Error('Test project has no audio clip');
    project = mustApply(project, { op: 'set_audio_start', clipId: clip.id, startMs: 1000 });

    expect(activeAudioClipsAt(project, 500)).toHaveLength(0);
    expect(activeAudioClipsAt(project, 1500)).toHaveLength(1);

    const muted = mustApply(project, { op: 'set_track', trackId: audioTrack!.id, muted: true });
    expect(activeAudioClipsAt(muted, 1500)).toHaveLength(0);
  });

  it('respects hidden on video, overlay and text tracks', () => {
    let project = projectWithTransition();
    project = mustApply(project, {
      op: 'add_asset',
      asset: { id: 'a_logo', kind: 'image', uri: '/media/logo.png', label: 'logo.png', durationMs: 5000 },
    });
    project = mustApply(project, {
      op: 'add_overlay',
      assetId: 'a_logo',
      startMs: 0,
      durationMs: 2000,
      x: 0.88,
      y: 0.08,
      scale: 0.16,
    });
    project = mustApply(project, {
      op: 'add_text',
      text: 'Caption',
      startMs: 0,
      durationMs: 2000,
    });

    const videoTrackId = project.tracks.find((t) => t.kind === 'video')!.id;
    const overlayTrackId = project.tracks.find((t) => t.kind === 'overlay')!.id;
    const textTrackId = project.tracks.find((t) => t.kind === 'text')!.id;

    expect(videoClips(project)).toHaveLength(2);
    expect(activeOverlayClipsAt(project, 500)).toHaveLength(1);
    expect(textItemsAt(project, 500)).toHaveLength(1);

    const hiddenAll = [
      { op: 'set_track' as const, trackId: videoTrackId, hidden: true },
      { op: 'set_track' as const, trackId: overlayTrackId, hidden: true },
      { op: 'set_track' as const, trackId: textTrackId, hidden: true },
    ].reduce(mustApply, project);

    expect(videoClips(hiddenAll)).toHaveLength(0);
    expect(activeOverlayClipsAt(hiddenAll, 500)).toHaveLength(0);
    expect(textItemsAt(hiddenAll, 500)).toHaveLength(0);
  });
});

describe('compositor text placement', () => {
  it('uses the engine drawtext margin for left aligned text', () => {
    const style = { ...DEFAULT_TEXT_STYLE, align: 'left' as const, x: 0 };
    const placement = textPlacement(style, 'Hello', 1080, 1920);

    expect(placement.margin).toBe(48);
    expect(placement.top).toBe(Math.round(0.82 * 1920));
    expect(textLineX(placement, 200, 1080)).toBe(48);
  });

  it('centres and right-aligns lines with the anchor offset', () => {
    const centered = textPlacement({ ...DEFAULT_TEXT_STYLE, align: 'center' }, 'Hi', 1080, 1920);
    expect(textLineX(centered, 200, 1080)).toBe(440);

    const shifted = textPlacement({ ...DEFAULT_TEXT_STYLE, align: 'center', x: 0.6 }, 'Hi', 1080, 1920);
    expect(shifted.offsetX).toBe(108);
    expect(textLineX(shifted, 200, 1080)).toBe(548);

    const right = textPlacement({ ...DEFAULT_TEXT_STYLE, align: 'right', x: 1 }, 'Hi', 1080, 1920);
    expect(textLineX(right, 200, 1080)).toBe(1080 - 200 - 48);
  });

  it('places multiline text top-down from the same baseline', () => {
    const placement = textPlacement({ ...DEFAULT_TEXT_STYLE, fontSize: 64, lineHeight: 1.15 }, 'One\nTwo', 1080, 1920);
    expect(placement.lines).toEqual(['One', 'Two']);
    expect(placement.top).toBe(Math.round(0.82 * 1920));
    expect(placement.lineHeight).toBeCloseTo(73.6);
  });
});
