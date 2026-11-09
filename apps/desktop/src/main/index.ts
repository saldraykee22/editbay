import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportProject, probeMedia, getFfmpegInfo, extractFrameDataUrl, extractPeaks } from '@editbay/engine';
import { getProvider } from '@editbay/harness';
import type {
  AppInfoDTO,
  ChatRequestDTO,
  ChatResponseDTO,
  ExportRequestDTO,
  PickedMedia,
} from '../shared/api';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'editbay-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false },
  },
]);

const isDev = !app.isPackaged;

function userDataFile(name: string): string {
  return join(app.getPath('userData'), name);
}

function workspaceRoot(): string {
  const root = join(app.getPath('userData'), 'workspace');
  for (const dir of ['skills', 'memory', 'brands', 'receipts', 'projects', 'exports', 'effects']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  return root;
}

function seedSkills(): void {
  const candidates = [join(app.getAppPath(), 'resources', 'skills'), join(process.resourcesPath, 'skills')];
  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) return;
  const target = join(workspaceRoot(), 'skills');
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const destination = join(target, entry.name);
    if (!existsSync(destination)) cpSync(join(source, entry.name), destination, { recursive: true });
  }
}

function safeWorkspacePath(rel: string): string {
  const root = resolve(workspaceRoot());
  const target = resolve(root, normalize(rel).replace(/^[/\\]+/, ''));
  if (target !== root && !target.startsWith(root + sep)) throw new Error('Path escapes workspace');
  return target;
}

/* ------------------------------------------------------------------ */
/* Local media allowlist                                               */
/* ------------------------------------------------------------------ */

/**
 * `editbay-media://` used to serve any file on disk. Only paths the user
 * explicitly imported/opened (or that belong to a project they opened) are
 * served now. The list survives restarts so a reopened recent project still
 * previews without re-importing.
 */
const MAX_ALLOWLIST_ENTRIES = 4000;
let mediaAllowlist: Set<string> | null = null;

function normalizeFsPath(path: string): string {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function getMediaAllowlist(): Set<string> {
  if (mediaAllowlist) return mediaAllowlist;
  const allowlist = new Set<string>();
  const file = userDataFile('media-allowlist.json');
  try {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string' && entry !== '') allowlist.add(normalizeFsPath(entry));
        }
      }
    }
  } catch {
    // A corrupt allowlist only means the user re-imports media.
  }
  mediaAllowlist = allowlist;
  return allowlist;
}

function persistMediaAllowlist(allowlist: Set<string>): void {
  const entries = [...allowlist];
  const trimmed = entries.length > MAX_ALLOWLIST_ENTRIES ? entries.slice(-MAX_ALLOWLIST_ENTRIES) : entries;
  try {
    writeFileSync(userDataFile('media-allowlist.json'), JSON.stringify(trimmed, null, 2), 'utf8');
  } catch {
    // Persistence is best effort; the in-memory allowlist still works.
  }
}

function authorizeMedia(paths: Array<string | null | undefined>): void {
  const allowlist = getMediaAllowlist();
  let changed = false;
  for (const path of paths) {
    if (!path || path.trim() === '') continue;
    const normalized = normalizeFsPath(path);
    if (allowlist.has(normalized)) continue;
    allowlist.add(normalized);
    changed = true;
  }
  if (changed) persistMediaAllowlist(allowlist);
}

function isMediaAllowed(path: string): boolean {
  if (path.trim() === '') return false;
  return getMediaAllowlist().has(normalizeFsPath(path));
}

function assertMediaAllowed(path: string): void {
  if (!isMediaAllowed(path)) throw new Error('Media path was not authorized by an import dialog');
}

/* ------------------------------------------------------------------ */
/* Project path authorization                                          */
/* ------------------------------------------------------------------ */

/** Unknown local paths must come from open/save dialogs before they are written. */
const authorizedProjectPaths = new Set<string>();
const authorizedExportPaths = new Set<string>();

function authorizeProjectPath(path: string): void {
  authorizedProjectPaths.add(normalizeFsPath(path));
}

function isProjectPathAuthorized(path: string): boolean {
  return authorizedProjectPaths.has(normalizeFsPath(path));
}

const MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.avi',
  '.m4v',
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
]);

function looksLikeAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\');
}

/** A project may only authorize media files, never arbitrary documents. */
function looksLikeMediaPath(value: string): boolean {
  return looksLikeAbsolutePath(value) && MEDIA_EXTENSIONS.has(extname(value).toLowerCase());
}

/** Media referenced by a project the user opened stays previewable. */
function authorizeProjectAssets(content: string): void {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return;
    const assets = (parsed as { assets?: unknown }).assets;
    if (!Array.isArray(assets)) return;
    const paths: string[] = [];
    for (const asset of assets) {
      if (!asset || typeof asset !== 'object') continue;
      const uri = (asset as { uri?: unknown }).uri;
      if (typeof uri === 'string' && looksLikeMediaPath(uri)) paths.push(uri);
    }
    authorizeMedia(paths);
  } catch {
    // Invalid project JSON is rejected later by the renderer parser.
  }
}

function readSecrets(): Record<string, string> {
  const file = userDataFile('secrets.json');
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (safeStorage.isEncryptionAvailable()) {
        try {
          out[key] = safeStorage.decryptString(Buffer.from(value, 'base64'));
          continue;
        } catch {
          // Plaintext entry written before the OS keychain was available.
        }
      }
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeSecrets(secrets: Record<string, string>): { encrypted: boolean } {
  const encrypted = safeStorage.isEncryptionAvailable();
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    payload[key] = encrypted ? safeStorage.encryptString(value).toString('base64') : value;
  }
  const file = userDataFile('secrets.json');
  writeFileSync(file, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows ignores POSIX modes; the user profile ACL still applies.
  }
  return { encrypted };
}

function kindFromPath(path: string): PickedMedia['kind'] {
  const ext = extname(path).toLowerCase();
  if (['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'].includes(ext)) return 'video';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return 'image';
  return 'audio';
}

async function probePicked(path: string): Promise<PickedMedia> {
  authorizeMedia([path]);
  const label = path.split(/[\\/]/).pop() ?? path;
  const base: PickedMedia = { path, label, kind: kindFromPath(path) };
  try {
    const probe = await probeMedia(path);
    const kind: PickedMedia['kind'] = probe.width && probe.height ? (base.kind === 'image' ? 'image' : 'video') : base.kind;
    let thumbnail: string | undefined;
    if (kind !== 'audio') {
      try {
        thumbnail = await extractFrameDataUrl(path, Math.min(600, Math.max(0, probe.durationMs / 3)), 320);
      } catch {
        thumbnail = undefined;
      }
    }
    return {
      ...base,
      kind,
      durationMs: probe.durationMs,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
      thumbnail,
    };
  } catch {
    return base;
  }
}

/**
 * Test-only deterministic model. Enabled with EDITBAY_FAKE_LLM=1 so the UI and
 * agent loop can be exercised end to end without a provider or a key.
 */
function fakeChatResponse(req: ChatRequestDTO): ChatResponseDTO {
  const hasToolResult = req.messages.some((message) => message.role === 'tool');
  if (hasToolResult) {
    return { text: 'Trimmed the opening and added a title card.', toolCalls: [] };
  }
  const firstClip = /"clipId":\s*"(c_[^"]+)"/.exec(req.messages.map((message) => message.content).join('\n'));
  const clipId = firstClip?.[1] ?? 'c_tour';
  return {
    text: '',
    toolCalls: [
      {
        id: 'call_1',
        name: 'apply_commands',
        arguments: {
          commands: [
            { op: 'add_text', text: 'Editbay made this', startMs: 0, durationMs: 2200 },
            { op: 'add_effect', clipId, effect: { type: 'fade', params: { inMs: 400, outMs: 400 } } },
          ],
        },
      },
    ],
  };
}

function authorizeWorkspaceRecoveryAssets(): void {
  try {
    const file = join(workspaceRoot(), 'projects', 'current.json');
    if (!existsSync(file)) return;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { assets?: Array<{ uri?: unknown }> };
    const uris = (parsed.assets ?? [])
      .map((asset) => (typeof asset?.uri === 'string' ? asset.uri : null))
      .filter((uri): uri is string => uri !== null);
    if (uris.length > 0) authorizeMedia(uris);
  } catch {
    // A corrupt recovery file is handled by the renderer; it must not block startup.
  }
}

function createWindow(): BrowserWindow {  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#060807',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarOverlay: { color: '#060807', symbolColor: '#9DB3A7', height: 44 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  // Some Windows/Electron combinations never emit ready-to-show for hidden
  // windows; showing after the DOM is ready guarantees the app is visible.
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
      win.focus();
    }
  });
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
      win.focus();
    }
  }, 2500);

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

function registerIpc(): void {
  ipcMain.handle('app:info', (): AppInfoDTO => {
    const info = getFfmpegInfo();
    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      ffmpegPath: info?.path ?? null,
      ffmpegVersion: info?.version ?? null,
      workspaceRoot: workspaceRoot(),
      userData: app.getPath('userData'),
    };
  });

  ipcMain.handle('media:pick', async (): Promise<PickedMedia[]> => {
    if (process.env['EDITBAY_TEST_IMPORT']) {
      const paths = process.env['EDITBAY_TEST_IMPORT'].split(';').filter(Boolean);
      return Promise.all(paths.map(probePicked));
    }
    const result = await dialog.showOpenDialog({
      title: 'Import media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'png', 'jpg', 'jpeg', 'webp'] },
      ],
    });
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(probePicked));
  });

  ipcMain.handle('media:pickLogo', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Choose logo',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
    });
    const path = result.canceled ? null : (result.filePaths[0] ?? null);
    if (path) authorizeMedia([path]);
    return path;
  });

  // Bounded caches: filmstrip frames are data URLs, so an unbounded map would
  // grow with every zoom level and clip the user ever looked at.
  const CACHE_LIMIT = 600;
  const frameCache = new Map<string, string>();
  const peaksCache = new Map<string, number[]>();
  const remember = <T,>(cache: Map<string, T>, key: string, value: T): void => {
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, value);
  };

  ipcMain.handle('media:probe', async (_e, path: string) => {
    assertMediaAllowed(path);
    return probeMedia(path);
  });
  ipcMain.handle('media:thumbnail', async (_e, path: string, atMs = 0, width = 320) => {
    assertMediaAllowed(path);
    return extractFrameDataUrl(path, atMs, width);
  });
  ipcMain.handle(
    'media:filmstrip',
    async (
      _e,
      path: string,
      opts?: { inMs?: number; outMs?: number; count?: number; width?: number } | number[],
      widthArg?: number,
    ): Promise<string[]> => {
      assertMediaAllowed(path);
      const normalized = normalizeFsPath(path);
      let timestamps: number[] = [];
      let frameWidth = 140;
      if (Array.isArray(opts)) {
        timestamps = opts.slice(0, 12).map((t) => Math.max(0, Math.round(Number(t) || 0)));
        if (typeof widthArg === 'number' && widthArg > 0) frameWidth = Math.min(320, Math.round(widthArg));
      } else {
        const count = Math.max(1, Math.min(12, Math.floor(opts?.count ?? 4)));
        const inMs = Math.max(0, Math.round(opts?.inMs ?? 0));
        const outMs = Math.max(inMs + 100, Math.round(opts?.outMs ?? inMs + 1000));
        if (typeof opts?.width === 'number' && opts.width > 0) frameWidth = Math.min(320, Math.round(opts.width));
        const span = Math.max(100, outMs - inMs);
        for (let i = 0; i < count; i += 1) {
          timestamps.push(Math.round(inMs + ((i + 0.5) / count) * span));
        }
      }
      const frames = await Promise.all(
        timestamps.map(async (atMs) => {
          const cacheKey = `${normalized}@${atMs}@${frameWidth}`;
          const hit = frameCache.get(cacheKey);
          if (hit) return hit;
          try {
            const dataUrl = await extractFrameDataUrl(path, atMs, frameWidth);
            remember(frameCache, cacheKey, dataUrl);
            return dataUrl;
          } catch {
            return '';
          }
        }),
      );
      return frames.filter(Boolean);
    },
  );
  ipcMain.handle(
    'media:peaks',
    async (_e, path: string, opts?: { buckets?: number; inMs?: number; outMs?: number } | number): Promise<number[]> => {
      assertMediaAllowed(path);
      const bucketsRaw = typeof opts === 'number' ? opts : (opts?.buckets ?? 64);
      const buckets = Math.max(8, Math.min(256, Math.round(bucketsRaw)));
      const inMs = typeof opts === 'object' && opts !== null ? opts.inMs : undefined;
      const outMs = typeof opts === 'object' && opts !== null ? opts.outMs : undefined;
      const cacheKey = `${normalizeFsPath(path)}:${inMs ?? 0}:${outMs ?? 'end'}:${buckets}`;
      const hit = peaksCache.get(cacheKey);
      if (hit) return hit;
      try {
        const peaks = await extractPeaks(path, { buckets, inMs, outMs });
        remember(peaksCache, cacheKey, peaks);
        return peaks;
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle('dialog:saveVideo', async (_e, defaultName: string): Promise<string | null> => {
    if (process.env['EDITBAY_TEST_EXPORT']) {
      const testPath = process.env['EDITBAY_TEST_EXPORT'];
      authorizedExportPaths.add(normalizeFsPath(testPath));
      authorizeMedia([testPath]);
      return testPath;
    }
    const result = await dialog.showSaveDialog({
      title: 'Export video',
      defaultPath: join(app.getPath('videos'), defaultName),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
    });
    const path = result.canceled ? null : (result.filePath ?? null);
    if (path) {
      authorizedExportPaths.add(normalizeFsPath(path));
      authorizeMedia([path]);
    }
    return path;
  });

  ipcMain.handle('export:video', async (event, req: ExportRequestDTO) => {
    const started = Date.now();
    if (!authorizedExportPaths.has(normalizeFsPath(req.outPath))) {
      return { ok: false, error: 'Export path was not authorized by a save dialog', elapsedMs: 0 };
    }
    try {
      const result = await exportProject(req.project, {
        outPath: req.outPath,
        assetPaths: req.assetPaths,
        quality: req.quality,
        onProgress: (p) => event.sender.send('export:progress', p),
      });
      return { ok: true, outPath: result.outPath, elapsedMs: Date.now() - started };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started };
    }
  });

  ipcMain.handle('project:open', async () => {
    const testPath = process.env['EDITBAY_TEST_OPEN_PROJECT'];
    if (testPath) {
      const content = readFileSync(testPath, 'utf8');
      authorizeProjectPath(testPath);
      authorizeProjectAssets(content);
      return { path: testPath, content };
    }
    const result = await dialog.showOpenDialog({
      title: 'Open project',
      properties: ['openFile'],
      filters: [{ name: 'Editbay project', extensions: ['editbay.json', 'json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0];
    const content = readFileSync(path, 'utf8');
    authorizeProjectPath(path);
    authorizeProjectAssets(content);
    return { path, content };
  });

  ipcMain.handle('project:save', async (_e, content: string, path?: string): Promise<string | null> => {
    if (!path) return null;
    if (!isProjectPathAuthorized(path)) {
      throw new Error('Project path was not authorized by an open or save dialog');
    }
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, path);
    return path;
  });

  ipcMain.handle('project:saveAs', async (_e, content: string, defaultName: string): Promise<string | null> => {
    const result = await dialog.showSaveDialog({
      title: 'Save project',
      defaultPath: join(app.getPath('documents'), defaultName),
      filters: [{ name: 'Editbay project', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    writeFileSync(result.filePath, content, 'utf8');
    authorizeProjectPath(result.filePath);
    return result.filePath;
  });

  ipcMain.handle('secrets:has', async (_e, key: string): Promise<boolean> => {
    const value = readSecrets()[key];
    return typeof value === 'string' && value !== '';
  });
  ipcMain.handle('secrets:set', async (_e, key: string, value: string): Promise<{ encrypted: boolean }> => {
    const secrets = readSecrets();
    secrets[key] = value;
    return writeSecrets(secrets);
  });
  ipcMain.handle('secrets:delete', async (_e, key: string): Promise<void> => {
    const secrets = readSecrets();
    delete secrets[key];
    writeSecrets(secrets);
  });

  ipcMain.handle('workspace:read', async (_e, rel: string): Promise<string | null> => {
    const path = safeWorkspacePath(rel);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  });
  ipcMain.handle('workspace:write', async (_e, rel: string, content: string): Promise<void> => {
    const path = safeWorkspacePath(rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  });
  ipcMain.handle('workspace:append', async (_e, rel: string, content: string): Promise<void> => {
    const path = safeWorkspacePath(rel);
    mkdirSync(join(path, '..'), { recursive: true });
    const { appendFileSync } = await import('node:fs');
    appendFileSync(path, content, 'utf8');
  });
  ipcMain.handle('workspace:list', async (_e, rel: string) => {
    const path = safeWorkspacePath(rel);
    if (!existsSync(path)) return [];
    const { readdirSync, statSync } = await import('node:fs');
    return readdirSync(path, { withFileTypes: true }).map((entry) => {
      const full = join(path, entry.name);
      const stat = statSync(full);
      return { path: join(rel, entry.name).replace(/\\/g, '/'), name: entry.name, size: stat.size, updatedAt: stat.mtime.toISOString() };
    });
  });
  ipcMain.handle('workspace:remove', async (_e, rel: string): Promise<boolean> => {
    const path = safeWorkspacePath(rel);
    if (!existsSync(path)) return false;
    const { rmSync } = await import('node:fs');
    rmSync(path, { recursive: true, force: true });
    return true;
  });
  ipcMain.handle('workspace:exists', async (_e, rel: string): Promise<boolean> => existsSync(safeWorkspacePath(rel)));

  const activeLlmRequests = new Map<string, AbortController>();

  ipcMain.handle('llm:abort', async (_e, requestId: string): Promise<void> => {
    activeLlmRequests.get(requestId)?.abort();
  });

  ipcMain.handle('llm:chat', async (_e, req: ChatRequestDTO): Promise<ChatResponseDTO> => {
    if (process.env['EDITBAY_FAKE_LLM'] === '1') {
      return fakeChatResponse(req);
    }
    const controller = new AbortController();
    if (req.requestId) activeLlmRequests.set(req.requestId, controller);
    try {
      const provider = getProvider(req.providerId);
      if (!provider) return { text: '', toolCalls: [], error: `Unknown provider: ${req.providerId}` };
      const stored = readSecrets()[`provider.${req.providerId}.apiKey`];
      const apiKey = req.apiKey ?? stored ?? '';
      if (provider.requiresApiKey && !apiKey) {
        return { text: '', toolCalls: [], error: 'No API key configured for this provider.' };
      }
      const response = await provider.chat(
        {
          model: req.model,
          messages: req.messages,
          tools: req.tools,
          temperature: req.temperature,
          maxTokens: req.maxTokens,
          signal: controller.signal,
        },
        { apiKey, baseUrl: req.baseUrl ?? readSecrets()[`provider.${req.providerId}.baseUrl`] },
      );
      return { text: response.text, toolCalls: response.toolCalls, usage: response.usage };
    } catch (error) {
      return { text: '', toolCalls: [], error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (req.requestId) activeLlmRequests.delete(req.requestId);
    }
  });

  ipcMain.handle('llm:models', async (_e, providerId: string, apiKey: string, baseUrl?: string) => {
    const provider = getProvider(providerId);
    if (!provider?.listModels) return [];
    const stored = readSecrets()[`provider.${providerId}.apiKey`];
    return provider.listModels({
      apiKey: apiKey || stored || '',
      baseUrl: baseUrl || readSecrets()[`provider.${providerId}.baseUrl`],
    });
  });

  ipcMain.handle('shell:reveal', async (_e, path: string) => {
    shell.showItemInFolder(path);
  });

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
  });

  ipcMain.handle('auth:openrouter', async () => {
    try {
      const { runOpenRouterOAuth } = await import('./openrouter-oauth');
      const key = await runOpenRouterOAuth();
      const secrets = readSecrets();
      secrets['provider.openrouter.apiKey'] = key;
      writeSecrets(secrets);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
    }
  });

  app.whenReady().then(() => {
    if (!process.env['EDITBAY_FFMPEG']) {
      const bundled = join(process.resourcesPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      if (existsSync(bundled)) process.env['EDITBAY_FFMPEG'] = bundled;
    }
    protocol.handle('editbay-media', (request) => {
      const url = new URL(request.url);
      const encoded = url.pathname.replace(/^\//, '');
      const filePath = decodeURIComponent(encoded);
      if (!isMediaAllowed(filePath)) {
        return new Response('Forbidden', {
          status: 403,
          headers: { 'content-type': 'text/plain', 'access-control-allow-origin': '*' },
        });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    });

    registerIpc();
    seedSkills();
    authorizeWorkspaceRecoveryAssets();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
