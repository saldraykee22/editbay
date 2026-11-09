# Agent evals

Natural-language prompts go through the real agent loop (prompt → tools → validated commands) against a seeded project, then the resulting **project state** is checked — not the model's reply.

```bash
pnpm eval                                   # default: EVREN deepseek-v4.1-flash
pnpm eval --models "qwen3.8-flash-next,deepseek-v4.1-flash" --verbose
pnpm eval --cases "trim-first,title-card"   # quote the list (PowerShell splits commas)
pnpm eval --dry                             # list cases, no model calls
```

Reports land in `evals/reports/` (gitignored): JSON for tooling, Markdown for humans.

## Setup

- `EVREN_API_KEY` or `EVREN_BASE_URL` (default `https://evren-llmapi.ssyz.org.tr/v1`). Locally the runner also reads the EVREN key from `~/.config/opencode/opencode.json`.
- Any OpenAI-compatible endpoint works: point `EVREN_BASE_URL` at OpenRouter/LM Studio and pass `--models`.
- FFmpeg must be on PATH (the seed project is generated with lavfi).

## Seed project

Three video clips (6s, 5s, 4s) + 10s music + two text cards, 1080×1920@30. Every case starts from this state in a fresh temp directory, so cases cannot contaminate each other.

## Cases

| id | prompt | pass criterion |
|---|---|---|
| trim-first | İlk klibi 2 saniyeye kısalt. | first clip duration 1.5–2.6s |
| reorder-second-first | İkinci klibi en başa al. | first clip is `clip-b` |
| warm-grade | Tüm videoya sıcak, sinematik bir renk ver. | every video clip has a `grade` effect |
| title-card | En başa 2 saniyelik 'Merhaba' yazısı ekle. | text at <600ms, ≥1.4s |
| fade-between | İlk iki klip arasına yumuşak bir geçiş koy. | first clip has a transition ≥150ms |
| music-volume | Müziğin sesini yarıya indir. | audio volume 0.35–0.65 |
| delete-texts | Bütün yazıları sil. | zero text items |
| split-first | İlk klibi ortasından ikiye böl. | ≥4 video clips |
| square-canvas | Videoyu 1080x1080 kare formata çevir. | canvas 1080×1080 |
| fit-ten-seconds | Videoyu 10 saniyeye sığdır. | clips remain, total ≤11s |

## Reading results

`tools` counts tool calls, `ok` counts applied commands, `bad` counts rejected commands. A pass with `bad>0` means the model recovered from a schema mistake — useful signal even when the outcome is right. Latency is dominated by provider reasoning time, not by the engine.

## Verified runs

See `docs/last-eval.md` for the most recent full run (models, scores, timings, failure details).
