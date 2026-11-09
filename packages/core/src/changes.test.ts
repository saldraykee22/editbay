import { describe, expect, it } from 'vitest';

import { applyCommand, applyCommands, createEmptyProject, describeChanges } from './index';
import type { ApplySuccess, Asset, EditCommand, Project } from './index';

const VIDEO: Asset = {
  id: 'a_v1',
  kind: 'video',
  uri: 'C:/media/intro.mp4',
  label: 'intro.mp4',
  durationMs: 5000,
};

function applyOk(project: Project, command: EditCommand): ApplySuccess {
  const result = applyCommand(project, command);
  if (!result.ok) throw new Error(`${command.op}: ${result.error.message}`);
  return result;
}

function baseProject(): Project {
  const added = applyOk(createEmptyProject('Demo'), { op: 'add_asset', asset: VIDEO });
  return applyOk(added.project, { op: 'import_clip', assetId: VIDEO.id }).project;
}

function clipId(project: Project): string {
  return project.tracks.find((track) => track.kind === 'video')?.clips[0]?.id ?? '';
}

describe('describeChanges', () => {
  it('returns an empty list for identical projects', () => {
    const project = baseProject();
    expect(describeChanges(project, project)).toEqual([]);
  });

  it('describes renames and canvas changes', () => {
    const project = createEmptyProject('Old');
    const renamed = applyOk(project, { op: 'set_project_name', name: 'New' });
    const resized = applyOk(renamed.project, {
      op: 'set_canvas',
      width: 1920,
      height: 1080,
      fps: 60,
    });
    expect(describeChanges(project, resized.project)).toEqual([
      'Renamed project to "New"',
      'Set canvas to 1920x1080 at 60fps',
    ]);
  });

  it('describes added assets and clips', () => {
    const project = createEmptyProject();
    const result = applyOk(project, { op: 'add_asset', asset: VIDEO });
    const imported = applyOk(result.project, { op: 'import_clip', assetId: VIDEO.id });
    const changes = describeChanges(project, imported.project);
    expect(changes).toContain("Added asset 'intro.mp4'");
    expect(changes).toContain("Added clip 'intro.mp4' at 0.0s");
  });

  it('uses the concise trim sentence format', () => {
    const project = baseProject();
    const trimmed = applyOk(project, {
      op: 'trim_clip',
      clipId: clipId(project),
      inMs: 0,
      outMs: 4200,
    });
    expect(describeChanges(project, trimmed.project)).toContain("Trimmed 'intro.mp4' to 4.2s");
  });

  it('describes splits as a trim plus a new clip', () => {
    const project = baseProject();
    const split = applyOk(project, {
      op: 'split_clip',
      clipId: clipId(project),
      atMs: 2000,
    });
    const changes = describeChanges(project, split.project);
    expect(changes).toContain("Trimmed 'intro.mp4' to 2.0s");
    expect(changes).toContain("Added clip 'intro.mp4' at 2.0s");
  });

  it('describes text additions, edits and removals', () => {
    const project = createEmptyProject();
    const added = applyOk(project, {
      op: 'add_text',
      text: 'Hello',
      startMs: 500,
      durationMs: 1000,
    });
    const itemId = added.createdIds.item ?? '';
    expect(describeChanges(project, added.project)).toContain('Added text "Hello" at 0.5s');

    const edited = applyOk(added.project, { op: 'edit_text', itemId, text: 'Goodbye' });
    expect(describeChanges(added.project, edited.project)).toContain('Changed text to "Goodbye"');

    const deleted = applyOk(edited.project, { op: 'delete_text', itemId });
    expect(describeChanges(edited.project, deleted.project)).toContain('Removed text "Goodbye"');
  });

  it('describes audio clips distinctly', () => {
    const project = createEmptyProject();
    const added = applyOk(project, {
      op: 'add_asset',
      asset: {
        id: 'a_music',
        kind: 'audio',
        uri: 'C:/media/music.mp3',
        label: 'music.mp3',
        durationMs: 10_000,
      },
    });
    const audio = applyOk(added.project, { op: 'add_audio', assetId: 'a_music' });
    expect(describeChanges(project, audio.project)).toContain("Added audio 'music.mp3' at 0.0s");
  });

  it('caps output at eight lines and is deterministic', () => {
    const project = createEmptyProject('Many');
    const commands: EditCommand[] = [
      { op: 'set_project_name', name: 'Many changes' },
      { op: 'set_canvas', width: 1920, height: 1080, fps: 24 },
    ];
    for (let index = 0; index < 6; index += 1) {
      commands.push({
        op: 'add_asset',
        asset: {
          id: `a_${index}`,
          kind: 'video',
          uri: `C:/media/clip-${index}.mp4`,
          label: `clip-${index}.mp4`,
          durationMs: 1000 + index * 100,
        },
      });
    }
    const batch = applyCommands(project, commands);
    expect(batch.ok).toBe(true);
    const changes = describeChanges(project, batch.project);
    expect(changes.length).toBeLessThanOrEqual(8);
    expect(changes).toEqual(describeChanges(project, batch.project));
  });
});
