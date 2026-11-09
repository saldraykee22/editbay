import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editbay/core';
import { EditorStore } from '../store';

function makeStore(): EditorStore {
  return new EditorStore(createEmptyProject('Test project'));
}

describe('EditorStore', () => {
  let store: EditorStore;

  beforeEach(() => {
    store = makeStore();
  });

  it('keeps playhead and selection changes out of project listeners', () => {
    let projectChanges = 0;
    let renders = 0;
    store.onChange(() => {
      projectChanges += 1;
    });
    store.subscribe(() => {
      renders += 1;
    });

    const added = store.apply({ op: 'add_text', text: 'Title', startMs: 0, durationMs: 5000 });
    expect(added.ok).toBe(true);
    expect(projectChanges).toBe(1);

    projectChanges = 0;
    renders = 0;

    store.setPlayhead(1200);
    expect(store.playheadMs).toBe(1200);
    expect(projectChanges).toBe(0);
    expect(renders).toBe(0);

    store.select({ itemId: 'missing' });
    expect(projectChanges).toBe(0);
    expect(renders).toBe(1);

    store.setPlaying(true);
    expect(projectChanges).toBe(0);
    expect(renders).toBe(2);
  });

  it('marks the document dirty on edits and clean after save/load', () => {
    expect(store.isDirty).toBe(false);

    store.apply({ op: 'add_text', text: 'Title', startMs: 0, durationMs: 1000 });
    expect(store.isDirty).toBe(true);

    store.markSaved();
    expect(store.isDirty).toBe(false);

    store.apply({ op: 'add_text', text: 'Second', startMs: 0, durationMs: 1000 });
    expect(store.isDirty).toBe(true);

    store.load(createEmptyProject('Fresh'), null);
    expect(store.isDirty).toBe(false);
    expect(store.project.name).toBe('Fresh');
  });

  it('undoes and redoes a batch as a single history step', () => {
    const batch = store.applyBatch([
      { op: 'add_text', text: 'One', startMs: 0, durationMs: 1000 },
      { op: 'add_text', text: 'Two', startMs: 1200, durationMs: 1000 },
    ]);
    expect(batch.ok).toBe(true);

    const textTrack = () => store.project.tracks.find((track) => track.kind === 'text');
    expect(textTrack()?.items).toHaveLength(2);

    store.undo();
    expect(textTrack()?.items).toHaveLength(0);

    store.redo();
    expect(textTrack()?.items).toHaveLength(2);
    expect(textTrack()?.items.map((item) => item.text).sort()).toEqual(['One', 'Two']);
  });

  it('keeps the brand attachment across undo', () => {
    store.apply({ op: 'add_text', text: 'Title', startMs: 0, durationMs: 1000 });
    store.setBrandId('default');
    expect(store.project.brandId).toBe('default');

    store.undo();
    expect(store.project.tracks.find((track) => track.kind === 'text')?.items).toHaveLength(0);
    expect(store.project.brandId).toBe('default');
  });
});
