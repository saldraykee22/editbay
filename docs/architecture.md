# Architecture

## One project, one command stream

`packages/core` owns the entire editable state. The UI, the agent and tests all mutate it through `EditCommand` objects. The engine is a pure reducer:

```ts
const result = applyCommand(project, { op: 'trim_clip', clipId: 'c_1', outMs: 4200 });
if (!result.ok) showError(result.error); // state unchanged
```

Rules that keep this honest:

- Commands are validated; invalid commands never mutate state.
- `EditSession` stores JSON snapshots, so undo/redo is exact and cheap (projects are small).
- `describeChanges(before, after)` produces the human sentence in the chat and the receipt.
- `projectSummary()` is the only project view sent to a model: labels and timings, never file paths.

## Timeline semantics

- The main `video` track is **sequential**: clip start = sum of previous clip durations. No gaps by design; models confuse absolute vs index math, and sequential removes a whole class of errors.
- `overlay` and `audio` clips use absolute `startMs`.
- `text` items use `startMs` / `durationMs`.
- Clip duration = `(outMs - inMs) / speed`.
- Transitions live on the outgoing clip (`transitionOut`) and consume overlap at export.

## Rendering

`packages/engine` builds one FFmpeg invocation per export:

1. One input per clip (images get `-loop 1`), so trims are plain `trim` filters.
2. Per clip: trim → speed → fps → scale/crop to canvas → effect filters → transform.
3. Adjacent clips with `transitionOut` are chained with `xfade`.
4. Text items become `drawtext` with a temp text file (no escaping bugs) and `enable='between(t,…)'`.
5. Audio: clip audio + music tracks → `amix` with `normalize=0`.
6. Encode: H.264 yuv420p, AAC 48 kHz, `+faststart`.

Preview is a Canvas 2D compositor that resolves the same effect definitions (`style()`) instead of FFmpeg filters. Preview is an approximation; **export is the reference** — the UI says so.

## Agent harness

`packages/harness` is provider-agnostic (OpenAI-compatible, Anthropic, Gemini). The loop:

```
user text → system prompt (brand + matched skills + project summary)
         → model chooses tools → tools mutate the project via commands
         → model summarises → receipt written
```

Tools: `read_project`, `list_assets`, `apply_commands`, `undo`, `search_memory`, `remember`, `list_skills`, `read_skill`, `write_skill`, `list_effects`, `ask_user`.

Safety properties: the model cannot execute arbitrary code, cannot read file paths, and cannot change the project except through validated commands. `autoApply=false` turns every batch into a proposal the user approves.

## Workspace layout

```
workspace/
  brands/<id>/identity.md    brand voice, colours, fonts, do/don't
  memory/YYYY-MM-DD-*.md     dated facts with source + tags
  skills/<id>/SKILL.md       playbooks (+ optional code/)
  receipts/YYYY-MM-DD.jsonl  provenance for every agent turn
  projects/current.json      autosaved project
```

Humans can read, edit, delete and version all of it. That is the point: memory you own, not a vector database you rent.

## Effects as code

An effect is a small module with `params`, a pure `style(ctx)` for preview and an optional `ffmpeg(params, meta)` string for export. Built-ins live in `packages/effects`. The agent can write new ones into `skills/<id>/code/effect.js`; they render immediately in preview and export honestly (or fall back with a warning).
