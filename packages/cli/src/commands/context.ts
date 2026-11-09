/**
 * Shared plumbing for every command group: output streams, resolved paths,
 * studio construction and small formatting helpers.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadlessStudio } from '@editbay/kit';
import type { CliOptions } from '../args';

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface CliContext {
  io: CliIo;
  options: CliOptions;
  /** Absolute path of the project JSON file. */
  projectPath: string;
  /** Absolute workspace root (brands, memory, skills, history). */
  workspaceRoot: string;
  /** True when stdout must be a single JSON document. */
  json: boolean;
  quiet: boolean;
}

/** Error with an explicit process exit code; `run` turns it into a message. */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

const DEFAULT_PROJECT = 'editbay.json';
const DEFAULT_WORKSPACE = join(homedir(), '.editbay');
const BUILTIN_SKILLS_RELATIVE = join('apps', 'desktop', 'resources', 'skills');

function envPath(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function createContext(io: CliIo, options: CliOptions): CliContext {
  const projectPath = resolve(options.project ?? envPath('EDITBAY_PROJECT') ?? DEFAULT_PROJECT);
  const workspaceRoot = resolve(options.workspace ?? envPath('EDITBAY_WORKSPACE') ?? DEFAULT_WORKSPACE);
  return { io, options, projectPath, workspaceRoot, json: options.jsonOutput, quiet: options.quiet };
}

/**
 * Builtin skill directory: the explicit env override wins; otherwise walk up
 * from this module (works unbundled under src/ and bundled under dist/) and
 * then from the working directory, looking for the desktop resources folder.
 */
export function resolveBuiltinSkillsDir(): string | undefined {
  const fromEnv = envPath('EDITBAY_BUILTIN_SKILLS');
  if (fromEnv !== undefined) return resolve(fromEnv);

  const starts: string[] = [];
  try {
    starts.push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    // import.meta.url is always available in ESM; keep the cwd fallback anyway.
  }
  starts.push(process.cwd());

  for (const start of starts) {
    let dir = resolve(start);
    for (;;) {
      const candidate = join(dir, BUILTIN_SKILLS_RELATIVE);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

/** Opens (and, when missing, creates) the project through HeadlessStudio. */
export async function openStudio(ctx: CliContext): Promise<HeadlessStudio> {
  const builtinSkillsDir = resolveBuiltinSkillsDir();
  return HeadlessStudio.open({
    projectPath: ctx.projectPath,
    workspaceRoot: ctx.workspaceRoot,
    ...(builtinSkillsDir === undefined ? {} : { builtinSkillsDir }),
    ...(ctx.options.name === undefined ? {} : { name: ctx.options.name }),
  });
}

/** Prints a value as pretty JSON on stdout. */
export function writeJson(ctx: CliContext, value: unknown): void {
  ctx.io.out(`${JSON.stringify(value, null, 2)}\n`);
}

export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatCanvas(canvas: { width: number; height: number; fps: number }): string {
  return `${canvas.width}x${canvas.height}@${canvas.fps}fps`;
}

/** Comma separated list flag (`--triggers a,b`) to trimmed strings. */
export function splitList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export function parseIntegerFlag(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new CliError(`${flag} expects an integer, got "${value}"`);
  return parsed;
}

/** Counts clips/tracks once for summary and undo output. */
export function countClips(tracks: ReadonlyArray<{ clips: unknown[] }>): number {
  return tracks.reduce((total, track) => total + track.clips.length, 0);
}
