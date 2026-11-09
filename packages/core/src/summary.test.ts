import { describe, expect, it } from 'vitest';

import { applyCommand, createEmptyProject, mainVideoTrack, projectSummary } from './index';
import type { ApplySuccess, Asset, EditCommand, Project } from './index';

const VIDEO: Asset = {
  id: 'a_v1',
  kind: 'video',
  uri: '/home/user/secret/intro.mp4',
  label: 'intro.mp4',
  durationMs: 5000,
  thumbnailUri: '/home/user/secret/thumb.jpg',
};

function applyOk(project: Project, command: EditCommand): ApplySuccess {
  const result = applyCommand(project, command);
  if (!result.ok) throw new Error(`${command.op}: ${result.error.message}`);
  return result;
}

function fixture(): { project: Project; clipId: string } {
  let project = createEmptyProject('Brand film');
  project = applyOk(project, { op: 'add_asset', asset: VIDEO }).project;
  project = applyOk(project, { op: 'add_asset', asset: { ...VIDEO, id: 'a_v2', label: 'broll.mp4', uri: 'C:/x/broll.mp4' } }).project;
  const imported = applyOk(project, { op: 'import_clip', assetId: 'a_v1' });
  project = imported.project;
  const clipId = imported.createdIds.clip ?? '';
  project = applyOk(project, { op: 'set_clip_transform', clipId, transform: { scale: 1.2 } }).project;
  project = applyOk(project, {
    op: 'add_effect',
    clipId,
    effect: { type: 'fade', startMs: 100, durationMs: 500 },
  }).project;
  return { project, clipId };
}

describe('projectSummary', () => {
  it('is valid JSON with canvas, duration and tracks', () => {
    const summary = projectSummary(createEmptyProject('Brand film'));
    const parsed = JSON.parse(summary) as Record<string, unknown>;
    expect(parsed.project).toBe('Brand film');
    expect(parsed.canvas).toBe('1080x1920@30fps');
    expect(parsed.duration).toBe(0);
    expect(Array.isArray(parsed.tracks)).toBe(true);
    expect((parsed.tracks as unknown[]).length).toBe(4);
  });

  it('never leaks file paths, uris or thumbnails', () => {
    const { project } = fixture();
    const summary = projectSummary(project);
    expect(summary).not.toContain('C:/');
    expect(summary).not.toContain('secret');
    expect(summary).not.toContain('thumb.jpg');
    expect(summary).toContain('intro.mp4');
  });

  it('includes clip ids, labels and timings in seconds', () => {
    const { project, clipId } = fixture();
    const parsed = JSON.parse(projectSummary(project)) as {
      tracks: { kind: string; clips?: { id: string; asset: string; start: number; duration: number }[] }[];
    };
    const videoTrack = parsed.tracks.find((track) => track.kind === 'video');
    const clip = videoTrack?.clips?.[0];
    expect(clip?.id).toBe(clipId);
    expect(clip?.asset).toBe('intro.mp4');
    expect(clip?.start).toBe(0);
    expect(clip?.duration).toBe(5);
  });

  it('includes effect types and windows', () => {
    const { project } = fixture();
    const summary = projectSummary(project);
    expect(summary).toContain('fade@0.1s+0.5s');
  });

  it('includes text items with animation and truncates long text', () => {
    const project = createEmptyProject('Captions');
    const longText = 'word '.repeat(40).trim();
    const added = applyOk(project, {
      op: 'add_text',
      text: longText,
      startMs: 250,
      durationMs: 1500,
      animation: 'fade',
    });
    const summary = projectSummary(added.project);
    const parsed = JSON.parse(summary) as {
      tracks: { kind: string; items?: { text: string; animation: string; start: number }[] }[];
    };
    const textTrack = parsed.tracks.find((track) => track.kind === 'text');
    const item = textTrack?.items?.[0];
    expect(item?.animation).toBe('fade');
    expect(item?.start).toBe(0.3);
    expect((item?.text ?? '').length).toBeLessThanOrEqual(60);
    expect(summary).not.toContain(longText);
  });

  it('limits listed assets with maxAssets', () => {
    let project = createEmptyProject('Many assets');
    for (let index = 0; index < 5; index += 1) {
      project = applyOk(project, {
        op: 'add_asset',
        asset: {
          id: `a_${index}`,
          kind: 'video',
          uri: `C:/media/clip-${index}.mp4`,
          label: `clip-${index}.mp4`,
          durationMs: 1000,
        },
      }).project;
    }
    const summary = projectSummary(project, { maxAssets: 2 });
    const parsed = JSON.parse(summary) as { assets: unknown[]; assetsOmitted: number };
    expect(parsed.assets).toHaveLength(2);
    expect(parsed.assetsOmitted).toBe(3);
  });

  it('rounds timings to 0.1s', () => {
    const { project, clipId } = fixture();
    const trimmed = applyOk(project, { op: 'trim_clip', clipId, inMs: 0, outMs: 1234 });
    const parsed = JSON.parse(projectSummary(trimmed.project)) as {
      tracks: { kind: string; clips?: { duration: number }[] }[];
    };
    expect(parsed.tracks.find((track) => track.kind === 'video')?.clips?.[0]?.duration).toBe(1.2);
    expect(mainVideoTrack(trimmed.project).clips[0]?.outMs).toBe(1234);
  });
});
