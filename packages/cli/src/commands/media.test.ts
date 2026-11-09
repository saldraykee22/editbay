import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '@editbay/core';
import { isFfmpegAvailable, resolveFfmpeg, runCommand } from '@editbay/engine';
import { HeadlessStudio } from '@editbay/kit';
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

interface ImportEntry {
  assetId: string;
  clipId: string;
  label: string;
  kind: string;
  durationMs: number;
  path: string;
}

const ffmpegAvailable = isFfmpegAvailable();
const suite = ffmpegAvailable ? describe : describe.skip;

suite('media commands', () => {
  let fixtureDir: string;
  let videoPath: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(path.join(tmpdir(), 'editbay-cli-media-'));
    videoPath = path.join(fixtureDir, 'clip.mp4');
    const result = await runCommand(resolveFfmpeg(), [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=320x240:r=30:d=1',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      videoPath,
    ]);
    if (result.code !== 0) throw new Error(`fixture generation failed: ${result.stderr}`);
  });

  afterAll(async () => {
    if (fixtureDir !== undefined) await rm(fixtureDir, { recursive: true, force: true });
  });

  let dir: string;
  let projectPath: string;
  let workspace: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'editbay-cli-media-project-'));
    projectPath = path.join(dir, 'editbay.json');
    workspace = path.join(dir, '.editbay');
    await run(['init', '--project', projectPath, '--workspace', workspace], capture().io);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function importFirst(): Promise<ImportEntry> {
    const cap = capture();
    const code = await run(
      ['import', videoPath, '--json', '--project', projectPath, '--workspace', workspace],
      cap.io,
    );
    expect(code).toBe(0);
    const entries = JSON.parse(cap.stdout()) as ImportEntry[];
    const first = entries[0];
    if (first === undefined) throw new Error('import returned no entries');
    return first;
  }

  it('import registers an asset and clip and persists them', async () => {
    const cap = capture();
    const code = await run(
      ['import', videoPath, '--json', '--project', projectPath, '--workspace', workspace],
      cap.io,
    );
    expect(code).toBe(0);

    const entries = JSON.parse(cap.stdout()) as ImportEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe(videoPath);
    expect(entries[0]?.kind).toBe('video');
    expect(entries[0]?.durationMs).toBeGreaterThan(500);
    expect(entries[0]?.clipId).toMatch(/^c_/);

    const studio = await HeadlessStudio.open({ projectPath, workspaceRoot: workspace });
    const project = studio.project;
    expect(project.assets).toHaveLength(1);
    expect(project.assets[0]?.id).toBe(entries[0]?.assetId);
    const videoTrack = project.tracks.find((track) => track.kind === 'video');
    expect(videoTrack?.clips).toHaveLength(1);
    expect(videoTrack?.clips[0]?.outMs).toBeGreaterThan(0);
  });

  it('import accepts several positionals in one call', async () => {
    const cap = capture();
    expect(
      await run(
        ['import', videoPath, videoPath, '--json', '--project', projectPath, '--workspace', workspace],
        cap.io,
      ),
    ).toBe(0);
    const entries = JSON.parse(cap.stdout()) as ImportEntry[];
    expect(entries).toHaveLength(2);
    expect(entries[0]?.assetId).not.toBe(entries[1]?.assetId);

    const project = JSON.parse(await readFile(projectPath, 'utf8')) as Project;
    const clips = project.tracks.reduce((total, track) => total + track.clips.length, 0);
    expect(clips).toBe(2);
  });

  it('import prints human output with asset and clip ids', async () => {
    const cap = capture();
    expect(
      await run(['import', videoPath, '--project', projectPath, '--workspace', workspace], cap.io),
    ).toBe(0);
    expect(cap.stdout()).toContain('imported 1 file');
    expect(cap.stdout()).toContain('asset');
    expect(cap.stdout()).toContain('clip');
    expect(cap.stdout()).toContain(videoPath);
  });

  it('apply trims a clip and saves the change', async () => {
    const imported = await importFirst();
    const cap = capture();
    const commands = JSON.stringify([{ op: 'trim_clip', clipId: imported.clipId, outMs: 600 }]);
    expect(
      await run(['apply', '--json', commands, '--project', projectPath, '--workspace', workspace], cap.io),
    ).toBe(0);
    expect(cap.stdout()).toContain('ok    trim_clip');

    const onDisk = JSON.parse(await readFile(projectPath, 'utf8')) as Project;
    const clip = onDisk.tracks.flatMap((track) => track.clips).find((entry) => entry.id === imported.clipId);
    expect(clip?.outMs).toBe(600);

    const studio = await HeadlessStudio.open({ projectPath, workspaceRoot: workspace });
    const reopened = studio.project.tracks
      .flatMap((track) => track.clips)
      .find((entry) => entry.id === imported.clipId);
    expect(reopened?.outMs).toBe(600);
  });

  it('summary --json reports the imported clip without absolute paths', async () => {
    await importFirst();
    const cap = capture();
    expect(
      await run(['summary', '--json', '--project', projectPath, '--workspace', workspace], cap.io),
    ).toBe(0);
    const parsed = JSON.parse(cap.stdout()) as {
      assets: number;
      clips: number;
      durationMs: number;
      summary: string;
    };
    expect(parsed.assets).toBe(1);
    expect(parsed.clips).toBe(1);
    expect(parsed.durationMs).toBeGreaterThan(500);
    expect(parsed.summary).toContain('clip.mp4');
    expect(parsed.summary).not.toContain(fixtureDir);
    expect(parsed.summary).not.toContain(dir);
  });

  it('probe returns duration and dimensions', async () => {
    const jsonCap = capture();
    expect(
      await run(['probe', videoPath, '--json', '--project', projectPath, '--workspace', workspace], jsonCap.io),
    ).toBe(0);
    const probe = JSON.parse(jsonCap.stdout()) as {
      durationMs: number;
      width?: number;
      height?: number;
      hasAudio: boolean;
    };
    expect(probe.durationMs).toBeGreaterThan(500);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
    expect(probe.hasAudio).toBe(false);

    const humanCap = capture();
    expect(
      await run(['probe', videoPath, '--project', projectPath, '--workspace', workspace], humanCap.io),
    ).toBe(0);
    expect(humanCap.stdout()).toContain('320x240');
    expect(humanCap.stdout()).toContain('duration');
  });
});
