import { useSyncExternalStore } from 'react';
import {
  EditSession,
  createId,
  timelineDurationMs,
  type Asset,
  type EditCommand,
  type ApplyResult,
  type BatchResult,
  type Project,
} from '@editbay/core';
import type { PickedMedia } from '../../../shared/api';

export interface Selection {
  clipId?: string;
  itemId?: string;
  trackId?: string;
}

const MEDIA_SCHEME = 'editbay-media://local/';

export function mediaUrl(path: string): string {
  return `${MEDIA_SCHEME}${encodeURIComponent(path)}`;
}

export class EditorStore {
  session: EditSession;
  selection: Selection = {};
  playheadMs = 0;
  playing = false;
  pxPerSec = 54;
  projectPath: string | null = null;
  demo = false;

  private version = 0;
  private listeners = new Set<() => void>();
  /** Fires only when the project document changes, so autosave ignores UI state. */
  private projectListeners = new Set<() => void>();
  private playheadListeners = new Set<() => void>();
  private playheadVersion = 0;
  private dirty = false;
  private brandId: string | null = null;
  private revision = 0;

  constructor(project?: Project) {
    this.session = new EditSession(project);
    this.session.subscribe(() => this.projectChanged());
  }

  get project(): Project {
    return this.session.project;
  }

  get durationMs(): number {
    return timelineDurationMs(this.project);
  }

  /** True when the document has edits that are not written to a project file. */
  get isDirty(): boolean {
    return this.dirty;
  }

  /** Monotonic document revision used to detect edits during an async save. */
  get projectRevision(): number {
    return this.revision;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.version;

  /** Project-document subscriptions (autosave, exports, agent context). */
  onChange(listener: () => void): () => void {
    this.projectListeners.add(listener);
    return () => this.projectListeners.delete(listener);
  }

  /** Re-render UI that depends on selection/playback state. */
  private bump(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private projectChanged(): void {
    // Undo snapshots predate brand attachment; keep the workspace link stable.
    if (this.brandId && this.project.brandId !== this.brandId) this.project.brandId = this.brandId;
    this.dirty = true;
    this.revision += 1;
    this.version += 1;
    for (const listener of this.listeners) listener();
    for (const listener of this.projectListeners) listener();
  }

  markSaved(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.bump();
  }

  select(selection: Selection): void {
    this.selection = selection;
    this.bump();
  }

  setPlayhead(ms: number): void {
    const next = Math.max(0, Math.min(this.durationMs, Math.round(ms)));
    if (next === this.playheadMs) return;
    this.playheadMs = next;
    this.playheadVersion += 1;
    for (const listener of this.playheadListeners) listener();
  }

  subscribePlayhead = (listener: () => void): (() => void) => {
    this.playheadListeners.add(listener);
    return () => this.playheadListeners.delete(listener);
  };

  getPlayheadSnapshot = (): number => this.playheadVersion;

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.bump();
  }

  apply(command: EditCommand): ApplyResult {
    const result = this.session.apply(command);
    if (result.ok) {
      if (this.playheadMs > this.durationMs) this.playheadMs = this.durationMs;
    }
    return result;
  }

  applyBatch(commands: EditCommand[]): BatchResult {
    const result = this.session.applyBatch(commands);
    if (this.playheadMs > this.durationMs) this.playheadMs = this.durationMs;
    return result;
  }

  undo(): boolean {
    const ok = this.session.undo();
    return ok;
  }

  redo(): boolean {
    return this.session.redo();
  }

  /**
   * Brand identity is workspace metadata, not an undoable timeline edit, so it
   * is attached to the document without pushing an undo snapshot.
   */
  setBrandId(brandId: string): void {
    this.brandId = brandId;
    if (this.project.brandId === brandId) return;
    this.project.brandId = brandId;
    this.projectChanged();
  }

  load(project: Project, path: string | null = null): void {
    this.brandId = project.brandId ?? null;
    this.session = new EditSession(project);
    this.session.subscribe(() => this.projectChanged());
    this.projectPath = path;
    this.selection = {};
    this.playheadMs = 0;
    this.playing = false;
    this.dirty = false;
    this.revision += 1;
    this.bump();
  }

  addPickedMedia(items: PickedMedia[]): { added: number; errors: string[] } {
    let added = 0;
    const errors: string[] = [];
    for (const item of items) {
      const asset: Asset = {
        id: createId('a'),
        kind: item.kind,
        uri: item.path,
        label: item.label,
        durationMs: item.durationMs && item.durationMs > 0 ? item.durationMs : item.kind === 'image' ? 5000 : 0,
        width: item.width,
        height: item.height,
        hasAudio: item.hasAudio,
        thumbnailUri: item.thumbnail,
        origin: 'imported',
        createdAt: new Date().toISOString(),
      };
      const addResult = this.apply({ op: 'add_asset', asset });
      if (!addResult.ok) {
        errors.push(`${item.label}: ${addResult.error.message}`);
        continue;
      }
      const importResult = this.apply({ op: 'import_clip', assetId: asset.id });
      if (!importResult.ok) {
        errors.push(`${item.label}: ${importResult.error.message}`);
        continue;
      }
      added += 1;
      if (importResult.createdIds.clip) this.selection = { clipId: importResult.createdIds.clip };
    }
    this.bump();
    return { added, errors };
  }

  assetById(id: string): Asset | undefined {
    return this.project.assets.find((a) => a.id === id);
  }
}

/* ---------------- React binding ---------------- */

export function useEditorVersion(store: EditorStore): number {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function usePlayhead(store: EditorStore): number {
  useSyncExternalStore(store.subscribePlayhead, store.getPlayheadSnapshot, store.getPlayheadSnapshot);
  return store.playheadMs;
}
