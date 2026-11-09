/**
 * Workspace commands: `skills`, `memory` and `brands`.
 *
 * Skills and notes live in the workspace (never in the project file), so this
 * group is what lets an agent remember how a brand wants to be edited.
 */

import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BrandProfile, MemoryEntry, Skill } from '@editbay/harness';
import {
  CliError,
  openStudio,
  parseIntegerFlag,
  splitList,
  writeJson,
  type CliContext,
} from './context';

async function readBody(ctx: CliContext, command: string): Promise<string> {
  const inline = ctx.options.body;
  if (inline !== undefined) return inline;
  const bodyFile = ctx.options.bodyFile;
  if (bodyFile === undefined) {
    throw new CliError(`${command} needs --body <text> or --body-file <path>`);
  }
  const path = resolve(bodyFile);
  try {
    return await fs.readFile(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not read ${path}: ${message}`);
  }
}

function skillPath(skill: Skill): string {
  return join(skill.dir, 'SKILL.md');
}

function skillJson(skill: Skill): Record<string, unknown> {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    triggers: skill.triggers,
    builtin: skill.builtin === true,
    version: skill.version ?? null,
    hasCode: skill.hasCode,
    path: skillPath(skill),
    body: skill.body,
  };
}

export async function runSkills(ctx: CliContext): Promise<number> {
  const action = ctx.options.positionals[0];
  const studio = await openStudio(ctx);

  if (action === 'list') {
    const skills = await studio.listSkills();
    if (ctx.json) {
      writeJson(
        ctx,
        skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          triggers: skill.triggers,
          builtin: skill.builtin === true,
        })),
      );
      return 0;
    }
    ctx.io.out(`skills (${skills.length})\n`);
    for (const skill of skills) {
      const origin = skill.builtin === true ? 'builtin' : 'user';
      ctx.io.out(`  ${skill.id.padEnd(20)} ${origin.padEnd(8)} ${skill.name}\n`);
      if (skill.triggers.length > 0) ctx.io.out(`  ${''.padEnd(20)} triggers: ${skill.triggers.join(', ')}\n`);
    }
    return 0;
  }

  if (action === 'show') {
    const id = ctx.options.positionals[1];
    if (id === undefined) throw new CliError('skills show needs a skill id');
    const skill = await studio.getSkill(id);
    if (skill === null) throw new CliError(`Skill not found: ${id}`);
    if (ctx.json) {
      writeJson(ctx, skillJson(skill));
      return 0;
    }
    ctx.io.out(`id           ${skill.id}\n`);
    ctx.io.out(`name         ${skill.name}\n`);
    ctx.io.out(`builtin      ${skill.builtin === true ? 'yes' : 'no'}\n`);
    ctx.io.out(`triggers     ${skill.triggers.join(', ')}\n`);
    ctx.io.out(`description  ${skill.description}\n`);
    ctx.io.out(`path         ${skillPath(skill)}\n`);
    ctx.io.out(`\n${skill.body.trim()}\n`);
    return 0;
  }

  if (action === 'add') {
    const id = ctx.options.positionals[1];
    if (id === undefined) throw new CliError('skills add needs a skill id');
    const name = ctx.options.name ?? id;
    const description = ctx.options.description ?? '';
    const triggers = splitList(ctx.options.triggers);
    const body = await readBody(ctx, 'skills add');
    const skill = await studio.saveSkill(id, name, description, triggers, body);
    if (ctx.json) {
      writeJson(ctx, skillJson(skill));
      return 0;
    }
    ctx.io.out(`saved skill: ${skill.id}\n`);
    ctx.io.out(`  name      ${skill.name}\n`);
    ctx.io.out(`  triggers  ${skill.triggers.join(', ')}\n`);
    ctx.io.out(`  path      ${skillPath(skill)}\n`);
    return 0;
  }

  throw new CliError('skills needs list, show <id> or add <id>');
}

function memoryJson(entry: MemoryEntry, workspaceRoot: string, absolutePath: string): Record<string, unknown> {
  return {
    id: entry.id,
    title: entry.title,
    tags: entry.tags,
    source: entry.source,
    createdAt: entry.createdAt,
    path: absolutePath,
    workspace: workspaceRoot,
  };
}

export async function runMemory(ctx: CliContext): Promise<number> {
  const action = ctx.options.positionals[0];
  const studio = await openStudio(ctx);

  if (action === 'remember') {
    const title = ctx.options.positionals[1];
    if (title === undefined) throw new CliError('memory remember needs a title');
    const body = await readBody(ctx, 'memory remember');
    const tags = splitList(ctx.options.tags);
    const entry = await studio.remember(title, body, tags);
    const absolutePath = join(studio.workspaceRoot, entry.path);

    if (ctx.json) {
      writeJson(ctx, memoryJson(entry, studio.workspaceRoot, absolutePath));
      return 0;
    }
    ctx.io.out(`remembered: ${entry.title}\n`);
    ctx.io.out(`  id    ${entry.id}\n`);
    ctx.io.out(`  path  ${absolutePath}\n`);
    return 0;
  }

  if (action === 'search') {
    // Join remaining positionals so `memory search brand voice` works too.
    const query = ctx.options.positionals.slice(1).join(' ');
    if (query === '') throw new CliError('memory search needs a query');
    const limit = parseIntegerFlag(ctx.options.limit, '--limit') ?? 5;
    if (limit < 0) throw new CliError('--limit must not be negative');
    const entries = await studio.searchMemory(query, limit);
    const withPaths = entries.map((entry) => ({
      entry,
      absolutePath: join(studio.workspaceRoot, entry.path),
    }));

    if (ctx.json) {
      writeJson(
        ctx,
        withPaths.map(({ entry, absolutePath }) => memoryJson(entry, studio.workspaceRoot, absolutePath)),
      );
      return 0;
    }
    ctx.io.out(`matches (${withPaths.length})\n`);
    for (const { entry, absolutePath } of withPaths) {
      ctx.io.out(`  ${entry.id.padEnd(24)} ${entry.title}\n`);
      ctx.io.out(`  ${''.padEnd(24)} ${absolutePath}\n`);
    }
    return 0;
  }

  throw new CliError('memory needs remember <title> or search <query>');
}

function brandJson(brand: BrandProfile): Record<string, unknown> {
  return {
    id: brand.id,
    name: brand.name,
    colors: brand.colors,
    fonts: brand.fonts,
    logoPath: brand.logoPath ?? null,
    updatedAt: brand.updatedAt,
    body: brand.body,
  };
}

export async function runBrands(ctx: CliContext): Promise<number> {
  const action = ctx.options.positionals[0];
  const studio = await openStudio(ctx);

  if (action === 'list') {
    const brands = await studio.brands();
    if (ctx.json) {
      writeJson(ctx, brands.map((brand) => brandJson(brand)));
      return 0;
    }
    ctx.io.out(`brands (${brands.length})\n`);
    for (const brand of brands) {
      ctx.io.out(`  ${brand.id.padEnd(20)} ${brand.name}  colors: ${brand.colors.join(', ') || '-'}\n`);
    }
    return 0;
  }

  if (action === 'show') {
    const id = ctx.options.positionals[1];
    if (id === undefined) throw new CliError('brands show needs a brand id');
    const brand = await studio.brand(id);
    if (brand === null) throw new CliError(`Brand not found: ${id}`);
    if (ctx.json) {
      writeJson(ctx, brandJson(brand));
      return 0;
    }
    ctx.io.out(`id        ${brand.id}\n`);
    ctx.io.out(`name      ${brand.name}\n`);
    ctx.io.out(`colors    ${brand.colors.join(', ') || '-'}\n`);
    ctx.io.out(`fonts     ${brand.fonts.join(', ') || '-'}\n`);
    ctx.io.out(`logo      ${brand.logoPath ?? '-'}\n`);
    ctx.io.out(`\n${brand.body.trim()}\n`);
    return 0;
  }

  throw new CliError('brands needs list or show <id>');
}
