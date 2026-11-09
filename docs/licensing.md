# Licensing notes

Editbay is Apache-2.0.

## FFmpeg

The app shells out to an FFmpeg binary. For distribution:

- Ship an **LGPL** build (`--disable-gpl --disable-nonfree`), not a GPL build with libx264.
- Publish the corresponding FFmpeg source next to the binary and include the LGPL notice in About.
- Do not add an anti-reverse-engineering clause.
- H.264/AAC patent licensing is separate from copyright; for commercial distribution prefer platform encoders (Media Foundation on Windows, VideoToolbox on macOS, MediaCodec on Android) where feasible.

Developer machines can use any FFmpeg build; that does not change what is distributed.

## Fonts

IBM Plex Sans / Mono — SIL Open Font License 1.1 (`apps/desktop/src/renderer/public/fonts/OFL.txt`).

## Dependencies

Every dependency must be MIT/BSD/Apache-2.0/ISC or OFL. Copyleft dependencies need an explicit decision recorded here before merge.
