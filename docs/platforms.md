# Platforms

Ship order: **desktop (Windows, Linux, macOS) → Android → iOS**.

## Today: desktop

Electron shell (`apps/desktop`), React renderer, FFmpeg binary from `PATH` or `EDITBAY_FFMPEG`. The renderer talks to the OS through a small, typed preload API (`apps/desktop/src/shared/api.ts`).

## Android (next)

The renderer is a plain web app; it can run inside a Capacitor shell. What changes:

| Concern | Desktop | Android |
|---|---|---|
| Shell | Electron | Capacitor (or Tauri v2) |
| Media access | file paths | Storage Access Framework + content URIs |
| Preview | `<video>` + Canvas 2D | same, with WebCodecs fallback |
| Export | FFmpeg CLI | Media3 Transformer, or an FFmpeg build that supports the ABI |
| Keys | Electron safeStorage | Android Keystore via a plugin |

The engine package is split between a **pure planner** (`buildRenderPlan`, testable everywhere) and a **platform executor**. Android gets its own executor; the command engine, harness and UI stay untouched.

## iOS / macOS later

Same UI, native executors: AVFoundation (`AVAssetExportSession` / `AVAssetWriter`) for export, AVPlayer for preview. Keys in Keychain. The command schema already forbids arbitrary code execution, which keeps App Store review tractable.

## What must never be platform-specific

- Project model and commands (`packages/core`)
- Agent loop, tools, skills, memory (`packages/harness`)
- Effect definitions and their parameter contracts
- The UI (React)

If a feature needs platform code, it goes behind an interface in `packages/engine` or the shell — never into the domain.
