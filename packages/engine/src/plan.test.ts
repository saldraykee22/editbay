import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_STYLE } from '@editbay/core';
import type { Asset, AssetKind, Clip, Project, TextItem, Track } from '@editbay/core';
import {
  buildRenderPlan,
  RenderError,
  atempoChain,
  QUALITY_PRESETS,
  splitFilterChain,
  withEnableWindow,
} from './plan';
import type { EngineRenderPlan, RenderPlanOptions } from './plan';
import { clipDurationMs, projectDurationMs, sequentialStarts, timelineOf } from './timing';

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makeAsset(id: string, kind: AssetKind = 'video', overrides: Partial<Asset> = {}): Asset {
  const ext = kind === 'image' ? 'png' : kind === 'audio' ? 'm4a' : 'mp4';
  return {
    id,
    kind,
    uri: `C:/media/${id}.${ext}`,
    label: `${id.toUpperCase()}.${ext}`,
    durationMs: 10_000,
    hasAudio: kind !== 'image',
    ...overrides,
  };
}

function makeClip(id: string, assetId: string, overrides: Partial<Clip> = {}): Clip {
  return { id, assetId, inMs: 0, outMs: 2000, effects: [], ...overrides };
}

function makeText(id: string, overrides: Partial<TextItem> = {}): TextItem {
  return {
    id,
    text: 'Hello world',
    startMs: 500,
    durationMs: 1500,
    style: { ...DEFAULT_TEXT_STYLE },
    ...overrides,
  };
}

interface ProjectOptions {
  clips?: Clip[];
  audioClips?: Clip[];
  textItems?: TextItem[];
  assets?: Asset[];
  canvas?: Project['canvas'];
}

function makeProject(opts: ProjectOptions = {}): Project {
  const assets = opts.assets ?? [makeAsset('a1'), makeAsset('a2')];
  const tracks: Track[] = [
    { id: 'vt', kind: 'video', clips: opts.clips ?? [makeClip('c1', 'a1')], items: [] },
  ];
  if (opts.textItems?.length) tracks.push({ id: 'tt', kind: 'text', clips: [], items: opts.textItems });
  if (opts.audioClips?.length) tracks.push({ id: 'at', kind: 'audio', clips: opts.audioClips, items: [] });

  return {
    schemaVersion: 2,
    id: 'proj',
    name: 'Test project',
    canvas: opts.canvas ?? { width: 1080, height: 1920, fps: 30 },
    assets,
    tracks,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function planFor(project: Project, overrides: Partial<RenderPlanOptions> = {}): EngineRenderPlan {
  const assetPaths: Record<string, string> = {};
  for (const asset of project.assets) assetPaths[asset.id] = asset.uri;
  return buildRenderPlan(project, {
    assetPaths,
    outPath: 'C:/out/final.mp4',
    textFileDir: 'C:/tmp/editbay-text',
    // Pin the encoder so unit tests never depend on the host binary.
    videoEncoder: 'libx264',
    ...overrides,
  });
}

function argAfter(plan: EngineRenderPlan, flag: string): string | undefined {
  const index = plan.args.indexOf(flag);
  return index >= 0 ? plan.args[index + 1] : undefined;
}

/* ------------------------------------------------------------------ */
/* Timing                                                             */
/* ------------------------------------------------------------------ */

describe('timing', () => {
  it('divides clip duration by speed', () => {
    expect(clipDurationMs(makeClip('c', 'a', { inMs: 0, outMs: 4000 }))).toBe(4000);
    expect(clipDurationMs(makeClip('c', 'a', { inMs: 0, outMs: 4000, speed: 2 }))).toBe(2000);
    expect(clipDurationMs(makeClip('c', 'a', { inMs: 1000, outMs: 3000, speed: 0.5 }))).toBe(4000);
  });

  it('starts video clips sequentially without transitions', () => {
    const clips = [
      makeClip('c1', 'a1', { outMs: 1000 }),
      makeClip('c2', 'a2', { outMs: 1500 }),
      makeClip('c3', 'a1', { outMs: 500 }),
    ];
    expect(sequentialStarts(clips)).toEqual([0, 1000, 2500]);
    expect(timelineOf(clips).durationMs).toBe(3000);
  });

  it('pulls clips back by the transition overlap', () => {
    const clips = [
      makeClip('c1', 'a1', {
        outMs: 2000,
        transitionOut: { id: 't1', type: 'fade', durationMs: 500 },
      }),
      makeClip('c2', 'a2', { outMs: 2000 }),
    ];
    const timeline = timelineOf(clips);
    expect(timeline.clips[1]?.startMs).toBe(1500);
    expect(timeline.durationMs).toBe(3500);
  });

  it('skips an audio clip that starts after the project ends', () => {
    const project = makeProject({
      clips: [makeClip('c1', 'a1', { outMs: 1000 })],
      audioClips: [makeClip('c2', 'a3', { startMs: 2000, outMs: 3000 })],
      assets: [makeAsset('a1'), makeAsset('a3', 'audio')],
    });
    const plan = planFor(project);
    expect(plan.durationMs).toBe(1000);
    expect(plan.inputs).toEqual(['C:/media/a1.mp4']);
    expect(plan.warnings.some((warning) => warning.includes('after the project ends'))).toBe(true);
  });

  it('measures the project by its picture, not by a long music bed', () => {
    const project = makeProject({
      clips: [makeClip('c1', 'a1', { outMs: 5000 })],
      audioClips: [makeClip('c2', 'a3', { outMs: 60_000 })],
      assets: [makeAsset('a1'), makeAsset('a3', 'audio')],
    });
    expect(projectDurationMs(project)).toBe(5000);

    const audioTrack = project.tracks.find((track) => track.kind === 'audio');
    expect(audioTrack).toBeDefined();
    if (audioTrack) audioTrack.muted = true;

    expect(projectDurationMs(project)).toBe(5000);
    expect(planFor(project).durationMs).toBe(5000);
  });
});

/* ------------------------------------------------------------------ */
/* Video graph                                                       */
/* ------------------------------------------------------------------ */

describe('buildRenderPlan: video', () => {
  it('trims, retimes, letterboxes and normalises one clip', () => {
    const project = makeProject({
      clips: [makeClip('c1', 'a1', { inMs: 1000, outMs: 3000 })],
    });
    const plan = planFor(project);
    // Input-level seek (F-23) and a zero-based filter trim.
    expect(plan.args).toEqual(
      expect.arrayContaining(['-ss', '1.000', '-to', '3.000', '-i', 'C:/media/a1.mp4']),
    );
    expect(plan.filterGraph).toContain('trim=start=0.000:end=2.000');
    expect(plan.filterGraph).toContain('setpts=PTS-STARTPTS');
    expect(plan.filterGraph).not.toContain('setpts=(PTS-STARTPTS)/');
    expect(plan.filterGraph).toContain('fps=30');
    expect(plan.filterGraph).toContain('scale=1080:1920:force_original_aspect_ratio=increase');
    expect(plan.filterGraph).toContain('crop=1080:1920');
    expect(plan.filterGraph).toContain('setsar=1');
    expect(plan.filterGraph).toContain('[vfinal]');
    expect(plan.args).toContain('[vfinal]');
  });

  it('applies speed in setpts and shortens the clip', () => {
    const project = makeProject({ clips: [makeClip('c1', 'a1', { outMs: 2000, speed: 2 })] });
    const plan = planFor(project);
    expect(plan.filterGraph).toContain('setpts=(PTS-STARTPTS)/2');
    expect(plan.durationMs).toBe(1000);
    expect(argAfter(plan, '-t')).toBe('1.000');
  });

  it('loops image inputs for the clip length plus a second', () => {
    const project = makeProject({
      assets: [makeAsset('a1', 'image')],
      clips: [makeClip('c1', 'a1', { outMs: 2000 })],
    });
    const plan = planFor(project);
    const loopIndex = plan.args.indexOf('-loop');
    expect(loopIndex).toBeGreaterThanOrEqual(0);
    expect(plan.args[loopIndex + 1]).toBe('1');
    expect(plan.args[loopIndex + 2]).toBe('-t');
    expect(plan.args[loopIndex + 3]).toBe('3.000');
    expect(plan.args[loopIndex + 4]).toBe('-i');
    expect(plan.inputs).toEqual(['C:/media/a1.png']);
  });

  it('chains clips with xfade at the right offsets', () => {
    const project = makeProject({
      clips: [
        makeClip('c1', 'a1', { outMs: 2000, transitionOut: { id: 't1', type: 'fade', durationMs: 500 } }),
        makeClip('c2', 'a2', { outMs: 2000 }),
      ],
    });
    const plan = planFor(project);
    expect(plan.filterGraph).toContain('xfade=transition=fade:duration=0.500:offset=1.500');
    expect(plan.filterGraph).toContain('[vout]');
    expect(plan.durationMs).toBe(3500);
  });

  it('accumulates transition offsets across three clips', () => {
    const project = makeProject({
      clips: [
        makeClip('c1', 'a1', { outMs: 2000, transitionOut: { id: 't1', type: 'dissolve', durationMs: 500 } }),
        makeClip('c2', 'a2', { outMs: 2000, transitionOut: { id: 't2', type: 'slideleft', durationMs: 500 } }),
        makeClip('c3', 'a1', { outMs: 2000 }),
      ],
    });
    const plan = planFor(project);
    expect(plan.filterGraph).toContain('xfade=transition=dissolve:duration=0.500:offset=1.500');
    expect(plan.filterGraph).toContain('xfade=transition=slideleft:duration=0.500:offset=3.000');
    expect(plan.durationMs).toBe(5000);
  });

  it('clamps an overlong transition to the clip lengths', () => {
    const project = makeProject({
      clips: [
        makeClip('c1', 'a1', { outMs: 200, transitionOut: { id: 't1', type: 'fade', durationMs: 900 } }),
        makeClip('c2', 'a2', { outMs: 200 }),
      ],
    });
    const plan = planFor(project);
    // @editbay/core clamps to floor(min(prev, next) / 2) = 100 ms.
    expect(plan.filterGraph).toContain('duration=0.100');
    expect(plan.filterGraph).toContain('offset=0.100');
    expect(plan.durationMs).toBe(300);
    expect(plan.warnings.some((warning) => warning.includes('clips allow'))).toBe(false);
  });

  it('falls back to concat without a transition and warns on unknown ids', () => {
    const withoutTransition = planFor(
      makeProject({
        clips: [makeClip('c1', 'a1', { outMs: 1000 }), makeClip('c2', 'a2', { outMs: 1000 })],
      }),
    );
    expect(withoutTransition.filterGraph).toContain('concat=n=2:v=1:a=0');

    const unknown = planFor(
      makeProject({
        clips: [
          makeClip('c1', 'a1', { outMs: 2000, transitionOut: { id: 't1', type: 'warp', durationMs: 300 } }),
          makeClip('c2', 'a2', { outMs: 2000 }),
        ],
      }),
    );
    expect(unknown.filterGraph).toContain('xfade=transition=fade:duration=0.300');
    expect(unknown.warnings.some((warning) => warning.includes('Unknown transition "warp"'))).toBe(true);
  });

  it('skips the transform chain when the transform is default', () => {
    const plan = planFor(makeProject());
    expect(plan.filterGraph).not.toContain('rotate=');
    expect(plan.filterGraph).not.toContain('color=c=black');
  });

  it('composites non-default transforms on a black canvas', () => {
    const plan = planFor(
      makeProject({
        clips: [
          makeClip('c1', 'a1', {
            transform: { x: 0.1, y: -0.05, scale: 1.5, rotation: 10, opacity: 0.5 },
          }),
        ],
      }),
    );
    expect(plan.filterGraph).toContain(
      "scale=w='max(2,trunc(iw*1.5/2)*2)':h='max(2,trunc(ih*1.5/2)*2)'",
    );
    expect(plan.filterGraph).toContain('rotate=0.174533');
    expect(plan.filterGraph).toContain('colorchannelmixer=aa=0.5');
    expect(plan.filterGraph).toContain('color=c=black:s=1080x1920');
    expect(plan.filterGraph).toContain('overlay=x=(main_w-overlay_w)/2+108:y=(main_h-overlay_h)/2+-96');
  });

  it('converts to rgba before scaling and rounds odd scaled sizes to even', () => {
    const plan = planFor(
      makeProject({
        clips: [makeClip('c1', 'a1', { transform: { x: 0, y: 0, scale: 0.501, rotation: 0, opacity: 1 } })],
      }),
    );
    const layer = plan.filterGraph.split(';').find((line) => line.includes('scale=w='));
    expect(layer).toBeDefined();
    const order = layer?.indexOf('format=rgba') ?? -1;
    const scale = layer?.indexOf("scale=w='max(2,trunc(iw*0.501/2)*2)'") ?? -1;
    expect(order).toBeGreaterThanOrEqual(0);
    expect(scale).toBeGreaterThan(order);
  });

  it('resolves one input per clip in order', () => {
    const project = makeProject({
      assets: [makeAsset('a1'), makeAsset('a2'), makeAsset('a3', 'audio')],
      clips: [makeClip('c1', 'a1', { outMs: 1000 }), makeClip('c2', 'a2', { outMs: 1000 })],
      audioClips: [makeClip('c3', 'a3', { outMs: 1000 })],
    });
    const plan = planFor(project);
    expect(plan.inputs).toEqual(['C:/media/a1.mp4', 'C:/media/a2.mp4', 'C:/media/a3.m4a']);
    expect(plan.args.filter((arg) => arg === '-i')).toHaveLength(3);
  });

  it('seeks split clips at the input and trims from zero', () => {
    const plan = planFor(makeProject({ clips: [makeClip('c1', 'a1', { inMs: 60_000, outMs: 65_000 })] }));
    const inputAt = plan.args.indexOf('-i');
    expect(inputAt).toBeGreaterThan(0);
    expect(plan.args.slice(0, inputAt)).toEqual(expect.arrayContaining(['-ss', '60.000', '-to', '65.000']));
    expect(plan.args.indexOf('-ss')).toBeLessThan(inputAt);
    expect(plan.filterGraph).toContain('trim=start=0.000:end=5.000');
    expect(plan.durationMs).toBe(5000);
  });

  it('keeps input-level seeking for retimed clips so A/V stay in sync', () => {
    const plan = planFor(
      makeProject({ clips: [makeClip('c1', 'a1', { inMs: 60_000, outMs: 65_000, speed: 2 })] }),
    );
    expect(plan.args).toEqual(expect.arrayContaining(['-ss', '60.000', '-to', '65.000']));
    expect(plan.filterGraph).toContain('setpts=(PTS-STARTPTS)/2');
    expect(plan.filterGraph).toContain('atempo=2');
    expect(plan.durationMs).toBe(2500);
  });
});

/* ------------------------------------------------------------------ */
/* Text                                                               */
/* ------------------------------------------------------------------ */

describe('buildRenderPlan: text', () => {
  it('emits drawtext with a text file and its time window', () => {
    const project = makeProject({ textItems: [makeText('t1', { text: 'Merhaba dünya' })] });
    const plan = planFor(project);

    expect(plan.filterGraph).toContain('drawtext=');
    expect(plan.filterGraph).toContain("textfile='C\\:/tmp/editbay-text/editbay-text-proj-0.txt'");
    expect(plan.filterGraph).toContain("enable='between(t,0.500,2.000)'");
    expect(plan.textFiles).toHaveLength(1);
    expect(plan.textFiles[0]?.content).toBe('Merhaba dünya');
    expect(plan.textFiles[0]?.path.endsWith('editbay-text-proj-0.txt')).toBe(true);
  });

  it('maps style to drawtext options on the project canvas', () => {
    const project = makeProject({
      textItems: [
        makeText('t1', {
          style: {
            ...DEFAULT_TEXT_STYLE,
            fontSize: 72,
            color: '#ff8800',
            align: 'right',
            x: 1,
            y: 0.25,
            background: '#000000',
            padding: 20,
            shadow: true,
          },
        }),
      ],
    });
    const plan = planFor(project);
    expect(plan.filterGraph).toContain('fontsize=72');
    expect(plan.filterGraph).toContain('fontcolor=0xFF8800');
    expect(plan.filterGraph).toContain('x=w-text_w-48');
    expect(plan.filterGraph).toContain('y=480');
    expect(plan.filterGraph).toContain('box=1');
    expect(plan.filterGraph).toContain('boxcolor=0x000000');
    expect(plan.filterGraph).toContain('boxborderw=20');
    expect(plan.filterGraph).toContain('shadowcolor=black@0.6');
  });

  it('centers text and keeps fontSize in canvas pixels', () => {
    const project = makeProject({
      canvas: { width: 720, height: 1280, fps: 25 },
      textItems: [makeText('t1', { style: { ...DEFAULT_TEXT_STYLE, fontSize: 64, align: 'center', y: 0.82 } })],
    });
    const plan = planFor(project);
    expect(plan.filterGraph).toContain('x=(w-text_w)/2');
    expect(plan.filterGraph).toContain('y=1050');
    expect(plan.filterGraph).toContain('fontsize=64');
    expect(plan.filterGraph).toContain('fps=25');
  });

  it('left-aligns text with a 48px margin', () => {
    const plan = planFor(
      makeProject({ textItems: [makeText('t1', { style: { ...DEFAULT_TEXT_STYLE, align: 'left' } })] }),
    );
    expect(plan.filterGraph).toContain('x=48');
  });

  it('applies every text item after the assembled picture', () => {
    const plan = planFor(
      makeProject({
        textItems: [
          makeText('t1', { text: 'first', startMs: 0 }),
          makeText('t2', { text: 'second', startMs: 1000, durationMs: 500 }),
        ],
      }),
    );
    expect(plan.textFiles.map((file) => file.content)).toEqual(['first', 'second']);
    expect(plan.filterGraph).toContain('[txt0]');
    expect(plan.filterGraph).toContain('[txt1]');
    expect(plan.filterGraph).toContain('[txt1]format=yuv420p[vfinal]');
  });
});

/* ------------------------------------------------------------------ */
/* Effects                                                            */
/* ------------------------------------------------------------------ */

describe('buildRenderPlan: effects', () => {
  const effect = (type: string, params: Record<string, number | string> = {}, window = {}) => ({
    id: `e-${type}`,
    type,
    params,
    ...window,
  });

  it('includes the fade effect from the catalog', () => {
    const plan = planFor(
      makeProject({ clips: [makeClip('c1', 'a1', { effects: [effect('fade', { inMs: 500, outMs: 400 })] })] }),
    );
    expect(plan.filterGraph).toContain('fade=t=in:st=0:d=0.500');
    expect(plan.filterGraph).toContain('fade=t=out:st=1.600:d=0.400');
  });

  it('includes color grade filters resolved from the catalog', () => {
    const plan = planFor(
      makeProject({
        clips: [makeClip('c1', 'a1', { effects: [effect('grade', { preset: 'punch', intensity: 0.5 })] })],
      }),
    );
    expect(plan.filterGraph).toContain('eq=contrast=1.10:saturation=1.27');
  });

  it('includes grain with resolved defaults', () => {
    const plan = planFor(makeProject({ clips: [makeClip('c1', 'a1', { effects: [effect('grain')] })] }));
    expect(plan.filterGraph).toContain('noise=alls=18:allf=t+u');
  });

  it('limits a simple effect filter to its time window', () => {
    const plan = planFor(
      makeProject({
        clips: [
          makeClip('c1', 'a1', {
            effects: [effect('vignette', { angle: 0.5 }, { startMs: 500, durationMs: 500 })],
          }),
        ],
      }),
    );
    expect(plan.filterGraph).toContain("vignette=angle=0.500:enable='between(t,0.500,1.000)'");
  });

  it('documents that fade windows cannot be limited', () => {
    const plan = planFor(
      makeProject({
        clips: [
          makeClip('c1', 'a1', { effects: [effect('fade', {}, { startMs: 500, durationMs: 500 })] }),
        ],
      }),
    );
    expect(plan.filterGraph).not.toContain(`enable='between(t,0.500,1.000)'`);
    expect(plan.warnings.some((warning) => warning.includes('not timeline-aware'))).toBe(true);
  });

  it('never attaches an enable window to zoompan and warns instead', () => {
    const plan = planFor(
      makeProject({
        clips: [
          makeClip('c1', 'a1', {
            effects: [effect('kenburns', { zoom: 1.2 }, { startMs: 500, durationMs: 500 })],
          }),
        ],
      }),
    );
    expect(plan.filterGraph).toContain('zoompan=');
    expect(plan.filterGraph).not.toContain('enable=');
    expect(plan.warnings.some((warning) => warning.includes('not timeline-aware'))).toBe(true);
  });

  it('collects warnings for unknown and unmapped effects', () => {
    const plan = planFor(
      makeProject({
        clips: [
          makeClip('c1', 'a1', {
            effects: [effect('sparkle'), effect('shake')],
          }),
        ],
      }),
    );
    expect(plan.filterGraph).not.toContain('sparkle');
    expect(plan.warnings.some((warning) => warning.includes('Unknown effect "sparkle"'))).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes('returned no FFmpeg filter'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Audio                                                              */
/* ------------------------------------------------------------------ */

describe('buildRenderPlan: audio', () => {
  it('trims and sets the volume of a video clip track', () => {
    const plan = planFor(
      makeProject({ clips: [makeClip('c1', 'a1', { inMs: 500, outMs: 1500, volume: 0.5 })] }),
    );
    expect(plan.args).toEqual(expect.arrayContaining(['-ss', '0.500', '-to', '1.500']));
    expect(plan.filterGraph).toContain('[0:a]atrim=start=0.000:end=1.000');
    expect(plan.filterGraph).toContain('volume=0.5');
    expect(plan.filterGraph).toContain('aresample=48000');
    expect(plan.filterGraph).toContain('[aout]');
    expect(argAfter(plan, '-map')).toBe('[vfinal]');
    expect(plan.args.filter((arg) => arg === '[aout]')).toHaveLength(1);
  });

  it('delays audio-track clips and applies fades', () => {
    const project = makeProject({
      clips: [makeClip('c1', 'a1', { outMs: 2000 })],
      assets: [makeAsset('a1'), makeAsset('a3', 'audio')],
      audioClips: [
        makeClip('c2', 'a3', {
          inMs: 0,
          outMs: 1200,
          startMs: 500,
          volume: 0.7,
          audioFadeInMs: 200,
          audioFadeOutMs: 300,
        }),
      ],
    });
    const plan = planFor(project);
    expect(plan.filterGraph).toContain('adelay=500|500');
    expect(plan.filterGraph).toContain('afade=t=in:st=0.500:d=0.200');
    expect(plan.filterGraph).toContain('afade=t=out:st=1.400:d=0.300');
    expect(plan.filterGraph).toContain('volume=0.7');
  });

  it('mixes multiple audio branches with amix', () => {
    const project = makeProject({
      assets: [makeAsset('a1'), makeAsset('a2'), makeAsset('a3', 'audio')],
      clips: [
        makeClip('c1', 'a1', { outMs: 1000, transitionOut: { id: 't', type: 'fade', durationMs: 200 } }),
        makeClip('c2', 'a2', { outMs: 1000 }),
      ],
      audioClips: [makeClip('c3', 'a3', { outMs: 800 })],
    });
    const plan = planFor(project);
    expect(plan.filterGraph).toContain('amix=inputs=3:duration=longest:dropout_transition=0:normalize=0[aout]');
    // Clip 2 starts at 800ms; its audio must follow the picture.
    expect(plan.filterGraph).toContain('adelay=800|800');
  });

  it('omits audio mapping when no clip has audio', () => {
    const project = makeProject({
      assets: [makeAsset('a1', 'video', { hasAudio: false })],
      clips: [makeClip('c1', 'a1')],
    });
    const plan = planFor(project);
    expect(plan.filterGraph).not.toContain('[aout]');
    expect(plan.args).not.toContain('[aout]');
    expect(plan.args.filter((arg) => arg === '-i')).toHaveLength(1);
  });

  it('skips muted clips and zero volume', () => {
    const plan = planFor(makeProject({ clips: [makeClip('c1', 'a1', { volume: 0 })] }));
    expect(plan.filterGraph).not.toContain('[aout]');
  });

  it('applies clip fades to main video-track audio', () => {
    const plan = planFor(
      makeProject({
        clips: [
          makeClip('c1', 'a1', { outMs: 2000, audioFadeInMs: 500, audioFadeOutMs: 2000 }),
        ],
      }),
    );
    expect(plan.filterGraph).toContain('afade=t=in:st=0.000:d=0.500');
    // A fade-out as long as the clip is legal: 2s fade starting at 0.
    expect(plan.filterGraph).toContain('afade=t=out:st=0.000:d=2.000');
  });

  it('applies a full-length fade-out on an audio-track clip', () => {
    const project = makeProject({
      assets: [makeAsset('a1'), makeAsset('a3', 'audio')],
      clips: [makeClip('c1', 'a1', { outMs: 2000 })],
      audioClips: [makeClip('c2', 'a3', { outMs: 1200, audioFadeOutMs: 1200 })],
    });
    const plan = planFor(project);
    expect(plan.filterGraph).toContain('afade=t=out:st=0.000:d=1.200');
  });

  it('leaves a music bed that ends before the picture untouched', () => {
    const project = makeProject({
      assets: [makeAsset('a1'), makeAsset('a3', 'audio')],
      clips: [makeClip('c1', 'a1', { outMs: 7000 })],
      audioClips: [makeClip('c2', 'a3', { outMs: 3000 })],
    });
    const plan = planFor(project);
    expect(plan.durationMs).toBe(7000);
    expect(plan.filterGraph).toContain('atrim=start=0.000:end=3.000');
    expect(plan.filterGraph).not.toContain('afade=t=out');
    expect(plan.filterGraph).not.toContain('afade=t=in');
  });

  it('cuts a music bed at the project end with a 300 ms fade-out', () => {
    const project = makeProject({
      assets: [makeAsset('a1'), makeAsset('a3', 'audio')],
      clips: [makeClip('c1', 'a1', { outMs: 7000 })],
      audioClips: [makeClip('c2', 'a3', { outMs: 30_000 })],
    });
    const plan = planFor(project);
    expect(plan.durationMs).toBe(7000);
    expect(argAfter(plan, '-t')).toBe('7.000');
    // The cut keeps the matching source span and ramps out over the last 300 ms.
    expect(plan.filterGraph).toContain('atrim=start=0.000:end=7.000');
    expect(plan.filterGraph).toContain('afade=t=out:st=6.700:d=0.300');
  });

  it('keeps a longer explicit fade-out when the music is cut', () => {
    const project = makeProject({
      assets: [makeAsset('a1'), makeAsset('a3', 'audio')],
      clips: [makeClip('c1', 'a1', { outMs: 7000 })],
      audioClips: [makeClip('c2', 'a3', { outMs: 30_000, audioFadeOutMs: 1500 })],
    });
    expect(planFor(project).filterGraph).toContain('afade=t=out:st=5.500:d=1.500');
  });

  it('crossfades clip audio across a transition', () => {
    const project = makeProject({
      clips: [
        makeClip('c1', 'a1', { outMs: 2000, transitionOut: { id: 't1', type: 'fade', durationMs: 500 } }),
        makeClip('c2', 'a2', { outMs: 2000 }),
      ],
    });
    const plan = planFor(project);
    // The outgoing clip fades out over the overlap (1.5s..2.0s)…
    expect(plan.filterGraph).toContain(
      '[0:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS,volume=1,afade=t=out:st=1.500:d=0.500',
    );
    // …while the incoming clip is delayed to the xfade offset and fades in there.
    expect(plan.filterGraph).toContain(
      '[1:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS,volume=1,adelay=1500|1500,afade=t=in:st=1.500:d=0.500',
    );
  });

  it('lets an explicit fade longer than the transition win', () => {
    const project = makeProject({
      clips: [
        makeClip('c1', 'a1', {
          outMs: 2000,
          audioFadeOutMs: 900,
          transitionOut: { id: 't1', type: 'fade', durationMs: 500 },
        }),
        makeClip('c2', 'a2', { outMs: 2000, audioFadeInMs: 800 }),
      ],
    });
    const plan = planFor(project);
    expect(plan.filterGraph).toContain('afade=t=out:st=1.100:d=0.900');
    expect(plan.filterGraph).toContain('adelay=1500|1500,afade=t=in:st=1.500:d=0.800');
  });

  it('does not invent audio filters for a silent clip in a transition', () => {
    const project = makeProject({
      assets: [makeAsset('a1', 'video', { hasAudio: false }), makeAsset('a2')],
      clips: [
        makeClip('c1', 'a1', { outMs: 2000, transitionOut: { id: 't1', type: 'fade', durationMs: 500 } }),
        makeClip('c2', 'a2', { outMs: 2000 }),
      ],
    });
    const plan = planFor(project);
    expect(plan.filterGraph).not.toContain('[0:a]');
    expect(plan.filterGraph).toContain('adelay=1500|1500,afade=t=in:st=1.500:d=0.500');
    expect(plan.filterGraph).not.toContain('afade=t=out');
  });

  it('skips silent video assets on audio tracks instead of referencing [N:a]', () => {
    const project = makeProject({
      assets: [makeAsset('a1'), makeAsset('silent', 'video', { hasAudio: false })],
      clips: [makeClip('c1', 'a1', { volume: 0 })],
      audioClips: [makeClip('c2', 'silent', { outMs: 1000 })],
    });
    const plan = planFor(project);
    expect(plan.inputs).toEqual(['C:/media/a1.mp4']);
    expect(plan.filterGraph).not.toContain('[1:a]');
    expect(plan.filterGraph).not.toContain('[aout]');
    expect(plan.warnings.some((warning) => warning.includes('has no audio'))).toBe(true);
  });

  it('skips zero-volume clips on audio tracks', () => {
    const project = makeProject({
      assets: [makeAsset('a1'), makeAsset('a3', 'audio')],
      clips: [makeClip('c1', 'a1', { volume: 0 })],
      audioClips: [makeClip('c2', 'a3', { outMs: 1000, volume: 0 })],
    });
    const plan = planFor(project);
    expect(plan.inputs).toEqual(['C:/media/a1.mp4']);
    expect(plan.filterGraph).not.toContain('[aout]');
  });
});

/* ------------------------------------------------------------------ */
/* Args, quality, validation                                          */
/* ------------------------------------------------------------------ */

describe('buildRenderPlan: encode arguments', () => {
  it('uses the draft preset', () => {
    const plan = planFor(makeProject(), { quality: 'draft' });
    expect(argAfter(plan, '-preset')).toBe('ultrafast');
    expect(argAfter(plan, '-crf')).toBe('28');
  });

  it('uses the standard preset by default', () => {
    const plan = planFor(makeProject());
    expect(plan.quality).toBe('standard');
    expect(argAfter(plan, '-preset')).toBe(QUALITY_PRESETS.standard.preset);
    expect(argAfter(plan, '-crf')).toBe('21');
  });

  it('uses the high preset', () => {
    const plan = planFor(makeProject(), { quality: 'high' });
    expect(argAfter(plan, '-preset')).toBe('slow');
    expect(argAfter(plan, '-crf')).toBe('18');
  });

  it('always writes a playable 48kHz faststart mp4', () => {
    const plan = planFor(makeProject());
    expect(plan.args).toEqual(
      expect.arrayContaining([
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-progress',
        'pipe:1',
      ]),
    );
    expect(argAfter(plan, '-r')).toBe('30');
    expect(argAfter(plan, '-t')).toBe('2.000');
    expect(plan.args[plan.args.length - 1]).toBe('C:/out/final.mp4');
  });

  it('serves the output path from options', () => {
    const plan = planFor(makeProject(), { outPath: 'D:/renders/cut.mp4' });
    expect(plan.args[plan.args.length - 1]).toBe('D:/renders/cut.mp4');
  });
});

describe('buildRenderPlan: validation', () => {
  it('rejects a project without video clips', () => {
    expect(() => planFor(makeProject({ clips: [] }))).toThrow(RenderError);
    expect(() => planFor(makeProject({ clips: [] }))).toThrow('Project has no video clips');
  });

  it('rejects clips pointing at a missing asset', () => {
    expect(() => planFor(makeProject({ assets: [], clips: [makeClip('c1', 'ghost')] }))).toThrow(
      /references missing asset "ghost"/,
    );
  });

  it('names the asset label when no file path is available', () => {
    const project = makeProject({ assets: [makeAsset('a1', 'video', { uri: '' })], clips: [makeClip('c1', 'a1')] });
    expect(() => buildRenderPlan(project, { assetPaths: {} })).toThrow(/Asset "A1.mp4"/);
  });

  it('warns instead of failing for overlay tracks', () => {
    const project = makeProject();
    project.tracks.push({ id: 'ot', kind: 'overlay', clips: [makeClip('o1', 'a2')], items: [] });
    const plan = planFor(project);
    expect(plan.warnings.some((warning) => warning.includes('Overlay tracks'))).toBe(true);
  });

  it('rejects an audio asset on a video track', () => {
    const project = makeProject({ assets: [makeAsset('a1', 'audio')], clips: [makeClip('c1', 'a1')] });
    expect(() => planFor(project)).toThrow(/cannot be used on a video track/);
  });

  it('skips an image placed on an audio track', () => {
    const project = makeProject({
      assets: [makeAsset('a1'), makeAsset('still', 'image')],
      audioClips: [makeClip('c2', 'still')],
    });
    const plan = planFor(project);
    expect(plan.warnings.some((warning) => warning.includes('has no audio'))).toBe(true);
    expect(plan.inputs).toEqual(['C:/media/a1.mp4']);
  });
});

/* ------------------------------------------------------------------ */
/* Audio helpers                                                      */
/* ------------------------------------------------------------------ */

describe('atempoChain', () => {
  it('is empty at normal speed', () => {
    expect(atempoChain(1)).toEqual([]);
  });

  it('uses one stage inside the supported range', () => {
    expect(atempoChain(2)).toEqual(['atempo=2']);
    expect(atempoChain(0.5)).toEqual(['atempo=0.5']);
  });

  it('chains two stages for 4x and 0.25x', () => {
    for (const speed of [4, 0.25]) {
      const chain = atempoChain(speed);
      expect(chain).toHaveLength(2);
      for (const filter of chain) {
        const factor = Number(filter.replace('atempo=', ''));
        expect(factor).toBeGreaterThanOrEqual(0.5);
        expect(factor).toBeLessThanOrEqual(2);
      }
    }
  });

  it('retimes clip audio with atempo for non-1 speeds', () => {
    const plan = planFor(makeProject({ clips: [makeClip('c1', 'a1', { outMs: 4000, speed: 4 })] }));
    expect(plan.filterGraph).toContain('atempo=2,atempo=2');
    expect(plan.durationMs).toBe(1000);
  });
});

/* ------------------------------------------------------------------ */
/* Filter-chain windowing (F-15)                                      */
/* ------------------------------------------------------------------ */

describe('withEnableWindow', () => {
  it('splits only on top-level commas', () => {
    expect(splitFilterChain("eq=contrast=1.2,drawtext=text='a,b':x=1")).toEqual([
      'eq=contrast=1.2',
      "drawtext=text='a,b':x=1",
    ]);
    expect(splitFilterChain('scale=w=if(gt(t,1),10,20):h=10')).toEqual([
      'scale=w=if(gt(t,1),10,20):h=10',
    ]);
    expect(splitFilterChain('drawbox=x=0:y=0:w=10:h=10:t=fill,eq=contrast=1.1')).toEqual([
      'drawbox=x=0:y=0:w=10:h=10:t=fill',
      'eq=contrast=1.1',
    ]);
  });

  it('attaches the window to every top-level filter but not inside quotes', () => {
    const windowed = withEnableWindow("eq=contrast=1.2,drawtext=text='a,b':x=1", 0.5, 1.5);
    expect(windowed).toBe(
      "eq=contrast=1.2:enable='between(t,0.500,1.500)',drawtext=text='a,b':x=1:enable='between(t,0.500,1.500)'",
    );
  });

  it('never attaches a window to zoompan', () => {
    const zoom = "zoompan=z='1.2':d=1:s=1080x1920:fps=30,format=yuv420p";
    expect(withEnableWindow(zoom, 0.5, 1.5)).toBe(
      "zoompan=z='1.2':d=1:s=1080x1920:fps=30,format=yuv420p:enable='between(t,0.500,1.500)'",
    );
  });
});
