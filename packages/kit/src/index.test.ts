import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HeadlessStudio } from './index';

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
});
