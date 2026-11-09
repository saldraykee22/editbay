import { describe, expect, it } from 'vitest';
import { builtinTransitions, transitionFrame, type TransitionFrame, type TransitionLayer } from '@editbay/effects';
import { isFfmpegAvailable, resolveFfmpeg, runCommandBuffer } from './ffmpeg';

/**
 * Transition preview parity against real ffmpeg.
 *
 * The canvas preview paints transitions from `transitionFrame` while the export
 * applies ffmpeg `xfade`. This suite renders the midpoint of every builtin
 * transition with lavfi colour sources and compares a handful of pixels with
 * the colour the preview math predicts, so a wrong direction/side in the
 * preview (or here) fails loudly.
 *
 * Solid red/blue clips mean a pixel's colour identifies which clip reached it,
 * and the composited RGB is predicted by the same alpha/offset/clip model the
 * compositor uses.
 */
const ffmpegAvailable = isFfmpegAvailable();
const suite = ffmpegAvailable ? describe : describe.skip;

const W = 320;
const H = 240;
const FPS = 30;
const DURATION_SEC = 0.5;
const OFFSET_SEC = 0.5;
/** xfade frame at t = 22/30 s, i.e. just before the middle of the transition. */
const MID_FRAME = 22;
const PROGRESS = (MID_FRAME / FPS - OFFSET_SEC) / DURATION_SEC;
/** yuv420p round-trip and limited-range RGB conversion move pure colours ~1 step. */
const CHANNEL_TOLERANCE = 12;

type Rgb = [number, number, number];

interface Sample {
  label: string;
  x: number;
  y: number;
}

/**
 * Sample points chosen away from each transition's moving edge so the expected
 * side is unambiguous (ffmpeg feathers edges; the preview clips hard).
 */
const SAMPLES: Record<string, Sample[]> = {
  fade: [
    { label: 'left', x: 40, y: 120 },
    { label: 'right', x: 280, y: 120 },
    { label: 'center', x: 160, y: 120 },
  ],
  slideleft: [
    { label: 'left', x: 40, y: 120 },
    { label: 'right', x: 280, y: 120 },
    { label: 'top-left', x: 6, y: 6 },
    { label: 'bottom-right', x: 314, y: 234 },
  ],
  slideup: [
    { label: 'top', x: 160, y: 30 },
    { label: 'bottom', x: 160, y: 210 },
    { label: 'left', x: 40, y: 120 },
  ],
  wipeleft: [
    { label: 'left', x: 40, y: 120 },
    { label: 'right', x: 280, y: 120 },
    { label: 'top-left', x: 6, y: 6 },
    { label: 'bottom-right', x: 314, y: 234 },
  ],
  circleopen: [
    { label: 'center', x: 160, y: 120 },
    { label: 'top-left', x: 6, y: 6 },
    { label: 'bottom-right', x: 314, y: 234 },
  ],
  zoomin: [
    { label: 'center', x: 160, y: 120 },
    { label: 'top-left', x: 6, y: 6 },
    { label: 'bottom-right', x: 314, y: 234 },
  ],
};

function lavfiColorSource(color: string): string[] {
  return ['-f', 'lavfi', '-i', `color=c=${color}:s=${W}x${H}:r=${FPS}:d=1,format=yuv420p`];
}

async function runFfmpegFrame(args: string[]): Promise<Buffer> {
  const result = await runCommandBuffer(resolveFfmpeg(), [
    '-hide_banner',
    '-loglevel',
    'error',
    ...args,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]);
  expect(result.code).toBe(0);
  expect(result.stdout.length).toBe(W * H * 3);
  return result.stdout;
}

/** A single frame of a solid lavfi colour, decoded exactly like the frames below. */
async function solidColor(color: string): Promise<Rgb> {
  const frame = await runFfmpegFrame(lavfiColorSource(color));
  return pixel(frame, 10, 10);
}

/** One frame of the xfade midpoint, decoded to raw rgb24. */
async function xfadeMidFrame(transition: string): Promise<Buffer> {
  const filter = `[0:v][1:v]xfade=transition=${transition}:duration=${DURATION_SEC}:offset=${OFFSET_SEC},select='eq(n\\,${MID_FRAME})'`;
  return runFfmpegFrame([
    ...lavfiColorSource('red'),
    ...lavfiColorSource('blue'),
    '-filter_complex',
    filter,
  ]);
}

function pixel(frame: Buffer, x: number, y: number): Rgb {
  const offset = (y * W + x) * 3;
  return [frame[offset] ?? -1, frame[offset + 1] ?? -1, frame[offset + 2] ?? -1];
}

/** Does `layer` paint the canvas point (x, y)? */
function covers(layer: TransitionLayer, x: number, y: number): boolean {
  const clip = layer.clip;
  if (clip?.kind === 'rect') {
    if (x < clip.x || x > clip.x + clip.w || y < clip.y || y > clip.y + clip.h) return false;
  } else if (clip?.kind === 'circle') {
    if (Math.hypot(x - clip.cx, y - clip.cy) > clip.r) return false;
  }
  // Inverse of the compositor transform: translate(dx) + scale about the centre.
  const sourceX = W / 2 + (x - layer.dx - W / 2) / layer.scale;
  const sourceY = H / 2 + (y - layer.dy - H / 2) / layer.scale;
  return sourceX >= 0 && sourceX <= W && sourceY >= 0 && sourceY <= H;
}

/** Composite the preview layers over black at one point. */
function predictedColor(frame: TransitionFrame, x: number, y: number, outgoing: Rgb, incoming: Rgb): Rgb {
  const result: Rgb = [0, 0, 0];
  const layers: Array<[TransitionLayer, Rgb]> = [
    [frame.outgoing, outgoing],
    [frame.incoming, incoming],
  ];
  for (const [layer, color] of layers) {
    if (layer.alpha <= 0 || !covers(layer, x, y)) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const previous = result[channel] ?? 0;
      const source = color[channel] ?? 0;
      result[channel] = previous * (1 - layer.alpha) + source * layer.alpha;
    }
  }
  return result;
}

function format(rgb: Rgb): string {
  return `(${rgb.map((value) => Math.round(value)).join(', ')})`;
}

suite('transition preview parity (real ffmpeg)', () => {
  const transitions = builtinTransitions.filter((transition) => transition.xfade !== 'dissolve');

  it('covers every builtin transition except dissolve', () => {
    expect(transitions.length).toBeGreaterThan(0);
    for (const transition of transitions) {
      expect(SAMPLES[transition.xfade], `missing samples for ${transition.xfade}`).toBeDefined();
    }
  });

  it(`matches xfade at the midpoint (progress ${PROGRESS.toFixed(3)})`, async () => {
    const red = await solidColor('red');
    const blue = await solidColor('blue');
    console.log(`sources: outgoing=red${format(red)} incoming=blue${format(blue)}`);

    for (const transition of transitions) {
      const name = transition.xfade;
      const samples = SAMPLES[name];
      if (!samples) throw new Error(`No sample points for ${name}`);

      const midFrame = await xfadeMidFrame(name);
      const preview = transitionFrame(name, PROGRESS, W, H);

      for (const sample of samples) {
        const measured = pixel(midFrame, sample.x, sample.y);
        const predicted = predictedColor(preview, sample.x, sample.y, red, blue);
        console.log(
          `${name.padEnd(10)} ${sample.label.padEnd(13)} measured=${format(measured)} predicted=${format(predicted)}`,
        );
        for (let channel = 0; channel < 3; channel += 1) {
          const delta = Math.abs((measured[channel] ?? 0) - (predicted[channel] ?? 0));
          expect(
            delta,
            `${name} ${sample.label} channel ${channel}: measured ${format(measured)} predicted ${format(predicted)}`,
          ).toBeLessThanOrEqual(CHANNEL_TOLERANCE);
        }
      }
    }
  });
});
