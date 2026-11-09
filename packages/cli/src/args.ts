/**
 * Tiny argv parser built on `node:util` `parseArgs` — no third-party deps.
 *
 * The command is the first positional token. Global flags (`--project`,
 * `--workspace`, `--json`, `--help`) may appear before or after it; every
 * command adds its own flags on top.
 *
 * One deliberate exception to "`--json` means JSON output": for `apply` the
 * flag carries the command payload (`--json '<commands-array>'`), exactly as
 * documented in the command surface.
 */

import { parseArgs } from 'node:util';

export interface CliOptions {
  /** Subcommand, e.g. `summary`. Empty when no positional was given. */
  command: string;
  /** Positional arguments that follow the subcommand. */
  positionals: string[];
  project?: string;
  workspace?: string;
  /** Emit machine-readable JSON on stdout. Always false for `apply`. */
  jsonOutput: boolean;
  help: boolean;
  name?: string;
  track?: string;
  index?: string;
  quality?: string;
  quiet: boolean;
  file?: string;
  body?: string;
  bodyFile?: string;
  tags?: string;
  limit?: string;
  description?: string;
  triggers?: string;
  offset?: string;
  /** Raw JSON command payload for `apply --json`. */
  payload?: string;
}

interface OptionSpec {
  type: 'string' | 'boolean';
  short?: string;
}

const GLOBAL_OPTIONS: Record<string, OptionSpec> = {
  project: { type: 'string' },
  workspace: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

/** Per-command flags, merged over the globals. */
const COMMAND_OPTIONS: Record<string, Record<string, OptionSpec>> = {
  init: {
    name: { type: 'string' },
  },
  import: {
    track: { type: 'string' },
    index: { type: 'string' },
  },
  apply: {
    // Shadow the global boolean: here `--json` carries the command payload.
    json: { type: 'string' },
    file: { type: 'string' },
  },
  export: {
    quality: { type: 'string' },
    quiet: { type: 'boolean' },
  },
  captions: {
    offset: { type: 'string' },
  },
  skills: {
    name: { type: 'string' },
    description: { type: 'string' },
    triggers: { type: 'string' },
    body: { type: 'string' },
    'body-file': { type: 'string' },
  },
  memory: {
    body: { type: 'string' },
    'body-file': { type: 'string' },
    tags: { type: 'string' },
    limit: { type: 'string' },
  },
};

/** Flags that never consume the next token while we look for the subcommand. */
const BOOLEAN_TOKENS = new Set(['json', 'help', 'h', 'quiet']);

/**
 * Index of the subcommand in argv, or -1. A naive "first token" scan is not
 * enough because global flags may precede the command.
 */
function findCommandIndex(argv: string[]): number {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === '--') {
      return index + 1 < argv.length ? index + 1 : -1;
    }
    if (token.startsWith('--')) {
      const name = token.slice(2);
      if (name.includes('=') || BOOLEAN_TOKENS.has(name)) continue;
      // Assume unknown long flags take a value; this keeps `--name Demo init`
      // from treating "Demo" as the command.
      index += 1;
      continue;
    }
    if (token.startsWith('-') && token !== '-') continue;
    return index;
  }
  return -1;
}

function readString(value: string | boolean | (string | boolean)[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Parses argv (without node/script) into a typed option bag. Throws on bad flags. */
export function parseCliArgs(argv: string[]): CliOptions {
  const commandIndex = findCommandIndex(argv);
  const command = commandIndex >= 0 ? argv[commandIndex] ?? '' : '';
  const commandOptions = COMMAND_OPTIONS[command] ?? {};
  const spec: Record<string, OptionSpec> = { ...GLOBAL_OPTIONS, ...commandOptions };

  const parsed = parseArgs({ args: argv, options: spec, allowPositionals: true, strict: true });
  const values = parsed.values;
  const positionals = parsed.positionals.slice(commandIndex >= 0 ? 1 : 0);

  const isApply = command === 'apply';
  const options: CliOptions = {
    command,
    positionals,
    jsonOutput: !isApply && values.json === true,
    help: values.help === true,
    quiet: values.quiet === true,
  };

  const project = readString(values.project);
  if (project !== undefined) options.project = project;
  const workspace = readString(values.workspace);
  if (workspace !== undefined) options.workspace = workspace;
  const name = readString(values.name);
  if (name !== undefined) options.name = name;
  const track = readString(values.track);
  if (track !== undefined) options.track = track;
  const index = readString(values.index);
  if (index !== undefined) options.index = index;
  const quality = readString(values.quality);
  if (quality !== undefined) options.quality = quality;
  const file = readString(values.file);
  if (file !== undefined) options.file = file;
  const body = readString(values.body);
  if (body !== undefined) options.body = body;
  const bodyFile = readString(values['body-file']);
  if (bodyFile !== undefined) options.bodyFile = bodyFile;
  const tags = readString(values.tags);
  if (tags !== undefined) options.tags = tags;
  const limit = readString(values.limit);
  if (limit !== undefined) options.limit = limit;
  const description = readString(values.description);
  if (description !== undefined) options.description = description;
  const triggers = readString(values.triggers);
  if (triggers !== undefined) options.triggers = triggers;
  const offset = readString(values.offset);
  if (offset !== undefined) options.offset = offset;
  if (isApply) {
    const payload = readString(values.json);
    if (payload !== undefined) options.payload = payload;
  }

  return options;
}
