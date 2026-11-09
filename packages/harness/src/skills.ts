import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { FrontMatterData, FrontMatterValue } from './frontmatter';
import { parseFrontMatter, stringifyFrontMatter } from './frontmatter';
import type { Skill, SkillStore } from './types';

export interface FileSkillStoreOptions {
  /** Workspace root. User skills live in `<root>/skills/<id>/SKILL.md`. */
  root: string;
  /** Optional directory whose subfolders are read-only builtin skills. */
  builtinDir?: string;
}

/**
 * File-backed skill store.
 *
 * A skill is a directory with a `SKILL.md` file (YAML front-matter + markdown
 * instructions) and optionally a `code/` folder. User skills override builtin
 * skills with the same id.
 */
export class FileSkillStore implements SkillStore {
  private readonly root: string;
  private readonly userDir: string;
  private readonly builtinDir: string | null;

  constructor(options: FileSkillStoreOptions) {
    if (!options || typeof options.root !== 'string' || options.root.trim() === '') {
      throw new Error('SkillStore requires a workspace root');
    }
    this.root = path.resolve(options.root);
    this.userDir = path.join(this.root, 'skills');
    this.builtinDir =
      typeof options.builtinDir === 'string' && options.builtinDir.trim() !== ''
        ? path.resolve(options.builtinDir)
        : null;
  }

  async list(): Promise<Skill[]> {
    const byId = new Map<string, Skill>();

    if (this.builtinDir) {
      for (const skill of await this.scanDirectory(this.builtinDir, true)) {
        byId.set(skill.id, skill);
      }
    }
    for (const skill of await this.scanDirectory(this.userDir, false)) {
      byId.set(skill.id, skill);
    }

    return [...byId.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  }

  async get(id: string): Promise<Skill | null> {
    if (!isSafeSkillId(id)) return null;

    const userSkill = await this.readSkill(path.join(this.userDir, id), id, false);
    if (userSkill) return userSkill;
    if (this.builtinDir) {
      return this.readSkill(path.join(this.builtinDir, id), id, true);
    }
    return null;
  }

  async save(
    skill: Omit<Skill, 'dir' | 'hasCode'> & { body: string },
  ): Promise<Skill> {
    if (!isSafeSkillId(skill.id)) {
      throw new Error(`Invalid skill id: ${skill.id}`);
    }
    const name = (skill.name || skill.id).trim();
    const description = (skill.description ?? '').trim();
    const triggers = (skill.triggers ?? []).map((trigger) => String(trigger).trim()).filter(Boolean);

    const dir = path.join(this.userDir, skill.id);
    await fs.mkdir(dir, { recursive: true });

    const data: FrontMatterData = {
      id: skill.id,
      name,
      description,
      triggers,
    };
    if (skill.version !== undefined) data.version = skill.version;
    if (skill.builtin !== undefined) data.builtin = skill.builtin;
    if (skill.createdAt !== undefined) data.createdAt = skill.createdAt;

    await fs.writeFile(path.join(dir, 'SKILL.md'), stringifyFrontMatter(data, skill.body), 'utf8');

    return {
      id: skill.id,
      name,
      description,
      triggers,
      version: skill.version,
      builtin: skill.builtin,
      createdAt: skill.createdAt,
      body: skill.body,
      dir,
      hasCode: await pathExists(path.join(dir, 'code')),
    };
  }

  async match(query: string, limit = 5): Promise<Skill[]> {
    const skills = await this.list();
    const normalizedQuery = normalize(query);
    if (normalizedQuery === '') return [];
    const queryTokens = tokenize(normalizedQuery);
    const queryTokenSet = new Set(queryTokens);

    const scored: Array<{ skill: Skill; score: number }> = [];
    for (const skill of skills) {
      let score = 0;
      const name = normalize(skill.name);
      const description = normalize(skill.description);
      const id = normalize(skill.id);

      for (const trigger of skill.triggers) {
        const normalizedTrigger = normalize(trigger);
        if (normalizedTrigger === '') continue;
        if (normalizedQuery.includes(normalizedTrigger)) {
          // Exact trigger phrases are the strongest signal.
          score += 10 + normalizedTrigger.split(/\s+/).length;
        }
        for (const token of tokenize(normalizedTrigger)) {
          if (queryTokenSet.has(token)) score += 3;
        }
      }

      for (const token of queryTokens) {
        if (name.includes(token)) score += 4;
        if (id.includes(token)) score += 2;
        if (description.includes(token)) score += 1;
      }

      if (score > 0) scored.push({ skill, score });
    }

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        a.skill.name.localeCompare(b.skill.name) ||
        a.skill.id.localeCompare(b.skill.id),
    );
    return scored.slice(0, Math.max(0, Math.floor(limit))).map((entry) => entry.skill);
  }

  /* ---------------------------------------------------------------- */

  private async scanDirectory(dir: string, builtin: boolean): Promise<Skill[]> {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }

    const skills: Skill[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isSafeSkillId(entry.name)) continue;
      const skill = await this.readSkill(path.join(dir, entry.name), entry.name, builtin);
      if (skill) skills.push(skill);
    }
    return skills;
  }

  private async readSkill(dir: string, idHint: string, builtin: boolean): Promise<Skill | null> {
    const file = path.join(dir, 'SKILL.md');
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
      throw new Error(`Invalid SKILL.md at ${file}: ${errorMessage(error)}`);
    }
    if (!parsed) {
      throw new Error(
        `Invalid SKILL.md at ${file}: missing YAML front-matter (file must start with "---")`,
      );
    }

    const data = parsed.data;
    const id = nonEmptyString(data.id) ?? idHint;
    const name = nonEmptyString(data.name) ?? id;
    const description = nonEmptyString(data.description) ?? '';
    const triggers = stringArray(data.triggers);
    const version = nonEmptyString(data.version);
    const createdAt = nonEmptyString(data.createdAt);
    const builtinFlag = typeof data.builtin === 'boolean' ? data.builtin : builtin;

    return {
      id,
      name,
      description,
      triggers,
      version,
      builtin: builtinFlag,
      createdAt,
      body: parsed.body,
      dir,
      hasCode: await pathExists(path.join(dir, 'code')),
    };
  }
}

export function createSkillStore(options: FileSkillStoreOptions): SkillStore {
  return new FileSkillStore(options);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'your',
  'you',
  'bir',
  'ile',
  'için',
  'icin',
  'olan',
  've',
  'bu',
  'şu',
  'su',
]);

function tokenize(value: string): string[] {
  return [
    ...new Set(
      normalize(value)
        .split(/[^a-z0-9ığüşöç]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
    ),
  ];
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}

function nonEmptyString(value: FrontMatterValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function stringArray(value: FrontMatterValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()];
  return [];
}

function isSafeSkillId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes('..');
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
