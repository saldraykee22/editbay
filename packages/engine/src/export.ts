/**
 * Project export: plan -> temp file -> ffmpeg -> atomic rename.
 *
 * `-progress pipe:1` gives machine-readable key/value lines on stdout
 * (`out_time_ms` is microseconds, despite the name), which map to
 * `ExportProgress`. Nothing is written to the final path until ffmpeg exits
 * cleanly, so an abort or crash never leaves a half-playable mp4 behind.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Project } from '@editbay/core';
import { resolveFfmpeg } from './ffmpeg';
import { buildRenderPlan, normalizeAssetPath } from './plan';
import { probeMedia } from './probe';
import type { ExportOptions, ExportProgress, ExportResult } from './types';

export interface ExportProjectOptions extends ExportOptions {
  /** Explicit bundled ffmpeg directory (or binary path). */
  bundledDir?: string;
  /** Override the drawtext font. */
  fontPath?: string;
  /** Parent directory for temporary drawtext files. */
  textFileDir?: string;
  /** Pin the H.264 encoder instead of probing `ffmpeg -encoders`. */
  videoEncoder?: string;
}

function abortError(): Error {
  const error = new Error('Export aborted');
  error.name = 'AbortError';
  return error;
}

const RETRYABLE_RM_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES']);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Windows releases file handles asynchronously after a killed process exits, so
 * an immediate `rm` can fail with EBUSY/EPERM. Retry briefly before giving up.
 */
export async function removeWithRetry(target: string, opts: { recursive?: boolean } = {}): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(target, { force: true, recursive: opts.recursive ?? false });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === undefined || !RETRYABLE_RM_CODES.has(code)) return;
      if (attempt === 4) return;
      await delay(40 * (attempt + 1));
    }
  }
}

/** `rename` within a volume, `copyFile` + `rm` across volumes (Windows EXDEV). */
async function moveIntoPlace(tempPath: string, outPath: string): Promise<void> {
  try {
    await rename(tempPath, outPath);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error;
  }
  await copyFile(tempPath, outPath);
  await removeWithRetry(tempPath);
}

/** Fill `hasAudio` for assets the project never probed (pure plan stays pure). */
async function withProbedAssets(project: Project, assetPaths: Record<string, string>): Promise<Project> {
  const targets = project.assets.filter(
    (asset) => asset.hasAudio === undefined && asset.kind !== 'image' && (assetPaths[asset.id] ?? asset.uri),
  );
  if (targets.length === 0) return project;

  const probed = new Map<string, boolean>();
  await Promise.all(
    targets.map(async (asset) => {
      const raw = assetPaths[asset.id] ?? asset.uri;
      try {
        const result = await probeMedia(normalizeAssetPath(raw));
        probed.set(asset.id, result.hasAudio);
      } catch {
        // Unreadable asset stays unknown; the exporter then omits its audio.
      }
    }),
  );

  if (probed.size === 0) return project;
  return {
    ...project,
    assets: project.assets.map((asset) =>
      probed.has(asset.id) ? { ...asset, hasAudio: probed.get(asset.id) } : asset,
    ),
  };
}

interface ProgressValues {
  [key: string]: string;
}

function createProgressParser(
  durationMs: number,
  onProgress: ((progress: ExportProgress) => void) | undefined,
): (line: string) => void {
  const state: ProgressValues = {};
  let lastEmittedOutMs = -1;

  const report = (values: ProgressValues): void => {
    if (!onProgress) return;
    const micros = Number(values.out_time_us ?? values.out_time_ms);
    const outTimeMs = Number.isFinite(micros) ? Math.round(micros / 1000) : undefined;
    if (outTimeMs !== undefined) {
      if (outTimeMs === lastEmittedOutMs) return;
      lastEmittedOutMs = outTimeMs;
    }

    const durationSec = Math.max(0.001, durationMs / 1000);
    const fraction =
      outTimeMs === undefined ? 0 : Math.min(1, Math.max(0, outTimeMs / 1000 / durationSec));
    const frame = Number(values.frame);
    const fps = Number(values.fps);

    const progress: ExportProgress = {
      fraction,
      ...(Number.isFinite(frame) ? { frame } : {}),
      ...(Number.isFinite(fps) ? { fps } : {}),
      ...(values.speed ? { speed: values.speed } : {}),
      ...(outTimeMs !== undefined ? { outTimeMs } : {}),
    };
    try {
      onProgress(progress);
    } catch {
      // A throwing progress listener must never kill the export.
    }
  };

  return (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) return;
    const key = trimmed.slice(0, equals);
    const value = trimmed.slice(equals + 1);
    if (key === 'progress') {
      if (value === 'end') report({ ...state, out_time_us: String(durationMs * 1000) });
      return;
    }
    state[key] = value;
    if (key === 'out_time_ms' || key === 'out_time_us') report(state);
  };
}

/**
 * Render a project to an mp4. Resolves once the file is fully written and
 * renamed into place; rejects (after cleaning up) on ffmpeg failure or abort.
 */
export async function exportProject(project: Project, options: ExportProjectOptions): Promise<ExportResult> {
  const startedAt = Date.now();
  const outPath = options.outPath;
  if (!outPath) throw new Error('Export requires an output path');

  await mkdir(path.dirname(outPath), { recursive: true });
  // Temp output lives in the OS temp dir: an aborted Windows export can leave a
  // locked file behind, and it must never land in the user's output folder.
  const tempOut = path.join(tmpdir(), `editbay-export-${randomBytes(6).toString('hex')}.mp4`);
  const textRoot = options.textFileDir ?? tmpdir();
  await mkdir(textRoot, { recursive: true });
  const textFileDir = await mkdtemp(path.join(textRoot, 'editbay-export-'));
  const ffmpeg = resolveFfmpeg({ bundledDir: options.bundledDir });

  let child: ReturnType<typeof spawn> | undefined;
  let aborted = false;
  const onAbort = (): void => {
    aborted = true;
    child?.kill('SIGKILL');
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    if (options.signal?.aborted) throw abortError();

    const enriched = await withProbedAssets(project, options.assetPaths);
    const plan = buildRenderPlan(enriched, {
      assetPaths: options.assetPaths,
      quality: options.quality,
      outPath: tempOut,
      textFileDir,
      fontPath: options.fontPath,
      videoEncoder: options.videoEncoder,
    });

    await Promise.all(
      plan.textFiles.map((textFile) => writeFile(textFile.path, textFile.content, 'utf8')),
    );

    if (aborted || options.signal?.aborted) throw abortError();

    await new Promise<void>((resolve, reject) => {
      const parser = createProgressParser(plan.durationMs, options.onProgress);
      const stderrChunks: string[] = [];
      const proc = spawn(ffmpeg, plan.args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child = proc;
      if (aborted) proc.kill('SIGKILL');

      let stdoutBuffer = '';
      proc.stdout?.setEncoding('utf8');
      proc.stdout?.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) parser(line);
      });

      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (chunk: string) => {
        stderrChunks.push(chunk);
        const total = stderrChunks.reduce((sum, entry) => sum + entry.length, 0);
        if (total > 16_000) stderrChunks.splice(0, stderrChunks.length - 1);
      });

      proc.on('error', (error: Error) => {
        reject(new Error(`Failed to start ffmpeg (${ffmpeg}): ${error.message}`));
      });

      proc.on('close', (code: number | null) => {
        if (stdoutBuffer.trim()) parser(stdoutBuffer);
        if (aborted || options.signal?.aborted) {
          reject(abortError());
          return;
        }
        if (code !== 0) {
          const tail = stderrChunks.join('').trim().slice(-2000);
          reject(new Error(`ffmpeg exited with code ${code ?? 'null'}${tail ? `: ${tail}` : ''}`));
          return;
        }
        resolve();
      });
    });

    if (aborted || options.signal?.aborted) throw abortError();

    await moveIntoPlace(tempOut, outPath);
    const info = await stat(outPath);
    return {
      outPath,
      durationMs: plan.durationMs,
      sizeBytes: info.size,
      elapsedMs: Date.now() - startedAt,
      videoEncoder: plan.videoEncoder,
    };
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    await removeWithRetry(tempOut);
    await removeWithRetry(textFileDir, { recursive: true });
  }
}
