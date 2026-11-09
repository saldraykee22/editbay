import { constants as fsConstants, promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import type { Workspace, WorkspaceFile } from './types';

/**
 * Node file-system implementation of the harness workspace.
 *
 * All public methods take POSIX-style relative paths. Absolute paths, drive
 * letters, backslash traversal and `..` segments are rejected so an agent can
 * never read or write outside the workspace root.
 */
export class NodeWorkspace implements Workspace {
  readonly root: string;

  constructor(root: string) {
    if (typeof root !== 'string' || root.trim() === '') {
      throw new Error('Workspace root must be a non-empty path');
    }
    this.root = path.resolve(root);
  }

  /** Resolve a safe relative path to an absolute path inside the root. */
  resolve(relativePath: string): string {
    if (typeof relativePath !== 'string') {
      throw new Error('Workspace path must be a string');
    }
    if (relativePath.includes('\0')) {
      throw new Error('Workspace path must not contain null bytes');
    }

    const normalized = relativePath.replace(/\\/g, '/').trim();
    if (normalized === '' || normalized === '.' || normalized === './') {
      return this.root;
    }
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
      throw new Error(`Absolute workspace paths are not allowed: ${relativePath}`);
    }

    const segments: string[] = [];
    for (const segment of normalized.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..') {
        throw new Error(`Workspace path escapes the root: ${relativePath}`);
      }
      segments.push(segment);
    }
    if (segments.length === 0) return this.root;

    const resolved = path.resolve(this.root, ...segments);
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Workspace path escapes the root: ${relativePath}`);
    }
    return resolved;
  }

  async read(relativePath: string): Promise<string | null> {
    const file = this.resolve(relativePath);
    try {
      return await fs.readFile(file, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async write(relativePath: string, content: string): Promise<void> {
    const file = this.resolve(relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf8');
  }

  async append(relativePath: string, content: string): Promise<void> {
    const file = this.resolve(relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, content, 'utf8');
  }

  /**
   * Recursively list files under `relativeDir` (directories are not returned).
   * Paths are POSIX-style and relative to the workspace root.
   */
  async list(relativeDir: string): Promise<WorkspaceFile[]> {
    const dir = this.resolve(relativeDir);
    const files: WorkspaceFile[] = [];

    const walk = async (current: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }

      for (const entry of entries) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }
        const stat = await fs.stat(absolute);
        files.push({
          path: toPosix(path.relative(this.root, absolute)),
          name: entry.name,
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        });
      }
    };

    await walk(dir);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return files;
  }

  async remove(relativePath: string): Promise<boolean> {
    const target = this.resolve(relativePath);
    if (target === this.root) {
      throw new Error('Refusing to remove the workspace root');
    }
    try {
      await fs.lstat(target);
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
    await fs.rm(target, { recursive: true, force: true });
    return true;
  }

  async exists(relativePath: string): Promise<boolean> {
    const target = this.resolve(relativePath);
    try {
      await fs.access(target, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

export function createWorkspace(root: string): Workspace {
  return new NodeWorkspace(root);
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
