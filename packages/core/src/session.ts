/**
 * Stateful editing session with snapshot undo/redo.
 *
 * The session owns the current project, keeps JSON snapshots (max 200) and
 * notifies subscribers after every successful mutation.
 */

import { applyCommand, applyCommands } from './commands';
import { createEmptyProject } from './project';
import type { ApplyResult, BatchResult, EditCommand, Project } from './types';

const HISTORY_LIMIT = 200;

function isProject(value: unknown): value is Project {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<Project>;
  return (
    candidate.schemaVersion === 2 &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.canvas === 'object' &&
    Array.isArray(candidate.assets) &&
    Array.isArray(candidate.tracks)
  );
}

function parseProject(json: string): Project {
  const parsed: unknown = JSON.parse(json);
  return parsed as Project;
}

export class EditSession {
  private current: Project;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(project?: Project) {
    this.current = structuredClone(project ?? createEmptyProject());
  }

  static create(name?: string): EditSession {
    return new EditSession(createEmptyProject(name));
  }

  static fromJSON(json: string): EditSession {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Invalid project JSON');
    }
    if (!isProject(parsed)) throw new Error('Invalid project JSON');
    return new EditSession(parsed);
  }

  get project(): Project {
    return this.current;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  apply(command: EditCommand): ApplyResult {
    const before = this.current;
    const result = applyCommand(before, command);
    if (!result.ok) return result;

    const changed = JSON.stringify(before) !== JSON.stringify(result.project);
    this.current = result.project;
    if (changed) {
      this.pushUndo(before);
      this.emit();
    }
    return result;
  }

  applyBatch(commands: EditCommand[]): BatchResult {
    const before = this.current;
    const result = applyCommands(before, commands);
    const changed = JSON.stringify(before) !== JSON.stringify(result.project);
    this.current = result.project;
    if (changed) {
      this.pushUndo(before);
      this.emit();
    }
    return result;
  }

  undo(): boolean {
    const snapshot = this.undoStack.pop();
    if (snapshot === undefined) return false;
    this.redoStack.push(JSON.stringify(this.current));
    if (this.redoStack.length > HISTORY_LIMIT) this.redoStack.shift();
    this.current = parseProject(snapshot);
    this.emit();
    return true;
  }

  redo(): boolean {
    const snapshot = this.redoStack.pop();
    if (snapshot === undefined) return false;
    this.undoStack.push(JSON.stringify(this.current));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.current = parseProject(snapshot);
    this.emit();
    return true;
  }

  /** Replaces the document entirely and clears history. */
  replaceProject(project: Project): void {
    this.current = structuredClone(project);
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  toJSON(): string {
    return JSON.stringify(this.current);
  }

  private pushUndo(project: Project): void {
    this.undoStack.push(JSON.stringify(project));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A broken subscriber must not take down the editing session.
      }
    }
  }
}
