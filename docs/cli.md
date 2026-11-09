# CLI

Editbay ships a headless CLI. Same project file, same commands, same FFmpeg renderer — no window.

```bash
pnpm build:cli
node packages/cli/dist/cli.mjs --help
# or link it
npm link ./packages/cli
editbay --help
```

Global flags: `--project <path>` (default `./editbay.json`), `--workspace <dir>` (default `~/.editbay`), `--json`.

## Quick start

```bash
editbay init --name "Launch cut"
editbay import ./footage/*.mp4 ./music.mp3
editbay summary
editbay apply --json '[{"op":"trim_clip","clipId":"c_ab12","inMs":0,"outMs":3000}]'
editbay export ./out.mp4 --quality standard
```

## Commands

| command | what it does |
|---|---|
| `init [--name]` | Create the project file (4 tracks, 1080×1920@30). |
| `summary [--json]` | Canvas, duration, tracks, clips, assets + the model-safe summary. |
| `import <file...>` | Probe and add media; video/images go to the video track, audio to the audio track. |
| `apply --json '<commands>'` / `--file cmds.json` | Apply validated commands; exit 2 if any fail. |
| `undo` / `redo` | Journal-backed per-project history. |
| `export <out.mp4>` | Render with FFmpeg; progress on stderr. |
| `probe <file>` | ffprobe metadata as JSON. |
| `effects [--json]` | Effect and transition catalog. |
| `skills list\|show\|add` | Read built-in skills, write your own. |
| `memory remember\|search` | Durable brand notes as markdown. |
| `brands list\|show` | Brand identities. |

## Scripting notes

- Exit codes: `0` ok, `1` bad input / IO, `2` invalid command batch, `3` render failure.
- `--json` keeps stdout machine-readable; all progress goes to stderr.
- Commands are atomic and validated; an invalid batch never corrupts the project file.
- `apply` accepts `[{...}]` or `{"commands":[...]}`.

## Example: an agent-friendly loop

```bash
editbay init --project cut.json
editbay import a.mp4 b.mp4 music.mp3 --project cut.json
editbay summary --json --project cut.json | jq '.durationMs'
editbay apply --project cut.json --json '[
  {"op":"add_text","text":"Northwind Coffee","startMs":0,"durationMs":2000},
  {"op":"add_effect","clipId":"c_1","effect":{"type":"grade","params":{"preset":"warm"}}}
]'
editbay export out.mp4 --project cut.json
```
