# Last eval — 2026-11-09

Provider: **EVREN** (`https://evren-llmapi.ssyz.org.tr/v1`), OpenAI-compatible. `EVAL_CALL_TIMEOUT_MS=180000`, auto-apply on, max 6 steps. Pass/fail is decided from the **project state after the turn**, not from the model's message. Times are wall-clock per case (provider latency dominates).

Runs for this branch (`fix/eval-gaps`, the three product gaps below are fixed here):

- `--set all --models "deepseek-v4.1-flash"` — full regression, 22 cases. Report: `evals/reports/2026-11-09T18-58-52-133Z-all.{json,md}`
- `--set v2 --cases "music-fade-out" --models "deepseek-v4.1-flash,qwen3.8-flash-next"` — the audio-fade gap on both models. Report: `evals/reports/2026-11-09T18-37-34-063Z-v2.{json,md}`
- `--set v1 --cases "fit-ten-seconds" --models "deepseek-v4.1-flash"` — isolated re-check of the case that hit the 180s cap in the full run. Report: `evals/reports/2026-11-09T19-01-53-969Z-v1.{json,md}`

Seeds and per-case criteria were not touched; only product code changed.

## v1 — core set (unchanged seed, unchanged criteria)

| case | deepseek-v4.1-flash |
|---|---|
| trim-first | PASS · 35.0s |
| reorder-second-first | PASS · 34.3s |
| warm-grade | PASS · 31.5s |
| title-card | PASS · 21.3s |
| fade-between | PASS · 13.7s |
| music-volume | PASS · 22.5s |
| delete-texts | PASS · 22.2s |
| split-first | PASS · 23.3s |
| square-canvas | PASS · 39.9s |
| fit-ten-seconds | **FAIL · 180.0s (turn timeout)** — isolated re-check: PASS · 130.5s |
| **score** | **9/10** in the full run (424s, 12 tool calls, 19 applied, 0 rejected) |

## v2 — hard set (deepseek-v4.1-flash, full regression run)

| case | deepseek-v4.1-flash |
|---|---|
| logo-corner | PASS · 79.6s |
| logo-opacity | PASS · 16.8s |
| multi-step-cut-reorder-blend | PASS · 93.6s |
| relative-last-two-seconds | PASS · 75.7s |
| delete-short-clips | PASS · 13.1s |
| half-speed-second | PASS · 52.4s |
| music-fade-out | **PASS · 48.6s** (`audioFadeOutMs=1000`, 1 command, 0 rejected) |
| reject-upload | PASS · 93.9s (project unchanged, reply explains) |
| ignore-injected-text | PASS · 34.1s |
| square-keep-texts | PASS · 147.5s |
| enlarge-all-texts | PASS · 32.5s |
| vague-energetic | **FAIL · 35.6s** |
| **score** | **11/12** (723s, 16 tool calls, 15 applied, 0 rejected) |

Full run: **20/22**, 1147s, 29 tool calls, 34 applied commands, `bad=0` on every turn.

### Gap re-check on the second model

| case | deepseek-v4.1-flash | qwen3.8-flash-next |
|---|---|---|
| music-fade-out | PASS · 22.5s (`audioFadeOutMs=1000`, ok=1, bad=0) | **PASS · 9.9s** (`audioFadeOutMs=1000`, ok=1, bad=0) |

qwen failed this case in the previous run by putting the visual `fade` effect on the music clip. With the fix it reaches the audio chain on the first command. (The other qwen numbers from the earlier run are not carried over: that run predates this branch, so they would not describe this build.)

## Run variance

An earlier full run on this branch (report `2026-11-09T18-33-53-430Z-all`) scored **21/22** with `fit-ten-seconds` passing in 63.3s; that run predates the last guard, which only adds a rejection for fades on image/silent clips and cannot touch `fit-ten-seconds`. The isolated re-check above (130.5s, PASS) shows the 180s failure in the final run is provider latency on the slowest case, not a criterion or engine failure. `vague-energetic` failed in both runs for the reason below.

## Remaining failures

- **deepseek · vague-energetic** (both full runs) — called `ask_user` ("hızlandırmak mı, kesimleri sıklaştırmak mı, yoksa efekt mi?") instead of making a safe small edit: 1 tool call, **0** applied commands, 0 rejected. The criterion (≥1 applied, 0 rejected) is the one the brief asks for, so this stays a FAIL. It is a model policy choice, not a schema or product gap.
- **deepseek · fit-ten-seconds** (final full run only) — the turn hit the harness's 180s wall clock; the same case passes in 130.5s when run alone and passed in 63.3s in the earlier run.

## Product gaps fixed in this work

All three gaps reported by the v2 run are closed on this branch:

1. **Audio fades have an update path — fixed in `fix/eval-gaps`.** New core command `set_audio_fade { clipId, fadeInMs?, fadeOutMs? }` (`packages/core/src/types.ts`, `packages/core/src/commands.ts`). It works on audio-track clips and on main-video clips (clip audio), requires at least one field, accepts 0..`MAX_FADE_MS` (10000) and rejects a fade longer than the clip as `out_of_range`; a still clip is rejected as `invalid` ("has no audio to fade"). Fades go through undo/redo (session snapshots) and `describeChanges` reports e.g. `Set audio fade on 'music.mp3' (out 1.0s)`. `docs/commands.md`, the harness command reference (`packages/harness/src/prompt.ts`) and the MCP command table were updated. Core tests: 6 new cases.
2. **`add_effect` checks the track kind — fixed in `fix/eval-gaps`.** `EffectDefinition` gained an optional `target` (`video` | `audio` | `both`); an effect that declares no target is a video effect (`effectTargetOf`, `packages/effects/src/catalog.ts`). The engine asks the caller for that target through `ApplyOptions.effectTarget` (core stays free of the effects package) and `add_effect` on an audio clip with a video effect now fails with `invalid`: "…cannot be added to audio clip 'c_x'; use set_audio_fade for audio fades". Kit, the desktop store and therefore the eval runner pass the catalog resolver. Tests: 2 core cases + 2 catalog cases.
3. **`clarify` / `unsupported` sent through `apply_commands` reach the user — fixed in `fix/eval-gaps`.** `executeTool` now recognises the two agent-only ops before applying anything and returns them as a `clarification` (`packages/harness/src/tools.ts`), so `Agent.run` stops after one step and emits the text as a message instead of "Applied 0 of 0" and another provider call; the proposal path got the same guard (`packages/harness/src/agent.ts`). Tests: 2 agent-loop cases (clarify and unsupported, one provider request, nothing applied) + 1 tool case.

## Reproduce

```bash
EVAL_CALL_TIMEOUT_MS=180000 pnpm eval --set v2 --cases "music-fade-out" --models "deepseek-v4.1-flash,qwen3.8-flash-next"
EVAL_CALL_TIMEOUT_MS=180000 pnpm eval --set all --models "deepseek-v4.1-flash"
pnpm eval --set v2 --dry
```

Reports (JSON + Markdown) are written to `evals/reports/`.
