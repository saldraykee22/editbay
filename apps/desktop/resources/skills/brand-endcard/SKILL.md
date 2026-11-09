---
id: brand-endcard
name: Brand end card
description: Close every cut with the brand's logo line, tone and call to action.
triggers: [logo, end card, brand, marka, kapanış, cta]
version: 1
builtin: true
---
# Brand end card

Read the brand identity from memory before editing (`search_memory` / brand profile).

1. Reserve the last 1.5–2.5 seconds for the end card.
2. Pull the brand name, tagline and CTA from the brand identity. If the identity has no CTA, use the one the user gave in this conversation; otherwise ask.
3. Place the brand name with `add_text`: centered, `y = 0.62`, fontSize 84–110, brand colour from the identity.
4. Never redraw or approximate a logo with text if a logo asset exists — ask the user to import it.
5. Keep the end card background calm: either the last shot with a subtle `fade` effect or black.

Tone: match the brand voice exactly; do not add generic marketing lines.
