---
id: color-look
name: Colour look
description: One consistent grade across the whole cut, export-safe.
triggers: [color, grade, look, cinematic, renk, grade, ton]
version: 1
builtin: true
---
# Colour look

The look must be identical in preview and export, so use built-in effects rather than describing a mood.

Available looks: `grade` with `preset` = cinema | warm | cool | mono | punch, plus `vignette`, `grain`, `glow`.

Recipe per brand:
- Warm hospitality: `grade { preset: "warm", intensity: 0.55 }` + `vignette { angle: 0.35 }`
- Clean tech: `grade { preset: "cool", intensity: 0.4 }` + `glow { amount: 0.25 }`
- Documentary: `grade { preset: "cinema", intensity: 0.5 }` + `grain { amount: 12 }`
- Luxury mono: `grade { preset: "mono", intensity: 0.8 }` + `vignette { angle: 0.5 }`

Apply the same effect to every video clip with `add_effect`. Do not stack two `grade` effects on one clip.
If the user asks for something not covered by the catalog, read the `effect-authoring` skill.
