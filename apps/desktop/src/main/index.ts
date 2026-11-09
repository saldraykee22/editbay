import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportProject, probeMedia, getFfmpegInfo, extractFrameDataUrl } from '@editbay/engine';
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
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
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
        } catch {
          // ignore unreadable entries
        }
      } else {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeSecrets(secrets: Record<string, string>): void {
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    payload[key] = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(value).toString('base64')
      : value;
  }
  const file = userDataFile('secrets.json');
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
}

function kindFromPath(path: string): PickedMedia['kind'] {
  const ext = extname(path).toLowerCase();
  if (['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'].includes(ext)) return 'video';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return 'image';
  return 'audio';
}

async function probePicked(path: string): Promise<PickedMedia> {
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
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('media:probe', async (_e, path: string) => probeMedia(path));
  ipcMain.handle('media:thumbnail', async (_e, path: string, atMs = 0, width = 320) =>
    extractFrameDataUrl(path, atMs, width),
  );

  ipcMain.handle('dialog:saveVideo', async (_e, defaultName: string): Promise<string | null> => {
    if (process.env['EDITBAY_TEST_EXPORT']) return process.env['EDITBAY_TEST_EXPORT'];
    const result = await dialog.showSaveDialog({
      title: 'Export video',
      defaultPath: join(app.getPath('videos'), defaultName),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
    });
    return result.canceled ? null : (result.filePath ?? null);
  });

  ipcMain.handle('export:video', async (event, req: ExportRequestDTO) => {
    const started = Date.now();
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
    const result = await dialog.showOpenDialog({
      title: 'Open project',
      properties: ['openFile'],
      filters: [{ name: 'Editbay project', extensions: ['editbay.json', 'json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0];
    return { path, content: readFileSync(path, 'utf8') };
  });

  ipcMain.handle('project:save', async (_e, content: string, path?: string): Promise<string | null> => {
    if (!path) return null;
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
    return result.filePath;
  });

  ipcMain.handle('secrets:get', async (_e, key: string): Promise<string | null> => readSecrets()[key] ?? null);
  ipcMain.handle('secrets:set', async (_e, key: string, value: string): Promise<void> => {
    const secrets = readSecrets();
    secrets[key] = value;
    writeSecrets(secrets);
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

  ipcMain.handle('llm:chat', async (_e, req: ChatRequestDTO): Promise<ChatResponseDTO> => {
    if (process.env['EDITBAY_FAKE_LLM'] === '1') {
      return fakeChatResponse(req);
    }
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
        },
        { apiKey, baseUrl: req.baseUrl ?? readSecrets()[`provider.${req.providerId}.baseUrl`] },
      );
      return { text: response.text, toolCalls: response.toolCalls, usage: response.usage };
    } catch (error) {
      return { text: '', toolCalls: [], error: error instanceof Error ? error.message : String(error) };
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

app.whenReady().then(() => {
  protocol.handle('editbay-media', (request) => {
    const url = new URL(request.url);
    const encoded = url.pathname.replace(/^\//, '');
    const filePath = decodeURIComponent(encoded);
    return net.fetch(pathToFileURL(filePath).toString());
  });

  registerIpc();
  seedSkills();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
