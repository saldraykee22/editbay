# Command schema

All times are integer milliseconds. Every command returns `{ ok, project, changes, createdIds }` or `{ ok: false, error }` and never mutates its input.

| op | fields | meaning |
|---|---|---|
| `add_asset` | `asset` | Register a local file (path stays local). |
| `delete_asset` | `assetId` | Remove an unused asset. |
| `import_clip` | `assetId`, `trackId?`, `index?` | Add a clip; defaults to the main video track. |
| `trim_clip` | `clipId`, `inMs?`, `outMs?` | Source in/out points. |
| `retime_clip` | `clipId`, `inMs`, `outMs`, `startMs?` | Trim + timeline start in one step. |
| `move_clip` | `clipId`, `after?` / `toIndex?` | Reorder within a track (exactly one of the two). |
| `split_clip` | `clipId`, `atMs` | Split at an offset from the clip's timeline start. |
| `duplicate_clip` | `clipId` | Copy right after the original. |
| `delete_clip` | `clipId` | Remove. |
| `set_volume` | `clipId`, `volume` | 0–2, clip's own audio. |
| `set_audio_start` | `clipId`, `startMs` | Audio/overlay clips only. |
| `set_clip_speed` | `clipId`, `speed` | 0.25–4. |
| `set_clip_transform` | `clipId`, `transform` | x, y, scale, rotation, opacity. |
| `add_text` | `text`, `startMs`, `durationMs`, `style?` | Title/caption layer. |
| `edit_text` | `itemId`, … | Partial update. |
| `delete_text` | `itemId` | Remove. |
| `add_audio` | `assetId`, `startMs?`, `volume?`, fades | Music / voice-over. |
| `add_effect` | `clipId`, `effect` | Windowed parametric effect. |
| `remove_effect` | `clipId`, `effectId` | Remove. |
| `add_transition` | `clipId`, `transition` | Transition into the next clip. |
| `remove_transition` | `clipId` | Remove. |
| `set_canvas` | `width`, `height`, `fps?` | Output format. |
| `set_project_name` | `name` | Rename. |

Agent-only replies: `{ "op": "clarify", "question": "…" }` and `{ "op": "unsupported", "reason": "…" }`.

A model may return an array of commands; they are applied in order and stop at the first failure, with the error surfaced to the user.
