import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getFfmpegInfo, isFfmpegAvailable, resolveFfmpeg, runCommand, runCommandBuffer } from './ffmpeg';

const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

describe('ffmpeg resolution and process helpers', () => {
  let dir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'editbay-ffmpeg-test-'));
    originalEnv = process.env.EDITBAY_FFMPEG;
  });

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.EDITBAY_FFMPEG;
    else process.env.EDITBAY_FFMPEG = originalEnv;
    await rm(dir, { recursive: true, force: true });
  });

  it('prefers an explicit bundled directory', async () => {
    const bundledDir = path.join(dir, 'bundle');
    await mkdir(bundledDir, { recursive: true });
    const fake = path.join(bundledDir, executable);
    await writeFile(fake, 'fake');

    expect(resolveFfmpeg({ bundledDir })).toBe(fake);
  });

  it('honours EDITBAY_FFMPEG when no explicit bundle is given', async () => {
    const fake = path.join(dir, `ffmpeg-custom${path.extname(executable)}`);
    await writeFile(fake, 'fake');
    process.env.EDITBAY_FFMPEG = fake;

    expect(resolveFfmpeg()).toBe(fake);
  });

  it('prefers the explicit bundle over the environment', async () => {
    const bundledDir = path.join(dir, 'bundle');
    await mkdir(bundledDir, { recursive: true });
    const bundled = path.join(bundledDir, executable);
    await writeFile(bundled, 'fake');
    const fromEnv = path.join(dir, `ffmpeg-env${path.extname(executable)}`);
    await writeFile(fromEnv, 'fake');
    process.env.EDITBAY_FFMPEG = fromEnv;

    expect(resolveFfmpeg({ bundledDir })).toBe(bundled);
  });

  it('finds a working ffmpeg and reports its version', () => {
    expect(isFfmpegAvailable()).toBe(true);
    const info = getFfmpegInfo();
    expect(info.path.length).toBeGreaterThan(0);
    expect(info.version).toMatch(/^\d+\.\d+/);
    expect(['env', 'bundled', 'path']).toContain(info.source);
  });

  it('captures stdout, stderr and the exit code without a shell', async () => {
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write("out");process.stderr.write("err")']);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
  });

  it('captures binary stdout as a buffer', async () => {
    const result = await runCommandBuffer(process.execPath, ['-e', 'process.stdout.write(Buffer.from([1,2,3]))']);
    expect(result.code).toBe(0);
    expect([...result.stdout]).toEqual([1, 2, 3]);
  });

  it('times out long commands', async () => {
    await expect(
      runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 200 }),
    ).rejects.toThrow(/timed out/);
  });
});
