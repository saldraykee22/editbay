/**
 * `editbay` command line — headless video editing for humans and agents.
 *
 * `run(argv, io)` is the whole interface: it never throws, returns the process
 * exit code and writes only through `io`, which keeps it testable and lets the
 * MCP server or a script drive the same commands.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCliArgs } from './args';
import { CliError, createContext, type CliContext, type CliIo } from './commands/context';
import { runApply, runRedo, runUndo } from './commands/edit';
import { runEffects } from './commands/effects';
import { runExport } from './commands/export';
import { runBrands, runMemory, runSkills } from './commands/knowledge';
import { runImport, runProbe } from './commands/media';
import { runInit, runSummary, runVersion } from './commands/project';

export type { CliIo } from './commands/context';

export const HELP = `editbay — headless video editing for humans and agents

Usage
  editbay <command> [options]

Project
  init [--name <name>]                   Create the project file (or show the existing one)
  summary [--json]                       Name, canvas, duration, counts and project summary
  import <file...> [--track <id>] [--index <n>]
                                         Probe media and place it on the timeline
  apply --json '<commands-array>'        Apply validated edit commands
  apply --file <commands.json>           ...or read them from a file ({"commands": [...]} works too)
  undo | redo                            Step through the CLI edit history
  export <out.mp4> [--quality draft|standard|high] [--quiet]
                                         Render the timeline with ffmpeg
  probe <file>                           Inspect duration, size, fps and codecs

Workspace
  effects [--json]                       List effects and transitions
  skills list                            Builtin and user skills
  skills show <id>                       Full skill (front-matter and body)
  skills add <id> --name <name> --description <text> --triggers a,b --body <text>|--body-file <path>
  memory remember <title> --body <text>|--body-file <path> [--tags a,b]
  memory search <query> [--limit 5]
  brands list | show <id>
  version

Global
  --project <path>     Project JSON (env EDITBAY_PROJECT, default ./editbay.json)
  --workspace <dir>    Workspace root (env EDITBAY_WORKSPACE, default ~/.editbay)
  --json               Machine-readable stdout (for apply, --json is the command payload)
  --help, -h           This help

A missing project file is created automatically; init just makes it explicit.
`;

type Handler = (ctx: CliContext) => Promise<number>;

const COMMANDS: Record<string, Handler> = {
  init: runInit,
  summary: runSummary,
  import: runImport,
  apply: runApply,
  undo: runUndo,
  redo: runRedo,
  export: runExport,
  probe: runProbe,
  effects: runEffects,
  skills: runSkills,
  memory: runMemory,
  brands: runBrands,
  version: runVersion,
};

const defaultIo: CliIo = {
  out: (text: string): void => {
    process.stdout.write(text);
  },
  err: (text: string): void => {
    process.stderr.write(text);
  },
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs one CLI invocation. Returns the exit code instead of calling exit. */
export async function run(argv: string[], io: CliIo = defaultIo): Promise<number> {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    io.err(`editbay: ${messageFrom(error)}\n`);
    io.err('run "editbay --help" for usage\n');
    return 1;
  }

  if (options.help || options.command === '' || options.command === 'help') {
    io.out(HELP);
    return 0;
  }

  const handler = COMMANDS[options.command];
  if (handler === undefined) {
    io.err(`editbay: unknown command "${options.command}"\n`);
    io.err('run "editbay --help" for usage\n');
    return 1;
  }

  try {
    return await handler(createContext(io, options));
  } catch (error) {
    if (error instanceof CliError) {
      io.err(`editbay: ${error.message}\n`);
      return error.exitCode;
    }
    io.err(`editbay: ${messageFrom(error)}\n`);
    return 1;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return pathToFileURL(resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`editbay: ${messageFrom(error)}\n`);
      process.exitCode = 1;
    });
}
