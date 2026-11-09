/**
 * FFmpeg binary discovery and process helpers.
 *
 * The engine never builds a shell string: every ffmpeg invocation is a
 * `spawn(command, args)` with an argv array, so paths with spaces or quotes on
 * Windows behave exactly like paths without them.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FfmpegInfo } from './types';

const EXECUTABLE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const PROBE_EXECUTABLE = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';

/** Repository root derived from this source file (`packages/engine/src`). */
export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Accept either a directory that contains ffmpeg or a direct binary path. */
function binaryIn(candidate: string, executable: string): string | undefined {
  if (isFile(candidate)) {
    const base = path.basename(candidate).toLowerCase();
    if (base === executable.toLowerCase()) return candidate;
    // A custom-named binary inside a bundled directory is still fine.
    if (base.startsWith('ffmpeg')) return candidate;
    return undefined;
  }
  const joined = path.join(candidate, executable);
  return isFile(joined) ? joined : undefined;
}

function findOnPath(executable: string): string | undefined {
  const raw = process.env.PATH ?? process.env.Path ?? '';
  for (const entry of raw.split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, executable);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function bundledCandidates(executable: string): string[] {
  const root = repoRoot();
  return [
    path.join(root, 'resources', executable),
    path.join(root, 'resources', 'ffmpeg', executable),
    path.join(root, 'resources', 'bin', executable),
    path.join(root, 'apps', 'desktop', 'resources', 'ffmpeg', executable),
  ];
}

export interface ResolveFfmpegOptions {
  /** Explicit bundled directory (or direct binary path) provided by the app. */
  bundledDir?: string;
}

/**
 * Resolve the ffmpeg binary. Order:
 *   1. explicit `opts.bundledDir`
 *   2. `EDITBAY_FFMPEG`
 *   3. `<repo>/resources/ffmpeg(.exe)` and a few known bundle locations
 *   4. the first `ffmpeg` found on PATH
 *   5. the bare name `ffmpeg` (spawn will produce a clear ENOENT)
 */
export function resolveFfmpeg(opts: ResolveFfmpegOptions = {}): string {
  if (opts.bundledDir) {
    const explicit = binaryIn(opts.bundledDir, EXECUTABLE);
    if (explicit) return explicit;
  }

  const fromEnv = process.env.EDITBAY_FFMPEG;
  if (fromEnv) {
    const resolved = binaryIn(fromEnv, EXECUTABLE);
    if (resolved) return resolved;
  }

  for (const candidate of bundledCandidates(EXECUTABLE)) {
    if (isFile(candidate)) return candidate;
  }

  return findOnPath(EXECUTABLE) ?? EXECUTABLE;
}

/** Sibling ffprobe resolution: same directory as ffmpeg first, then PATH. */
export function resolveFfprobe(opts: ResolveFfmpegOptions = {}): string {
  const fromEnv = process.env.EDITBAY_FFPROBE;
  if (fromEnv) {
    const resolved = binaryIn(fromEnv, PROBE_EXECUTABLE);
    if (resolved) return resolved;
  }

  const ffmpegPath = resolveFfmpeg(opts);
  if (path.isAbsolute(ffmpegPath)) {
    const sibling = path.join(path.dirname(ffmpegPath), PROBE_EXECUTABLE);
    if (isFile(sibling)) return sibling;
  }

  return findOnPath(PROBE_EXECUTABLE) ?? PROBE_EXECUTABLE;
}

/** Which discovery branch produced a path (for diagnostics in the UI). */
export function ffmpegSource(ffmpegPath: string): FfmpegInfo['source'] {
  const env = process.env.EDITBAY_FFMPEG;
  if (env && binaryIn(env, EXECUTABLE) === ffmpegPath) return 'env';
  const bundled = bundledCandidates(EXECUTABLE);
  if (bundled.some((candidate) => candidate === ffmpegPath) || ffmpegPath.includes(`${path.sep}resources${path.sep}`)) {
    return 'bundled';
  }
  return 'path';
}

function parseVersion(output: string): string {
  const match = /ffmpeg version\s+(\S+)/i.exec(output);
  return match?.[1] ?? 'unknown';
}

/** Synchronous info probe used at startup; `ffmpeg -version` is fast. */
export function getFfmpegInfo(opts: ResolveFfmpegOptions = {}): FfmpegInfo {
  const ffmpegPath = resolveFfmpeg(opts);
  const result = spawnSync(ffmpegPath, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const version = result.status === 0 ? parseVersion(stdout || stderr) : 'unknown';
  return { path: ffmpegPath, version, source: ffmpegSource(ffmpegPath) };
}

/** True when the resolved binary can be executed. */
export function isFfmpegAvailable(opts: ResolveFfmpegOptions = {}): boolean {
  const result = spawnSync(resolveFfmpeg(opts), ['-version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  return result.status === 0;
}

export interface RunCommandOptions {
  timeoutMs?: number;
  cwd?: string;
  signal?: AbortSignal;
}

export interface RunCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunCommandBufferResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function abortError(): Error {
  const error = new Error('Command aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Spawn a command with an argv array, capture stdout/stderr and enforce a
 * timeout (and optional AbortSignal). Resolves with the exit code; rejects only
 * on spawn failure, timeout or abort.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  opts: RunCommandOptions = {},
): Promise<RunCommandResult> {
  return runCommandInternal(command, args, opts).then((result) => ({
    code: result.code,
    stdout: result.stdout.toString('utf8'),
    stderr: result.stderr,
  }));
}

/** Same as `runCommand` but keeps binary stdout (frames, thumbnails). */
export function runCommandBuffer(
  command: string,
  args: readonly string[],
  opts: RunCommandOptions = {},
): Promise<RunCommandBufferResult> {
  return runCommandInternal(command, args, opts);
}

function runCommandInternal(
  command: string,
  args: readonly string[],
  opts: RunCommandOptions,
): Promise<RunCommandBufferResult> {
  return new Promise<RunCommandBufferResult>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(abortError());
      return;
    }

    const child = spawn(command, [...args], {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            finish(
              new Error(
                `Command timed out after ${timeoutMs}ms: ${path.basename(command)} ${args.join(' ')}`.slice(0, 2000),
              ),
            );
            child.kill('SIGKILL');
          }, timeoutMs)
        : undefined;

    const onAbort = (): void => {
      finish(abortError());
      child.kill('SIGKILL');
    };

    function cleanup(): void {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }

    function finish(error: Error | undefined, code?: number): void {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    }

    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', (error: Error) => finish(error));
    child.on('close', (code: number | null) => finish(undefined, code ?? -1));
  });
}
