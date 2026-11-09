# Roadmap

## v0.1 — preview (now)

- [x] Project model, command engine, undo, change summaries
- [x] FFmpeg export with transitions, text, audio mixing, progress
- [x] Desktop shell, timeline, preview compositor, design system
- [x] Agent harness: providers, tools, skills, memory, receipts
- [x] Brand identity + memory files, skill authoring
- [x] OpenRouter OAuth, OS keychain storage
- [ ] Windows/Linux/macOS installers (electron-builder)
- [ ] Signed releases, auto-update

## v0.2 — the editor that keeps up

- [ ] Proxy media for smooth 4K preview
- [ ] Waveforms and audio scrubbing
- [ ] Keyframes for transform/opacity
- [ ] Effect stack UI (drag to reorder, parameter sliders)
- [x] Caption track from SRT/VTT
- [ ] Captions from a transcript (needs local STT)
- [ ] Project version history and diff view

## v0.3 — the agent that earns trust

- [ ] Streaming responses and cancellable runs
- [ ] Plan preview: show the intended edit before applying (multi-step)
- [ ] Skill authoring from a corrected edit ("remember this for next time")
- [ ] Receipts UI: every agent action, replayable
- [ ] Local STT (Whisper) for transcript-driven rough cuts

## v0.4 — teams and clients

- [ ] Shareable review link (opt-in upload of a compressed cut only)
- [ ] Comment-to-command ("move the logo up 2%")
- [ ] Multi-brand workspace
- [ ] Export presets per platform

## Later

- [ ] Image generation providers (covers, thumbnails, b-roll stills)
- [ ] Video generation providers (BYOK), always as assets — never as a hidden edit
- [ ] Android app, then iOS
- [ ] Plugin API for third-party effect packs

## Non-goals

- Becoming a CapCut clone. Manual editing exists so the agent is optional, not because we want a full NLE.
- Training or hosting models. Editbay is the workspace; providers are yours.
- Uploading media by default. Anything that leaves the machine is explicit.
