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

/* ------------------------------------------------------------------ */
/* Front matter (kept in the renderer: no node imports)                */
/* ------------------------------------------------------------------ */

interface FrontMatter {
  meta: Record<string, string>;
  body: string;
}

function parseFrontMatter(text: string): FrontMatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    meta[key] = value.replace(/^["']|["']$/g, '');
  }
  return { meta, body: match[2] ?? '' };
}

function stringifyFrontMatter(meta: Record<string, string | number | boolean>, body: string): string {
  const lines = Object.entries(meta).map(([key, value]) => `${key}: ${String(value)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

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
    const existing = (await this.read(relativePath)) ?? '';
    await this.write(relativePath, existing + content);
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
    const { meta, body } = parseFrontMatter(content);
    const files = await window.editbay.workspace.list(`skills/${id}`);
    return {
      id,
      name: meta['name'] ?? id,
      description: meta['description'] ?? '',
      triggers: parseList(meta['triggers']),
      version: meta['version'],
      builtin: meta['builtin'] === 'true',
      createdAt: meta['created'],
      body,
      dir: `workspace://skills/${id}`,
      hasCode: files.some((file) => file.name === 'code'),
    };
  }

  async save(skill: Omit<Skill, 'dir' | 'hasCode'> & { body: string }): Promise<Skill> {
    const content = stringifyFrontMatter(
      {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        triggers: `[${skill.triggers.join(', ')}]`,
        version: skill.version ?? '1',
        builtin: skill.builtin ? 'true' : 'false',
        created: skill.createdAt ?? new Date().toISOString(),
      },
      skill.body,
    );
    await window.editbay.workspace.write(`skills/${skill.id}/SKILL.md`, content);
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
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'note';
}

export class IpcMemoryStore implements MemoryStore {
  async listBrands(): Promise<BrandProfile[]> {
    const dirs = await window.editbay.workspace.list('brands');
    const brands: BrandProfile[] = [];
    for (const dir of dirs) {
      const brand = await this.getBrand(dir.name);
      if (brand) brands.push(brand);
    }
    return brands;
  }

  async getBrand(id: string): Promise<BrandProfile | null> {
    const content = await window.editbay.workspace.read(`brands/${id}/identity.md`);
    if (!content) return null;
    const { meta, body } = parseFrontMatter(content);
    return {
      id,
      name: meta['name'] ?? id,
      body,
      colors: parseList(meta['colors']),
      fonts: parseList(meta['fonts']),
      logoPath: meta['logo'],
      updatedAt: meta['updated'] ?? new Date().toISOString(),
    };
  }

  async saveBrand(brand: BrandProfile): Promise<void> {
    const content = stringifyFrontMatter(
      {
        name: brand.name,
        colors: brand.colors.join(', '),
        fonts: brand.fonts.join(', '),
        ...(brand.logoPath ? { logo: brand.logoPath } : {}),
        updated: new Date().toISOString(),
      },
      brand.body,
    );
    await window.editbay.workspace.write(`brands/${brand.id}/identity.md`, content);
  }

  async entries(): Promise<MemoryEntry[]> {
    const files = await window.editbay.workspace.list('memory');
    const entries: MemoryEntry[] = [];
    for (const file of files) {
      if (!file.name.endsWith('.md')) continue;
      const content = await window.editbay.workspace.read(file.path);
      if (!content) continue;
      const { meta, body } = parseFrontMatter(content);
      entries.push({
        id: file.name.replace(/\.md$/, ''),
        title: meta['title'] ?? file.name,
        body,
        tags: parseList(meta['tags']),
        source: meta['source'] ?? 'user',
        createdAt: meta['created'] ?? file.updatedAt,
        path: file.path,
      });
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async remember(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'path'>): Promise<MemoryEntry> {
    const createdAt = new Date().toISOString();
    const id = `${createdAt.slice(0, 10)}-${slugify(entry.title)}`;
    const path = `memory/${id}.md`;
    const content = stringifyFrontMatter(
      {
        title: entry.title,
        source: entry.source,
        created: createdAt,
        tags: `[${entry.tags.join(', ')}]`,
      },
      `# ${entry.title}\n\n${entry.body}`,
    );
    await window.editbay.workspace.write(path, content);
    return { ...entry, id, createdAt, path };
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
    const response = await window.editbay.llm.chat({
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
  }
}
