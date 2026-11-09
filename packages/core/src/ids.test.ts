import { describe, expect, it } from 'vitest';

import { createId } from './index';

describe('createId', () => {
  it('formats ids as prefix plus six hex characters', () => {
    expect(createId('c')).toMatch(/^c_[0-9a-f]{6}$/);
    expect(createId('fx')).toMatch(/^fx_[0-9a-f]{6}$/);
  });

  it('produces unique ids across many calls', () => {
    const ids = new Set(Array.from({ length: 500 }, () => createId('c')));
    expect(ids.size).toBe(500);
  });

  it('falls back to a generic prefix for empty input', () => {
    expect(createId('')).toMatch(/^id_[0-9a-f]{6}$/);
  });
});
