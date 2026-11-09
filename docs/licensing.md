# Licensing notes

Editbay is Apache-2.0.

## FFmpeg

The app shells out to an FFmpeg binary. For distribution:

- Ship an **LGPL** build (`--disable-gpl --disable-nonfree`), not a GPL build with libx264.
- Publish the corresponding FFmpeg source next to the binary and include the LGPL notice in About.
- Do not add an anti-reverse-engineering clause.
- H.264/AAC patent licensing is separate from copyright; for commercial distribution prefer platform encoders (Media Foundation on Windows, VideoToolbox on macOS, MediaCodec on Android) where feasible.

Developer machines can use any FFmpeg build; that does not change what is distributed.

### Bundled FFmpeg

Release builds ship an FFmpeg binary inside the installer under `resources/ffmpeg`
(`ffmpeg`, `ffprobe`, `LICENSE`, `README`). It is produced by:

```bash
pnpm fetch:ffmpeg          # download + verify the LGPL build for this platform
pnpm fetch:ffmpeg --from <archive-or-directory>   # use a local build instead
```

- **Which build:** the newest BtbN `FFmpeg-Builds` **LGPL** archive for the target
  (`ffmpeg-n8.*-latest-<win64|linux64|linuxarm64>-lgpl-*`), i.e. configured with
  `--disable-gpl --disable-nonfree`. No libx264; the engine falls back to
  `libopenh264`, `h264_mf`, `h264_nvenc` or `h264_videotoolbox` (see
  `packages/engine/src/encoder.ts`).
- **Source:** <https://github.com/BtbN/FFmpeg-Builds> publishes the binaries, the
  build scripts and the corresponding FFmpeg source for every release;
  upstream source is at <https://ffmpeg.org/download.html>. Keep the version
  recorded in the release notes next to the binary we ship.
- **Integrity:** `scripts/fetch-ffmpeg.mjs` verifies the release's
  `checksums.sha256` when present and refuses any binary whose `ffmpeg -version`
  reports `--enable-gpl` (GPL builds are never distributed).
- **Replacing it:** the binary is discovered in this order: `EDITBAY_FFMPEG`
  (explicit path or directory), the bundled copy, then `PATH`. Users who prefer
  their own build can set `EDITBAY_FFMPEG` (and `EDITBAY_FFPROBE`) and the bundled
  copy is ignored. The Settings panel shows which of the three is in use.
- **macOS:** BtbN does not publish macOS binaries; pass a local build with
  `--from <archive-or-directory>` or `EDITBAY_FFMPEG_ARCHIVE=<path>`.

## Fonts

IBM Plex Sans / Mono — SIL Open Font License 1.1 (`apps/desktop/src/renderer/public/fonts/OFL.txt`).

## Dependencies

Every dependency must be MIT/BSD/Apache-2.0/ISC or OFL. Copyleft dependencies need an explicit decision recorded here before merge.
