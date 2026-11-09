# @editbay/mcp

Stdio [Model Context Protocol](https://modelcontextprotocol.io) server for Editbay.
It exposes one headless project to any agent (Claude Code, Codex, OpenCode, custom
clients) so the agent can edit video through validated commands — no UI, no
direct file access, no ffmpeg strings from the model.

```
agent ── MCP (stdin/stdout) ──> editbay-mcp ──> @editbay/kit HeadlessStudio
                                                   ├─ project JSON (commands, undo)
                                                   ├─ ffmpeg export / probe / frames
                                                   └─ workspace (skills, brand, memory)
```

## Build

```bash
cd /path/to/editbay
pnpm exec tsc -p packages/mcp          # typecheck
pnpm exec vitest run packages/mcp      # tests
node packages/mcp/scripts/build.mjs    # -> packages/mcp/dist/server.mjs
node packages/mcp/scripts/handshake-check.mjs
```

The bundle is self-contained (esbuild, ESM, node platform) and starts with a
`#!/usr/bin/env node` shebang. Requires Node 20+ and ffmpeg/ffprobe only for
import, probe, frame extraction and export.

## Configuration

Resolution order per value: **CLI flag → environment variable → default**.

| Value | Flag | Environment | Default |
| --- | --- | --- | --- |
| Project file | `--project` | `EDITBAY_PROJECT` | `./editbay.json` |
| Workspace root | `--workspace` | `EDITBAY_WORKSPACE` | `~/.editbay` (studio default) |
| Builtin skills | `--builtin-skills` | `EDITBAY_BUILTIN_SKILLS` | unset |
| Project name for new files | `--name` | — | `Untitled` |

The project file is created on first start. Paths are resolved against the
working directory. The workspace holds `brands/`, `memory/`, `skills/` and
`receipts/`.

stdout carries **only** MCP JSON-RPC. Diagnostics — including the resolved
project path — go to stderr.

## Client snippets

### Claude Code

Project-scoped `.mcp.json` in the repo the agent edits:

```json
{
  "mcpServers": {
    "editbay": {
      "command": "node",
      "args": [
        "/path/to/editbay/packages/mcp/dist/server.mjs",
        "--project", "C:/work/demo/editbay.json",
        "--workspace", "C:/work/demo/.editbay"
      ]
    }
  }
}
```

Or from the CLI:

```bash
claude mcp add editbay -- node /path/to/editbay/packages/mcp/dist/server.mjs \
  --project C:/work/demo/editbay.json --workspace C:/work/demo/.editbay
```

### Codex

`~/.codex/config.toml` (or a project-level config):

```toml
[mcp_servers.editbay]
command = "node"
args = [
  "/path/to/editbay/packages/mcp/dist/server.mjs",
  "--project", "C:/work/demo/editbay.json",
  "--workspace", "C:/work/demo/.editbay",
]
```

### OpenCode

`opencode.json` (project or global):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "editbay": {
      "type": "local",
      "command": [
        "node",
        "/path/to/editbay/packages/mcp/dist/server.mjs",
        "--project",
        "C:/work/demo/editbay.json",
        "--workspace",
        "C:/work/demo/.editbay"
      ],
      "enabled": true
    }
  }
}
```

### Custom agent

Speak newline-delimited JSON-RPC 2.0 on stdio:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_project","arguments":{}}}
```

## Tools

| Tool | What it does |
| --- | --- |
| `get_project` | Snapshot: name, canvas, duration, assets, tracks/clips, texts, summary. No asset paths. |
| `apply_commands` | Apply a validated batch of `EditCommand`s. One batch = one undo step. |
| `import_media` | Import local files and create clips. Returns asset/clip ids. |
| `probe_media` | ffprobe metadata for a file, without importing. |
| `undo` / `redo` | Revert or reapply the last command batch. |
| `export_video` | Render an mp4 (`draft` / `standard` / `high`). |
| `extract_frame` | Write one JPEG frame from an asset to disk. |
| `list_effects` | Effect and transition catalog with parameter specs. |
| `list_skills` / `read_skill` / `write_skill` | Workspace editing playbooks. |
| `remember` / `search_memory` | Durable workspace notes. |
| `get_brand` / `save_brand` | Brand identity: markdown, colors, fonts. |
| `get_help` | Markdown cheat sheet with the command schema and an example batch. |

Every tool description is written for a model: it states when to use the tool,
where ids come from, that asset paths never reach the model, and that edits are
validated and undoable.

## Error behaviour

Invalid input never crashes the server. Tool failures return
`{ "content": [...], "isError": true }` with a JSON body containing the failing
op, the engine's message and — where useful — valid ids (`Available clip ids: …`,
`Available asset ids: …`). The agent can fix the ids and retry.

## Tests

`src/server.test.ts` drives a real MCP `Client` over an in-memory transport
(`InMemoryTransport.createLinkedPair`) against a seeded project in a temp
directory. ffmpeg-dependent tests (import/probe/frame/export) are skipped when
ffmpeg is absent on PATH. Nothing touches `~/.editbay`.
