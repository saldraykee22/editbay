import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function createDemoMedia(dir) {
  mkdirSync(dir, { recursive: true });
  const clip1 = resolve(dir, 'roastery-tour.mp4');
  const clip2 = resolve(dir, 'pour-shot.mp4');
  const music = resolve(dir, 'bed.mp3');
  const logo = resolve(dir, 'northwind-logo.png');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=420:sample_rate=48000', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip1]);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'smptebars=size=720x1280:rate=30', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip2]);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '9', '-c:a', 'libmp3lame', music]);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x5BE9A6:s=200x200', '-frames:v', '1', logo]);
  return { clip1, clip2, music, logo };
}

export function buildDemoProject(media) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id: 'p_demo',
    name: 'Roastery — launch cut',
    canvas: { width: 1080, height: 1920, fps: 30 },
    brandId: 'default',
    createdAt: now,
    updatedAt: now,
    assets: [
      { id: 'a_tour', kind: 'video', uri: media.clip1, label: 'roastery-tour.mp4', durationMs: 5000, width: 720, height: 1280, hasAudio: true, origin: 'imported' },
      { id: 'a_pour', kind: 'video', uri: media.clip2, label: 'pour-shot.mp4', durationMs: 4000, width: 720, height: 1280, hasAudio: false, origin: 'imported' },
      { id: 'a_bed', kind: 'audio', uri: media.music, label: 'bed.mp3', durationMs: 9000, hasAudio: true, origin: 'imported' },
      { id: 'a_logo', kind: 'image', uri: media.logo, label: 'northwind-logo.png', durationMs: 5000, width: 200, height: 200, origin: 'imported' },
    ],
    tracks: [
      {
        id: 'v1',
        kind: 'video',
        clips: [
          {
            id: 'c_tour',
            assetId: 'a_tour',
            inMs: 300,
            outMs: 4300,
            effects: [{ id: 'fx_grade', type: 'grade', params: { preset: 'warm', intensity: 0.55 } }],
            transitionOut: { id: 'tr_1', type: 'fade', durationMs: 500 },
          },
          { id: 'c_pour', assetId: 'a_pour', inMs: 0, outMs: 3200, effects: [{ id: 'fx_zoom', type: 'kenburns', params: { zoom: 1.12, direction: 'in' } }] },
        ],
        items: [],
      },
      {
        id: 'o1',
        kind: 'overlay',
        clips: [
          {
            id: 'c_logo',
            assetId: 'a_logo',
            inMs: 0,
            outMs: 6400,
            startMs: 300,
            transform: { x: 0.38, y: -0.42, scale: 0.16, rotation: 0, opacity: 1 },
            effects: [],
          },
        ],
        items: [],
      },
      {
        id: 't1',
        kind: 'text',
        clips: [],
        items: [
          {
            id: 'x_1',
            text: 'Kavurma odasından\ndoğrudan fincana',
            startMs: 400,
            durationMs: 3000,
            animation: 'rise',
            style: {
              fontFamily: 'IBM Plex Sans',
              fontSize: 86,
              fontWeight: 600,
              color: '#F2F7F4',
              align: 'center',
              x: 0.5,
              y: 0.72,
              background: '#00000099',
              padding: 22,
              radius: 14,
              lineHeight: 1.1,
            },
          },
          {
            id: 'x_2',
            text: 'NORTHWIND · ISTANBUL',
            startMs: 4600,
            durationMs: 2400,
            animation: 'fade',
            style: {
              fontFamily: 'IBM Plex Mono',
              fontSize: 40,
              fontWeight: 500,
              color: '#5BE9A6',
              align: 'center',
              x: 0.5,
              y: 0.84,
              letterSpacing: 6,
            },
          },
        ],
      },
      { id: 'a1', kind: 'audio', clips: [{ id: 'c_bed', assetId: 'a_bed', inMs: 0, outMs: 8200, startMs: 0, volume: 0.45, effects: [] }], items: [] },
    ],
  };
}
