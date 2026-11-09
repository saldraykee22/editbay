import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FileSkillStore } from './skills';
import { stringifyFrontMatter } from './frontmatter';

let root: string;
let builtinDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'editbay-skills-'));
  builtinDir = path.join(root, 'builtins');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSkillFile(
  base: string,
  id: string,
  data: Record<string, string | number | boolean | string[]>,
  body: string,
): Promise<void> {
  const dir = path.join(base, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), stringifyFrontMatter(data, body), 'utf8');
}

describe('FileSkillStore', () => {
  it('saves a skill and reads it back with metadata', async () => {
    const store = new FileSkillStore({ root });
    const saved = await store.save({
      id: 'caption-style',
      name: 'Caption style',
      description: 'Short, punchy captions.',
      triggers: ['add captions', 'subtitles'],
      version: '1.2.0',
      body: '# Captions\n\nTwo lines max.',
    });

    expect(saved.id).toBe('caption-style');
    expect(saved.version).toBe('1.2.0');
    expect(saved.hasCode).toBe(false);

    const loaded = await store.get('caption-style');
    expect(loaded?.name).toBe('Caption style');
    expect(loaded?.body).toContain('Two lines max.');
    expect(loaded?.triggers).toEqual(['add captions', 'subtitles']);
  });

  it('detects a code folder', async () => {
    const store = new FileSkillStore({ root });
    await store.save({ id: 'with-code', name: 'With code', description: '', triggers: [], body: 'x' });
    await mkdir(path.join(root, 'skills', 'with-code', 'code'), { recursive: true });

    expect((await store.get('with-code'))?.hasCode).toBe(true);
  });

  it('returns null for a missing skill and empty list for a missing folder', async () => {
    const store = new FileSkillStore({ root });
    expect(await store.get('missing')).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it('scores exact triggers above description matches', async () => {
    const store = new FileSkillStore({ root });
    await store.save({
      id: 'captions',
      name: 'Captions',
      description: 'Add readable subtitles.',
      triggers: ['add captions'],
      body: 'caption body',
    });
    await store.save({
      id: 'interview-polish',
      name: 'Interview polish',
      description: 'Clean interview audio and jump cuts.',
      triggers: ['polish interview'],
      body: 'interview body',
    });

    const matched = await store.match('please add captions to the intro');
    expect(matched.map((skill) => skill.id)).toEqual(['captions']);
  });

  it('matches on description keywords too and respects limit', async () => {
    const store = new FileSkillStore({ root });
    await store.save({
      id: 'audio-clean',
      name: 'Audio clean',
      description: 'Remove background noise from dialogue.',
      triggers: ['noise'],
      body: '',
    });
    await store.save({
      id: 'audio-mix',
      name: 'Audio mix',
      description: 'Balance dialogue and music levels.',
      triggers: ['mix'],
      body: '',
    });

    const matched = await store.match('clean dialogue noise', 1);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.id).toBe('audio-clean');
  });

  it('loads builtin skills from the supplied directory', async () => {
    await writeSkillFile(
      builtinDir,
      'builtin-style',
      { id: 'builtin-style', name: 'Builtin style', description: 'Ships with the app', triggers: ['style'], builtin: true },
      'builtin body',
    );
    const store = new FileSkillStore({ root, builtinDir });

    const skill = await store.get('builtin-style');
    expect(skill?.builtin).toBe(true);
    expect(skill?.body).toBe('builtin body');
  });

  it('lets a user skill override a builtin with the same id', async () => {
    await writeSkillFile(
      builtinDir,
      'style',
      { id: 'style', name: 'Builtin', description: 'builtin', triggers: [], builtin: true },
      'builtin body',
    );
    const store = new FileSkillStore({ root, builtinDir });
    await store.save({ id: 'style', name: 'User', description: 'user', triggers: [], body: 'user body' });

    const list = await store.list();
    expect(list.filter((skill) => skill.id === 'style')).toHaveLength(1);
    expect((await store.get('style'))?.name).toBe('User');
  });

  it('throws a clear error for invalid front-matter', async () => {
    const store = new FileSkillStore({ root });
    const dir = path.join(root, 'skills', 'broken');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'SKILL.md'), '---\nnot a pair\n---\nbody', 'utf8');

    await expect(store.get('broken')).rejects.toThrow(/Invalid SKILL.md/);
    await expect(store.list()).rejects.toThrow(/Invalid SKILL.md/);
  });

  it('rejects unsafe skill ids on save', async () => {
    const store = new FileSkillStore({ root });
    await expect(
      store.save({ id: '../escape', name: 'x', description: '', triggers: [], body: '' }),
    ).rejects.toThrow(/Invalid skill id/);
  });
});
