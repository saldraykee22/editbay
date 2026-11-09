import type {
  BrandProfile,
  MemoryEntry,
  MemoryStore,
  Provider,
  ProviderConfig,
  Receipt,
  Skill,
  SkillStore,
  Workspace,
  WorkspaceFile,
} from '@editbay/harness/types';
import type { ChatRequest, ChatResponse } from '@editbay/harness/types';
import { createReceipt, type CreateReceiptInput } from '@editbay/harness/receipts';
import {
  frontMatterBool,
  frontMatterList,
  frontMatterString,
  parseFrontMatter,
  stringifyFrontMatter,
  type FrontMatterData,
} from '../lib/frontmatter';

/* ------------------------------------------------------------------ */
/* Workspace over IPC                                                  */
/* ------------------------------------------------------------------ */

export class IpcWorkspace implements Workspace {
  readonly root = 'workspace://';

  async read(relativePath: string): Promise<string | null> {
    return window.editbay.workspace.read(relativePath);
  }

  async write(relativePath: string, content: string): Promise<void> {
    await window.editbay.workspace.write(relativePath, content);
  }

  async append(relativePath: string, content: string): Promise<void> {
    await window.editbay.workspace.append(relativePath, content);
  }

  async list(relativeDir: string): Promise<WorkspaceFile[]> {
    return window.editbay.workspace.list(relativeDir);
  }

  async remove(relativePath: string): Promise<boolean> {
    return window.editbay.workspace.remove(relativePath);
  }

  async exists(relativePath: string): Promise<boolean> {
    return window.editbay.workspace.exists(relativePath);
  }
}

export const workspace = new IpcWorkspace();

/** Front-matter keys are shared with the harness file stores. */
function splitDocument(content: string): { data: FrontMatterData; body: string } {
  const parsed = parseFrontMatter(content);
  return parsed ?? { data: {}, body: content };
}

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

export class IpcSkillStore implements SkillStore {
  async list(): Promise<Skill[]> {
    const dirs = await window.editbay.workspace.list('skills');
    const skills: Skill[] = [];
    for (const dir of dirs) {
      if (!dir.name || dir.name.includes('.')) continue;
      const skill = await this.get(dir.name);
      if (skill) skills.push(skill);
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Skill | null> {
    const path = `skills/${id}/SKILL.md`;
    const content = await window.editbay.workspace.read(path);
    if (!content) return null;
    const { data, body } = splitDocument(content);
    const files = await window.editbay.workspace.list(`skills/${id}`);
    const version = frontMatterString(data, 'version');
    const createdAt = frontMatterString(data, 'createdAt') || frontMatterString(data, 'created');
    return {
      id: frontMatterString(data, 'id', id),
      name: frontMatterString(data, 'name', id),
      description: frontMatterString(data, 'description'),
      triggers: frontMatterList(data, 'triggers'),
      ...(version ? { version } : {}),
      builtin: frontMatterBool(data, 'builtin'),
      ...(createdAt ? { createdAt } : {}),
      body,
      dir: `workspace://skills/${id}`,
      hasCode: files.some((file) => file.name === 'code'),
    };
  }

  async save(skill: Omit<Skill, 'dir' | 'hasCode'> & { body: string }): Promise<Skill> {
    const data: FrontMatterData = {
      id: skill.id,
      name: skill.name || skill.id,
      description: skill.description ?? '',
      triggers: [...(skill.triggers ?? [])],
    };
    if (skill.version !== undefined) data['version'] = skill.version;
    if (skill.builtin !== undefined) data['builtin'] = skill.builtin;
    if (skill.createdAt !== undefined) data['createdAt'] = skill.createdAt;
    await window.editbay.workspace.write(`skills/${skill.id}/SKILL.md`, stringifyFrontMatter(data, skill.body));
    const saved = await this.get(skill.id);
    if (!saved) throw new Error('Skill could not be saved');
    return saved;
  }

  async match(query: string, limit = 4): Promise<Skill[]> {
    const skills = await this.list();
    const tokens = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 2);
    const scored = skills.map((skill) => {
      const haystack = `${skill.name} ${skill.description} ${skill.triggers.join(' ')}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (skill.triggers.some((trigger) => trigger.toLowerCase().includes(token))) score += 3;
        if (haystack.includes(token)) score += 1;
      }
      return { skill, score };
    });
    return scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.skill);
  }
}

export const skills = new IpcSkillStore();

/* ------------------------------------------------------------------ */
/* Memory                                                              */
/* ------------------------------------------------------------------ */

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'note'
  );
}

/** The first markdown heading, used when a note has no `title` front-matter. */
function firstHeading(markdown: string): string | undefined {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (match) return (match[1] ?? '').trim();
  }
  return undefined;
}

/** Strip one leading heading so a note body never repeats its own title. */
export function stripDuplicateHeading(body: string, title: string): string {
  const lines = body.replace(/^\r?\n+/, '').split(/\r?\n/);
  const first = (lines[0] ?? '').trim();
  const match = /^#{1,6}\s+(.+)$/.exec(first);
  if (!match) return body.replace(/^\r?\n+/, '');
  const heading = (match[1] ?? '').trim();
  if (heading !== title.trim()) return body.replace(/^\r?\n+/, '');
  return lines.slice(1).join('\n').replace(/^\r?\n+/, '');
}

export class IpcMemoryStore implements MemoryStore {
  async listBrands(): Promise<BrandProfile[]> {
    const dirs = await window.editbay.workspace.list('brands');
    const brands: BrandProfile[] = [];
    for (const dir of dirs) {
      const brand = await this.getBrand(dir.name);
      if (brand) brands.push(brand);
    }
    return brands.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getBrand(id: string): Promise<BrandProfile | null> {
    const content = await window.editbay.workspace.read(`brands/${id}/identity.md`);
    if (!content) return null;
    const { data, body } = splitDocument(content);
    const logoPath = frontMatterString(data, 'logoPath') || frontMatterString(data, 'logo');
    return {
      id: frontMatterString(data, 'id', id),
      name: frontMatterString(data, 'name', id),
      body,
      colors: frontMatterList(data, 'colors'),
      fonts: frontMatterList(data, 'fonts'),
      ...(logoPath ? { logoPath } : {}),
      updatedAt:
        frontMatterString(data, 'updatedAt') || frontMatterString(data, 'updated') || new Date().toISOString(),
    };
  }

  async saveBrand(brand: BrandProfile): Promise<void> {
    // Key names and array shapes match `FileMemoryStore.saveBrand` so both
    // stores read the same identity.md file.
    const data: FrontMatterData = {
      id: brand.id,
      name: brand.name,
      colors: [...brand.colors],
      fonts: [...brand.fonts],
      updatedAt: new Date().toISOString(),
    };
    if (brand.logoPath) data['logoPath'] = brand.logoPath;
    await window.editbay.workspace.write(`brands/${brand.id}/identity.md`, stringifyFrontMatter(data, brand.body));
  }

  async entries(): Promise<MemoryEntry[]> {
    const files = await window.editbay.workspace.list('memory');
    const entries: MemoryEntry[] = [];
    for (const file of files) {
      if (!file.name.endsWith('.md')) continue;
      const content = await window.editbay.workspace.read(file.path);
      if (!content) continue;
      const { data, body } = splitDocument(content);
      entries.push({
        id: file.name.replace(/\.md$/, ''),
        title: frontMatterString(data, 'title') || firstHeading(body) || file.name,
        body,
        tags: frontMatterList(data, 'tags'),
        source: frontMatterString(data, 'source', 'user'),
        createdAt: frontMatterString(data, 'createdAt') || frontMatterString(data, 'created') || file.updatedAt,
        path: file.path,
      });
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async remember(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'path'>): Promise<MemoryEntry> {
    const createdAt = new Date().toISOString();
    const id = `${createdAt.slice(0, 10)}-${slugify(entry.title)}`;
    const path = `memory/${id}.md`;
    const body = stripDuplicateHeading(entry.body, entry.title);
    const data: FrontMatterData = {
      id,
      title: entry.title,
      source: entry.source,
      createdAt,
      tags: [...entry.tags],
    };
    await window.editbay.workspace.write(path, stringifyFrontMatter(data, body));
    return { ...entry, id, createdAt, path, body };
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const tokens = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 2);
    if (tokens.length === 0) return (await this.entries()).slice(0, limit);
    const all = await this.entries();
    return all
      .map((entry) => {
        const haystack = `${entry.title} ${entry.body} ${entry.tags.join(' ')}`.toLowerCase();
        const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
        return { entry, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((row) => row.entry);
  }
}

export const memory = new IpcMemoryStore();

/* ------------------------------------------------------------------ */
/* Receipts over the workspace bridge                                  */
/* ------------------------------------------------------------------ */

export class IpcReceiptStore {
  async record(input: CreateReceiptInput): Promise<Receipt> {
    const receipt = createReceipt(input);
    const day = receipt.at.slice(0, 10);
    await window.editbay.workspace.append(`receipts/${day}.jsonl`, `${JSON.stringify(receipt)}\n`);
    return receipt;
  }
}

export const receipts = new IpcReceiptStore();

/* ------------------------------------------------------------------ */
/* Provider over IPC (keys never enter the renderer)                   */
/* ------------------------------------------------------------------ */

export class IpcProvider implements Provider {
  id = 'ipc';
  label = 'Editbay provider bridge';
  requiresApiKey = false;
  defaultBaseUrl = '';
  defaultModel = '';

  constructor(private readonly config: { providerId: string; baseUrl?: string }) {}

  async chat(request: ChatRequest, _config: ProviderConfig): Promise<ChatResponse> {
    const requestId = `llm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const signal = request.signal;
    const abort = () => {
      void window.editbay.llm.abort(requestId);
    };
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await window.editbay.llm.chat({
        requestId,
        providerId: this.config.providerId,
        baseUrl: this.config.baseUrl,
        model: request.model,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
          toolCallId: message.toolCallId,
          toolCalls: message.toolCalls,
          name: message.name,
        })),
        tools: request.tools,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      });
      if (response.error) throw new Error(response.error);
      return {
        text: response.text,
        toolCalls: response.toolCalls,
        usage: response.usage,
      };
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
}
