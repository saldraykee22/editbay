# Contributing

Editbay is early. The most useful contributions right now:

1. **Reproduce a real edit** with the agent and report where it failed (prompt, project, what you expected).
2. **Write a skill** for a workflow you repeat (a client's style, a platform format, a caption convention).
3. **Add a test** for a command edge case. The command engine is the contract; tests there are worth more than UI polish.
4. **Platform work**: Android executor, macOS packaging, FFmpeg LGPL build pipeline.

## Ground rules

- Domain logic stays platform-agnostic (`packages/core`, `packages/harness`).
- No command mutates state without validation and an undo entry.
- Never send asset paths or media to a provider. Labels only.
- Preview may approximate; export must be honest. If they differ, say so in the UI.
- Tests: `pnpm test`, typecheck: `pnpm typecheck`. A PR without a test needs a reason.

## Style

TypeScript strict, no `any`, small pure functions, English comments. UI copy is plain and specific — no "unleash", "revolutionary", "game-changer".
