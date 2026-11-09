/**
 * Workspace knowledge tools: skills, memory notes and brand identity.
 *
 * These live outside the project file and survive across sessions. They are
 * the agent's long-term context, so descriptions tell the model when writing is
 * appropriate (after an explicit user instruction or a reusable discovery).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrandProfile } from '@editbay/harness';
import type { HeadlessStudio } from '@editbay/kit';
import { errorMessage, errorResult, jsonResult } from './shared';

export function registerKnowledgeTools(server: McpServer, studio: HeadlessStudio): void {
  server.registerTool(
    'list_skills',
    {
      title: 'List skills',
      description:
        'List workspace skills: reusable editing playbooks (markdown instructions plus optional effect code). ' +
        'Call it when the user references a house style, a recurring format or a previous recipe. ' +
        'Use read_skill for the full body and write_skill to save a new playbook.',
      inputSchema: {},
    },
    async () => {
      try {
        const skills = await studio.listSkills();
        return jsonResult({
          skills: skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            triggers: skill.triggers,
            builtin: skill.builtin === true,
            hasCode: skill.hasCode,
          })),
        });
      } catch (error) {
        return errorResult(`Could not list skills: ${errorMessage(error)}`);
      }
    },
  );

  server.registerTool(
    'read_skill',
    {
      title: 'Read skill',
      description:
        'Read one skill in full, including its markdown instructions. Call it after list_skills when a skill ' +
        'matches the task, then follow the body as guidance for your edit commands. ' +
        'Id is the skill id returned by list_skills.',
      inputSchema: {
        id: z.string().min(1).describe('Skill id from list_skills.'),
      },
    },
    async (args) => {
      try {
        const skill = await studio.getSkill(args.id);
        if (!skill) {
          const available = (await studio.listSkills()).map((entry) => entry.id);
          return errorResult(
            `Skill not found: ${args.id}. Available skill ids: ${available.length > 0 ? available.join(', ') : '(none)'}.`,
          );
        }
        return jsonResult({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          triggers: skill.triggers,
          builtin: skill.builtin === true,
          hasCode: skill.hasCode,
          body: skill.body,
        });
      } catch (error) {
        return errorResult(`Could not read skill ${args.id}: ${errorMessage(error)}`);
      }
    },
  );

  server.registerTool(
    'write_skill',
    {
      title: 'Write skill',
      description:
        'Create or update a workspace skill: a reusable markdown playbook with a short description and trigger ' +
        'phrases. Use it when the user asks you to remember a workflow, or after you discovered a recipe worth ' +
        'repeating. Writing is explicit and durable; do not save throwaway notes (use remember for facts). ' +
        'Id must be a short slug such as "vertical-hook"; a user skill with the same id overrides a builtin.',
      inputSchema: {
        id: z.string().min(1).describe('Slug id, e.g. "vertical-hook". Reuse it to update the skill.'),
        name: z.string().min(1).describe('Human title.'),
        description: z.string().describe('One sentence: when this skill applies.'),
        triggers: z.array(z.string()).optional().describe('Keywords/phrases that should surface this skill.'),
        body: z.string().min(1).describe('Markdown instructions the agent should follow.'),
      },
    },
    async (args) => {
      try {
        const skill = await studio.saveSkill(
          args.id,
          args.name,
          args.description,
          args.triggers ?? [],
          args.body,
        );
        return jsonResult({
          ok: true,
          id: skill.id,
          name: skill.name,
          description: skill.description,
          triggers: skill.triggers,
        });
      } catch (error) {
        return errorResult(
          `${errorMessage(error)} Could not write the skill. Use a short slug id (letters, digits, dash, underscore).`,
        );
      }
    },
  );

  server.registerTool(
    'remember',
    {
      title: 'Remember a fact',
      description:
        'Store a durable note in workspace memory: brand facts, user preferences, recurring constraints and ' +
        'decisions that should survive the session. Use it when the user states a preference or asks you ' +
        'to remember something. Titles become searchable ids; keep them short and specific. ' +
        'For reusable procedures use write_skill instead.',
      inputSchema: {
        title: z.string().min(1).describe('Short, specific title. Also used to build the note id.'),
        body: z.string().min(1).describe('The fact in plain markdown, including context the future you needs.'),
        tags: z.array(z.string()).optional().describe('Optional lowercase keywords for search.'),
      },
    },
    async (args) => {
      try {
        const entry = await studio.remember(args.title, args.body, args.tags ?? []);
        return jsonResult({
          ok: true,
          id: entry.id,
          title: entry.title,
          tags: entry.tags,
          createdAt: entry.createdAt,
        });
      } catch (error) {
        return errorResult(`Could not save the memory note: ${errorMessage(error)}`);
      }
    },
  );

  server.registerTool(
    'search_memory',
    {
      title: 'Search memory',
      description:
        'Search durable workspace memory notes by keyword and return the best matches (title, body, tags). ' +
        'Call it before editing when brand tone, user preferences or past decisions may matter. ' +
        'An empty query returns the most recent notes.',
      inputSchema: {
        query: z.string().describe('Keywords to search for; empty string lists recent notes.'),
        limit: z.number().int().min(1).max(20).optional().describe('Max results. Defaults to 5.'),
      },
    },
    async (args) => {
      try {
        const entries = await studio.searchMemory(args.query, args.limit ?? 5);
        return jsonResult({
          entries: entries.map((entry) => ({
            id: entry.id,
            title: entry.title,
            body: entry.body,
            tags: entry.tags,
            createdAt: entry.createdAt,
          })),
        });
      } catch (error) {
        return errorResult(`Could not search memory: ${errorMessage(error)}`);
      }
    },
  );

  server.registerTool(
    'get_brand',
    {
      title: 'Get brand profile',
      description:
        'Read a brand profile: tone/audience markdown, palette colors and fonts. Call it when the user says ' +
        '"our brand", "the client" or asks for on-brand styling, then use the colors/fonts in add_text styles. ' +
        'Id is a brand id; list valid brands by calling it with an unknown id.',
      inputSchema: {
        id: z.string().min(1).describe('Brand id, e.g. "acme".'),
      },
    },
    async (args) => {
      try {
        const brand = await studio.brand(args.id);
        if (!brand) {
          const available = (await studio.brands()).map((entry) => entry.id);
          return errorResult(
            `Brand not found: ${args.id}. Available brand ids: ${available.length > 0 ? available.join(', ') : '(none)'}.`,
          );
        }
        return jsonResult({
          id: brand.id,
          name: brand.name,
          body: brand.body,
          colors: brand.colors,
          fonts: brand.fonts,
          ...(brand.logoPath === undefined ? {} : { logoPath: brand.logoPath }),
          updatedAt: brand.updatedAt,
        });
      } catch (error) {
        return errorResult(`Could not read brand ${args.id}: ${errorMessage(error)}`);
      }
    },
  );

  server.registerTool(
    'save_brand',
    {
      title: 'Save brand profile',
      description:
        'Create or update a brand profile (markdown identity, palette colors, fonts). Use it when the user defines ' +
        'or corrects brand rules. Then reuse get_brand in later edits so styling stays on-brand. ' +
        'Id must be a short slug; an existing logo path is preserved.',
      inputSchema: {
        id: z.string().min(1).describe('Slug id, e.g. "acme". Reuse it to update.'),
        name: z.string().min(1).describe('Brand display name.'),
        body: z.string().describe('Markdown identity: tone, audience, do/don\'t.'),
        colors: z.array(z.string()).optional().describe('Palette as hex strings, e.g. ["#0E1F1A", "#46E0B0"].'),
        fonts: z.array(z.string()).optional().describe('Preferred font families.'),
      },
    },
    async (args) => {
      try {
        const existing = await studio.brand(args.id);
        const brand: BrandProfile = {
          id: args.id,
          name: args.name,
          body: args.body,
          colors: args.colors ?? [],
          fonts: args.fonts ?? [],
          ...(existing?.logoPath === undefined ? {} : { logoPath: existing.logoPath }),
          updatedAt: new Date().toISOString(),
        };
        await studio.saveBrand(brand);
        return jsonResult({ ok: true, id: brand.id, name: brand.name, updatedAt: brand.updatedAt });
      } catch (error) {
        return errorResult(
          `${errorMessage(error)} Could not save the brand. Use a short slug id (letters, digits, dash, underscore).`,
        );
      }
    },
  );
}
