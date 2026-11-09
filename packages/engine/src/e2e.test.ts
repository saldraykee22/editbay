import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_STYLE } from '@editbay/core';
import { applyCommand, createEmptyProject } from '@editbay/core';
import type { Asset, Clip, Project, Track } from '@editbay/core';
import { availableVideoEncoders, selectVideoEncoder, videoEncoderArgs } from './encoder';
import { exportProject } from './export';
import { isFfmpegAvailable, resolveFfmpeg, runCommand, runCommandBuffer } from './ffmpeg';
import { buildRenderPlan, QUALITY_PRESETS } from './plan';
import { probeMedia } from './probe';
import { extractFrameDataUrl, makeThumbnail } from './thumbs';
import type { ExportProgress, ProbeResult } from './types';

/**
 * Real-ffmpeg end-to-end suite. Synthetic lavfi clips keep it fast (<10s) while
 * covering trim, text, xfade, audio mixing, thumbnails and encoding.
 */
const ffmpegAvailable = isFfmpegAvailable();
const suite = ffmpegAvailable ? describe : describe.skip;

const CANVAS = { width: 320, height: 240, fps: 30 } as const;

/** Fixture generation must respect the same encoder policy as exports. */
function fixtureEncodeArgs(width: number, height: number): string[] {
  return videoEncoderArgs({
    encoder: selectVideoEncoder().encoder,
    quality: 'draft',
    preset: QUALITY_PRESETS.draft,
    width,
    height,
    fps: 30,
  });
}

interface Fixtures {
  dir: string;
  red: { path: string; probe: ProbeResult };
  blue: { path: string; probe: ProbeResult };
  blueLong: { path: string; probe: ProbeResult };
  logo: { path: string; probe: ProbeResult };
  music: { path: string; probe: ProbeResult };
  image: { path: string; probe: ProbeResult };
  tall: { path: string; probe: ProbeResult };
}

let fixtures: Fixtures | undefined;

function fixture(): Fixtures {
  if (!fixtures) throw new Error('e2e fixtures were not created');
  return fixtures;
}

async function runFfmpeg(args: string[]): Promise<void> {
  const result = await runCommand(resolveFfmpeg(), args, { timeoutMs: 60_000 });
  if (result.code !== 0) throw new Error(`ffmpeg fixture generation failed: ${result.stderr.slice(-2000)}`);
}

function videoAsset(id: string, filePath: string, probe: ProbeResult, label: string): Asset {
  return {
    id,
    kind: 'video',
    uri: filePath,
    label,
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    hasAudio: probe.hasAudio,
  };
}

function makeClip(id: string, assetId: string, overrides: Partial<Clip> = {}): Clip {
  return { id, assetId, inMs: 0, outMs: 1000, effects: [], ...overrides };
}

/** Two video clips (trimmed, crossfaded), a text overlay and a music bed. */
function buildShowreel(): Project {
  const f = fixture();
  const assets: Asset[] = [
    videoAsset('red', f.red.path, f.red.probe, 'Red clip'),
    videoAsset('blue', f.blue.path, f.blue.probe, 'Blue clip'),
    {
      id: 'music',
      kind: 'audio',
      uri: f.music.path,
      label: 'Music bed',
      durationMs: f.music.probe.durationMs,
      hasAudio: f.music.probe.hasAudio,
    },
  ];

  const video: Track = {
    id: 'video',
    kind: 'video',
    name: 'Main',
    clips: [
      makeClip('clip-red', 'red', {
        inMs: 200,
        outMs: 1500,
        volume: 0.8,
        transitionOut: { id: 'tr-fade', type: 'fade', durationMs: 300 },
      }),
      makeClip('clip-blue', 'blue', { inMs: 0, outMs: 1200 }),
    ],
    items: [],
  };

  const text: Track = {
    id: 'text',
    kind: 'text',
    name: 'Titles',
    clips: [],
    items: [
      {
        id: 'title',
        text: 'EDITBAY',
        startMs: 0,
        durationMs: 1500,
        style: { ...DEFAULT_TEXT_STYLE, fontSize: 28, x: 0.5, y: 0.82 },
      },
    ],
  };

  const audio: Track = {
    id: 'audio',
    kind: 'audio',
    name: 'Music',
    clips: [
      makeClip('clip-music', 'music', {
        inMs: 0,
        outMs: 1200,
        startMs: 500,
        volume: 0.4,
        audioFadeInMs: 200,
        audioFadeOutMs: 300,
      }),
    ],
    items: [],
  };

  return {
    schemaVersion: 2,
    id: 'showreel',
    name: 'Showreel',
    canvas: CANVAS,
    assets,
    tracks: [video, text, audio],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function assetPathsOf(project: Project): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const asset of project.assets) paths[asset.id] = asset.uri;
  return paths;
}

/** Center pixel of a frame as RGB, decoded through ffmpeg rawvideo. */
async function centerPixel(filePath: string, atMs: number): Promise<[number, number, number]> {
  return pixelAt(filePath, atMs, CANVAS.width / 2, CANVAS.height / 2);
}

/** RGB of one canvas pixel in a frame, decoded through ffmpeg rawvideo. */
async function pixelAt(
  filePath: string,
  atMs: number,
  pixelX: number,
  pixelY: number,
): Promise<[number, number, number]> {
  const result = await runCommandBuffer(resolveFfmpeg(), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    (atMs / 1000).toFixed(3),
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]);
  expect(result.code).toBe(0);
  expect(result.stdout.length).toBe(CANVAS.width * CANVAS.height * 3);
  const x = Math.min(CANVAS.width - 1, Math.max(0, Math.round(pixelX)));
  const y = Math.min(CANVAS.height - 1, Math.max(0, Math.round(pixelY)));
  const offset = (y * CANVAS.width + x) * 3;
  return [result.stdout[offset] ?? -1, result.stdout[offset + 1] ?? -1, result.stdout[offset + 2] ?? -1];
}

suite('engine e2e (real ffmpeg)', () => {
  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'editbay-engine-e2e-'));
    const redPath = path.join(dir, 'red.mp4');
    const bluePath = path.join(dir, 'blue.mp4');
    const blueLongPath = path.join(dir, 'blue-long.mp4');
    const logoPath = path.join(dir, 'logo.png');
    const musicPath = path.join(dir, 'music.m4a');
    const imagePath = path.join(dir, 'still.png');
    const tallPath = path.join(dir, 'tall.mp4');

    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=320x240:r=30:d=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=2',
      ...fixtureEncodeArgs(320, 240),
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      redPath,
    ]);
    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=320x240:r=30:d=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=660:sample_rate=48000:duration=2',
      ...fixtureEncodeArgs(320, 240),
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      bluePath,
    ]);
    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=320x240:r=30:d=3',
      ...fixtureEncodeArgs(320, 240),
      '-pix_fmt',
      'yuv420p',
      blueLongPath,
    ]);
    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=200x200',
      '-frames:v',
      '1',
      logoPath,
    ]);
    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=48000:duration=1.5',
      '-c:a',
      'aac',
      musicPath,
    ]);
    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=320x240:r=30:d=1',
      '-frames:v',
      '1',
      imagePath,
    ]);
    // Tall yuv420p source: 1080 * 0.501 = 541 is odd (F-03 regression).
    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=teal:s=1080x1920:r=30:d=1',
      ...fixtureEncodeArgs(1080, 1920),
      '-pix_fmt',
      'yuv420p',
      tallPath,
    ]);

    const [redProbe, blueProbe, blueLongProbe, logoProbe, musicProbe, imageProbe, tallProbe] =
      await Promise.all([
        probeMedia(redPath),
        probeMedia(bluePath),
        probeMedia(blueLongPath),
        probeMedia(logoPath),
        probeMedia(musicPath),
        probeMedia(imagePath),
        probeMedia(tallPath),
      ]);

    fixtures = {
      dir,
      red: { path: redPath, probe: redProbe },
      blue: { path: bluePath, probe: blueProbe },
      blueLong: { path: blueLongPath, probe: blueLongProbe },
      logo: { path: logoPath, probe: logoProbe },
      music: { path: musicPath, probe: musicProbe },
      image: { path: imagePath, probe: imageProbe },
      tall: { path: tallPath, probe: tallProbe },
    };
  });

  afterAll(async () => {
    if (fixtures) await rm(fixtures.dir, { recursive: true, force: true });
  });

  it('probes the synthetic fixtures', () => {
    const f = fixture();
    expect(f.red.probe.width).toBe(320);
    expect(f.red.probe.height).toBe(240);
    expect(f.red.probe.fps).toBe(30);
    expect(f.red.probe.hasAudio).toBe(true);
    expect(f.red.probe.videoCodec).toBe('h264');
    expect(f.red.probe.durationMs).toBeGreaterThan(1800);
    expect(f.music.probe.hasAudio).toBe(true);
    expect(f.music.probe.videoCodec).toBeUndefined();
    expect(f.image.probe.hasAudio).toBe(false);
    expect(f.tall.probe.width).toBe(1080);
    expect(f.tall.probe.height).toBe(1920);
  });

  it('exports the showreel with a transition, text and mixed audio', async () => {
    const project = buildShowreel();
    const outPath = path.join(fixture().dir, 'showreel.mp4');
    const progress: ExportProgress[] = [];

    const result = await exportProject(project, {
      outPath,
      assetPaths: assetPathsOf(project),
      quality: 'draft',
      onProgress: (entry) => progress.push(entry),
    });

    // 1300ms + 1200ms - 300ms transition
    expect(result.durationMs).toBe(2200);
    expect(result.sizeBytes).toBeGreaterThan(2000);
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(existsSync(outPath)).toBe(true);
    expect((await stat(outPath)).size).toBe(result.sizeBytes);

    const probe = await probeMedia(outPath);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
    expect(probe.fps).toBe(30);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.audioCodec).toBe('aac');
    expect(probe.hasAudio).toBe(true);
    expect(Math.abs(probe.durationMs - 2200)).toBeLessThanOrEqual(300);
    // F-08: the export reports a real, probed encoder.
    expect(availableVideoEncoders()).toContain(result.videoEncoder);

    // Progress is monotonic and reaches the end.
    expect(progress.length).toBeGreaterThan(0);
    const fractions = progress.map((entry) => entry.fraction);
    for (let i = 1; i < fractions.length; i += 1) {
      expect(fractions[i]!).toBeGreaterThanOrEqual(fractions[i - 1]!);
    }
    expect(fractions[fractions.length - 1]).toBe(1);
    expect(progress.some((entry) => entry.outTimeMs !== undefined && entry.outTimeMs > 0)).toBe(true);

    // faststart: moov must come before mdat.
    const bytes = await readFile(outPath);
    const moov = bytes.indexOf('moov');
    const mdat = bytes.indexOf('mdat');
    expect(moov).toBeGreaterThan(0);
    expect(mdat).toBeGreaterThan(0);
    expect(moov).toBeLessThan(mdat);

    // Picture content: red before the crossfade, blue after it.
    const [r, g, b] = await centerPixel(outPath, 500);
    expect(Math.abs(r - 255)).toBeLessThanOrEqual(40);
    expect(g).toBeLessThanOrEqual(40);
    expect(b).toBeLessThanOrEqual(40);

    const [r2, g2, b2] = await centerPixel(outPath, 1800);
    expect(r2).toBeLessThanOrEqual(40);
    expect(g2).toBeLessThanOrEqual(40);
    expect(Math.abs(b2 - 255)).toBeLessThanOrEqual(40);
  });

  it('resolves an encoder from the probed list and maps quality args', () => {
    const project = buildShowreel();
    const plan = buildRenderPlan(project, {
      assetPaths: assetPathsOf(project),
      quality: 'draft',
      outPath: path.join(fixture().dir, 'plan.mp4'),
      textFileDir: fixture().dir,
    });

    const available = availableVideoEncoders();
    expect(available.length).toBeGreaterThan(0);
    expect(available).toContain(plan.videoEncoder);
    expect(plan.args[plan.args.indexOf('-c:v') + 1]).toBe(plan.videoEncoder);

    if (plan.videoEncoder === 'libx264') {
      expect(plan.args).toEqual(expect.arrayContaining(['-preset', 'ultrafast', '-crf', '28']));
    } else {
      expect(plan.args).toContain('-b:v');
      expect(plan.args).not.toContain('-crf');
      expect(plan.warnings.some((warning) => warning.includes('libx264 is not available'))).toBe(true);
    }
  });

  it('exports a 0.501-scaled clip from a 1080x1920 yuv420p source', async () => {
    const f = fixture();
    const asset: Asset = {
      id: 'tall',
      kind: 'video',
      uri: f.tall.path,
      label: 'Tall clip',
      durationMs: f.tall.probe.durationMs,
      width: f.tall.probe.width,
      height: f.tall.probe.height,
      fps: f.tall.probe.fps,
      hasAudio: false,
    };
    const project: Project = {
      schemaVersion: 2,
      id: 'scaled',
      name: 'Scaled',
      canvas: { width: 1080, height: 1920, fps: 30 },
      assets: [asset],
      tracks: [
        {
          id: 'video',
          kind: 'video',
          clips: [
            makeClip('tall-clip', 'tall', {
              inMs: 0,
              outMs: 600,
              transform: { x: 0, y: 0, scale: 0.501, rotation: 0, opacity: 1 },
            }),
          ],
          items: [],
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const outPath = path.join(f.dir, 'scaled.mp4');
    const plan = buildRenderPlan(project, {
      assetPaths: assetPathsOf(project),
      quality: 'draft',
      outPath,
      textFileDir: f.dir,
    });
    expect(plan.filterGraph).toContain(
      "format=rgba,scale=w='max(2,trunc(iw*0.501/2)*2)':h='max(2,trunc(ih*0.501/2)*2)'",
    );

    const result = await exportProject(project, {
      outPath,
      assetPaths: assetPathsOf(project),
      quality: 'draft',
    });
    expect(result.sizeBytes).toBeGreaterThan(1000);

    const probe = await probeMedia(outPath);
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1920);
    expect(Math.abs(probe.durationMs - 600)).toBeLessThanOrEqual(300);
  });

  it('composites a logo overlay only inside its timeline window', async () => {
    const f = fixture();
    const project = { current: createEmptyProject('Overlay') };
    const run = (command: Parameters<typeof applyCommand>[1]) => {
      const result = applyCommand(project.current, command);
      if (!result.ok) throw new Error(`${command.op} failed: ${result.error.message}`);
      project.current = result.project;
    };

    run({ op: 'set_canvas', width: CANVAS.width, height: CANVAS.height, fps: CANVAS.fps });
    run({
      op: 'add_asset',
      asset: videoAsset('bg', f.blueLong.path, f.blueLong.probe, 'Background'),
    });
    run({
      op: 'add_asset',
      asset: {
        id: 'logo',
        kind: 'image',
        uri: f.logo.path,
        label: 'Logo',
        durationMs: 1000,
        width: f.logo.probe.width,
        height: f.logo.probe.height,
        hasAudio: false,
      },
    });
    run({ op: 'import_clip', assetId: 'bg' });
    run({
      op: 'add_overlay',
      assetId: 'logo',
      startMs: 1000,
      durationMs: 1000,
      x: 0.85,
      y: 0.1,
      scale: 0.2,
    });

    const outPath = path.join(f.dir, 'overlay.mp4');
    const result = await exportProject(project.current, {
      outPath,
      assetPaths: assetPathsOf(project.current),
      quality: 'draft',
    });
    expect(result.sizeBytes).toBeGreaterThan(1000);
    expect(result.durationMs).toBeGreaterThanOrEqual(3000);

    // Logo centre: 0.85 * 320 = 272px, 0.1 * 240 = 24px; the overlay is 64px wide.
    const [r, g, b] = await pixelAt(outPath, 1500, 272, 24);
    expect(r).toBeGreaterThan(180);
    expect(g).toBeLessThan(90);
    expect(b).toBeLessThan(90);

    // Before the window the same spot shows the blue background.
    const [r0, g0, b0] = await pixelAt(outPath, 500, 272, 24);
    expect(r0).toBeLessThan(90);
    expect(b0).toBeGreaterThan(180);

    // And it disappears again once the overlay window ends.
    const [r2, g2, b2] = await pixelAt(outPath, 2500, 272, 24);
    expect(r2).toBeLessThan(90);
    expect(b2).toBeGreaterThan(180);
    expect(g2).toBeLessThan(90);
  });

  it('extracts data-url frames and writes thumbnails', async () => {
    const f = fixture();
    const dataUrl = await extractFrameDataUrl(f.red.path, 500, 160);
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);

    const jpeg = Buffer.from(dataUrl.slice('data:image/jpeg;base64,'.length), 'base64');
    expect(jpeg.length).toBeGreaterThan(200);
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
    expect(jpeg[jpeg.length - 2]).toBe(0xff);
    expect(jpeg[jpeg.length - 1]).toBe(0xd9);

    const thumbPath = path.join(f.dir, 'thumb.jpg');
    await makeThumbnail(f.blue.path, thumbPath, { atMs: 300, width: 160 });
    expect((await stat(thumbPath)).size).toBeGreaterThan(200);
    const thumbProbe = await probeMedia(thumbPath);
    expect(thumbProbe.width).toBe(160);
  });

  it('exports a silent still image without an audio stream', async () => {    const f = fixture();
    const imageAsset: Asset = {
      id: 'still',
      kind: 'image',
      uri: f.image.path,
      label: 'Still',
      durationMs: 1000,
      width: f.image.probe.width,
      height: f.image.probe.height,
      hasAudio: false,
    };
    const project: Project = {
      schemaVersion: 2,
      id: 'still-project',
      name: 'Still',
      canvas: CANVAS,
      assets: [imageAsset],
      tracks: [
        {
          id: 'video',
          kind: 'video',
          clips: [makeClip('still-clip', 'still', { inMs: 0, outMs: 1000, volume: 0 })],
          items: [],
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const plan = buildRenderPlan(project, {
      assetPaths: assetPathsOf(project),
      quality: 'draft',
      outPath: path.join(f.dir, 'still.mp4'),
      textFileDir: f.dir,
    });
    expect(plan.args).toContain('-loop');
    expect(plan.filterGraph).not.toContain('[aout]');

    const outPath = path.join(f.dir, 'still.mp4');
    const result = await exportProject(project, {
      outPath,
      assetPaths: assetPathsOf(project),
      quality: 'draft',
    });
    expect(result.durationMs).toBe(1000);

    const probe = await probeMedia(outPath);
    expect(probe.hasAudio).toBe(false);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
    expect(Math.abs(probe.durationMs - 1000)).toBeLessThanOrEqual(300);
  });

  it('aborts cleanly without leaving partial files', async () => {
    const project = buildShowreel();
    const outDir = path.join(fixture().dir, 'aborted');
    const outPath = path.join(outDir, 'aborted.mp4');
    const controller = new AbortController();
    controller.abort();

    await expect(
      exportProject(project, {
        outPath,
        assetPaths: assetPathsOf(project),
        quality: 'draft',
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/i);

    expect(existsSync(outPath)).toBe(false);
    const leftovers = existsSync(outDir) ? await readdir(outDir) : [];
    expect(leftovers).toEqual([]);
    expect(leftovers.filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('aborts mid-export without leaking temp files into the output folder', async () => {
    const f = fixture();
    const red = videoAsset('red', f.red.path, f.red.probe, 'Red clip');
    const blue = videoAsset('blue', f.blue.path, f.blue.probe, 'Blue clip');
    const clips: Clip[] = [];
    for (let index = 0; index < 30; index += 1) {
      clips.push(makeClip(`abort-${index}`, index % 2 === 0 ? 'red' : 'blue', { inMs: 0, outMs: 1200 }));
    }
    const project: Project = {
      schemaVersion: 2,
      id: 'abort-mid',
      name: 'Abort mid',
      canvas: CANVAS,
      assets: [red, blue],
      tracks: [{ id: 'video', kind: 'video', clips, items: [] }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const outDir = path.join(f.dir, 'aborted-mid');
    const outPath = path.join(outDir, 'mid.mp4');
    const controller = new AbortController();
    let aborted = false;

    await expect(
      exportProject(project, {
        outPath,
        assetPaths: assetPathsOf(project),
        // A slow preset guarantees the export is still running at 0.5 s.
        quality: 'high',
        signal: controller.signal,
        onProgress: () => {
          if (aborted) return;
          aborted = true;
          controller.abort();
        },
      }),
    ).rejects.toThrow(/aborted/i);

    expect(aborted).toBe(true);
    expect(existsSync(outPath)).toBe(false);
    const leftovers = existsSync(outDir) ? await readdir(outDir) : [];
    expect(leftovers.filter((name) => name.includes('.tmp-'))).toEqual([]);
  });
});
