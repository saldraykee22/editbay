import type { EffectInstance } from '@editbay/core';
import type { EffectDefinition, EffectParam, TransitionDefinition } from './types';
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
 * Compile a workspace effect module written by the agent.
 * The module source must assign a `const effect = { ... }` object (no imports,
 * no exports). It runs in the UI process only, in a function scope without DOM
 * handles; export quality falls back to a preview approximation unless the
 * module also supplies an `ffmpeg(params, meta)` function.
 */
export function compileCustomEffect(source: string): EffectDefinition {
  const factory = new Function('helpers', `${source}\nreturn typeof effect !== 'undefined' ? effect : null;`);
  const helpers = { clamp: (n: number, a: number, b: number) => Math.min(b, Math.max(a, n)) };
  const result = factory(helpers) as EffectDefinition | null;
  if (!result || typeof result !== 'object' || typeof result.id !== 'string') {
    throw new Error('Effect module must define a `const effect = { id, name, params, style }` object');
  }
  return {
    ...result,
    params: Array.isArray(result.params) ? result.params : [],
    builtin: false,
    id: result.id,
    name: result.name || result.id,
    category: result.category ?? 'motion',
    description: result.description ?? '',
  };
}
