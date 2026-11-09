import type {
  EffectDefinition,
  EffectParam,
  EffectRenderContext,
  FrameStyle,
  TransitionDefinition,
} from './types';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const num = (params: Record<string, EffectParam>, key: string, fallback: number): number => {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
const str = (params: Record<string, EffectParam>, key: string, fallback: string): string => {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
};

export const fade: EffectDefinition = {
  id: 'fade',
  name: 'Fade',
  category: 'motion',
  description: 'Fades the clip in and out from black.',
  builtin: true,
  params: [
    { key: 'inMs', label: 'Fade in', type: 'number', default: 300, min: 0, max: 3000, step: 50, unit: 'ms' },
    { key: 'outMs', label: 'Fade out', type: 'number', default: 300, min: 0, max: 3000, step: 50, unit: 'ms' },
  ],
  style(ctx: EffectRenderContext): FrameStyle {
    const fadeIn = Math.max(1, num(ctx.params, 'inMs', 300));
    const fadeOut = Math.max(1, num(ctx.params, 'outMs', 300));
    const t = ctx.timeMs;
    const total = ctx.durationMs;
    const inPart = clamp01(t / fadeIn);
    const outPart = clamp01((total - t) / fadeOut);
    return { opacity: Math.min(inPart, outPart) };
  },
  ffmpeg(params, meta) {
    const inMs = num(params, 'inMs', 300);
    const outMs = num(params, 'outMs', 300);
    const filters: string[] = [];
    if (inMs > 0) filters.push(`fade=t=in:st=${meta.startSec}:d=${(inMs / 1000).toFixed(3)}`);
    if (outMs > 0) {
      const st = Math.max(meta.startSec, meta.startSec + meta.durationSec - outMs / 1000);
      filters.push(`fade=t=out:st=${st.toFixed(3)}:d=${(outMs / 1000).toFixed(3)}`);
    }
    return filters.length ? filters.join(',') : null;
  },
};

export const kenburns: EffectDefinition = {
  id: 'kenburns',
  name: 'Ken Burns',
  category: 'motion',
  description: 'Slow cinematic push or pull on stills and clips.',
  builtin: true,
  params: [
    { key: 'zoom', label: 'Zoom', type: 'number', default: 1.12, min: 1, max: 1.8, step: 0.01, unit: 'x' },
    {
      key: 'direction',
      label: 'Direction',
      type: 'select',
      default: 'in',
      options: [
        { value: 'in', label: 'Push in' },
        { value: 'out', label: 'Pull out' },
      ],
    },
  ],
  style(ctx: EffectRenderContext): FrameStyle {
    const zoom = num(ctx.params, 'zoom', 1.12);
    const dir = str(ctx.params, 'direction', 'in');
    const p = clamp01(ctx.progress);
    const factor = dir === 'out' ? zoom - (zoom - 1) * p : 1 + (zoom - 1) * p;
    return { scale: factor };
  },
  ffmpeg(params, meta) {
    const zoom = num(params, 'zoom', 1.12);
    const dir = str(params, 'direction', 'in');
    const frames = Math.max(2, Math.round(meta.durationSec * meta.fps));
    const z =
      dir === 'out'
        ? `${zoom}-${(zoom - 1).toFixed(4)}*on/${frames}`
        : `1+${(zoom - 1).toFixed(4)}*on/${frames}`;
    return `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${meta.width}x${meta.height}:fps=${meta.fps}`;
  },
};

export const shake: EffectDefinition = {
  id: 'shake',
  name: 'Handheld shake',
  category: 'motion',
  description: 'Subtle camera shake for energy or impact.',
  builtin: true,
  params: [
    { key: 'intensity', label: 'Intensity', type: 'number', default: 0.004, min: 0.001, max: 0.02, step: 0.001 },
    { key: 'speed', label: 'Speed', type: 'number', default: 9, min: 2, max: 20, step: 1, unit: 'hz' },
  ],
  style(ctx: EffectRenderContext): FrameStyle {
    const amp = num(ctx.params, 'intensity', 0.004);
    const speed = num(ctx.params, 'speed', 9);
    const t = ctx.timeMs / 1000;
    return {
      translateX: Math.sin(t * speed * Math.PI * 2) * amp,
      translateY: Math.cos(t * speed * 1.37 * Math.PI * 2) * amp * 0.8,
    };
  },
  ffmpeg() {
    return null;
  },
};

export const grain: EffectDefinition = {
  id: 'grain',
  name: 'Film grain',
  category: 'texture',
  description: 'Adds organic film texture.',
  builtin: true,
  params: [
    { key: 'amount', label: 'Amount', type: 'number', default: 18, min: 1, max: 60, step: 1 },
  ],
  ffmpeg(params) {
    const amount = num(params, 'amount', 18);
    return `noise=alls=${Math.round(amount)}:allf=t+u`;
  },
};

export const vignette: EffectDefinition = {
  id: 'vignette',
  name: 'Vignette',
  category: 'texture',
  description: 'Darkens the frame edges.',
  builtin: true,
  params: [
    { key: 'angle', label: 'Strength', type: 'number', default: 0.6, min: 0, max: 1.5, step: 0.05 },
  ],
  ffmpeg(params) {
    const angle = num(params, 'angle', 0.6);
    return `vignette=angle=${angle.toFixed(3)}`;
  },
};

export const grade: EffectDefinition = {
  id: 'grade',
  name: 'Color grade',
  category: 'color',
  description: 'Look presets that stay consistent between preview and export.',
  builtin: true,
  params: [
    {
      key: 'preset',
      label: 'Look',
      type: 'select',
      default: 'cinema',
      options: [
        { value: 'cinema', label: 'Cinema' },
        { value: 'warm', label: 'Warm' },
        { value: 'cool', label: 'Cool' },
        { value: 'mono', label: 'Mono' },
        { value: 'punch', label: 'Punch' },
      ],
    },
    { key: 'intensity', label: 'Intensity', type: 'number', default: 0.7, min: 0, max: 1, step: 0.05 },
  ],
  style(ctx: EffectRenderContext): FrameStyle {
    const preset = str(ctx.params, 'preset', 'cinema');
    const i = clamp01(num(ctx.params, 'intensity', 0.7));
    const filters: string[] = [];
    if (preset === 'mono') filters.push(`grayscale(${i.toFixed(2)})`);
    if (preset === 'warm') filters.push(`sepia(${(i * 0.45).toFixed(2)}) saturate(${(1 + i * 0.15).toFixed(2)})`);
    if (preset === 'cool') filters.push(`hue-rotate(${(-i * 8).toFixed(2)}deg) saturate(${(1 + i * 0.1).toFixed(2)})`);
    if (preset === 'punch') filters.push(`saturate(${(1 + i * 0.5).toFixed(2)}) contrast(${(1 + i * 0.15).toFixed(2)})`);
    if (preset === 'cinema') filters.push(`contrast(${(1 + i * 0.12).toFixed(2)}) saturate(${(1 - i * 0.12).toFixed(2)})`);
    return filters.length ? { filter: filters.join(' ') } : {};
  },
  ffmpeg(params) {
    const preset = str(params, 'preset', 'cinema');
    const i = clamp01(num(params, 'intensity', 0.7));
    switch (preset) {
      case 'mono':
        return `hue=s=0,eq=contrast=${(1 + i * 0.1).toFixed(2)}`;
      case 'warm':
        return `colorbalance=rs=${(i * 0.12).toFixed(2)}:gs=${(i * 0.03).toFixed(2)}:bs=${(-i * 0.1).toFixed(2)},eq=saturation=${(1 + i * 0.15).toFixed(2)}`;
      case 'cool':
        return `colorbalance=rs=${(-i * 0.08).toFixed(2)}:bs=${(i * 0.12).toFixed(2)},eq=saturation=${(1 + i * 0.08).toFixed(2)}`;
      case 'punch':
        return `eq=contrast=${(1 + i * 0.2).toFixed(2)}:saturation=${(1 + i * 0.55).toFixed(2)}`;
      default:
        return `eq=contrast=${(1 + i * 0.14).toFixed(2)}:saturation=${(1 - i * 0.15).toFixed(2)},colorbalance=bs=${(i * 0.06).toFixed(2)}`;
    }
  },
};

export const blur: EffectDefinition = {
  id: 'blur',
  name: 'Blur',
  category: 'texture',
  description: 'Softens the image; useful for backgrounds and reveals.',
  builtin: true,
  params: [
    { key: 'amount', label: 'Amount', type: 'number', default: 6, min: 0, max: 40, step: 1, unit: 'px' },
  ],
  style(ctx: EffectRenderContext): FrameStyle {
    const amount = num(ctx.params, 'amount', 6);
    return amount > 0 ? { filter: `blur(${amount.toFixed(1)}px)` } : {};
  },
  ffmpeg(params) {
    const amount = num(params, 'amount', 6);
    return amount > 0 ? `gblur=sigma=${(amount / 2).toFixed(2)}` : null;
  },
};

export const glow: EffectDefinition = {
  id: 'glow',
  name: 'Glow',
  category: 'texture',
  description: 'Bloom around highlights.',
  builtin: true,
  params: [
    { key: 'amount', label: 'Amount', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
  ],
  style(ctx: EffectRenderContext): FrameStyle {
    const amount = num(ctx.params, 'amount', 0.5);
    return { filter: `brightness(${(1 + amount * 0.12).toFixed(2)}) blur(${(amount * 1.2).toFixed(1)}px)` };
  },
  ffmpeg(params) {
    const amount = num(params, 'amount', 0.5);
    return `unsharp=5:5:${(amount * 1.6).toFixed(2)}:5:5:0,eq=brightness=${(amount * 0.05).toFixed(3)}:saturation=${(1 + amount * 0.1).toFixed(2)}`;
  },
};

export const glitch: EffectDefinition = {
  id: 'glitch',
  name: 'RGB shift',
  category: 'texture',
  description: 'Chromatic offset; keep the amount low for a premium feel.',
  builtin: true,
  params: [
    { key: 'amount', label: 'Amount', type: 'number', default: 3, min: 1, max: 12, step: 1, unit: 'px' },
  ],
  ffmpeg(params) {
    const amount = Math.round(num(params, 'amount', 3));
    return `rgbashift=rh=${amount}:bh=-${amount}`;
  },
};

export const zoomPunch: EffectDefinition = {
  id: 'zoom-punch',
  name: 'Zoom punch',
  category: 'motion',
  description: 'Fast push at the start of the clip.',
  builtin: true,
  params: [
    { key: 'amount', label: 'Amount', type: 'number', default: 0.12, min: 0.02, max: 0.4, step: 0.02 },
    { key: 'durationMs', label: 'Duration', type: 'number', default: 280, min: 80, max: 1200, step: 20, unit: 'ms' },
  ],
  style(ctx: EffectRenderContext): FrameStyle {
    const amount = num(ctx.params, 'amount', 0.12);
    const d = Math.max(1, num(ctx.params, 'durationMs', 280));
    const p = clamp01(ctx.timeMs / d);
    return { scale: 1 + amount * (1 - p) ** 2 };
  },
  ffmpeg(params, meta) {
    const amount = num(params, 'amount', 0.12);
    const dSec = Math.max(0.08, num(params, 'durationMs', 280) / 1000);
    const frames = Math.max(2, Math.round(meta.durationSec * meta.fps));
    const trend = Math.min(frames, Math.round(dSec * meta.fps));
    return `zoompan=z='if(lte(on,${trend}),${(1 + amount).toFixed(3)}-${amount.toFixed(3)}*on/${trend},1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${meta.width}x${meta.height}:fps=${meta.fps}`;
  },
};

export const builtinEffects: EffectDefinition[] = [
  fade,
  kenburns,
  zoomPunch,
  shake,
  grade,
  blur,
  glow,
  grain,
  vignette,
  glitch,
];

export const builtinTransitions: TransitionDefinition[] = [
  { id: 'fade', name: 'Fade', description: 'Crossfade.', defaultDurationMs: 400, xfade: 'fade', builtin: true },
  { id: 'dissolve', name: 'Dissolve', description: 'Soft dissolve.', defaultDurationMs: 500, xfade: 'dissolve', builtin: true },
  { id: 'slideleft', name: 'Slide left', description: 'Push left.', defaultDurationMs: 400, xfade: 'slideleft', builtin: true },
  { id: 'slideup', name: 'Slide up', description: 'Push up.', defaultDurationMs: 400, xfade: 'slideup', builtin: true },
  { id: 'wipeleft', name: 'Wipe left', description: 'Hard wipe.', defaultDurationMs: 350, xfade: 'wipeleft', builtin: true },
  { id: 'circleopen', name: 'Circle open', description: 'Iris in.', defaultDurationMs: 450, xfade: 'circleopen', builtin: true },
  { id: 'zoomin', name: 'Zoom in', description: 'Punch through.', defaultDurationMs: 500, xfade: 'zoomin', builtin: true },
];
