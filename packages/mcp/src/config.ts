/**
 * Configuration for the Editbay MCP server.
 *
 * Every value resolves from the CLI first, then the environment, then a
 * default, so the same binary works from a desktop app, a terminal or a test
 * harness. Relative paths are resolved against the working directory.
 */
import { resolve } from 'node:path';
import type { StudioOptions } from '@editbay/kit';

export interface EditbayConfig {
  /** Absolute path to the project JSON file. Created on first open. */
  projectPath: string;
  /** Absolute workspace root (brands, memory, skills, receipts). */
  workspaceRoot?: string;
  /** Read-only directory that ships builtin skills. */
  builtinSkillsDir?: string;
  /** Project name used when the project file is created. */
  name?: string;
}

export interface CliValues {
  project?: string;
  workspace?: string;
  builtinSkills?: string;
  name?: string;
}

/** Flags that take a value, either `--flag value` or `--flag=value`. */
const VALUE_FLAGS: Record<string, keyof CliValues> = {
  '--project': 'project',
  '--workspace': 'workspace',
  '--builtin-skills': 'builtinSkills',
  '--name': 'name',
};

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Parses `--flag value` and `--flag=value` pairs. Unknown or malformed flags
 * are ignored instead of throwing: a protocol server must never die on argv.
 */
export function parseArgs(argv: readonly string[]): CliValues {
  const values: CliValues = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    const equals = token.indexOf('=');
    const flag = equals === -1 ? token : token.slice(0, equals);
    const key = VALUE_FLAGS[flag];
    if (!key) continue;

    if (equals !== -1) {
      const inline = nonEmpty(token.slice(equals + 1));
      if (inline !== undefined) values[key] = inline;
      continue;
    }

    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) continue;
    const value = nonEmpty(next);
    if (value !== undefined) {
      values[key] = value;
      index += 1;
    }
  }
  return values;
}

/** Resolves a possibly relative path against `cwd`. */
function absolute(value: string, cwd: string): string {
  return resolve(cwd, value);
}

/**
 * Builds the runtime configuration.
 *
 * Defaults: project `./editbay.json`; workspace and builtin skills are unset,
 * which lets `HeadlessStudio` fall back to its own defaults.
 */
export function resolveConfig(
  argv: readonly string[] = [],
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): EditbayConfig {
  const args = parseArgs(argv);

  const project = nonEmpty(args.project) ?? nonEmpty(env.EDITBAY_PROJECT) ?? 'editbay.json';
  const workspace = nonEmpty(args.workspace) ?? nonEmpty(env.EDITBAY_WORKSPACE);
  const builtinSkills = nonEmpty(args.builtinSkills) ?? nonEmpty(env.EDITBAY_BUILTIN_SKILLS);
  const name = nonEmpty(args.name);

  return {
    projectPath: absolute(project, cwd),
    ...(workspace === undefined ? {} : { workspaceRoot: absolute(workspace, cwd) }),
    ...(builtinSkills === undefined ? {} : { builtinSkillsDir: absolute(builtinSkills, cwd) }),
    ...(name === undefined ? {} : { name }),
  };
}

/** Maps the server configuration onto `HeadlessStudio.open` options. */
export function toStudioOptions(config: EditbayConfig): StudioOptions {
  return {
    projectPath: config.projectPath,
    ...(config.workspaceRoot === undefined ? {} : { workspaceRoot: config.workspaceRoot }),
    ...(config.builtinSkillsDir === undefined ? {} : { builtinSkillsDir: config.builtinSkillsDir }),
    ...(config.name === undefined ? {} : { name: config.name }),
  };
}
