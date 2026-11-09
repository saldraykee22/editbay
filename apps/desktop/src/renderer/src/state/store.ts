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
  private changeListeners = new Set<() => void>();
  private playheadListeners = new Set<() => void>();
  private playheadVersion = 0;

  constructor(project?: Project) {
    this.session = new EditSession(project);
    this.session.subscribe(() => this.bump());
  }

  get project(): Project {
    return this.session.project;
  }

  get durationMs(): number {
    return timelineDurationMs(this.project);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.version;

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private bump(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
    for (const listener of this.changeListeners) listener();
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

  load(project: Project, path: string | null = null): void {
    this.session = new EditSession(project);
    this.session.subscribe(() => this.bump());
    this.projectPath = path;
    this.selection = {};
    this.playheadMs = 0;
    this.playing = false;
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
