import { _electron as electron } from 'playwright';
import { electronPath as electronPathFor } from './lib/electron-path.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const appDir = resolve(root, 'apps/desktop');
const electronPath = electronPathFor(root);
const demoDir = resolve(root, '.demo');
mkdirSync(demoDir, { recursive: true });

const clip1 = resolve(demoDir, 'roastery-tour.mp4');
const clip2 = resolve(demoDir, 'pour-shot.mp4');
const music = resolve(demoDir, 'bed.mp3');

execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=420:sample_rate=48000', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip1]);
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'smptebars=size=720x1280:rate=30', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip2]);
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '9', '-c:a', 'libmp3lame', music]);

const now = new Date().toISOString();
const project = {
  schemaVersion: 2,
  id: 'p_demo',
  name: 'Roastery — launch cut',
  canvas: { width: 1080, height: 1920, fps: 30 },
  brandId: 'default',
  createdAt: now,
  updatedAt: now,
  assets: [
    { id: 'a_tour', kind: 'video', uri: clip1, label: 'roastery-tour.mp4', durationMs: 5000, width: 720, height: 1280, hasAudio: true, origin: 'imported' },
    { id: 'a_pour', kind: 'video', uri: clip2, label: 'pour-shot.mp4', durationMs: 4000, width: 720, height: 1280, hasAudio: false, origin: 'imported' },
    { id: 'a_bed', kind: 'audio', uri: music, label: 'bed.mp3', durationMs: 9000, hasAudio: true, origin: 'imported' },
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
    { id: 'a1', kind: 'audio', clips: [{ id: 'c_bed', assetId: 'a_bed', inMs: 0, outMs: 7500, startMs: 0, volume: 0.45, effects: [] }], items: [] },
  ],
};

const app = await electron.launch({ executablePath: electronPath, args: [appDir], cwd: appDir });
const page = await app.firstWindow();
await page.waitForTimeout(600);
const info = await page.evaluate(() => window.editbay.appInfo());
mkdirSync(resolve(info.workspaceRoot, 'projects'), { recursive: true });
writeFileSync(resolve(info.workspaceRoot, 'projects/current.json'), JSON.stringify(project, null, 2), 'utf8');
await page.reload();
await page.waitForTimeout(2600);
await page.evaluate(() => document.querySelector('.stage-frame')?.scrollIntoView());
await page.screenshot({ path: resolve(root, 'docs/screenshots/app-demo.png') });
const text = await page.evaluate(() => document.body.innerText);
console.log(JSON.stringify({ workspace: info.workspaceRoot, hasTimeline: text.includes('Timeline') || text.includes('TIMELINE'), clips: text.match(/\d+ clips/)?.[0], text: text.slice(0, 400) }, null, 2));
await app.close();
