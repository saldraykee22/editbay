/**
 * Frame extraction helpers (data URLs for the UI, thumbnails on disk).
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isFfmpegAvailable, resolveFfmpeg, runCommandBuffer, runCommand } from './ffmpeg';
import type { ThumbnailOptions } from './types';

function evenWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 480;
  return Math.max(16, Math.round(width / 2) * 2);
}

function seconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

async function extractJpeg(filePath: string, atMs: number, scaleFilter: string): Promise<Buffer> {
  const ffmpeg = resolveFfmpeg();
  const result = await runCommandBuffer(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-ss',
      seconds(atMs),
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-an',
      '-vf',
      scaleFilter,
      '-f',
      'image2pipe',
      '-c:v',
      'mjpeg',
      '-q:v',
      '3',
      'pipe:1',
    ],
    { timeoutMs: 30_000 },
  );

  if (result.code !== 0) {
    throw new Error(`Frame extraction failed for ${filePath}: ${result.stderr.trim() || 'unknown ffmpeg error'}`);
  }
  if (result.stdout.length === 0) {
    throw new Error(`Frame extraction returned no data for ${filePath} at ${atMs}ms`);
  }
  return result.stdout;
}

/**
 * Extract a single frame as a JPEG data URL. Safe to drop straight into an
 * `<img src>` in the renderer.
 */
export async function extractFrameDataUrl(filePath: string, atMs: number, width = 480): Promise<string> {
  if (!isFfmpegAvailable()) throw new Error('ffmpeg is not available');
  const jpeg = await extractJpeg(filePath, atMs, `scale=${evenWidth(width)}:-2`);
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/**
 * Write a thumbnail JPEG to disk. Both `width` and `height` keep the aspect
 * ratio inside the box; a single dimension scales proportionally.
 */
export async function makeThumbnail(filePath: string, outPath: string, opts: ThumbnailOptions = {}): Promise<void> {
  const atMs = Math.max(0, opts.atMs ?? 0);
  const scaleFilter =
    opts.width && opts.height
      ? `scale=${evenWidth(opts.width)}:${evenWidth(opts.height)}:force_original_aspect_ratio=decrease`
      : opts.height
        ? `scale=-2:${evenWidth(opts.height)}`
        : `scale=${evenWidth(opts.width ?? 480)}:-2`;

  await mkdir(path.dirname(outPath), { recursive: true });
  const ffmpeg = resolveFfmpeg();
  const result = await runCommand(
    ffmpeg,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-ss',
      seconds(atMs),
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-an',
      '-vf',
      scaleFilter,
      '-q:v',
      '3',
      outPath,
    ],
    { timeoutMs: 30_000 },
  );

  if (result.code !== 0) {
    throw new Error(`Thumbnail failed for ${filePath}: ${result.stderr.trim() || 'unknown ffmpeg error'}`);
  }
}
