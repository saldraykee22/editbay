/**
 * `apply`, `undo` and `redo`.
 *
 * Edit history is a small journal in `<workspace>/history/` keyed by the
 * absolute project path, so undo/redo survive between CLI invocations (a CLI
 * process is one-shot, so the studio session's in-memory stack is not enough).
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { timelineDurationMs } from '@editbay/core';
import type { AgentCommand, Project } from '@editbay/core';
import {
  CliError,
  countClips,
  formatDuration,
  openStudio,
  writeJson,
  type CliContext,
} from './context';

interface HistoryJournal {
  version: 1;
  projectPath: string;
  undo: string[];
  redo: string[];
}

const HISTORY_LIMIT = 50;

function journalPath(ctx: CliContext): string {
  const key = createHash('sha256').update(ctx.projectPath).digest('hex').slice(0, 16);
  return join(ctx.workspaceRoot, 'history', `${key}.json`);
}

function emptyJournal(ctx: CliContext): HistoryJournal {
  return { version: 1, projectPath: ctx.projectPath, undo: [], redo: [] };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

async function loadJournal(ctx: CliContext): Promise<HistoryJournal> {
  let raw: string;
  try {
    raw = await fs.readFile(journalPath(ctx), 'utf8');
  } catch (error) {
    if (isNotFound(error)) return emptyJournal(ctx);
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && isStringArray(parsed.undo) && isStringArray(parsed.redo)) {
      return { version: 1, projectPath: ctx.projectPath, undo: parsed.undo, redo: parsed.redo };
    }
  } catch {
    // A corrupt journal is treated as empty; the project file stays the truth.
  }
  return emptyJournal(ctx);
}

async function saveJournal(ctx: CliContext, journal: HistoryJournal): Promise<void> {
  const file = journalPath(ctx);
  await fs.mkdir(dirname(file), { recursive: true });
  // A unique temp name keeps two concurrent CLI processes from colliding.
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(journal), 'utf8');
  await fs.rename(temp, file);
}

/** Snapshot of the project *before* a mutation; clears the redo branch. */
export async function recordHistory(ctx: CliContext, project: Project): Promise<void> {
  const journal = await loadJournal(ctx);
  journal.undo.push(JSON.stringify(project));
  if (journal.undo.length > HISTORY_LIMIT) journal.undo.splice(0, journal.undo.length - HISTORY_LIMIT);
  journal.redo = [];
  await saveJournal(ctx, journal);
}

/** Writes a snapshot back as the project file (atomic replace). */
async function writeSnapshot(ctx: CliContext, snapshot: string): Promise<void> {
  await fs.mkdir(dirname(ctx.projectPath), { recursive: true });
  const temp = `${ctx.projectPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, snapshot, 'utf8');
  await fs.rename(temp, ctx.projectPath);
}

function printProjectState(ctx: CliContext, action: string, project: Project): void {
  const durationMs = timelineDurationMs(project);
  const clips = countClips(project.tracks);
  if (ctx.json) {
    writeJson(ctx, {
      ok: true,
      action,
      path: ctx.projectPath,
      name: project.name,
      durationMs,
      tracks: project.tracks.length,
      clips,
    });
    return;
  }
  ctx.io.out(`${action}: ${project.name}\n`);
  ctx.io.out(`  path      ${ctx.projectPath}\n`);
  ctx.io.out(`  duration  ${formatDuration(durationMs)}\n`);
  ctx.io.out(`  tracks    ${project.tracks.length}  clips ${clips}\n`);
}

async function readCommands(ctx: CliContext): Promise<AgentCommand[]> {
  let raw: string | undefined = ctx.options.payload;
  if (raw === undefined) {
    const file = ctx.options.file;
    if (file === undefined) {
      throw new CliError("apply needs --json '<commands-array>' or --file <path.json>");
    }
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(`Could not read ${file}: ${message}`);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Invalid JSON: ${message}`);
  }

  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.commands)
      ? parsed.commands
      : null;
  if (list === null) {
    throw new CliError('Expected a JSON array of commands or an object with a "commands" array');
  }
  for (const [index, entry] of list.entries()) {
    if (!isRecord(entry)) throw new CliError(`Command ${index + 1} is not a JSON object`);
  }
  return list as AgentCommand[];
}

export async function runApply(ctx: CliContext): Promise<number> {
  const commands = await readCommands(ctx);
  const studio = await openStudio(ctx);
  const before = studio.project;
  const report = await studio.apply(commands);

  const applied = report.results.filter((result) => result.ok).length;
  // Persist immediately: a crashed process must not leave a silent partial batch.
  if (applied > 0) {
    await studio.flush();
    await recordHistory(ctx, before);
  }

  report.results.forEach((result, index) => {
    const op = result.command.op;
    if (result.ok) {
      const created = Object.entries(result.createdIds);
      const suffix =
        created.length === 0
          ? ''
          : ` (${created.map(([role, id]) => `${role} ${id}`).join(', ')})`;
      ctx.io.out(`${index + 1}. ok    ${op}${suffix}\n`);
      return;
    }
    const hint = result.error.hint === undefined ? '' : ` [${result.error.hint}]`;
    ctx.io.out(`${index + 1}. fail  ${op}: ${result.error.code} — ${result.error.message}${hint}\n`);
  });

  if (report.changes.length > 0) {
    ctx.io.out('changes:\n');
    for (const change of report.changes) ctx.io.out(`  - ${change}\n`);
  }

  if (report.fatal !== undefined) {
    ctx.io.err(`apply stopped: ${report.fatal}\n`);
    return 2;
  }
  if (!report.ok) {
    ctx.io.err(`apply failed: ${applied}/${commands.length} commands applied, the rest were skipped\n`);
    return 2;
  }
  ctx.io.out(`applied ${applied} command${applied === 1 ? '' : 's'}\n`);
  return 0;
}

export async function runUndo(ctx: CliContext): Promise<number> {
  const studio = await openStudio(ctx);
  const journal = await loadJournal(ctx);
  const snapshot = journal.undo.pop();
  if (snapshot === undefined) throw new CliError('Nothing to undo');

  journal.redo.push(JSON.stringify(studio.project));
  await writeSnapshot(ctx, snapshot);
  await saveJournal(ctx, journal);
  printProjectState(ctx, 'undo', JSON.parse(snapshot) as Project);
  return 0;
}

export async function runRedo(ctx: CliContext): Promise<number> {
  const studio = await openStudio(ctx);
  const journal = await loadJournal(ctx);
  const snapshot = journal.redo.pop();
  if (snapshot === undefined) throw new CliError('Nothing to redo');

  journal.undo.push(JSON.stringify(studio.project));
  await writeSnapshot(ctx, snapshot);
  await saveJournal(ctx, journal);
  printProjectState(ctx, 'redo', JSON.parse(snapshot) as Project);
  return 0;
}
