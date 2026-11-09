---
id: rough-cut
name: Rough cut
description: Assemble a first cut from imported footage — order, trims, pacing.
triggers: [rough cut, first cut, assemble, edit this, kaba kurgu, birleştir]
version: 1
builtin: true
---
# Rough cut

Goal: a watchable first pass in one turn.

1. Call `read_project` and `list_assets` first. Never invent asset ids.
2. Choose clips in a narrative order: hook → context → payoff. For social video, open on the strongest visual, not the logo.
3. Import only the assets you need, then trim each clip so the cut starts on motion and ends before dead air.
4. Keep total runtime close to the user's request. Default social length: 15–30s.
5. Add at most one transition per cut and only where the story changes location or time.
6. Return a short summary: what you kept, what you dropped, total runtime.

Rules:
- Prefer trims over deleting good footage; the user can re-add.
- Leave 200–400ms of breathing room at the start and end.
- Never add music unless the user asked or a music asset exists.
