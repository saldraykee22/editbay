---
id: effect-authoring
name: Authoring effects
description: Write a new parametric effect module when the built-in catalog is not enough.
triggers: [new effect, custom effect, transition, animasyon, efekt yaz, shader]
version: 1
builtin: true
---
# Authoring effects

Built-ins cover motion (fade, kenburns, zoom-punch, shake), colour (grade), texture (blur, glow, grain, vignette, glitch) and transitions (fade, dissolve, slide, wipe, circle, zoom).

When none fits:
1. Say what is missing in one sentence and confirm with the user.
2. Write a skill folder `skills/<effect-id>/SKILL.md` describing the intent AND a `code/effect.js` file with this exact shape:

```js
const effect = {
  id: 'pulse-border',
  name: 'Pulse border',
  category: 'motion', // motion | color | texture | audio
  description: 'A mint border that breathes with the beat.',
  params: [
    { key: 'amount', label: 'Amount', type: 'number', default: 0.4, min: 0, max: 1, step: 0.05 },
  ],
  style: ({ progress, params, width, height }) => ({
    scale: 1 + Math.sin(progress * Math.PI * 2) * params.amount * 0.02,
    filter: `drop-shadow(0 0 ${12 * params.amount}px rgba(91,233,166,.5))`,
  }),
};
```

3. `style()` must be pure, fast, and use only the arguments provided. No DOM, no network, no imports.
4. Custom effects render in preview immediately. They export only if a matching `ffmpeg` function exists; otherwise the exporter falls back to a neutral approximation — tell the user this honestly.
5. Register it with `add_effect { clipId, effect: { type: "<effect-id>", params: {...} } }` after the user approves the code.
