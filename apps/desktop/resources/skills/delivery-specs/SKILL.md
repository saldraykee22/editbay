---
id: delivery-specs
name: Delivery specs
description: Export settings and aspect ratios for the platforms clients ask for.
triggers: [reels, tiktok, shorts, youtube, export, teslim, format, 9:16, 16:9]
version: 1
builtin: true
---
# Delivery specs

| Target | Canvas | Notes |
|---|---|---|
| Reels / TikTok / Shorts | 1080×1920, 30fps | Hook in the first 2s, captions mandatory, safe area middle 80% |
| YouTube | 1920×1080, 30fps | Intro under 5s, no vertical letterboxing |
| Feed square | 1080×1080, 30fps | Keep subject centered |
| Client archive | match source | Do not upscale beyond source resolution |

Rules:
- `set_canvas` before adding effects that depend on size.
- Export quality `standard` unless the client asked for a master; `high` doubles render time.
- Horizontal footage in a 9:16 canvas is cropped by design — warn the user before exporting.
- Never claim a platform will approve the file; the user verifies playback.
