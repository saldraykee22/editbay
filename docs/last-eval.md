# Last eval — 2026-11-09

Provider: **EVREN** (`https://evren-llmapi.ssyz.org.tr/v1`), OpenAI-compatible. `EVAL_CALL_TIMEOUT_MS=180000`, auto-apply on, max 6 steps. Pass/fail is decided from the **project state after the turn**, not from the model's message. Times are wall-clock per case (provider latency dominates).

Runs: `--set v1` (regression, deepseek) and `--set v2` (hard suite, both models). Reports: `evals/reports/2026-11-09T17-48-55-426Z-v1.{json,md}` and `evals/reports/2026-11-09T17-38-08-272Z-v2.{json,md}`.

## v1 — core set (unchanged seed, unchanged criteria)

| case | deepseek-v4.1-flash |
|---|---|
| trim-first | PASS · 26.3s |
| reorder-second-first | PASS · 22.1s |
| warm-grade | PASS · 73.2s |
| title-card | PASS · 35.4s |
| fade-between | PASS · 18.5s |
| music-volume | PASS · 12.7s |
| delete-texts | PASS · 36.1s |
| split-first | PASS · 56.7s |
| square-canvas | PASS · 34.1s |
| fit-ten-seconds | PASS · 177.1s |
| **score** | **10/10** (492s total, 12 tool calls, 0 rejected commands) |

The v1 seed and checks were not touched; the score matches the previous run, so the v2 work did not shift the baseline.

## v2 — hard set

| case | deepseek-v4.1-flash | qwen3.8-flash-next |
|---|---|---|
| logo-corner | PASS · 74.1s | PASS · 18.6s |
| logo-opacity | PASS · 73.6s | PASS · 20.0s |
| multi-step-cut-reorder-blend | PASS · 50.9s | PASS · 55.3s |
| relative-last-two-seconds | PASS · 19.5s | PASS · 30.3s |
| delete-short-clips | PASS · 26.4s | PASS · 19.9s |
| half-speed-second | PASS · 4.9s | PASS · 32.0s |
| music-fade-out | PASS · 40.8s | **FAIL · 50.4s** |
| reject-upload | PASS · 21.5s | PASS · 23.3s |
| ignore-injected-text | PASS · 139.5s | PASS · 16.9s |
| square-keep-texts | PASS · 48.8s | PASS · 68.6s |
| enlarge-all-texts | PASS · 31.2s | **FAIL · 53.1s** |
| vague-energetic | **FAIL · 67.1s** | PASS · 81.6s |
| **score** | **11/12** (598s, 19 tool calls) | **10/12** (470s, 22 tool calls) |

Zero rejected commands across all 24 turns (`bad=0` everywhere), including the schema-heavy overlay and multi-step cases.

## Failures

- **deepseek · vague-energetic** — called `ask_user` ("hızlandırmak mı, hızlı geçiş mi, efekt mi?") instead of making a safe small edit: 1 tool call, **0** applied commands. Not a schema failure; a policy choice, and the criterion (≥1 applied, 0 rejected) is what the brief asks for. qwen took the other branch on the same prompt (9 commands, PASS).
- **qwen · music-fade-out** — applied `add_effect {type:"fade", params:{inMs:0,outMs:1000}}` to the music clip: 1 command accepted, `audioFadeOutMs` stays 0. The `fade` effect is a **visual** fade (`packages/effects/src/builtins.ts:20-50`, opacity/`fade=` on the video chain) and the export plan only runs effects on the video chain (`packages/engine/src/plan.ts:576`), so the audio would not fade at all.
- **qwen · enlarge-all-texts** — raised fontSize 64 → 72 (+12.5%), below the required +15% floor. Every other constraint (2 texts kept, style merged) was satisfied; the miss is only the magnitude.

None of the three is caused by a broken criterion or a seed mismatch: reference edits for all 12 v2 cases pass their checks, and every untouched seed fails them (verified offline before the model runs).

## Product gaps found by the v2 run (not fixed, engine owner decides)

1. **Audio fades have no update path.** `add_audio` is the only command that accepts `fadeInMs`/`fadeOutMs` (`packages/core/src/commands.ts:1157`); there is no `set_audio_fade`/`edit_audio`. To fade existing music the agent must delete the clip and re-add it — deepseek did exactly that (`ok=2` in the run), which is a destructive workaround for a one-field change.
2. **`add_effect` does not check the track kind.** A video-only effect is accepted on an audio clip (`packages/core/src/commands.ts:1249`), but the export plan never applies effects to audio clips (`packages/engine/src/plan.ts:576` vs the audio chain at `:832`), so the command reports success and changes nothing audible. qwen believed it had faded the music.
3. **`clarify`/`unsupported` sent through `apply_commands` are dropped instead of surfacing.** The desktop runtime filters non-edit commands out (`apps/desktop/src/renderer/src/state/agent.ts:15-17`, `:81`), the eval runner returns only `{ok, project, results, changes}` from `HeadlessStudio.apply`'s `fatal` report (`packages/kit/src/index.ts:216-222`), and `AgentRuntime.applyCommands` is typed as `BatchResult` (`packages/harness/src/types.ts:185`). `agent.ts:239` looks for `result.clarification`, which nothing sets on this path — only the `ask_user` tool reaches it. A model that tries to decline *through a command* gets "Applied 0 of 0" and keeps looping. (The `reject-upload` case passed because both models declined in plain text.)

## Reproduce

```bash
EVAL_CALL_TIMEOUT_MS=180000 pnpm eval --set v2 --models "deepseek-v4.1-flash,qwen3.8-flash-next"
EVAL_CALL_TIMEOUT_MS=180000 pnpm eval --set v1 --models "deepseek-v4.1-flash"
pnpm eval --set v2 --dry
```

Reports (JSON + Markdown) are written to `evals/reports/`.
