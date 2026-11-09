import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import {
  EditSession,
  createEmptyProject,
  describeChanges,
  projectSummary,
  timelineDurationMs,
  type AgentCommand,
  type ApplyResult,
  type Asset,
  type BatchResult,
  type EditCommand,
  type Project,
} from '@editbay/core';
import {
  exportProject,
  extractFrameDataUrl,
  getFfmpegInfo,
  makeThumbnail,
  probeMedia,
  type ExportProgress,
  type ExportQuality,
  type ProbeResult,
} from '@editbay/engine';
import { effectCatalog } from '@editbay/effects';
import {
  FileMemoryStore,
  FileSkillStore,
  type BrandProfile,
  type MemoryEntry,
  type Skill,
} from '@editbay/harness';
import { assertSafeBrandId } from './id';

export interface StudioOptions {
  /** Path to the project JSON file. Created when missing. */
  projectPath: string;
  /** Root for brands/, memory/, skills/, receipts/. Defaults to ~/.editbay. */
  workspaceRoot?: string;
  /** Directory that ships read-only builtin skills. */
  builtinSkillsDir?: string;
  /** Project name used when a new project file is created. */
  name?: string;
}

export interface ImportResult {
  assetId: string;
  clipId?: string;
  label: string;
  kind: Asset['kind'];
  durationMs: number;
}

export interface ApplyReport {
  ok: boolean;
  changes: string[];
  results: ApplyResult[];
  project: Project;
  fatal?: string;
}

export interface ExportReport {
  outPath: string;
  durationMs: number;
  sizeBytes: number;
  elapsedMs: number;
}

const DEFAULT_WORKSPACE = join(homedir(), '.editbay');

function isEditCommand(command: AgentCommand): command is EditCommand {
  return command.op !== 'clarify' && command.op !== 'unsupported';
}

function kindFromPath(path: string): Asset['kind'] {
  const ext = extname(path).toLowerCase();
  if (['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'].includes(ext)) return 'video';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return 'image';
  return 'audio';
}

/**
 * Headless studio: the same project, commands and renderer as the desktop app,
 * with no UI. Used by the CLI, the MCP server and evaluation runs.
 */
export class HeadlessStudio {
  readonly projectPath: string;
  readonly workspaceRoot: string;
  readonly skills: FileSkillStore;
  readonly memory: FileMemoryStore;
  private session: EditSession;
  private saveTimer: NodeJS.Timeout | null = null;
  /** Saves are serialized through this promise chain (no `.tmp` collisions). */
  private saveChain: Promise<void> = Promise.resolve();
  /** Monotonic suffix for unique temp files. */
  private saveSequence = 0;

  private constructor(options: Required<Pick<StudioOptions, 'projectPath' | 'workspaceRoot'>> & {
    session: EditSession;
    builtinSkillsDir?: string;
  }) {
    this.projectPath = options.projectPath;
    this.workspaceRoot = options.workspaceRoot;
    this.session = options.session;
    this.skills = new FileSkillStore({ root: this.workspaceRoot, builtinDir: options.builtinSkillsDir });
    this.memory = new FileMemoryStore(this.workspaceRoot);
  }

  static async open(options: StudioOptions): Promise<HeadlessStudio> {
    const projectPath = isAbsolute(options.projectPath) ? options.projectPath : resolve(options.projectPath);
    const workspaceRoot = resolve(options.workspaceRoot ?? DEFAULT_WORKSPACE);
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(dirname(projectPath), { recursive: true });

    let session: EditSession;
    if (existsSync(projectPath)) {
      const raw = await fs.readFile(projectPath, 'utf8');
      session = EditSession.fromJSON(raw);
    } else {
      session = new EditSession(createEmptyProject(options.name ?? 'Untitled'));
    }

    const studio = new HeadlessStudio({ projectPath, workspaceRoot, session, builtinSkillsDir: options.builtinSkillsDir });
    if (!existsSync(projectPath)) await studio.save();
    return studio;
  }

  get project(): Project {
    return this.session.project;
  }

  get durationMs(): number {
    return timelineDurationMs(this.project);
  }

  get canUndo(): boolean {
    return this.session.canUndo;
  }

  get canRedo(): boolean {
    return this.session.canRedo;
  }

  /**
   * Writes the project atomically. Concurrent callers are serialized and each
   * attempt uses its own temp file, so two overlapping saves can never race on
   * the same path (and a failed attempt never leaves the project half-written).
   */
  async save(): Promise<void> {
    const write = async (): Promise<void> => {
      const json = this.session.toJSON();
      mkdirSync(dirname(this.projectPath), { recursive: true });
      this.saveSequence += 1;
      const temp = `${this.projectPath}.${process.pid}.${this.saveSequence}.tmp`;
      try {
        await fs.writeFile(temp, json, 'utf8');
        await fs.rename(temp, this.projectPath);
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => undefined);
        throw error;
      }
    };
    const next = this.saveChain.then(write, write);
    // The chain itself must never reject; callers observe their own failure.
    this.saveChain = next.catch(() => undefined);
    return next;
  }

  /** Debounced save for tool loops that mutate many times in a row. */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      // Fire-and-forget by design: the in-memory project is the truth and the
      // next flush/save retries. Swallow the rejection so it cannot surface as
      // an unhandled promise rejection and crash the host process.
      void this.save().catch(() => undefined);
    }, 150);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }

  summary(): string {
    return projectSummary(this.project);
  }

  apply(commands: AgentCommand[]): ApplyReport {
    const clarify = commands.find((command) => command.op === 'clarify');
    if (clarify && clarify.op === 'clarify') {
      return { ok: false, changes: [], results: [], project: this.project, fatal: clarify.question };
    }
    const unsupported = commands.find((command) => command.op === 'unsupported');
    if (unsupported && unsupported.op === 'unsupported') {
      return { ok: false, changes: [], results: [], project: this.project, fatal: unsupported.reason };
    }

    const before = this.project;
    const batch: BatchResult = this.session.applyBatch(commands.filter(isEditCommand));
    const changes = describeChanges(before, batch.project);
    if (batch.results.some((result) => result.ok)) {
      this.scheduleSave();
    }
    return { ok: batch.ok, changes, results: batch.results, project: batch.project };
  }

  async undo(): Promise<boolean> {
    const ok = this.session.undo();
    if (ok) await this.save();
    return ok;
  }

  async redo(): Promise<boolean> {
    const ok = this.session.redo();
    if (ok) await this.save();
    return ok;
  }

  async probe(path: string): Promise<ProbeResult> {
    return probeMedia(isAbsolute(path) ? path : resolve(path));
  }

  async importMedia(paths: string[], options: { trackId?: string; index?: number } = {}): Promise<ImportResult[]> {
    const imported: ImportResult[] = [];
    for (const input of paths) {
      const path = isAbsolute(input) ? input : resolve(input);
      if (!existsSync(path)) throw new Error(`Media file not found: ${input}`);
      const probe = await probeMedia(path);
      const kind = probe.width && probe.height ? kindFromPath(path) : kindFromPath(path);
      const label = path.split(/[\\/]/).pop() ?? path;
      const asset: Asset = {
        id: `a_${Math.random().toString(36).slice(2, 8)}`,
        kind,
        uri: path,
        label,
        durationMs: probe.durationMs > 0 ? probe.durationMs : kind === 'image' ? 5000 : 0,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        hasAudio: probe.hasAudio,
        origin: 'imported',
        createdAt: new Date().toISOString(),
      };
      const before = this.project;
      // One batch per file: a single undo removes the asset *and* its clip.
      const batch = this.session.applyBatch([
        { op: 'add_asset', asset },
        {
          op: 'import_clip',
          assetId: asset.id,
          ...(options.trackId ? { trackId: options.trackId } : {}),
          ...(options.index !== undefined ? { index: options.index } : {}),
        },
      ]);
      if (!batch.ok) {
        const changed = JSON.stringify(before) !== JSON.stringify(this.project);
        // Roll the partial batch back so a failed import leaves no orphan asset.
        if (changed) this.session.undo();
        const failed = batch.results.find((result) => !result.ok);
        const reason = failed !== undefined && !failed.ok ? failed.error.message : 'the command batch was rejected';
        throw new Error(`Could not import ${label}: ${reason}`);
      }
      const clipResult = batch.results[1];
      imported.push({
        assetId: asset.id,
        clipId: clipResult !== undefined && clipResult.ok ? clipResult.createdIds.clip : undefined,
        label,
        kind,
        durationMs: asset.durationMs,
      });
    }
    await this.save();
    return imported;
  }

  async exportVideo(
    outPath: string,
    options: { quality?: ExportQuality; onProgress?: (progress: ExportProgress) => void } = {},
  ): Promise<ExportReport> {
    const path = isAbsolute(outPath) ? outPath : resolve(outPath);
    mkdirSync(dirname(path), { recursive: true });
    const assetPaths: Record<string, string> = {};
    for (const asset of this.project.assets) assetPaths[asset.id] = asset.uri;
    const result = await exportProject(this.project, {
      outPath: path,
      assetPaths,
      quality: options.quality ?? 'standard',
      onProgress: options.onProgress,
    });
    return result;
  }

  async thumbnail(assetId: string, atMs = 0, width = 480): Promise<string> {
    const asset = this.project.assets.find((entry) => entry.id === assetId);
    if (!asset) throw new Error(`Asset not found: ${assetId}`);
    return extractFrameDataUrl(asset.uri, atMs, width);
  }

  async thumbnailFile(assetId: string, outPath: string, atMs = 0): Promise<string> {
    const asset = this.project.assets.find((entry) => entry.id === assetId);
    if (!asset) throw new Error(`Asset not found: ${assetId}`);
    const path = isAbsolute(outPath) ? outPath : resolve(outPath);
    mkdirSync(dirname(path), { recursive: true });
    await makeThumbnail(asset.uri, path, { atMs });
    return path;
  }

  ffmpegInfo() {
    return getFfmpegInfo();
  }

  effects() {
    return effectCatalog.toJSON();
  }

  async listSkills(): Promise<Skill[]> {
    return this.skills.list();
  }

  async getSkill(id: string): Promise<Skill | null> {
    return this.skills.get(id);
  }

  async saveSkill(id: string, name: string, description: string, triggers: string[], body: string): Promise<Skill> {
    return this.skills.save({ id, name, description, triggers, body, builtin: false, createdAt: new Date().toISOString() });
  }

  async remember(title: string, body: string, tags: string[] = []): Promise<MemoryEntry> {
    return this.memory.remember({ title, body, tags, source: 'agent' });
  }

  async searchMemory(query: string, limit = 5): Promise<MemoryEntry[]> {
    return this.memory.search(query, limit);
  }

  async brands(): Promise<BrandProfile[]> {
    return this.memory.listBrands();
  }

  async brand(id: string): Promise<BrandProfile | null> {
    assertSafeBrandId(id);
    return this.memory.getBrand(id);
  }

  async saveBrand(brand: BrandProfile): Promise<void> {
    assertSafeBrandId(brand.id);
    await this.memory.saveBrand(brand);
  }
}

export { effectCatalog };
export { assertSafeBrandId, isSafeBrandId } from './id';
export { hasSkillFolders, resolveBuiltinSkillsDir, type BuiltinSkillsLookup } from './skills-path';
export type { AgentCommand, Project, Skill, MemoryEntry, ProbeResult };
