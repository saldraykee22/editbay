import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EffectCatalog, effectTargetOf, parseCustomEffect } from './catalog';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

describe('parseCustomEffect', () => {
  it('parses a declarative custom effect without evaluating source', () => {
    const definition = parseCustomEffect({
      id: 'tint',
      name: 'Tint',
      category: 'color',
      description: 'Simple tint',
      params: [{ key: 'amount', label: 'Amount', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 }],
      filter: 'hue=s={amount}',
    });

    expect(definition.id).toBe('tint');
    expect(definition.name).toBe('Tint');
    expect(definition.category).toBe('color');
    expect(definition.builtin).toBe(false);
    expect(definition.params).toHaveLength(1);
    expect(definition.params[0]?.default).toBe(0.5);
  });

  it('fills param defaults and renders the filter template', () => {
    const catalog = new EffectCatalog();
    catalog.registerEffect(
      parseCustomEffect({
        id: 'soften',
        name: 'Soften',
        category: 'texture',
        params: [{ key: 'sigma', label: 'Sigma', type: 'number', default: 2 }],
        filter: 'gblur=sigma={sigma}',
      }),
    );

    const params = catalog.resolveParams({ type: 'soften', params: { sigma: 4 } });
    expect(params.sigma).toBe(4);
    const definition = catalog.effect('soften');
    const filter = definition?.ffmpeg?.(params, {
      startSec: 0,
      durationSec: 1,
      fps: 30,
      width: 320,
      height: 240,
    });
    expect(filter).toBe('gblur=sigma=4');
  });

  it('keeps unresolved placeholders and sanitises string params', () => {
    const definition = parseCustomEffect({
      id: 'box',
      name: 'Box',
      category: 'texture',
      params: [
        { key: 'color', label: 'Colour', type: 'text', default: 'red' },
        { key: 'other', label: 'Other', type: 'text', default: 'x' },
      ],
      filter: 'drawbox=color={color}:label={missing}',
    });
    const filter = definition.ffmpeg?.(
      { color: 'red,evil=1', other: 'x' },
      { startSec: 0, durationSec: 1, fps: 30, width: 320, height: 240 },
    );
    // Commas are stripped so a param cannot inject extra filters.
    expect(filter).toBe('drawbox=color=redevil1:label={missing}');
  });

  it('defaults label to key and requires no filter', () => {
    const definition = parseCustomEffect({
      id: 'noop',
      name: 'Noop',
      category: 'motion',
      params: [{ key: 'speed', type: 'number', default: 1 }],
    });
    expect(definition.params[0]?.label).toBe('speed');
    expect(definition.ffmpeg).toBeUndefined();
  });

  it('rejects malformed definitions', () => {
    expect(() => parseCustomEffect(null)).toThrow(/JSON object/);
    expect(() => parseCustomEffect([])).toThrow(/JSON object/);
    expect(() => parseCustomEffect({})).toThrow(/id/);
    expect(() => parseCustomEffect({ id: '../escape', name: 'x', category: 'motion' })).toThrow(/id/);
    expect(() => parseCustomEffect({ id: 'x', name: 'x', category: 'weird' })).toThrow(/category/);
    expect(() => parseCustomEffect({ id: 'x', name: 'x', category: 'motion', params: 'nope' })).toThrow(
      /params must be an array/,
    );
    expect(() =>
      parseCustomEffect({
        id: 'x',
        name: 'x',
        category: 'motion',
        params: [{ key: 'amount', type: 'number', default: 'NaN' }],
      }),
    ).toThrow(/default must be a finite number/);
    expect(() =>
      parseCustomEffect({ id: 'x', name: 'x', category: 'motion', filter: 'eq=contrast=1;[1:v]hue=s=0' }),
    ).toThrow(/single filter/);
    expect(() => parseCustomEffect({ id: 'x', name: 'x', category: 'motion', filter: 42 })).toThrow(
      /filter must be a string/,
    );
  });
});

describe('effect targets', () => {
  it('falls back to video when an effect declares no target', () => {
    expect(effectTargetOf('fade')).toBe('video');
    expect(effectTargetOf('unknown-effect')).toBe('video');
  });

  it('keeps a declared target and rejects unknown ones', () => {
    const definition = parseCustomEffect({
      id: 'duck',
      name: 'Duck',
      category: 'audio',
      params: [{ key: 'amount', type: 'number', default: 0.5 }],
      target: 'audio',
    });
    expect(definition.target).toBe('audio');
    const catalog = new EffectCatalog({ effects: [definition] });
    expect(effectTargetOf('duck', catalog)).toBe('audio');
    expect(() =>
      parseCustomEffect({ id: 'x', name: 'x', category: 'audio', target: 'clip' }),
    ).toThrow(/target must be one of/);
  });
});

describe('effect package sources', () => {
  it('never evaluates effect code', () => {
    const offenders = readdirSync(sourceDir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => {
        const source = readFileSync(path.join(sourceDir, name), 'utf8');
        return /\bnew\s+Function\b|\beval\s*\(/.test(source);
      });
    expect(offenders).toEqual([]);
  });
});
