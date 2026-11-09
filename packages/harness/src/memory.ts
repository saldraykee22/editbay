import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { FrontMatterData, FrontMatterValue } from './frontmatter';
import { parseFrontMatter, stringifyFrontMatter } from './frontmatter';
import type { BrandProfile, MemoryEntry, MemoryStore } from './types';

/**
 * File-backed brand identity and memory notes.
 *
 * Layout:
 *   <root>/brands/<brandId>/identity.md   (front-matter + markdown body)
 *   <root>/memory/<slug>.md               (front-matter + markdown body)
 */
export class FileMemoryStore implements MemoryStore {
  private readonly root: string;
  private readonly brandsDir: string;
  private readonly memoryDir: string;

  constructor(root: string) {
    if (typeof root !== 'string' || root.trim() === '') {
      throw new Error('MemoryStore requires a workspace root');
    }
    this.root = path.resolve(root);
    this.brandsDir = path.join(this.root, 'brands');
    this.memoryDir = path.join(this.root, 'memory');
  }

  async listBrands(): Promise<BrandProfile[]> {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await fs.readdir(this.brandsDir, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }

    const brands: BrandProfile[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isSafeBrandId(entry.name)) continue;
      const brand = await this.getBrand(entry.name);
      if (brand) brands.push(brand);
    }
    brands.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return brands;
  }

  async getBrand(id: string): Promise<BrandProfile | null> {
    if (!isSafeBrandId(id)) return null;
    const file = path.join(this.brandsDir, id, 'identity.md');
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    return parseBrand(id, file, text);
  }

  async saveBrand(brand: BrandProfile): Promise<void> {
    if (!isSafeBrandId(brand.id)) {
      throw new Error(`Invalid brand id: ${brand.id}`);
    }
    const dir = path.join(this.brandsDir, brand.id);
    await fs.mkdir(dir, { recursive: true });

    const data: FrontMatterData = {
      id: brand.id,
      name: brand.name,
      colors: [...brand.colors],
      fonts: [...brand.fonts],
      updatedAt: brand.updatedAt,
    };
    if (brand.logoPath !== undefined) data.logoPath = brand.logoPath;

    await fs.writeFile(path.join(dir, 'identity.md'), stringifyFrontMatter(data, brand.body), 'utf8');
  }

  async entries(): Promise<MemoryEntry[]> {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await fs.readdir(this.memoryDir, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }

    const notes: MemoryEntry[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const note = await this.readEntry(entry.name);
      if (note) notes.push(note);
    }
    notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return notes;
  }

  async remember(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'path'>): Promise<MemoryEntry> {
    const title = entry.title.trim();
    if (title === '') throw new Error('Memory note title must not be empty');

    const baseSlug = slugify(title);
    const id = await this.uniqueSlug(baseSlug);
    const createdAt = new Date().toISOString();
    const filename = `${id}.md`;
    const relativePath = `memory/${filename}`;
    const file = path.join(this.memoryDir, filename);

    const data: FrontMatterData = {
      id,
      title,
      tags: [...entry.tags],
      source: entry.source,
      createdAt,
    };

    await fs.mkdir(this.memoryDir, { recursive: true });
    await fs.writeFile(file, stringifyFrontMatter(data, entry.body), 'utf8');

    return {
      id,
      title,
      tags: [...entry.tags],
      source: entry.source,
      createdAt,
      body: entry.body,
      path: relativePath,
    };
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const entries = await this.entries();
    const max = Math.max(0, Math.floor(limit));
    if (max === 0) return [];

    const normalizedQuery = query.toLocaleLowerCase('en-US').trim();
    const tokens = tokenize(normalizedQuery);
    if (tokens.length === 0) return entries.slice(0, max);

    const scored: Array<{ entry: MemoryEntry; score: number }> = [];
    for (const entry of entries) {
      const title = entry.title.toLocaleLowerCase('en-US');
      const body = entry.body.toLocaleLowerCase('en-US');
      const tags = entry.tags.map((tag) => tag.toLocaleLowerCase('en-US'));
      let score = 0;

      if (normalizedQuery !== '' && title.includes(normalizedQuery)) score += 6;

      for (const token of tokens) {
        if (title.includes(token)) score += 4;
        if (tags.some((tag) => tag.includes(token))) score += 3;
        const occurrences = countOccurrences(body, token);
        score += Math.min(occurrences, 3);
      }

      if (score > 0) scored.push({ entry, score });
    }

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        b.entry.createdAt.localeCompare(a.entry.createdAt) ||
        a.entry.id.localeCompare(b.entry.id),
    );
    return scored.slice(0, max).map((item) => item.entry);
  }

  /* ---------------------------------------------------------------- */

  private async readEntry(filename: string): Promise<MemoryEntry | null> {
    const file = path.join(this.memoryDir, filename);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }

    let parsed: ReturnType<typeof parseFrontMatter>;
    try {
      parsed = parseFrontMatter(text);
    } catch (error) {
      throw new Error(`Invalid memory note at ${file}: ${errorMessage(error)}`);
    }

    const data = parsed?.data ?? {};
    const fallbackId = filename.replace(/\.md$/i, '');
    const id = nonEmptyString(data.id) ?? fallbackId;
    const title = nonEmptyString(data.title) ?? firstHeading(parsed?.body ?? '') ?? fallbackId;
    const createdFromFile = await fileUpdatedAt(file, parsed?.body ?? '');

    return {
      id,
      title,
      tags: stringArray(data.tags),
      source: nonEmptyString(data.source) ?? 'user',
      createdAt: nonEmptyString(data.createdAt) ?? createdFromFile,
      body: parsed?.body ?? '',
      path: `memory/${filename}`,
    };
  }

  private async uniqueSlug(base: string): Promise<string> {
    let candidate = base;
    let counter = 2;
    while (await pathExists(path.join(this.memoryDir, `${candidate}.md`))) {
      candidate = `${base}-${counter}`;
      counter += 1;
    }
    return candidate;
  }
}

export function createMemoryStore(root: string): MemoryStore {
  return new FileMemoryStore(root);
}

/* ------------------------------------------------------------------ */
/* Parsing helpers                                                     */
/* ------------------------------------------------------------------ */

function parseBrand(id: string, file: string, text: string): BrandProfile {
  let parsed: ReturnType<typeof parseFrontMatter>;
  try {
    parsed = parseFrontMatter(text);
  } catch (error) {
    throw new Error(`Invalid brand identity at ${file}: ${errorMessage(error)}`);
  }
  if (!parsed) {
    throw new Error(`Invalid brand identity at ${file}: missing YAML front-matter`);
  }

  const data = parsed.data;
  const logoPath = nonEmptyString(data.logoPath);
  return {
    id: nonEmptyString(data.id) ?? id,
    name: nonEmptyString(data.name) ?? id,
    colors: stringArray(data.colors),
    fonts: stringArray(data.fonts),
    ...(logoPath !== undefined ? { logoPath } : {}),
    updatedAt: nonEmptyString(data.updatedAt) ?? new Date().toISOString(),
    body: parsed.body,
  };
}

function nonEmptyString(value: FrontMatterValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function stringArray(value: FrontMatterValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()];
  return [];
}

function firstHeading(markdown: string): string | undefined {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (match) return (match[1] ?? '').trim();
  }
  return undefined;
}

async function fileUpdatedAt(file: string, body: string): Promise<string> {
  // Prefer the body to stay deterministic when no front-matter timestamp exists.
  if (body.trim() !== '') {
    try {
      const stat = await fs.stat(file);
      return stat.mtime.toISOString();
    } catch {
      return new Date(0).toISOString();
    }
  }
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const TURKISH_MAP: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

export function slugify(value: string): string {
  const lowered = value.toLocaleLowerCase('en-US');
  let transliterated = '';
  for (const char of lowered) {
    transliterated += TURKISH_MAP[char] ?? char;
  }
  const slug = transliterated
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug === '' ? 'note' : slug;
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'bir',
  'ile',
  'için',
  'icin',
  'olan',
  've',
  'bu',
]);

function tokenize(value: string): string[] {
  return [
    ...new Set(
      value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
    ),
  ];
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Brand ids become directory names. Only lowercase slugs are allowed so a
 * brand id can never traverse outside `brands/`.
 */
export const BRAND_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isSafeBrandId(id: string): boolean {
  return typeof id === 'string' && BRAND_ID_PATTERN.test(id);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
