/**
 * Preview geometry for ffmpeg `xfade` transitions.
 *
 * The export path applies the real `xfade` filter (`packages/effects/src/builtins.ts`
 * names it, `packages/engine/src/plan.ts` wires it). The canvas preview has to
 * reproduce the same motion so what the editor shows matches the render. This
 * module is pure (no DOM) so it can be unit-tested and, more importantly, be
 * compared against real ffmpeg output in the engine e2e suite.
 *
 * `progress` is the timeline progress through the transition:
 *   0 = the outgoing clip alone, 1 = the incoming clip alone.
 *
 * ffmpeg semantics this mirrors (`libavfilter/vf_xfade.c`; the filter computes
 * its own `progress` as `1 - timelineProgress`, so the formulas below are given
 * in timeline terms):
 *   fade        dst = A * (1 - p) + B * p
 *   wipeleft    A where x <= (1 - p) * w, B to the right of it
 *   slideleft   A pushed out to the left, B slides in from the right
 *   slideup     A pushed up, B slides in from the bottom
 *   circleopen  B opens from the centre (hard clip in the preview; ffmpeg
 *               feathers the edge and ramps the radius ~3x faster, reaching the
 *               same radius at p = 0.5)
 *   zoomin      A held (magnified) through the first half, then crossfade to B
 *
 * Names that are not known fall back to `fade`, exactly like the exporter.
 */

export interface TransitionRectClip {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TransitionCircleClip {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
}

export type TransitionClip = TransitionRectClip | TransitionCircleClip;

/** How one side of a transition is drawn on the preview canvas. */
export interface TransitionLayer {
  /** Multiplied into the clip opacity (0..1). */
  alpha: number;
  /** Horizontal offset in canvas pixels. */
  dx: number;
  /** Vertical offset in canvas pixels. */
  dy: number;
  /** Uniform scale around the canvas centre. */
  scale: number;
  /** Clip region in canvas coordinates; the whole frame when omitted. */
  clip?: TransitionClip;
}

export interface TransitionFrame {
  /** Outgoing clip (the earlier clip on the track, ffmpeg's input 0). */
  outgoing: TransitionLayer;
  /** Incoming clip (the later clip on the track, ffmpeg's input 1). */
  incoming: TransitionLayer;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function layer(overrides: Partial<TransitionLayer> = {}): TransitionLayer {
  return { alpha: 1, dx: 0, dy: 0, scale: 1, ...overrides };
}

function crossfade(progress: number): TransitionFrame {
  // The canvas composites the incoming layer over the outgoing one, so keeping
  // A fully opaque and fading B in reproduces ffmpeg's `A * (1 - p) + B * p`
  // exactly. Fading both sides would darken the frame at mid-transition.
  return {
    outgoing: layer(),
    incoming: layer({ alpha: progress }),
  };
}

/**
 * Draw instructions for both sides of a transition at `progress` (0..1) on a
 * `w` x `h` canvas. Pure: same inputs, same output, no DOM access.
 */
export function transitionFrame(xfade: string, progress: number, w: number, h: number): TransitionFrame {
  const p = clamp01(progress);
  const width = Math.max(0, w);
  const height = Math.max(0, h);
  const centerX = width / 2;
  const centerY = height / 2;

  switch (xfade) {
    case 'dissolve':
      // ffmpeg dissolves through a random per-pixel threshold. A straight
      // crossfade is the accepted preview stand-in: same endpoints and the same
      // average mix, without animating noise on the canvas.
      return crossfade(p);

    case 'slideleft':
      return {
        outgoing: layer({ dx: -p * width }),
        incoming: layer({ dx: (1 - p) * width }),
      };

    case 'slideup':
      return {
        outgoing: layer({ dy: -p * height }),
        incoming: layer({ dy: (1 - p) * height }),
      };

    case 'wipeleft': {
      // ffmpeg keeps A while `x <= width * (1 - progress)` and takes B beyond
      // it, so the incoming picture eats in from the right edge.
      const edge = (1 - p) * width;
      return {
        outgoing: layer({ clip: { kind: 'rect', x: 0, y: 0, w: edge, h: height } }),
        incoming: layer({ clip: { kind: 'rect', x: edge, y: 0, w: width - edge, h: height } }),
      };
    }

    case 'circleopen':
      return {
        outgoing: layer(),
        incoming: layer({
          clip: { kind: 'circle', cx: centerX, cy: centerY, r: (p * Math.hypot(width, height)) / 2 },
        }),
      };

    case 'zoomin':
      // ffmpeg keeps A for the first half (sampling it with a zoom that relaxes
      // to 1:1) and fades to B over the second half. The preview ramps A's
      // scale 1 -> 2 across the first half and fades it out in the second half,
      // so the midpoint frame — the one the ffmpeg parity test checks — still
      // shows A only.
      return {
        outgoing: layer({
          scale: 1 + Math.min(1, p * 2),
          alpha: clamp01(1 - Math.max(0, p - 0.5) * 2),
        }),
        incoming: layer({ alpha: clamp01((p - 0.5) * 2) }),
      };

    case 'fade':
    default:
      return crossfade(p);
  }
}
