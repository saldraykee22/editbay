# Skills

A skill is a folder with a `SKILL.md` file: YAML front-matter plus instructions the agent reads when a request matches.

```
workspace/skills/rough-cut/SKILL.md
workspace/skills/brand-endcard/SKILL.md
workspace/skills/my-house-style/SKILL.md
```

```markdown
---
id: my-house-style
name: My house style
description: How this client's videos always look and sound.
triggers: [house style, brand, client]
version: 1
builtin: false
---

# House style

1. Open on the product, never on a logo.
2. Captions: 2 lines max, mint accent, bottom at y = 0.82.
3. End card: logo line 1.8s, tagline 1s, no music sting.
```

Matching is deliberately simple and local (trigger + description scoring). No embeddings, no upload. If several skills match, they are included in the prompt in score order.

Built-in skills shipped with the app:

| id | when it loads |
|---|---|
| `rough-cut` | assemble / first cut / edit this |
| `captions` | captions, subtitles, text |
| `brand-endcard` | logo, end card, CTA |
| `color-look` | grade, look, cinematic |
| `effect-authoring` | custom effect, animation |
| `delivery-specs` | reels, tiktok, export, 9:16 |

## Skills with code

A skill may ship an `code/effect.js` module (see `effect-authoring`). It is loaded by the UI as a parametric effect:

```js
const effect = {
  id: 'pulse-border',
  name: 'Pulse border',
  category: 'motion',
  description: 'A mint border that breathes.',
  params: [{ key: 'amount', label: 'Amount', type: 'number', default: 0.4, min: 0, max: 1 }],
  style: ({ progress, params }) => ({
    scale: 1 + Math.sin(progress * Math.PI * 2) * params.amount * 0.02,
  }),
};
```

Rules: pure functions, no DOM, no imports, no network. Preview is instant; export uses an `ffmpeg(params, meta)` function when provided, otherwise the effect is preview-only and the app says so.

## Writing a good skill

- One job per skill. "Captions" beats "make it good".
- State the order of operations and the exact command ops to use.
- Include hard numbers (positions, durations, font sizes) so the model does not invent them.
- Say what **not** to do; that is usually the most valuable line.
