import { describe, expect, it } from 'vitest';

import {
  audioTrack,
  clipTimelineDurationMs,
  createEmptyProject,
  findAsset,
  findClip,
  findTextItem,
  mainVideoTrack,
  projectDurationMs,
  textTrack,
  timelineDurationMs,
  videoClipStartMs,
} from './index';
import type { Clip, Project } from './index';

function clip(id: string, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    assetId: 'a_v1',
    inMs: 0,
    outMs: 4000,
    effects: [],
    ...overrides,
  };
}

function fixture(): Project {
  const project = createEmptyProject('Timeline');
  project.assets.push({
    id: 'a_v1',
    kind: 'video',
    uri: 'secret/path/video.mp4',
    label: 'video.mp4',
    durationMs: 10_000,
  });
  mainVideoTrack(project).clips.push(clip('c_1'), clip('c_2', { outMs: 6000 }));
  return project;
}

describe('timeline math', () => {
  it('reports zero duration for an empty project', () => {
    expect(timelineDurationMs(createEmptyProject())).toBe(0);
  });

  it('computes clip durations from source points and speed', () => {
    expect(clipTimelineDurationMs(clip('c_1'))).toBe(4000);
    expect(clipTimelineDurationMs(clip('c_1', { speed: 2 }))).toBe(2000);
    expect(clipTimelineDurationMs(clip('c_1', { inMs: 500, outMs: 1500 }))).toBe(1000);
  });

  it('rounds fractional timeline durations', () => {
    expect(clipTimelineDurationMs(clip('c_1', { outMs: 1001, speed: 2 }))).toBe(501);
  });

  it('sums sequential video clips', () => {
    expect(timelineDurationMs(fixture())).toBe(10_000);
  });

  it('uses absolute starts on overlay clips', () => {
    const project = fixture();
    const overlay = project.tracks.find((track) => track.kind === 'overlay');
    overlay?.clips.push(clip('c_overlay', { startMs: 9000, outMs: 3000 }));
    expect(timelineDurationMs(project)).toBe(12_000);
  });

  it('extends duration with text items', () => {
    const project = fixture();
    textTrack(project).items.push({
      id: 'ti_1',
      text: 'outro',
      startMs: 11_000,
      durationMs: 2000,
      style: {
        fontFamily: 'Inter',
        fontSize: 40,
        fontWeight: 400,
        color: '#fff',
        align: 'center',
        x: 0.5,
        y: 0.5,
      },
    });
    expect(timelineDurationMs(project)).toBe(13_000);
  });
});

describe('projectDurationMs: picture defines the length', () => {
  function addMusic(project: Project, startMs: number, outMs: number, muted = false): void {
    const track = audioTrack(project);
    track.muted = muted;
    track.clips.push(clip('c_music', { assetId: 'a_music', startMs, outMs }));
  }

  function musicProject(): Project {
    const project = fixture();
    project.assets.push({
      id: 'a_music',
      kind: 'audio',
      uri: 'secret/path/music.m4a',
      label: 'music.m4a',
      durationMs: 120_000,
    });
    return project;
  }

  it('keeps the video length when the video is longer than the music', () => {
    const project = musicProject();
    addMusic(project, 1000, 4000);
    expect(projectDurationMs(project)).toBe(10_000);
  });

  it('does not stretch to a music bed that outlasts the picture', () => {
    const project = musicProject();
    addMusic(project, 0, 30_000);
    expect(projectDurationMs(project)).toBe(10_000);
    expect(timelineDurationMs(project)).toBe(10_000);
  });

  it('uses the audio end when the project has no picture at all', () => {
    const project = createEmptyProject('Music only');
    project.assets.push({
      id: 'a_music',
      kind: 'audio',
      uri: 'secret/path/music.m4a',
      label: 'music.m4a',
      durationMs: 120_000,
    });
    addMusic(project, 1000, 3000);
    expect(projectDurationMs(project)).toBe(4000);
  });

  it('uses the text end when a text item outlasts the video', () => {
    const project = fixture();
    textTrack(project).items.push({
      id: 'ti_long',
      text: 'credits',
      startMs: 12_000,
      durationMs: 3000,
      style: {
        fontFamily: 'Inter',
        fontSize: 40,
        fontWeight: 400,
        color: '#fff',
        align: 'center',
        x: 0.5,
        y: 0.5,
      },
    });
    expect(projectDurationMs(project)).toBe(15_000);
  });

  it('subtracts transition overlap from the video end', () => {
    const project = createEmptyProject('Overlap');
    mainVideoTrack(project).clips.push(
      clip('c_1', { transitionOut: { id: 'tr_1', type: 'fade', durationMs: 500 } }),
      clip('c_2'),
    );
    expect(projectDurationMs(project)).toBe(7500);
  });
});

describe('videoClipStartMs', () => {
  it('returns 0 for the first clip and the cumulative duration after it', () => {
    const project = fixture();
    expect(videoClipStartMs(project, 'c_1')).toBe(0);
    expect(videoClipStartMs(project, 'c_2')).toBe(4000);
  });

  it('returns null for clips that are not on the main video track', () => {
    const project = fixture();
    const overlay = project.tracks.find((track) => track.kind === 'overlay');
    overlay?.clips.push(clip('c_overlay', { startMs: 500 }));
    expect(videoClipStartMs(project, 'c_overlay')).toBeNull();
    expect(videoClipStartMs(project, 'missing')).toBeNull();
  });
});

describe('lookups', () => {
  it('finds clips with their track and index', () => {
    const project = fixture();
    const found = findClip(project, 'c_2');
    expect(found?.track.kind).toBe('video');
    expect(found?.index).toBe(1);
    expect(findClip(project, 'missing')).toBeNull();
  });

  it('finds text items with their track and index', () => {
    const project = fixture();
    textTrack(project).items.push({
      id: 'ti_1',
      text: 'hello',
      startMs: 0,
      durationMs: 500,
      style: {
        fontFamily: 'Inter',
        fontSize: 40,
        fontWeight: 400,
        color: '#fff',
        align: 'center',
        x: 0.5,
        y: 0.5,
      },
    });
    const found = findTextItem(project, 'ti_1');
    expect(found?.track.kind).toBe('text');
    expect(found?.index).toBe(0);
    expect(findTextItem(project, 'missing')).toBeNull();
  });

  it('finds assets and returns null otherwise', () => {
    expect(findAsset(fixture(), 'a_v1')?.label).toBe('video.mp4');
    expect(findAsset(fixture(), 'a_missing')).toBeNull();
  });

  it('returns the standard tracks', () => {
    const project = createEmptyProject();
    expect(mainVideoTrack(project).kind).toBe('video');
    expect(textTrack(project).kind).toBe('text');
    expect(audioTrack(project).kind).toBe('audio');
  });
});
