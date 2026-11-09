import { describe, expect, it } from 'vitest';

import { createEmptyProject, mainVideoTrack, validateProject } from './index';
import type { Clip, Project } from './index';

function withAsset(): Project {
  const project = createEmptyProject('Validation');
  project.assets.push({
    id: 'a_v1',
    kind: 'video',
    uri: 'C:/media/video.mp4',
    label: 'video.mp4',
    durationMs: 10_000,
  });
  return project;
}

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

describe('createEmptyProject', () => {
  it('creates a schema v2 project with four standard tracks', () => {
    const project = createEmptyProject();
    expect(project.schemaVersion).toBe(2);
    expect(project.id).toMatch(/^p_/);
    expect(project.name).toBe('Untitled');
    expect(project.canvas).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(project.tracks.map((track) => track.kind)).toEqual([
      'video',
      'overlay',
      'text',
      'audio',
    ]);
    expect(project.assets).toEqual([]);
  });

  it('trims names, falls back to Untitled and caps at 120 characters', () => {
    expect(createEmptyProject('  My film  ').name).toBe('My film');
    expect(createEmptyProject('   ').name).toBe('Untitled');
    expect(createEmptyProject('x'.repeat(150)).name).toHaveLength(120);
  });

  it('stamps createdAt and updatedAt', () => {
    const project = createEmptyProject();
    expect(Number.isNaN(Date.parse(project.createdAt))).toBe(false);
    expect(project.updatedAt).toBe(project.createdAt);
  });
});

describe('validateProject', () => {
  it('returns no errors for a freshly created project', () => {
    expect(validateProject(createEmptyProject('Clean'))).toEqual([]);
  });

  it('accepts a valid clip with an existing asset', () => {
    const project = withAsset();
    mainVideoTrack(project).clips.push(clip('c_1'));
    expect(validateProject(project)).toEqual([]);
  });

  it('flags missing asset references', () => {
    const project = withAsset();
    mainVideoTrack(project).clips.push(clip('c_1', { assetId: 'a_missing' }));
    const errors = validateProject(project);
    expect(errors.some((error) => error.includes('missing asset'))).toBe(true);
  });

  it('flags duplicate clip ids', () => {
    const project = withAsset();
    mainVideoTrack(project).clips.push(clip('c_dup'), clip('c_dup'));
    const errors = validateProject(project);
    expect(errors.some((error) => error.includes('Duplicate clip id'))).toBe(true);
  });

  it('flags invalid canvas values', () => {
    const project = createEmptyProject();
    project.canvas.width = 1921;
    project.canvas.fps = 0;
    const errors = validateProject(project);
    expect(errors.some((error) => error.includes('Canvas width'))).toBe(true);
    expect(errors.some((error) => error.includes('Canvas fps'))).toBe(true);
  });

  it('flags an empty project name', () => {
    const project = createEmptyProject();
    project.name = '   ';
    expect(validateProject(project).some((error) => error.includes('Project name'))).toBe(true);
  });

  it('flags clips shorter than 100ms and invalid source ranges', () => {
    const project = withAsset();
    mainVideoTrack(project).clips.push(
      clip('c_short', { outMs: 50 }),
      clip('c_bad', { inMs: 2000, outMs: 1000 }),
    );
    const errors = validateProject(project);
    expect(errors.some((error) => error.includes('at least 100ms'))).toBe(true);
    expect(errors.some((error) => error.includes('greater than inMs'))).toBe(true);
  });

  it('flags text items with empty text or short durations', () => {
    const project = createEmptyProject();
    project.tracks.find((track) => track.kind === 'text')?.items.push({
      id: 'ti_1',
      text: '   ',
      startMs: 0,
      durationMs: 100,
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
    const errors = validateProject(project);
    expect(errors.some((error) => error.includes('1..500'))).toBe(true);
    expect(errors.some((error) => error.includes('at least 200'))).toBe(true);
  });

  it('flags a transition on the last clip', () => {
    const project = withAsset();
    mainVideoTrack(project).clips.push(
      clip('c_1', {
        transitionOut: { id: 'tr_1', type: 'fade', durationMs: 200 },
      }),
    );
    const errors = validateProject(project);
    expect(errors.some((error) => error.includes('no following clip'))).toBe(true);
  });
});
