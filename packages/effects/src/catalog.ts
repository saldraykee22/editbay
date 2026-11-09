import type { EffectInstance, EffectTarget } from '@editbay/core';
import type {
  EffectCategory,
  EffectDefinition,
  EffectParam,
  EffectParamSpec,
  TransitionDefinition,
} from './types';
import { builtinEffects, builtinTransitions } from './builtins';

export interface EffectCatalogInit {
  effects?: EffectDefinition[];
  transitions?: TransitionDefinition[];
}

/**
 * In-memory catalog. Built-ins are always present; workspace-authored effects
 * (written by the agent) are registered at runtime through `registerEffect`.
 */
export class EffectCatalog {
  private effects = new Map<string, EffectDefinition>();
  private transitions = new Map<string, TransitionDefinition>();

  constructor(init: EffectCatalogInit = {}) {
    for (const effect of [...builtinEffects, ...(init.effects ?? [])]) this.registerEffect(effect);
    for (const transition of [...builtinTransitions, ...(init.transitions ?? [])]) this.registerTransition(transition);
  }

  registerEffect(definition: EffectDefinition): void {
    if (!definition.id || !definition.name) throw new Error('Effect needs an id and a name');
    this.effects.set(definition.id, definition);
  }

  registerTransition(definition: TransitionDefinition): void {
    if (!definition.id || !definition.name) throw new Error('Transition needs an id and a name');
    this.transitions.set(definition.id, definition);
  }

  effect(id: string): EffectDefinition | undefined {
    return this.effects.get(id);
  }

  transition(id: string): TransitionDefinition | undefined {
    return this.transitions.get(id);
  }

  listEffects(): EffectDefinition[] {
    return [...this.effects.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  listTransitions(): TransitionDefinition[] {
    return [...this.transitions.values()];
  }

  effectIds(): string[] {
    return [...this.effects.keys()];
  }

  transitionIds(): string[] {
    return [...this.transitions.keys()];
  }

  /** Fill defaults for an effect instance; unknown keys are preserved. */
  resolveParams(instance: Pick<EffectInstance, 'type' | 'params'>): Record<string, EffectParam> {
    const definition = this.effects.get(instance.type);
    const resolved: Record<string, EffectParam> = {};
    for (const spec of definition?.params ?? []) resolved[spec.key] = spec.default;
    return { ...resolved, ...instance.params };
  }

  toJSON(): { effects: EffectDefinition[]; transitions: TransitionDefinition[] } {
    // Functions are not serialisable; only metadata is exported for prompts/UI.
    return {
      effects: this.listEffects().map((e) => ({ ...e, style: undefined, ffmpeg: undefined })),
      transitions: this.listTransitions(),
    };
  }
}

export const effectCatalog = new EffectCatalog();

/**
 * Track kinds a registered effect may target.
 *
 * Effects run on the picture chain, so an effect that declares no target is a
 * video effect. Audio clips fade with `set_audio_fade`, never with an effect.
 */
export function effectTargetOf(
  type: string,
  catalog: EffectCatalog = effectCatalog,
): EffectTarget {
  return catalog.effect(type)?.target ?? 'video';
}

/**
 * Parse a declarative workspace effect (JSON authored by an agent).
 *
 * No source is evaluated: a custom effect is data — metadata, param specs and
 * an optional static FFmpeg filter template. This closes the dynamic
 * code-evaluation hole while still allowing workspace-defined looks.
 */
export function parseCustomEffect(json: unknown): EffectDefinition {
  if (!isRecord(json)) throw new Error('Custom effect must be a JSON object');

  const id = typeof json.id === 'string' ? json.id.trim() : '';
  if (id === '') throw new Error('Custom effect needs a non-empty id');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error('Custom effect id may only contain letters, digits, "-" and "_"');
  }

  const name = typeof json.name === 'string' && json.name.trim() !== '' ? json.name.trim() : id;

  const category = json.category;
  if (typeof category !== 'string' || !EFFECT_CATEGORIES.includes(category as EffectCategory)) {
    throw new Error(`Custom effect category must be one of ${EFFECT_CATEGORIES.join(', ')}`);
  }

  const rawParams = json.params === undefined ? [] : json.params;
  if (!Array.isArray(rawParams)) throw new Error('Custom effect params must be an array');
  const params = rawParams.map((entry, index) => parseParamSpec(entry, index));

  const description = typeof json.description === 'string' ? json.description : '';

  const rawFilter = json.filter;
  if (rawFilter !== undefined && typeof rawFilter !== 'string') {
    throw new Error('Custom effect filter must be a string');
  }
  const filter = typeof rawFilter === 'string' ? rawFilter.trim() : '';
  if (filter !== '') validateFilterTemplate(filter);

  const rawTarget = json.target;
  const target = EFFECT_TARGETS.find((candidate) => candidate === rawTarget);
  if (rawTarget !== undefined && target === undefined) {
    throw new Error(`Custom effect target must be one of ${EFFECT_TARGETS.join(', ')}`);
  }

  const definition: EffectDefinition = {
    id,
    name,
    category: category as EffectCategory,
    description,
    params,
    builtin: false,
  };
  if (target !== undefined) definition.target = target;

  if (filter !== '') {
    definition.ffmpeg = (resolved) => renderFilterTemplate(filter, resolved);
  }

  return definition;
}

const EFFECT_CATEGORIES: readonly EffectCategory[] = ['motion', 'color', 'texture', 'audio'];
const EFFECT_TARGETS: readonly EffectTarget[] = ['video', 'audio', 'both'];
const PARAM_TYPES: readonly EffectParamSpec['type'][] = ['number', 'color', 'select', 'boolean', 'text'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseParamSpec(value: unknown, index: number): EffectParamSpec {
  if (!isRecord(value)) throw new Error(`Custom effect params[${index}] must be an object`);

  const key = typeof value.key === 'string' ? value.key.trim() : '';
  if (!key) throw new Error(`Custom effect params[${index}].key is required`);

  const type = value.type;
  if (typeof type !== 'string' || !PARAM_TYPES.includes(type as EffectParamSpec['type'])) {
    throw new Error(`Custom effect params[${index}].type must be one of ${PARAM_TYPES.join(', ')}`);
  }
  const paramType = type as EffectParamSpec['type'];

  const defaultValue = value.default;
  if (paramType === 'number') {
    if (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue)) {
      throw new Error(`Custom effect params[${index}].default must be a finite number`);
    }
  } else if (paramType === 'boolean') {
    if (typeof defaultValue !== 'boolean') {
      throw new Error(`Custom effect params[${index}].default must be a boolean`);
    }
  } else if (typeof defaultValue !== 'string') {
    throw new Error(`Custom effect params[${index}].default must be a string`);
  }

  const label =
    typeof value.label === 'string' && value.label.trim() !== '' ? value.label.trim() : key;
  const spec: EffectParamSpec = {
    key,
    label,
    type: paramType,
    default: defaultValue as EffectParam,
  };

  for (const field of ['min', 'max', 'step'] as const) {
    const candidate = value[field];
    if (candidate === undefined) continue;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
      throw new Error(`Custom effect params[${index}].${field} must be a finite number`);
    }
    spec[field] = candidate;
  }
  if (typeof value.unit === 'string') spec.unit = value.unit;

  if (value.options !== undefined) {
    if (!Array.isArray(value.options)) {
      throw new Error(`Custom effect params[${index}].options must be an array`);
    }
    spec.options = value.options.map((option, optionIndex) => {
      if (!isRecord(option) || typeof option.value !== 'string' || typeof option.label !== 'string') {
        throw new Error(
          `Custom effect params[${index}].options[${optionIndex}] needs string value and label`,
        );
      }
      return { value: option.value, label: option.label };
    });
  }

  return spec;
}

/** Templates must stay inside a single filter: no chaining or labels. */
function validateFilterTemplate(filter: string): void {
  if (filter.includes(';') || filter.includes('[') || filter.includes(']')) {
    throw new Error('Custom effect filter must be a single filter without labels');
  }
  if (/[\r\n]/.test(filter)) throw new Error('Custom effect filter must be a single line');
}

/** `{param}` placeholders are filled from resolved params; no code is run. */
function renderFilterTemplate(filter: string, params: Record<string, EffectParam>): string {
  return filter.replace(/\{([A-Za-z0-9_-]+)\}/g, (placeholder, key: string) => {
    const value = templateValue(params[key]);
    return value === undefined ? placeholder : value;
  });
}

function templateValue(value: EffectParam | undefined): string | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    return String(Math.round(value * 1_000_000) / 1_000_000);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'string') {
    // Filter-syntax safe subset: no commas, quotes or parentheses, so a string
    // param can never inject extra filters into the graph.
    const safe = value.trim().replace(/[^A-Za-z0-9_.:@+/*-]/g, '');
    return safe === '' ? undefined : safe;
  }
  return undefined;
}
