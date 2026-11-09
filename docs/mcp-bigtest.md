# Big test — external agent over MCP

Goal: prove that an agent that knows nothing about Editbay's internals can edit a real project through the MCP server, and that the result is correct on disk.

## Setup

- Model: **OpenCode Go `deepseek-v4.1-flash`** (the same model that maintains the project, run as an independent agent).
- Project: 3 seeded assets (6s + 5s video, 10s music), 1080×1920@30.
- MCP server: `node packages/mcp/dist/server.mjs --project .mcp-test/editbay.json --workspace .mcp-test/workspace`.
- Project config (`opencode.json`) registers the server; the prompt forbids bash/write/edit tools.

## Prompt

> Use ONLY the editbay MCP tools. 1) Read the project and the help. 2) Trim the first video clip to 2 seconds. 3) Add a text 'Merhaba' at the timeline start for 2 seconds. 4) Lower the music volume to 0.5. 5) Apply a warm grade to every video clip. 6) Export to `out.mp4` with draft quality.

## What the agent did

1. `get_project` + `get_help`
2. `list_effects`
3. One `apply_commands` batch with five commands (trim, add_text, set_volume, two add_effect)
4. `get_project` to verify
5. `export_video` (draft)

## Verification (independent of the agent's claims)

`ffprobe`:

```
duration 10.000000
size     837863
video    h264 1080x1920
audio    aac
```

Project JSON (via CLI `summary`):

- clip `c_d16520` 2s with `grade`, clip `c_be9e24` 5s with `grade`
- text `ti_ec06a6` "Merhaba" 0–2s
- music `c_3ff842` volume 0.5
- total duration 10s

The agent's summary matched the disk state. No invalid commands, no retries.

## Notes

- The MCP tool descriptions and `get_help` were enough; the agent never needed the source code.
- `apply_commands` returned per-command results, so the agent could verify before exporting.
- This is the acceptance test for the "people can use their own agent instead of our UI" path.
