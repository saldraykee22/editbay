# MCP server

Any MCP-capable agent (Claude Code, Codex, OpenCode, custom) can edit an Editbay project through validated commands — no UI, no screen scraping.

```bash
pnpm build:mcp
node packages/mcp/dist/server.mjs --project ./editbay.json
```

The project file is created when missing. Diagnostics go to **stderr**; stdout is the MCP protocol only.

## Configure

Claude Code (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "editbay": {
      "command": "node",
      "args": ["/path/to/editbay/packages/mcp/dist/server.mjs", "--project", "C:/work/my-cut/editbay.json"]
    }
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.editbay]
command = "node"
args = ["/path/to/editbay/packages/mcp/dist/server.mjs", "--project", "C:/work/my-cut/editbay.json"]
```

OpenCode (`opencode.json`):

```json
{
  "mcp": {
    "editbay": {
      "type": "local",
      "command": ["node", "/path/to/editbay/packages/mcp/dist/server.mjs", "--project", "C:/work/my-cut/editbay.json"],
      "enabled": true
    }
  }
}
```

Flags: `--project`, `--workspace`, `--builtin-skills`, `--name`. Env equivalents: `EDITBAY_PROJECT`, `EDITBAY_WORKSPACE`, `EDITBAY_BUILTIN_SKILLS`.

## Tools

| tool | purpose |
|---|---|
| `get_help` | Command schema cheat sheet for a fresh agent. |
| `get_project` | Canvas, duration, assets, tracks, clips, texts, effects — labels only, never paths. |
| `apply_commands` | The only mutation path; validated, undoable, per-command results. |
| `import_media` | Probe and add local files. |
| `probe_media` | Metadata for one file. |
| `undo` / `redo` | History. |
| `export_video` | MP4 render with quality preset. |
| `extract_frame` | PNG still from an asset for visual review. |
| `list_effects` | Effects + transitions with parameter specs. |
| `list_skills` / `read_skill` / `write_skill` | Playbooks the agent can follow or author. |
| `remember` / `search_memory` | Brand facts as markdown. |
| `get_brand` / `save_brand` | Brand identity files. |

## Why agents like it

- The command schema is explicit: `trim_clip`, `move_clip`, `add_text`, `add_effect`, `add_transition`…
- Invalid commands return `{ ok:false, code, message, hint, validIds }` instead of throwing.
- Edits are undoable and persisted after every batch, so a crashed agent cannot corrupt the project.
- Asset paths never leave the machine or reach the model; only labels and ids are exposed.
- `extract_frame` gives a vision model something to look at without rendering the whole video.

## Security

The server runs locally with the same file access as the user. It never uploads media and never calls a model. Keep it bound to stdio; do not expose it over the network.
