import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isFfmpegAvailable, resolveFfmpeg, runCommand } from '@editbay/engine';
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

const ffmpegAvailable = isFfmpegAvailable();
const suite = ffmpegAvailable ? describe : describe.skip;

suite('export command', () => {
  let fixtureDir: string;
  let videoPath: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(path.join(tmpdir(), 'editbay-cli-export-media-'));
    videoPath = path.join(fixtureDir, 'clip.mp4');
    const result = await runCommand(resolveFfmpeg(), [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=teal:s=320x240:r=30:d=1',
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
    dir = await mkdtemp(path.join(tmpdir(), 'editbay-cli-export-'));
    projectPath = path.join(dir, 'editbay.json');
    workspace = path.join(dir, '.editbay');
    const baseArgs = ['--project', projectPath, '--workspace', workspace];
    await run(['init', ...baseArgs], capture().io);
    await run(['import', videoPath, ...baseArgs], capture().io);
    await run(
      ['apply', '--json', JSON.stringify([{ op: 'set_canvas', width: 320, height: 240, fps: 30 }]), ...baseArgs],
      capture().io,
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const baseArgs = (): string[] => ['--project', projectPath, '--workspace', workspace];

  it('renders the project, reports progress on stderr and prints the result', async () => {
    const outPath = path.join(dir, 'out.mp4');
    const cap = capture();
    expect(await run(['export', outPath, '--quality', 'draft', '--json', ...baseArgs()], cap.io)).toBe(0);

    const report = JSON.parse(cap.stdout()) as {
      path: string;
      sizeBytes: number;
      durationMs: number;
      elapsedMs: number;
    };
    expect(report.path).toBe(outPath);
    expect(path.isAbsolute(report.path)).toBe(true);
    expect(report.sizeBytes).toBeGreaterThan(0);
    expect(report.durationMs).toBeGreaterThan(400);
    expect(report.elapsedMs).toBeGreaterThan(0);
    expect(existsSync(outPath)).toBe(true);
    expect(cap.stderr()).toMatch(/export \d+%/);
  });

  it('suppresses progress with --quiet but still prints the path', async () => {
    const outPath = path.join(dir, 'quiet.mp4');
    const cap = capture();
    expect(await run(['export', outPath, '--quality', 'draft', '--quiet', ...baseArgs()], cap.io)).toBe(0);
    expect(cap.stderr()).toBe('');
    expect(cap.stdout()).toContain(outPath);
    expect(existsSync(outPath)).toBe(true);
  });

  it('rejects an unknown quality before touching ffmpeg', async () => {
    const cap = capture();
    expect(await run(['export', path.join(dir, 'x.mp4'), '--quality', 'ultra', ...baseArgs()], cap.io)).toBe(1);
    expect(cap.stderr()).toContain('--quality must be');
  });

  it('exits 3 when ffmpeg cannot render the timeline', async () => {
    const gonePath = path.join(dir, 'gone.mp4');
    await copyFile(videoPath, gonePath);
    await run(['import', gonePath, ...baseArgs()], capture().io);
    await rm(gonePath, { force: true });

    const cap = capture();
    expect(await run(['export', path.join(dir, 'failed.mp4'), '--quality', 'draft', ...baseArgs()], cap.io)).toBe(3);
    expect(cap.stderr()).toContain('export failed');
  });
});
