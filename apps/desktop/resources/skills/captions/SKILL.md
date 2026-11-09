---
id: captions
name: Captions and text
description: Burned-in captions that survive compression and stay inside safe areas.
triggers: [caption, subtitles, text, altyazı, yazı, başlık]
version: 1
builtin: true
---
# Captions and text

Vertical video rules:
- Canvas is 1080×1920 by default. Keep text inside the middle 80% vertically.
- Base caption position: `y = 0.82`. Never place captions where platform UI covers them (bottom 12%).
- Max 2 lines, max 38 characters per line. Split long sentences into separate text items.
- Font size 56–72 for captions, 88–120 for a hook line, 44–52 for disclaimers.
- Add `background: "#00000099"`, `padding: 18`, `radius: 12` when the footage is bright or busy.
- One idea per card. Do not put a paragraph on screen.

Workflow:
1. `add_text` with explicit `startMs` and `durationMs` aligned to the spoken phrase, not the shot.
2. Read the project back and check overlaps before adding the next card.
3. If the user asked for automatic captions and no transcript exists, say what you need instead of guessing words.
