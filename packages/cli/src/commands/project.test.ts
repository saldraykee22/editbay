import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateProject, type Project } from '@editbay/core';
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

describe('project commands', () => {
  let dir: string;
  let projectPath: string;
  let workspace: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'editbay-cli-project-'));
    projectPath = path.join(dir, 'editbay.json');
    workspace = path.join(dir, '.editbay');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('init writes a valid schema v2 project with the four standard tracks', async () => {
    const cap = capture();
    const code = await run(['init', '--project', projectPath, '--workspace', workspace, '--name', 'Demo'], cap.io);
    expect(code).toBe(0);

    const project = JSON.parse(await readFile(projectPath, 'utf8')) as Project;
    expect(project.schemaVersion).toBe(2);
    expect(project.name).toBe('Demo');
    expect(project.tracks).toHaveLength(4);
    expect(project.tracks.map((track) => track.kind)).toEqual(['video', 'overlay', 'text', 'audio']);
    expect(project.assets).toEqual([]);
    expect(validateProject(project)).toEqual([]);

    expect(cap.stdout()).toContain(projectPath);
    expect(cap.stdout()).toContain('1080x1920@30fps');
    expect((await stat(projectPath)).isFile()).toBe(true);
  });

  it('keeps an existing project when init runs again', async () => {
    await run(['init', '--project', projectPath, '--workspace', workspace], capture().io);
    const before = await readFile(projectPath, 'utf8');

    const cap = capture();
    expect(await run(['init', '--project', projectPath, '--workspace', workspace], cap.io)).toBe(0);
    expect(cap.stdout()).toContain('project:');
    expect(await readFile(projectPath, 'utf8')).toBe(before);
  });

  it('summary --json returns the documented shape', async () => {
    await run(['init', '--project', projectPath, '--workspace', workspace, '--name', 'Shape'], capture().io);

    const cap = capture();
    expect(await run(['summary', '--json', '--project', projectPath, '--workspace', workspace], cap.io)).toBe(0);

    const parsed = JSON.parse(cap.stdout()) as {
      name: string;
      canvas: string;
      durationMs: number;
      tracks: number;
      clips: number;
      assets: number;
      summary: string;
    };
    expect(parsed.name).toBe('Shape');
    expect(parsed.canvas).toBe('1080x1920@30fps');
    expect(parsed.durationMs).toBe(0);
    expect(parsed.tracks).toBe(4);
    expect(parsed.clips).toBe(0);
    expect(parsed.assets).toBe(0);
    expect(typeof parsed.summary).toBe('string');
    expect(JSON.parse(parsed.summary)).toMatchObject({ project: 'Shape' });
    expect(cap.stderr()).toBe('');
  });

  it('summary prints the project name and summary text in human mode', async () => {
    await run(['init', '--project', projectPath, '--workspace', workspace, '--name', 'Human'], capture().io);
    const cap = capture();
    expect(await run(['summary', '--project', projectPath, '--workspace', workspace], cap.io)).toBe(0);
    expect(cap.stdout()).toContain('name      Human');
    expect(cap.stdout()).toContain('summary   {');
    expect(cap.stdout()).toContain('tracks    4');
  });

  it('keeps absolute media paths out of the summary string', async () => {
    await run(['init', '--project', projectPath, '--workspace', workspace], capture().io);
    const project = JSON.parse(await readFile(projectPath, 'utf8')) as Project;
    const mediaPath = path.join(dir, 'private', 'clip.mp4');
    project.assets.push({
      id: 'a_secret',
      kind: 'video',
      uri: mediaPath,
      label: 'clip.mp4',
      durationMs: 1000,
    });
    await writeFile(projectPath, JSON.stringify(project), 'utf8');

    const cap = capture();
    expect(await run(['summary', '--json', '--project', projectPath, '--workspace', workspace], cap.io)).toBe(0);
    const parsed = JSON.parse(cap.stdout()) as { assets: number; summary: string };
    expect(parsed.assets).toBe(1);
    expect(parsed.summary).toContain('clip.mp4');
    expect(parsed.summary).not.toContain(dir);
    expect(parsed.summary).not.toContain(mediaPath);
    expect(parsed.summary).not.toContain('private');
  });

  it('auto-creates a missing project for commands other than init', async () => {
    const cap = capture();
    expect(await run(['summary', '--json', '--project', projectPath, '--workspace', workspace], cap.io)).toBe(0);
    const project = JSON.parse(await readFile(projectPath, 'utf8')) as Project;
    expect(project.schemaVersion).toBe(2);
    expect(project.tracks).toHaveLength(4);
  });
});
