import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const builtinSkills = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/desktop/resources/skills',
);

describe('workspace commands', () => {
  let dir: string;
  let projectPath: string;
  let workspace: string;
  let previousBuiltin: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'editbay-cli-knowledge-'));
    projectPath = path.join(dir, 'editbay.json');
    workspace = path.join(dir, '.editbay');
    previousBuiltin = process.env.EDITBAY_BUILTIN_SKILLS;
    process.env.EDITBAY_BUILTIN_SKILLS = builtinSkills;
  });

  afterEach(async () => {
    if (previousBuiltin === undefined) delete process.env.EDITBAY_BUILTIN_SKILLS;
    else process.env.EDITBAY_BUILTIN_SKILLS = previousBuiltin;
    await rm(dir, { recursive: true, force: true });
  });

  const baseArgs = (): string[] => ['--project', projectPath, '--workspace', workspace];

  it('skills list includes a builtin skill', async () => {
    expect(existsSync(builtinSkills)).toBe(true);
    const cap = capture();
    expect(await run(['skills', 'list', '--json', ...baseArgs()], cap.io)).toBe(0);
    const skills = JSON.parse(cap.stdout()) as Array<{ id: string; builtin: boolean }>;
    expect(skills.length).toBeGreaterThanOrEqual(5);
    const captions = skills.find((skill) => skill.id === 'captions');
    expect(captions).toBeDefined();
    expect(captions?.builtin).toBe(true);
    expect(cap.stderr()).toBe('');
  });

  it('skills add then show round-trips the saved skill', async () => {
    const addCap = capture();
    expect(
      await run(
        [
          'skills',
          'add',
          'demo-skill',
          '--name',
          'Demo skill',
          '--description',
          'A test skill',
          '--triggers',
          'demo,test',
          '--body',
          'Keep cuts short.',
          ...baseArgs(),
        ],
        addCap.io,
      ),
    ).toBe(0);

    const skillFile = path.join(workspace, 'skills', 'demo-skill', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);
    expect(addCap.stdout()).toContain('saved skill: demo-skill');

    const showCap = capture();
    expect(await run(['skills', 'show', 'demo-skill', '--json', ...baseArgs()], showCap.io)).toBe(0);
    const skill = JSON.parse(showCap.stdout()) as {
      id: string;
      name: string;
      description: string;
      triggers: string[];
      body: string;
      builtin: boolean;
      path: string;
    };
    expect(skill.id).toBe('demo-skill');
    expect(skill.name).toBe('Demo skill');
    expect(skill.description).toBe('A test skill');
    expect(skill.triggers).toEqual(['demo', 'test']);
    expect(skill.body.trim()).toBe('Keep cuts short.');
    expect(skill.builtin).toBe(false);
    expect(skill.path).toBe(skillFile);
  });

  it('skills show fails for an unknown id', async () => {
    const cap = capture();
    expect(await run(['skills', 'show', 'nope', ...baseArgs()], cap.io)).toBe(1);
    expect(cap.stderr()).toContain('Skill not found: nope');
  });

  it('memory remember then search finds the note', async () => {
    const rememberCap = capture();
    expect(
      await run(
        [
          'memory',
          'remember',
          'Brand voice',
          '--body',
          'Warm, direct and never salesy.',
          '--tags',
          'tone,brand',
          '--json',
          ...baseArgs(),
        ],
        rememberCap.io,
      ),
    ).toBe(0);
    const remembered = JSON.parse(rememberCap.stdout()) as { id: string; title: string; path: string };
    expect(remembered.title).toBe('Brand voice');
    expect(path.isAbsolute(remembered.path)).toBe(true);
    expect(existsSync(remembered.path)).toBe(true);
    expect(remembered.path.startsWith(workspace)).toBe(true);

    const searchCap = capture();
    expect(await run(['memory', 'search', 'warm', '--limit', '5', '--json', ...baseArgs()], searchCap.io)).toBe(0);
    const entries = JSON.parse(searchCap.stdout()) as Array<{ id: string; title: string; path: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(remembered.id);
    expect(entries[0]?.title).toBe('Brand voice');
    expect(path.isAbsolute(entries[0]?.path ?? '')).toBe(true);
  });

  it('memory remember without a body fails cleanly', async () => {
    const cap = capture();
    expect(await run(['memory', 'remember', 'No body', ...baseArgs()], cap.io)).toBe(1);
    expect(cap.stderr()).toContain('--body');
  });

  it('memory search accepts a multi-word query', async () => {
    await run(['memory', 'remember', 'Cut rhythm', '--body', 'Fast cuts on the hook.', ...baseArgs()], capture().io);
    const cap = capture();
    expect(await run(['memory', 'search', 'fast', 'cuts', '--json', ...baseArgs()], cap.io)).toBe(0);
    const entries = JSON.parse(cap.stdout()) as Array<{ title: string }>;
    expect(entries.some((entry) => entry.title === 'Cut rhythm')).toBe(true);
  });

  it('brands list is empty and unknown brands fail', async () => {
    const listCap = capture();
    expect(await run(['brands', 'list', '--json', ...baseArgs()], listCap.io)).toBe(0);
    expect(JSON.parse(listCap.stdout())).toEqual([]);

    const showCap = capture();
    expect(await run(['brands', 'show', 'acme', ...baseArgs()], showCap.io)).toBe(1);
    expect(showCap.stderr()).toContain('Brand not found: acme');
  });

  it('reads a skill body from a file', async () => {
    const bodyFile = path.join(dir, 'body.md');
    await writeFile(bodyFile, '# Instructions\n\nUse the brand palette.\n', 'utf8');
    expect(
      await run(['skills', 'add', 'file-skill', '--body-file', bodyFile, ...baseArgs()], capture().io),
    ).toBe(0);

    const showCap = capture();
    expect(await run(['skills', 'show', 'file-skill', '--json', ...baseArgs()], showCap.io)).toBe(0);
    const shown = JSON.parse(showCap.stdout()) as { body: string };
    expect(shown.body).toContain('Use the brand palette.');
    expect(await readFile(path.join(workspace, 'skills', 'file-skill', 'SKILL.md'), 'utf8')).toContain('file-skill');
  });
});
