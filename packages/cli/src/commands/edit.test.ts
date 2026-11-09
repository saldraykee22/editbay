import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '@editbay/core';
import { run, type CliIo } from '../cli';

interface Captured {
  io: CliIo;
  stdout: () => string;
  stderr: () => string;
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (text: string): void => {
        out.push(text);
      },
      err: (text: string): void => {
        err.push(text);
      },
    },
    stdout: (): string => out.join(''),
    stderr: (): string => err.join(''),
  };
}

describe('apply, undo and redo', () => {
  let dir: string;
  let projectPath: string;
  let workspace: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'editbay-cli-edit-'));
    projectPath = path.join(dir, 'editbay.json');
    workspace = path.join(dir, '.editbay');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const baseArgs = (): string[] => ['--project', projectPath, '--workspace', workspace];

  async function initProject(name = 'Demo'): Promise<void> {
    const cap = capture();
    expect(await run(['init', ...baseArgs(), '--name', name], cap.io)).toBe(0);
  }

  async function readProject(): Promise<Project> {
    return JSON.parse(await readFile(projectPath, 'utf8')) as Project;
  }

  it('applies a valid command and saves it', async () => {
    await initProject();
    const cap = capture();
    const commands = JSON.stringify([{ op: 'set_project_name', name: 'Renamed' }]);
    expect(await run(['apply', '--json', commands, ...baseArgs()], cap.io)).toBe(0);
    expect(cap.stdout()).toContain('ok    set_project_name');
    expect(cap.stdout()).toContain('applied 1 command');
    expect(cap.stdout()).toContain('Renamed');
    expect((await readProject()).name).toBe('Renamed');
  });

  it('accepts a {"commands": [...]} document from a file', async () => {
    await initProject();
    const file = path.join(dir, 'commands.json');
    await writeFile(file, JSON.stringify({ commands: [{ op: 'set_project_name', name: 'From file' }] }), 'utf8');
    const cap = capture();
    expect(await run(['apply', '--file', file, ...baseArgs()], cap.io)).toBe(0);
    expect((await readProject()).name).toBe('From file');
  });

  it('exits 2 for an invalid command and leaves the project file unchanged', async () => {
    await initProject();
    const before = await readFile(projectPath, 'utf8');
    const commands = JSON.stringify([{ op: 'trim_clip', clipId: 'c_missing', outMs: 500 }]);
    const cap = capture();
    expect(await run(['apply', '--json', commands, ...baseArgs()], cap.io)).toBe(2);
    expect(cap.stdout()).toContain('fail');
    expect(cap.stderr()).toContain('0/1 commands applied');
    expect(await readFile(projectPath, 'utf8')).toBe(before);
  });

  it('reports which commands of a partially applied batch succeeded', async () => {
    await initProject();
    const commands = JSON.stringify([
      { op: 'set_project_name', name: 'Partial' },
      { op: 'trim_clip', clipId: 'c_missing', outMs: 500 },
    ]);
    const cap = capture();
    expect(await run(['apply', '--json', commands, ...baseArgs()], cap.io)).toBe(2);
    expect(cap.stderr()).toContain('1/2 commands applied');
    expect((await readProject()).name).toBe('Partial');
  });

  it('exits 1 for invalid JSON and does not touch the project', async () => {
    await initProject();
    const before = await readFile(projectPath, 'utf8');
    const cap = capture();
    expect(await run(['apply', '--json', '{oops', ...baseArgs()], cap.io)).toBe(1);
    expect(cap.stderr()).toContain('Invalid JSON');
    expect(await readFile(projectPath, 'utf8')).toBe(before);
  });

  it('undo and redo round-trip a change', async () => {
    await initProject('Demo');
    const applyCap = capture();
    const commands = JSON.stringify([{ op: 'set_project_name', name: 'Take 2' }]);
    expect(await run(['apply', '--json', commands, ...baseArgs()], applyCap.io)).toBe(0);
    expect((await readProject()).name).toBe('Take 2');

    const undoCap = capture();
    expect(await run(['undo', ...baseArgs()], undoCap.io)).toBe(0);
    expect(undoCap.stdout()).toContain('undo: Demo');
    expect((await readProject()).name).toBe('Demo');

    const redoCap = capture();
    expect(await run(['redo', ...baseArgs()], redoCap.io)).toBe(0);
    expect(redoCap.stdout()).toContain('redo: Take 2');
    expect((await readProject()).name).toBe('Take 2');

    const secondUndo = capture();
    expect(await run(['undo', ...baseArgs()], secondUndo.io)).toBe(0);
    expect((await readProject()).name).toBe('Demo');
  });

  it('exits 1 when there is nothing to undo', async () => {
    await initProject();
    const cap = capture();
    expect(await run(['undo', ...baseArgs()], cap.io)).toBe(1);
    expect(cap.stderr()).toContain('Nothing to undo');
  });
});
