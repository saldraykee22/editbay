import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { NodeWorkspace } from './workspace';

let root: string;
let workspace: NodeWorkspace;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'editbay-workspace-'));
  workspace = new NodeWorkspace(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('NodeWorkspace', () => {
  it('exposes an absolute root', () => {
    expect(path.isAbsolute(workspace.root)).toBe(true);
    expect(workspace.root).toBe(path.resolve(root));
  });

  it('writes, reads, appends and creates parent directories', async () => {
    await workspace.write('notes/brand/a.md', 'hello');
    await workspace.append('notes/brand/a.md', ' world');

    expect(await workspace.read('notes/brand/a.md')).toBe('hello world');
    expect(await workspace.exists('notes/brand/a.md')).toBe(true);
  });

  it('returns null for missing files and false for missing removal', async () => {
    expect(await workspace.read('missing.md')).toBeNull();
    expect(await workspace.remove('missing.md')).toBe(false);
  });

  it('lists files recursively with relative POSIX paths', async () => {
    await workspace.write('a.md', 'a');
    await workspace.write('nested/b.md', 'b');
    await workspace.write('nested/deep/c.md', 'c');

    const files = await workspace.list('');
    expect(files.map((file) => file.path)).toEqual(['a.md', 'nested/b.md', 'nested/deep/c.md']);
    expect(files[0]?.name).toBe('a.md');
    expect(files[0]?.size).toBe(1);
    expect(typeof files[0]?.updatedAt).toBe('string');
  });

  it('lists an empty result for a missing directory', async () => {
    expect(await workspace.list('nope')).toEqual([]);
  });

  it('normalizes backslashes and redundant separators', async () => {
    await workspace.write('nested\\a.md', 'x');
    expect(await workspace.read('nested/./a.md')).toBe('x');
    expect(await workspace.read('nested\\\\a.md')).toBe('x');
  });

  it('rejects absolute paths and traversal outside the root', async () => {
    expect(() => workspace.resolve('/etc/passwd')).toThrow(/Absolute/);
    expect(() => workspace.resolve('C:\\Windows\\win.ini')).toThrow(/Absolute/);
    expect(() => workspace.resolve('../secret.md')).toThrow(/escapes/);
    expect(() => workspace.resolve('nested/../../secret.md')).toThrow(/escapes/);
    expect(() => workspace.resolve('..\\secret.md')).toThrow(/escapes/);
    expect(() => workspace.resolve('a\0b')).toThrow(/null/);
  });

  it('rejects escaping writes instead of touching the parent directory', async () => {
    await expect(workspace.write('../outside.md', 'x')).rejects.toThrow(/escapes/);
    await expect(workspace.exists('../outside.md')).rejects.toThrow(/escapes/);
  });

  it('removes files and directories', async () => {
    await workspace.write('dir/a.md', 'a');
    expect(await workspace.remove('dir')).toBe(true);
    expect(await workspace.exists('dir/a.md')).toBe(false);
  });

  it('refuses to remove the workspace root', async () => {
    await expect(workspace.remove('')).rejects.toThrow(/workspace root/i);
  });

  it('treats the empty path as the root', () => {
    expect(workspace.resolve('')).toBe(workspace.root);
    expect(workspace.resolve('.')).toBe(workspace.root);
  });
});
