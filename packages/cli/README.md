# @editbay/cli

Headless `editbay` command line: edit, import, render and inspect an Editbay
project without the desktop UI. Built for humans and agents — every command is
deterministic, prints either readable text or `--json`, and exits non-zero on
failure.

## Build and run

```sh
pnpm --filter @editbay/cli build      # bundles dist/cli.mjs with esbuild
node packages/cli/dist/cli.mjs --help
```

The bundle has no runtime dependencies: node builtins are the only imports, so
`dist/cli.mjs` runs on a plain Node 20+ install.

`packages/cli/src/cli.ts` also exports `run(argv, io?)`, the same entry point the
binary uses. `io` is `{ out(text), err(text) }`, which makes the CLI easy to
drive from tests, scripts or another process.

## Commands

```
editbay init [--name <name>]
editbay summary [--json]
editbay import <file...> [--track <trackId>] [--index <n>]
editbay apply --json '<commands-array>' | --file <path.json>
editbay undo | redo
editbay export <out.mp4> [--quality draft|standard|high] [--quiet]
editbay probe <file>
editbay effects [--json]
editbay skills list | show <id> | add <id> --name <name> --description <text> --triggers a,b --body <text>|--body-file <path>
editbay memory remember <title> --body <text>|--body-file <path> [--tags a,b]
editbay memory search <query> [--limit 5]
editbay brands list | show <id>
editbay version
```

Global flags (before or after the command):

| Flag | Meaning |
| --- | --- |
| `--project <path>` | Project JSON. Default: `EDITBAY_PROJECT`, else `./editbay.json`. |
| `--workspace <dir>` | Workspace root for skills, memory, brands and CLI history. Default: `EDITBAY_WORKSPACE`, else `~/.editbay`. |
| `--json` | Machine-readable stdout. For `apply`, `--json` carries the command payload instead. |
| `--help`, `-h` | Usage. |

`EDITBAY_BUILTIN_SKILLS` overrides the builtin skill directory. Without it the
CLI walks up from its own location and from the working directory looking for
`apps/desktop/resources/skills`, which works both unbundled (`src/`) and bundled
(`dist/`).

## Behaviour worth knowing

- **Missing projects are created.** Every command opens the project through
  `HeadlessStudio.open`, which writes a new schema-v2 project when the file does
  not exist. `init` only makes that explicit (and can rename an existing
  project).
- **apply** accepts a JSON array of `EditCommand` objects or
  `{ "commands": [...] }`. Commands run in order and stop at the first failure.
  Each result is printed, successful commands are saved immediately, and the
  change list is shown. Exit codes: `0` all applied, `2` at least one command
  failed (anything applied before the failure is reported and kept), `1`
  unreadable file or invalid JSON.
- **undo / redo** use a small journal in `<workspace>/history/`, so the history
  survives between CLI invocations (one process per command).
- **export** writes progress to stderr roughly every 10% and the final
  path/size/duration to stdout; `--quiet` silences progress. Exit code `3` means
  ffmpeg failed.
- **Identifiers are the API.** Authoring commands use the ids returned by
  `import`, `apply` (created ids), `skills add` and `memory remember`; there is
  no name-based lookup.
- **stdout stays clean** for every `--json` command: logs and progress go to
  stderr.
- Absolute paths are printed for projects, media and workspace files; the
  project summary string never contains absolute media paths.

## Layout

```
src/cli.ts               run(), dispatch, help, main detection
src/args.ts              node:util parseArgs wrapper (subcommand + flags)
src/commands/context.ts  io, path defaults, studio open, formatting
src/commands/project.ts  init, summary, version
src/commands/media.ts    import, probe
src/commands/edit.ts     apply, undo, redo, history journal
src/commands/export.ts   export
src/commands/effects.ts  effects catalog
src/commands/knowledge.ts skills, memory, brands
```

Tests live next to the code (`*.test.ts`) and always point `--workspace` at a
temporary directory.
