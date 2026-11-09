import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HeadlessStudio } from './index';
import { resolveBuiltinSkillsDir } from './skills-path';

const root = resolve(import.meta.dirname, '..', '..', '..');
const builtinSkills = join(root, 'apps/desktop/resources/skills');
const workDir = mkdtempSync(join(tmpdir(), 'editbay-kit-'));
const mediaDir = join(workDir, 'media');
const clip = join(mediaDir, 'clip.mp4');
const music = join(mediaDir, 'music.mp3');
let hasFfmpeg = true;

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...args]);
}

beforeAll(() => {
  mkdirSync(mediaDir, { recursive: true });
  try {
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=420', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220', '-t', '4', '-c:a', 'libmp3lame', music]);
  } catch {
    hasFfmpeg = false;
  }
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

async function studio(dir: string): Promise<HeadlessStudio> {
  return HeadlessStudio.open({
    projectPath: join(dir, 'editbay.json'),
    workspaceRoot: join(dir, 'workspace'),
    builtinSkillsDir: builtinSkills,
    name: 'Kit test',
  });
}

describe('HeadlessStudio', () => {
  it('creates a project file on open and keeps the schema', async () => {
    const dir = join(workDir, 'create');
    mkdirSync(dir, { recursive: true });
    const instance = await studio(dir);
    expect(existsSync(join(dir, 'editbay.json'))).toBe(true);
    const raw = JSON.parse(readFileSync(join(dir, 'editbay.json'), 'utf8')) as { schemaVersion: number; tracks: unknown[] };
    expect(raw.schemaVersion).toBe(2);
    expect(raw.tracks).toHaveLength(4);
    expect(instance.durationMs).toBe(0);
  });

  it('imports media into clips and audio into the audio track', async () => {
    if (!hasFfmpeg) return;
    const dir = join(workDir, 'import');
    mkdirSync(dir, { recursive: true });
    const instance = await studio(dir);
    const imported = await instance.importMedia([clip, music]);
    expect(imported).toHaveLength(2);
    expect(imported[0]?.kind).toBe('video');
    expect(imported[0]?.clipId).toBeTruthy();
    expect(imported[1]?.kind).toBe('audio');
    const videoTrack = instance.project.tracks.find((track) => track.kind === 'video');
    const audioTrack = instance.project.tracks.find((track) => track.kind === 'audio');
    expect(videoTrack?.clips).toHaveLength(1);
    expect(audioTrack?.clips).toHaveLength(1);
    expect(instance.durationMs).toBeGreaterThan(2500);
  });

  it('applies commands, reports changes and persists them', async () => {
    if (!hasFfmpeg) return;
    const dir = join(workDir, 'apply');
    mkdirSync(dir, { recursive: true });
    const instance = await studio(dir);
    await instance.importMedia([clip]);
    const clipId = instance.project.tracks.find((track) => track.kind === 'video')?.clips[0]?.id;
    expect(clipId).toBeTruthy();
    const report = instance.apply([
      { op: 'trim_clip', clipId: clipId!, inMs: 0, outMs: 1200 },
      { op: 'add_text', text: 'Merhaba', startMs: 0, durationMs: 1000 },
    ]);
    expect(report.ok).toBe(true);
    expect(report.changes.length).toBeGreaterThan(0);
    await instance.flush();
    const reopened = await studio(dir);
    const saved = reopened.project.tracks.find((track) => track.kind === 'video')?.clips[0];
    expect(saved?.outMs).toBe(1200);
    expect(reopened.project.tracks.flatMap((track) => track.items)).toHaveLength(1);
  });

  it('rejects invalid commands without touching the project', async () => {
    const dir = join(workDir, 'invalid');
    mkdirSync(dir, { recursive: true });
    const instance = await studio(dir);
    const before = JSON.stringify(instance.project);
    const report = instance.apply([{ op: 'trim_clip', clipId: 'missing', outMs: 1000 }]);
    expect(report.ok).toBe(false);
    expect(JSON.stringify(instance.project)).toBe(before);
  });

  it('undo and redo round-trip', async () => {
    const dir = join(workDir, 'undo');
    mkdirSync(dir, { recursive: true });
    const instance = await studio(dir);
    instance.apply([{ op: 'set_project_name', name: 'First' }]);
    expect(instance.project.name).toBe('First');
    expect(await instance.undo()).toBe(true);
    expect(instance.project.name).toBe('Kit test');
    expect(await instance.redo()).toBe(true);
    expect(instance.project.name).toBe('First');
  });

  it('summary never leaks file paths', async () => {
    if (!hasFfmpeg) return;
    const dir = join(workDir, 'summary');
    mkdirSync(dir, { recursive: true });
    const instance = await studio(dir);
    await instance.importMedia([clip]);
    const summary = instance.summary();
    expect(summary).toContain('clip.mp4');
    expect(summary).not.toContain(workDir.replace(/\\/g, '\\\\'));
    expect(summary).not.toContain(':\\\\');
  });

  it('lists builtin skills and remembers facts', async () => {
    const dir = join(workDir, 'knowledge');
    mkdirSync(dir, { recursive: true });
    const instance = await studio(dir);
    const skills = await instance.listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(6);
    expect(skills.map((skill) => skill.id)).toContain('captions');
    const note = await instance.remember('Client tone', 'Never say game-changer.', ['brand']);
    expect(note.path).toContain('memory/');
    const found = await instance.searchMemory('game-changer');
    expect(found.some((entry) => entry.id === note.id)).toBe(true);
  });

  it('exposes the effect catalog', async () => {
    const dir = join(workDir, 'effects');
    mkdirSync(dir, { recursive: true });
    const instance = await studio(dir);
    const catalog = instance.effects();
    expect(catalog.effects.length).toBeGreaterThanOrEqual(10);
    expect(catalog.transitions.length).toBeGreaterThanOrEqual(5);
    expect(catalog.effects.some((effect) => effect.id === 'grade')).toBe(true);
  });

  it('serializes concurrent saves without throwing or leaking temp files', async () => {
    const dir = join(workDir, 'save-race');
    mkdirSync(dir, { recursive: true });
    const instance = await studio(dir);
    instance.apply([{ op: 'set_project_name', name: 'Race winner' }]);

    await expect(
      Promise.all([instance.save(), instance.save(), instance.save(), instance.save()]),
    ).resolves.toEqual([undefined, undefined, undefined, undefined]);

    const saved = JSON.parse(readFileSync(join(dir, 'editbay.json'), 'utf8')) as { name: string };
    expect(saved.name).toBe('Race winner');
    expect(readdirSync(dir).filter((name) => name.includes('.tmp'))).toHaveLength(0);
  });

  it('records one undo step per imported file (asset + clip)', async () => {
    if (!hasFfmpeg) return;
    const dir = join(workDir, 'import-undo');
    mkdirSync(dir, { recursive: true });
    const instance = await studio(dir);
    expect(instance.canUndo).toBe(false);

    await instance.importMedia([clip]);
    expect(instance.project.assets).toHaveLength(1);
    expect(instance.project.tracks.flatMap((track) => track.clips)).toHaveLength(1);
    expect(instance.canUndo).toBe(true);

    expect(await instance.undo()).toBe(true);
    expect(instance.project.assets).toHaveLength(0);
    expect(instance.project.tracks.flatMap((track) => track.clips)).toHaveLength(0);
    expect(instance.canUndo).toBe(false);
  });

  it('rejects brand ids that could escape the workspace', async () => {
    const dir = join(workDir, 'brand-traversal');
    mkdirSync(dir, { recursive: true });
    const instance = await studio(dir);
    for (const id of ['../../projects/current', '..', 'a/b', 'a\\b', '/abs']) {
      await expect(instance.brand(id)).rejects.toThrow(/Invalid brand id/);
      await expect(
        instance.saveBrand({ id, name: 'Bad', body: '', colors: [], fonts: [], updatedAt: '2026-01-01T00:00:00.000Z' }),
      ).rejects.toThrow(/Invalid brand id/);
    }
    // Nothing was written for the rejected ids.
    expect(existsSync(join(dir, 'workspace', 'brands'))).toBe(false);
  });
});

describe('resolveBuiltinSkillsDir', () => {
  it('prefers the explicit environment override', () => {
    const custom = join(workDir, 'custom-skills');
    mkdirSync(custom, { recursive: true });
    const resolved = resolveBuiltinSkillsDir({
      moduleDir: join(workDir, 'nowhere'),
      cwd: workDir,
      env: { EDITBAY_BUILTIN_SKILLS: custom },
    });
    expect(resolved).toBe(custom);
  });

  it('finds the bundled dist/skills copy next to the entry module', () => {
    const bundle = join(workDir, 'bundle');
    const skills = join(bundle, 'skills');
    mkdirSync(join(skills, 'captions'), { recursive: true });
    writeFileSync(join(skills, 'captions', 'SKILL.md'), '---\nid: captions\nname: Captions\n---\nBody\n', 'utf8');
    const resolved = resolveBuiltinSkillsDir({ moduleDir: bundle, cwd: workDir, env: {} });
    expect(resolved).toBe(skills);
  });

  it('ignores an empty skills folder and falls back to the repo resources', () => {
    const bundle = join(workDir, 'empty-bundle');
    mkdirSync(join(bundle, 'skills'), { recursive: true });
    // The temp tree has no repo layout above it, so an empty copy means "none".
    const resolved = resolveBuiltinSkillsDir({ moduleDir: bundle, cwd: bundle, env: {} });
    expect(resolved).toBeUndefined();
  });

  it('finds the repo resources from a source checkout', () => {
    const resolved = resolveBuiltinSkillsDir({ cwd: workDir, env: {} });
    expect(resolved).toBe(join(root, 'apps', 'desktop', 'resources', 'skills'));
  });
});
