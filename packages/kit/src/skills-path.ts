/**
 * Builtin skill discovery shared by the CLI and the MCP server.
 *
 * A published binary ships a `dist/skills` copy next to its entry file, so the
 * lookup order is:
 *
 * 1. `EDITBAY_BUILTIN_SKILLS` — an explicit override always wins;
 * 2. `<module dir>/skills` — the bundled copy produced by the build script;
 * 3. the repo layout `apps/desktop/resources/skills`, walking up from the
 *    module directory and then from the working directory (source and tests).
 *
 * A discovered directory is only accepted when it actually contains at least
 * one skill folder with a `SKILL.md`, so an empty `dist/skills` never shadows
 * the repo copy.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Monorepo path, relative to the repository root. */
const REPO_SKILLS_RELATIVE = join('apps', 'desktop', 'resources', 'skills');

export interface BuiltinSkillsLookup {
  /** Directory of the running module. Defaults to this file's directory. */
  moduleDir?: string;
  /** Working directory fallback. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Environment used for the explicit override. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

function currentModuleDir(): string | undefined {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    // Bundlers always provide import.meta.url; keep the cwd fallback anyway.
    return undefined;
  }
}

/** True when `dir` holds at least one `<id>/SKILL.md` skill folder. */
export function hasSkillFolders(dir: string): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')));
}

function findRepoSkills(start: string | undefined): string | undefined {
  if (start === undefined) return undefined;
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, REPO_SKILLS_RELATIVE);
    if (hasSkillFolders(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Resolves the read-only builtin skill directory, or `undefined` when none is
 * available (the studio then runs with user skills only).
 */
export function resolveBuiltinSkillsDir(lookup: BuiltinSkillsLookup = {}): string | undefined {
  const env = lookup.env ?? process.env;
  const override = env.EDITBAY_BUILTIN_SKILLS;
  if (typeof override === 'string' && override.trim() !== '') return resolve(override.trim());

  const moduleDir = lookup.moduleDir ?? currentModuleDir();
  if (moduleDir !== undefined) {
    const bundled = join(moduleDir, 'skills');
    if (hasSkillFolders(bundled)) return bundled;
  }

  return findRepoSkills(moduleDir) ?? findRepoSkills(lookup.cwd ?? process.cwd());
}
