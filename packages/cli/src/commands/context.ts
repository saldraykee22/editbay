/**
 * Shared plumbing for every command group: output streams, resolved paths,
 * studio construction and small formatting helpers.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { HeadlessStudio, resolveBuiltinSkillsDir as findBuiltinSkillsDir } from '@editbay/kit';
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
 * Builtin skill directory shared with the MCP server: the explicit env
 * override wins, then the `skills` copy bundled next to this entry point
 * (`dist/skills`), then the repo `apps/desktop/resources/skills` layout.
 */
export function resolveBuiltinSkillsDir(): string | undefined {
  return findBuiltinSkillsDir();
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
