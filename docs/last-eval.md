# Last eval — 2026-11-09

Provider: **EVREN** (`https://evren-llmapi.ssyz.org.tr/v1`), OpenAI-compatible. Same seed project, same 10 cases, auto-apply on, max 6 steps. Pass/fail is decided from the **project state after the turn**, not from the model's message.

| case | deepseek-v4.1-flash | qwen3.8-flash-next |
|---|---|---|
| trim-first | PASS · 109.0s | PASS · 26.9s |
| reorder-second-first | PASS · 28.2s | PASS · 19.8s |
| warm-grade | PASS · 60.2s | PASS · 80.1s |
| title-card | PASS · 63.3s | PASS · 47.8s |
| fade-between | PASS · 41.9s | PASS · 27.2s |
| music-volume | PASS · 19.8s | PASS · 13.1s |
| delete-texts | PASS · 77.5s | PASS · 14.0s |
| split-first | PASS · 52.6s¹ | PASS · 39.2s¹ |
| square-canvas | PASS · 63.5s | PASS · 38.7s |
| fit-ten-seconds | PASS · 167.4s¹ | PASS · 172.8s¹ |
| **score** | **10/10** | **10/10** |

¹ Re-run with `EVAL_CALL_TIMEOUT_MS=180000`. The first deepseek pass used a 75s per-call timeout and scored 8/10: `split-first` and `fit-ten-seconds` hit the *transport* timeout before the first tool call (0 tool calls, 0 commands). With a 180s budget both passed. Treat those two as provider-latency failures, not reasoning failures — the harness now exposes the timeout.

## Invalid commands

Zero rejected commands across 20 turns. Every model turn used `read_project`/`list_effects` only when needed and then a single `apply_commands` batch. This is a direct result of adding the **command reference** to the system prompt; before it, models invented `update_clip`, `params` and `type` fields and burned 6–9 tool calls per turn.

## What the cases cover

trim, reorder, effects on all clips, text timing, transitions, audio volume, deletion, split, canvas change, and an ambiguous "fit to 10 seconds" request (the models chose 4 trims and kept all three clips rather than deleting footage).

## Reproduce

```bash
EVAL_CALL_TIMEOUT_MS=180000 pnpm eval --models "deepseek-v4.1-flash,qwen3.8-flash-next"
```

Reports (JSON + Markdown) are written to `evals/reports/`.
