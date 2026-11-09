import { describe, expect, it } from 'vitest';
import { transitionFrame, type TransitionLayer } from './transition-preview';

const W = 320;
const H = 240;

/** Every xfade name the builtin catalog can emit. */
const TRANSITIONS = ['fade', 'dissolve', 'slideleft', 'slideup', 'wipeleft', 'circleopen', 'zoomin'] as const;
const PROGRESS_STEPS = [0, 0.5, 1] as const;

/** Does `layer` paint over the whole canvas at alpha 1? */
function coversFrame(layer: TransitionLayer): boolean {
  const left = layer.dx + W / 2 - (layer.scale * W) / 2;
  const right = layer.dx + W / 2 + (layer.scale * W) / 2;
  const top = layer.dy + H / 2 - (layer.scale * H) / 2;
  const bottom = layer.dy + H / 2 + (layer.scale * H) / 2;
  if (left > 0 || top > 0 || right < W || bottom < H) return false;

  const clip = layer.clip;
  if (!clip) return true;
  if (clip.kind === 'rect') return clip.x <= 0 && clip.y <= 0 && clip.w >= W && clip.h >= H;
  const corners: Array<[number, number]> = [
    [0.5, 0.5],
    [W - 0.5, 0.5],
    [0.5, H - 0.5],
    [W - 0.5, H - 0.5],
  ];
  return corners.every(([x, y]) => Math.hypot(x - clip.cx, y - clip.cy) <= clip.r);
}

/** Does `layer` paint anything at all? */
function visible(layer: TransitionLayer): boolean {
  if (layer.alpha <= 0) return false;
  const clip = layer.clip;
  if (!clip) return true;
  if (clip.kind === 'rect') return clip.w > 0 && clip.h > 0;
  return clip.r > 0;
}

/**
 * The frame shows only this layer at full strength. Layers are composited
 * outgoing first, so a full-strength incoming layer may legitimately hide the
 * outgoing one.
 */
function only(frame: { outgoing: TransitionLayer; incoming: TransitionLayer }, side: 'outgoing' | 'incoming'): boolean {
  const shown = frame[side];
  const other = frame[side === 'outgoing' ? 'incoming' : 'outgoing'];
  if (!visible(shown) || shown.alpha !== 1 || !coversFrame(shown)) return false;
  const otherDrawnOnTop = side === 'outgoing' && visible(other) && other.alpha === 1 && coversFrame(other);
  return !otherDrawnOnTop;
}

describe('transitionFrame', () => {
  for (const transition of TRANSITIONS) {
    describe(transition, () => {
      it('shows only the outgoing clip at progress 0', () => {
        expect(only(transitionFrame(transition, 0, W, H), 'outgoing')).toBe(true);
      });

      it('shows both clips at progress 0.5', () => {
        const frame = transitionFrame(transition, 0.5, W, H);
        expect(visible(frame.outgoing)).toBe(true);
        if (transition === 'zoomin') {
          // ffmpeg's zoomin holds the outgoing clip until the midpoint and only
          // then crossfades, so the midpoint frame is still clip A.
          expect(frame.incoming.alpha).toBe(0);
        } else {
          expect(visible(frame.incoming)).toBe(true);
        }
      });

      it('shows only the incoming clip at progress 1', () => {
        expect(only(transitionFrame(transition, 1, W, H), 'incoming')).toBe(true);
      });

      it('clamps progress outside 0..1', () => {
        expect(transitionFrame(transition, -0.5, W, H)).toEqual(transitionFrame(transition, 0, W, H));
        expect(transitionFrame(transition, 2, W, H)).toEqual(transitionFrame(transition, 1, W, H));
      });

      it('keeps every alpha inside 0..1', () => {
        for (const progress of PROGRESS_STEPS) {
          const frame = transitionFrame(transition, progress, W, H);
          for (const side of [frame.outgoing, frame.incoming]) {
            expect(side.alpha).toBeGreaterThanOrEqual(0);
            expect(side.alpha).toBeLessThanOrEqual(1);
            expect(side.scale).toBeGreaterThan(0);
          }
        }
      });
    });
  }

  it('crossfades the incoming clip over a fully opaque outgoing clip', () => {
    // Drawn as `outgoing` then `incoming` over it, this yields the same
    // A * (1 - p) + B * p mix ffmpeg's fade produces.
    const frame = transitionFrame('fade', 0.25, W, H);
    expect(frame.outgoing).toEqual({ alpha: 1, dx: 0, dy: 0, scale: 1 });
    expect(frame.incoming).toEqual({ alpha: 0.25, dx: 0, dy: 0, scale: 1 });
  });

  it('treats dissolve as a crossfade in the preview', () => {
    expect(transitionFrame('dissolve', 0.4, W, H)).toEqual(transitionFrame('fade', 0.4, W, H));
  });

  it('falls back to fade for unknown transition names', () => {
    expect(transitionFrame('nope', 0.3, W, H)).toEqual(transitionFrame('fade', 0.3, W, H));
    expect(transitionFrame('', 0.7, W, H)).toEqual(transitionFrame('fade', 0.7, W, H));
  });

  it('pushes the outgoing clip left and brings the incoming clip in from the right', () => {
    const frame = transitionFrame('slideleft', 0.5, W, H);
    expect(frame.outgoing.dx).toBe(-W / 2);
    expect(frame.incoming.dx).toBe(W / 2);
    expect(frame.outgoing.dy).toBe(0);
    expect(frame.incoming.dy).toBe(0);
    expect(frame.outgoing.alpha).toBe(1);
    expect(frame.incoming.alpha).toBe(1);
  });

  it('pushes the outgoing clip up and brings the incoming clip in from the bottom', () => {
    const frame = transitionFrame('slideup', 0.25, W, H);
    expect(frame.outgoing.dy).toBe(-H / 4);
    expect(frame.incoming.dy).toBe((H * 3) / 4);
    expect(frame.outgoing.dx).toBe(0);
    expect(frame.incoming.dx).toBe(0);
  });

  it('wipes the outgoing clip from the right edge towards the left', () => {
    const frame = transitionFrame('wipeleft', 0.25, W, H);
    expect(frame.outgoing.clip).toEqual({ kind: 'rect', x: 0, y: 0, w: W * 0.75, h: H });
    expect(frame.incoming.clip).toEqual({ kind: 'rect', x: W * 0.75, y: 0, w: W * 0.25, h: H });
    expect(frame.outgoing.alpha).toBe(1);
    expect(frame.incoming.alpha).toBe(1);
  });

  it('opens the incoming clip as a growing circle from the centre', () => {
    const early = transitionFrame('circleopen', 0.25, W, H);
    const late = transitionFrame('circleopen', 0.75, W, H);
    expect(early.incoming.clip).toEqual({ kind: 'circle', cx: W / 2, cy: H / 2, r: (Math.hypot(W, H) * 0.25) / 2 });
    expect(late.incoming.clip).toEqual({ kind: 'circle', cx: W / 2, cy: H / 2, r: (Math.hypot(W, H) * 0.75) / 2 });
    expect(early.outgoing.clip).toBeUndefined();
    expect(late.outgoing.clip).toBeUndefined();
  });

  it('holds the outgoing clip through the first half of zoomin and fades to the incoming clip', () => {
    const atMidpoint = transitionFrame('zoomin', 0.5, W, H);
    expect(atMidpoint.outgoing.alpha).toBe(1);
    expect(atMidpoint.incoming.alpha).toBe(0);
    expect(atMidpoint.outgoing.scale).toBe(2);

    const late = transitionFrame('zoomin', 0.75, W, H);
    expect(late.outgoing.alpha).toBe(0.5);
    expect(late.incoming.alpha).toBe(0.5);

    const early = transitionFrame('zoomin', 0.25, W, H);
    expect(early.outgoing.scale).toBe(1.5);
  });

  it('works for a portrait canvas', () => {
    const frame = transitionFrame('slideup', 0.5, 1080, 1920);
    expect(frame.outgoing.dy).toBe(-960);
    expect(frame.incoming.dy).toBe(960);
    expect(transitionFrame('circleopen', 0.5, 1080, 1920).incoming.clip).toEqual({
      kind: 'circle',
      cx: 540,
      cy: 960,
      r: Math.hypot(1080, 1920) / 4,
    });
  });
});
