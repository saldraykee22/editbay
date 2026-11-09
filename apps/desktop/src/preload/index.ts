import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppInfoDTO,
  ChatRequestDTO,
  ChatResponseDTO,
  ExportDoneDTO,
  ExportProgressDTO,
  ExportRequestDTO,
  FilmstripOptionsDTO,
  PeaksOptionsDTO,
  PickedMedia,
  ProbeDTO,
} from '../shared/api';

const api = {
  appInfo: (): Promise<AppInfoDTO> => ipcRenderer.invoke('app:info'),
  pickMedia: (): Promise<PickedMedia[]> => ipcRenderer.invoke('media:pick'),
  pickLogo: (): Promise<string | null> => ipcRenderer.invoke('media:pickLogo'),
  probeMedia: (path: string): Promise<ProbeDTO> => ipcRenderer.invoke('media:probe', path),
  thumbnail: (path: string, atMs = 0, width = 320): Promise<string> => ipcRenderer.invoke('media:thumbnail', path, atMs, width),
  filmstrip: (path: string, opts?: FilmstripOptionsDTO | number[], width?: number): Promise<string[]> =>
    ipcRenderer.invoke('media:filmstrip', path, opts, width),
  peaks: (path: string, opts?: PeaksOptionsDTO | number): Promise<number[]> =>
    ipcRenderer.invoke('media:peaks', path, opts),
  mediaUrl: (path: string): string => `editbay-media://local/${encodeURIComponent(path)}`,
  saveVideoDialog: (defaultName: string): Promise<string | null> => ipcRenderer.invoke('dialog:saveVideo', defaultName),
  exportVideo: (req: ExportRequestDTO): Promise<ExportDoneDTO> => ipcRenderer.invoke('export:video', req),
  onExportProgress: (callback: (progress: ExportProgressDTO) => void): (() => void) => {
    const listener = (_event: unknown, progress: ExportProgressDTO) => callback(progress);
    ipcRenderer.on('export:progress', listener);
    return () => {
      ipcRenderer.removeListener('export:progress', listener);
    };
  },
  openProjectDialog: () => ipcRenderer.invoke('project:open'),
  saveProject: (content: string, path?: string) => ipcRenderer.invoke('project:save', content, path),
  saveProjectAs: (content: string, defaultName: string) => ipcRenderer.invoke('project:saveAs', content, defaultName),
  secrets: {
    has: (key: string): Promise<boolean> => ipcRenderer.invoke('secrets:has', key),
    set: (key: string, value: string): Promise<{ encrypted: boolean }> => ipcRenderer.invoke('secrets:set', key, value),
    delete: (key: string): Promise<void> => ipcRenderer.invoke('secrets:delete', key),
  },
  workspace: {
    root: (): Promise<string> => ipcRenderer.invoke('app:info').then((info: AppInfoDTO) => info.workspaceRoot),
    read: (rel: string) => ipcRenderer.invoke('workspace:read', rel),
    write: (rel: string, content: string) => ipcRenderer.invoke('workspace:write', rel, content),
    append: (rel: string, content: string) => ipcRenderer.invoke('workspace:append', rel, content),
    list: (rel: string) => ipcRenderer.invoke('workspace:list', rel),
    remove: (rel: string) => ipcRenderer.invoke('workspace:remove', rel),
    exists: (rel: string) => ipcRenderer.invoke('workspace:exists', rel),
  },
  llm: {
    chat: (req: ChatRequestDTO): Promise<ChatResponseDTO> => ipcRenderer.invoke('llm:chat', req),
    abort: (requestId: string): Promise<void> => ipcRenderer.invoke('llm:abort', requestId),
    listModels: (providerId: string, apiKey: string, baseUrl?: string) =>
      ipcRenderer.invoke('llm:models', providerId, apiKey, baseUrl),
  },
  auth: {
    openrouter: () => ipcRenderer.invoke('auth:openrouter'),
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  revealInFolder: (path: string) => ipcRenderer.invoke('shell:reveal', path),
};

contextBridge.exposeInMainWorld('editbay', api);
