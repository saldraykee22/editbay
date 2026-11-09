import { describe, expect, it } from 'vitest';

import { createEmptyProject, EditSession } from './index';
import type { Asset } from './index';

const VIDEO: Asset = {
  id: 'a_v1',
  kind: 'video',
  uri: 'C:/media/intro.mp4',
  label: 'intro.mp4',
  durationMs: 5000,
};

describe('EditSession', () => {
  it('starts from an empty project by default', () => {
    const session = new EditSession();
    expect(session.project.tracks).toHaveLength(4);
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(false);
  });

  it('creates a named session with EditSession.create', () => {
    const session = EditSession.create('My film');
    expect(session.project.name).toBe('My film');
  });

  it('applies commands and pushes history', () => {
    const session = EditSession.create('Demo');
    const result = session.apply({ op: 'add_asset', asset: VIDEO });
    expect(result.ok).toBe(true);
    expect(session.project.assets).toHaveLength(1);
    expect(session.canUndo).toBe(true);
    expect(session.canRedo).toBe(false);
  });

  it('undoes and redoes project states', () => {
    const session = EditSession.create('Demo');
    session.apply({ op: 'set_project_name', name: 'First' });
    session.apply({ op: 'set_project_name', name: 'Second' });

    expect(session.undo()).toBe(true);
    expect(session.project.name).toBe('First');
    expect(session.canRedo).toBe(true);

    expect(session.redo()).toBe(true);
    expect(session.project.name).toBe('Second');
  });

  it('returns false when there is nothing to undo or redo', () => {
    const session = EditSession.create('Demo');
    expect(session.undo()).toBe(false);
    expect(session.redo()).toBe(false);
  });

  it('does not push history for failed commands', () => {
    const session = EditSession.create('Demo');
    let notified = 0;
    session.subscribe(() => {
      notified += 1;
    });
    const result = session.apply({ op: 'import_clip', assetId: 'a_missing' });
    expect(result.ok).toBe(false);
    expect(session.canUndo).toBe(false);
    expect(notified).toBe(0);
  });

  it('notifies subscribers on apply, undo and redo, and supports unsubscribe', () => {
    const session = EditSession.create('Demo');
    let notified = 0;
    const unsubscribe = session.subscribe(() => {
      notified += 1;
    });

    session.apply({ op: 'set_project_name', name: 'One' });
    session.undo();
    session.redo();
    expect(notified).toBe(3);

    unsubscribe();
    session.apply({ op: 'set_project_name', name: 'Two' });
    expect(notified).toBe(3);
  });

  it('round-trips through JSON', () => {
    const session = EditSession.create('Round trip');
    session.apply({ op: 'add_asset', asset: VIDEO });
    session.apply({ op: 'import_clip', assetId: VIDEO.id });

    const restored = EditSession.fromJSON(session.toJSON());
    expect(restored.project.name).toBe('Round trip');
    expect(restored.project.assets).toHaveLength(1);
    expect(restored.project.tracks.find((track) => track.kind === 'video')?.clips).toHaveLength(1);
    expect(restored.canUndo).toBe(false);
  });

  it('rejects malformed JSON', () => {
    expect(() => EditSession.fromJSON('not json')).toThrow('Invalid project JSON');
    expect(() => EditSession.fromJSON('{"schemaVersion":1}')).toThrow('Invalid project JSON');
  });

  it('caps undo history at 200 entries', () => {
    const session = EditSession.create('History');
    for (let index = 0; index < 205; index += 1) {
      session.apply({ op: 'set_project_name', name: `Name ${index}` });
    }
    let undone = 0;
    while (session.undo()) undone += 1;
    expect(undone).toBe(200);
  });

  it('treats a batch as one undo entry', () => {
    const session = EditSession.create('Batch');
    const result = session.applyBatch([
      { op: 'add_asset', asset: VIDEO },
      { op: 'import_clip', assetId: VIDEO.id },
    ]);
    expect(result.ok).toBe(true);
    expect(session.project.assets).toHaveLength(1);

    session.undo();
    expect(session.project.assets).toHaveLength(0);
    expect(session.undo()).toBe(false);
  });

  it('clears history when replacing the project', () => {
    const session = EditSession.create('Old');
    session.apply({ op: 'set_project_name', name: 'Changed' });
    session.replaceProject(createEmptyProject('Replaced'));
    expect(session.project.name).toBe('Replaced');
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(false);
  });

  it('clones the constructor project so external mutation cannot leak in', () => {
    const project = createEmptyProject('Original');
    const session = new EditSession(project);
    project.name = 'Mutated outside';
    expect(session.project.name).toBe('Original');
  });
});
