import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FileMemoryStore } from './memory';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'editbay-memory-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('FileMemoryStore', () => {
  it('saves, reads and lists brand identities', async () => {
    const store = new FileMemoryStore(root);
    await store.saveBrand({
      id: 'acme',
      name: 'Acme',
      body: '# Voice\n\nWarm and direct.',
      colors: ['#112233', '#FFAA00'],
      fonts: ['Inter', 'IBM Plex Sans'],
      logoPath: 'brands/acme/logo.png',
      updatedAt: '2026-01-02T03:04:05.000Z',
    });

    const brand = await store.getBrand('acme');
    expect(brand?.name).toBe('Acme');
    expect(brand?.colors).toEqual(['#112233', '#FFAA00']);
    expect(brand?.fonts).toEqual(['Inter', 'IBM Plex Sans']);
    expect(brand?.logoPath).toBe('brands/acme/logo.png');
    expect(brand?.body).toContain('Warm and direct.');

    expect((await store.listBrands()).map((item) => item.id)).toEqual(['acme']);
  });

  it('returns null for a missing brand', async () => {
    const store = new FileMemoryStore(root);
    expect(await store.getBrand('nope')).toBeNull();
    expect(await store.listBrands()).toEqual([]);
  });

  it('rejects unsafe brand ids', async () => {
    const store = new FileMemoryStore(root);
    await expect(store.getBrand('../evil')).resolves.toBeNull();
    await expect(
      store.saveBrand({
        id: '../evil',
        name: 'Evil',
        body: '',
        colors: [],
        fonts: [],
        updatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/Invalid brand id/);
  });

  it('remembers a note with a slug filename and front-matter', async () => {
    const store = new FileMemoryStore(root);
    const entry = await store.remember({
      title: 'Launch Colors',
      body: 'Use the teal accent only for CTAs.',
      tags: ['color', 'launch'],
      source: 'user',
    });

    expect(entry.id).toBe('launch-colors');
    expect(entry.path).toBe('memory/launch-colors.md');
    expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const file = await readFile(path.join(root, 'memory', 'launch-colors.md'), 'utf8');
    expect(file).toContain('title: Launch Colors');
    expect(file).toContain('tags: [color, launch]');
    expect(file).toContain('source: user');
    expect(file).toContain('Use the teal accent only for CTAs.');
  });

  it('slugifies Turkish characters', async () => {
    const store = new FileMemoryStore(root);
    const entry = await store.remember({
      title: 'Ürün Çekim Notları',
      body: 'Işık yumuşak olsun.',
      tags: [],
      source: 'agent',
    });
    expect(entry.id).toBe('urun-cekim-notlari');
  });

  it('avoids filename collisions', async () => {
    const store = new FileMemoryStore(root);
    const first = await store.remember({ title: 'Same title', body: 'one', tags: [], source: 'user' });
    const second = await store.remember({ title: 'Same title', body: 'two', tags: [], source: 'user' });

    expect(first.path).toBe('memory/same-title.md');
    expect(second.path).toBe('memory/same-title-2.md');
  });

  it('lists entries and ranks title matches first', async () => {
    const store = new FileMemoryStore(root);
    await store.remember({
      title: 'Lighting setup',
      body: 'Soft key light from the left.',
      tags: ['studio'],
      source: 'user',
    });
    await store.remember({
      title: 'Color palette',
      body: 'Brand colors are teal and charcoal.',
      tags: ['brand'],
      source: 'user',
    });

    const entries = await store.entries();
    expect(entries).toHaveLength(2);

    const matches = await store.search('lighting');
    expect(matches[0]?.title).toBe('Lighting setup');

    const palette = await store.search('brand colors');
    expect(palette[0]?.title).toBe('Color palette');
  });

  it('returns recent entries for an empty query and respects limit', async () => {
    const store = new FileMemoryStore(root);
    await store.remember({ title: 'One', body: 'first', tags: [], source: 'user' });
    await store.remember({ title: 'Two', body: 'second', tags: [], source: 'user' });

    expect(await store.search('', 10)).toHaveLength(2);
    expect(await store.search('', 1)).toHaveLength(1);
    expect(await store.search('unrelated-token')).toEqual([]);
  });

  it('reads hand-written notes with defaults', async () => {
    const store = new FileMemoryStore(root);
    await mkdir(path.join(root, 'memory'), { recursive: true });
    await writeFile(
      path.join(root, 'memory', 'hand-written.md'),
      ['---', 'title: Hand written', 'tags: [import]', '---', 'Body from disk'].join('\n'),
      'utf8',
    );

    const entries = await store.entries();
    expect(entries[0]?.title).toBe('Hand written');
    expect(entries[0]?.source).toBe('user');
    expect(entries[0]?.body).toBe('Body from disk');
  });
});
