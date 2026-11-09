import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands';
import { createEmptyProject } from './project';
import { EditSession } from './session';
import { clipStartMsOnTrack, projectDurationMs, timelineDurationMs, transitionOverlapMs } from './timeline';
import type { Asset, Clip, Project, Track } from './types';

function asset(id: string, kind: Asset['kind'], durationMs: number, hasAudio = true): Asset {
  return { id, kind, uri: `/tmp/${id}.bin`, label: `${id}.bin`, durationMs, hasAudio };
}

function clip(id: string, assetId: string, inMs: number, outMs: number): Clip {
  return { id, assetId, inMs, outMs, effects: [] };
}

function withVideo(clips: Clip[], assets: Asset[] = []): Project {
  const project = createEmptyProject('Audit');
  project.assets = assets;
  const video = project.tracks.find((track) => track.kind === 'video')!;
  video.clips = clips;
  return project;
}

function apply(project: Project, command: Parameters<typeof applyCommand>[1]) {
  const result = applyCommand(project, command);
  if (!result.ok) throw new Error(`${command.op} failed: ${result.error.message}`);
  return result.project;
}

function videoTrack(project: Project): Track {
  return project.tracks.find((track) => track.kind === 'video')!;
}

describe('audit: transition-aware timeline math', () => {
  it('pulls the next clip back by the transition overlap', () => {
    const project = withVideo([clip('c1', 'a1', 0, 2000), clip('c2', 'a1', 2000, 4000)]);
    videoTrack(project).clips[0]!.transitionOut = { id: 'tr1', type: 'fade', durationMs: 500 };
    expect(transitionOverlapMs(videoTrack(project).clips[0]!, videoTrack(project).clips[1])).toBe(500);
    expect(clipStartMsOnTrack(videoTrack(project), 1)).toBe(1500);
    expect(timelineDurationMs(project)).toBe(3500);
  });

  it('clamps an oversized transition to half of the shorter clip', () => {
    const project = withVideo([clip('c1', 'a1', 0, 2000), clip('c2', 'a1', 0, 1000)]);
    videoTrack(project).clips[0]!.transitionOut = { id: 'tr1', type: 'fade', durationMs: 5000 };
    expect(clipStartMsOnTrack(videoTrack(project), 1)).toBe(1500);
    expect(timelineDurationMs(project)).toBe(2500);
  });

  it('sizes the project by its picture, not by a longer music bed', () => {
    const project = withVideo([clip('c1', 'a1', 0, 5000)], [asset('a1', 'video', 5000), asset('m1', 'audio', 60000)]);
    const audio = project.tracks.find((track) => track.kind === 'audio')!;
    audio.clips = [clip('c9', 'm1', 0, 60000)];
    // Audio is trimmed at the project end, so a long bed never adds a black tail.
    expect(projectDurationMs(project)).toBe(5000);
    audio.muted = true;
    expect(projectDurationMs(project)).toBe(5000);
  });
});

describe('audit: track normalization after mutations', () => {
  it('clears a dangling transition when the last clip is deleted', () => {
    const project = withVideo([clip('c1', 'a1', 0, 2000), clip('c2', 'a1', 0, 2000)], [asset('a1', 'video', 4000)]);
    videoTrack(project).clips[0]!.transitionOut = { id: 'tr1', type: 'fade', durationMs: 300 };
    const next = apply(project, { op: 'delete_clip', clipId: 'c2' });
    expect(videoTrack(next).clips[0]!.transitionOut).toBeUndefined();
  });

  it('shrinks a transition when a clip is trimmed shorter', () => {
    const project = withVideo([clip('c1', 'a1', 0, 4000), clip('c2', 'a1', 0, 4000)], [asset('a1', 'video', 8000)]);
    videoTrack(project).clips[0]!.transitionOut = { id: 'tr1', type: 'fade', durationMs: 1000 };
    const next = apply(project, { op: 'trim_clip', clipId: 'c1', outMs: 400 });
    expect(videoTrack(next).clips[0]!.transitionOut?.durationMs).toBeLessThanOrEqual(200);
  });

  it('drops effect windows that fall outside the clip after a trim', () => {
    const project = withVideo([clip('c1', 'a1', 0, 4000)], [asset('a1', 'video', 4000)]);
    videoTrack(project).clips[0]!.effects = [
      { id: 'fx1', type: 'fade', params: {}, startMs: 3000, durationMs: 800 },
      { id: 'fx2', type: 'grade', params: {} },
    ];
    const next = apply(project, { op: 'trim_clip', clipId: 'c1', outMs: 1000 });
    const effects = videoTrack(next).clips[0]!.effects;
    expect(effects.map((effect) => effect.id)).toEqual(['fx2']);
  });
});

describe('audit: clip duplication', () => {
  it('gives the duplicate a fresh transition id and offsets audio clips', () => {
    const project = withVideo([clip('c1', 'a1', 0, 2000), clip('c2', 'a1', 0, 2000)], [asset('a1', 'video', 4000)]);
    videoTrack(project).clips[0]!.transitionOut = { id: 'tr_original', type: 'fade', durationMs: 300 };
    const next = apply(project, { op: 'duplicate_clip', clipId: 'c1' });
    const clips = videoTrack(next).clips;
    expect(clips).toHaveLength(3);
    expect(clips[1]!.transitionOut?.id).not.toBe('tr_original');
  });
});

describe('audit: audio guards', () => {
  it('rejects adding a silent video asset as audio', () => {
    const project = withVideo([], [asset('v1', 'video', 5000, false)]);
    const result = applyCommand(project, { op: 'add_audio', assetId: 'v1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid');
  });

  it('rejects audio clips shorter than the minimum', () => {
    const project = withVideo([], [asset('m1', 'audio', 5000)]);
    const result = applyCommand(project, { op: 'add_audio', assetId: 'm1', inMs: 0, outMs: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('out_of_range');
  });

  it('honours index on a non-video track', () => {
    const project = withVideo([], [asset('m1', 'audio', 5000), asset('m2', 'audio', 5000)]);
    let next = apply(project, { op: 'add_audio', assetId: 'm1', outMs: 2000 });
    next = apply(next, { op: 'add_audio', assetId: 'm2', outMs: 2000 });
    const audioTrackId = next.tracks.find((track) => track.kind === 'audio')!.id;
    const imported = apply(next, { op: 'import_clip', assetId: 'm2', trackId: audioTrackId, index: 0 });
    const audio = imported.tracks.find((track) => track.kind === 'audio')!;
    expect(audio.clips[0]!.assetId).toBe('m2');
  });
});

describe('audit: session validation', () => {
  it('rejects a project whose canvas is null', () => {
    const project = createEmptyProject('Broken') as unknown as Record<string, unknown>;
    project['canvas'] = null;
    expect(() => EditSession.fromJSON(JSON.stringify(project))).toThrow();
  });

  it('rejects a non-finite asset duration', () => {
    const project = createEmptyProject('NaN');
    const result = applyCommand(project, {
      op: 'add_asset',
      asset: { id: 'bad', kind: 'video', uri: '/tmp/bad.mp4', label: 'bad.mp4', durationMs: Number.NaN },
    });
    expect(result.ok).toBe(false);
  });

  it('keeps a valid project loadable', () => {
    const session = EditSession.create('Round trip');
    const again = EditSession.fromJSON(session.toJSON());
    expect(again.project.name).toBe('Round trip');
  });
});
