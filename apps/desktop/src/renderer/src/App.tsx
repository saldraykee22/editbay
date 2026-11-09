import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandMark, Button, Chip, Icon, IconButton, Modal, Progress } from '@editbay/ui';
import type { Project } from '@editbay/core';
import { clipStartMsOnTrack, clipTimelineDurationMs, createEmptyProject, EditSession } from '@editbay/core';
import { EditorStore, useEditorVersion } from './state/store';
import { loadSettings, providerPreset, saveSettings, type AppSettings } from './state/settings';
import { useAgentController } from './state/agent';
import { Stage } from './components/Stage';
import { Timeline } from './components/Timeline';
import { ChatPanel } from './components/ChatPanel';
import { BrandPanel } from './components/BrandPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { SettingsPanel } from './components/SettingsPanel';

type Tab = 'agent' | 'brand' | 'skills' | 'settings';

interface ExportState {
  active: boolean;
  fraction: number;
  done: boolean;
  error: string | null;
  outPath: string | null;
}

const AUTOSAVE_PATH = 'projects/current.json';

export function App() {
  const store = useMemo(() => new EditorStore(createEmptyProject('Untitled')), []);
  useEditorVersion(store);
  const [tab, setTab] = useState<Tab>('agent');
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [exportState, setExportState] = useState<ExportState>({ active: false, fraction: 0, done: false, error: null, outPath: null });
  const [appInfo, setAppInfo] = useState<{ version: string; ffmpegVersion: string | null; workspaceRoot: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [pendingAction, setPendingAction] = useState<'new' | 'open' | null>(null);
  const project = store.project;
  const saveTimer = useRef<number | null>(null);

  const agent = useAgentController({ store, settings });

  useEffect(() => {
    void window.editbay.appInfo().then(setAppInfo);
    void (async () => {
      const saved = await window.editbay.workspace.read(AUTOSAVE_PATH);
      if (!saved) return;
      try {
        const session = EditSession.fromJSON(saved);
        store.load(session.project, null);
      } catch {
        // corrupt autosave is ignored
      }
    })();
  }, [store]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    const unsubscribe = store.onChange(() => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        if (store.projectPath) {
          // Autosave the opened document, so the user's file is never stale.
          const revision = store.projectRevision;
          void window.editbay
            .saveProject(store.session.toJSON(), store.projectPath)
            .then((saved) => {
              if (saved && store.projectRevision === revision) store.markSaved();
            })
            .catch(() => undefined);
          return;
        }
        void window.editbay.workspace.write(AUTOSAVE_PATH, store.session.toJSON());
      }, 700);
    });
    return () => {
      unsubscribe();
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [store]);

  useEffect(() => window.editbay.onExportProgress((progress) => {
    setExportState((state) => ({ ...state, fraction: progress.fraction }));
  }), []);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3200);
  };

  const importMedia = useCallback(async () => {
    const picked = await window.editbay.pickMedia();
    if (picked.length === 0) return;
    const { added, errors } = store.addPickedMedia(picked);
    if (errors.length) flash(errors[0]!);
    if (added > 0) flash(`Imported ${added} item${added === 1 ? '' : 's'}`);
  }, [store]);

  const exportVideo = useCallback(async () => {
    if (project.assets.length === 0) {
      flash('Import media first');
      return;
    }
    const safeName = (project.name || 'editbay').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'editbay';
    const outPath = await window.editbay.saveVideoDialog(`${safeName}.mp4`);
    if (!outPath) return;
    setExportState({ active: true, fraction: 0, done: false, error: null, outPath: null });
    const assetPaths = Object.fromEntries(project.assets.map((asset) => [asset.id, asset.uri]));
    const result = await window.editbay.exportVideo({ project, assetPaths, outPath, quality: 'standard' });
    setExportState({
      active: false,
      fraction: result.ok ? 1 : 0,
      done: Boolean(result.ok),
      error: result.error ?? null,
      outPath: result.outPath ?? null,
    });
  }, [project]);

  const saveProjectAs = useCallback(async () => {
    setProjectMenu(false);
    const safeName = (store.project.name || 'editbay').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'editbay';
    try {
      const path = await window.editbay.saveProjectAs(store.session.toJSON(), `${safeName}.json`);
      if (!path) return;
      store.projectPath = path;
      store.markSaved();
      flash('Project saved');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Save failed');
    }
  }, [store]);

  const saveProject = useCallback(async () => {
    if (!store.projectPath) {
      await saveProjectAs();
      return;
    }
    try {
      const path = await window.editbay.saveProject(store.session.toJSON(), store.projectPath);
      if (!path) return;
      store.markSaved();
      flash('Project saved');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Save failed');
    }
  }, [saveProjectAs, store]);

  const newProject = useCallback(() => {
    setProjectMenu(false);
    store.load(createEmptyProject('Untitled'), null);
  }, [store]);

  const openProject = useCallback(async () => {
    setProjectMenu(false);
    const opened = await window.editbay.openProjectDialog();
    if (!opened) return;
    try {
      const session = EditSession.fromJSON(opened.content);
      store.load(session.project, opened.path);
      flash('Project opened');
    } catch {
      flash('That file is not a valid Editbay project');
    }
  }, [store]);

  const requestProjectChange = useCallback(
    (action: 'new' | 'open') => {
      if (store.isDirty) {
        setProjectMenu(false);
        setPendingAction(action);
        return;
      }
      if (action === 'new') newProject();
      else void openProject();
    },
    [newProject, openProject, store],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveProject();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        void exportVideo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setTab('agent');
        return;
      }
      if (typing) return;
      if (event.code === 'Space') {
        event.preventDefault();
        store.setPlaying(!store.playing);
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (store.selection.clipId) store.apply({ op: 'delete_clip', clipId: store.selection.clipId });
        if (store.selection.itemId) store.apply({ op: 'delete_text', itemId: store.selection.itemId });
      }
      if (event.key.toLowerCase() === 's') {
        const track = project.tracks.find((t) => t.kind === 'video');
        if (!track) return;
        for (let index = 0; index < track.clips.length; index += 1) {
          const clip = track.clips[index];
          if (!clip) continue;
          const cursor = clipStartMsOnTrack(track, index);
          const duration = clipTimelineDurationMs(clip);
          if (store.playheadMs > cursor + 100 && store.playheadMs < cursor + duration - 100) {
            store.apply({ op: 'split_clip', clipId: clip.id, atMs: store.playheadMs - cursor });
            break;
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [store, project, exportVideo, saveProject]);

  const durationSec = (store.durationMs / 1000).toFixed(1);

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <BrandMark size={18} />
          <div className="brand-name">
            editbay <span>/ studio</span>
          </div>
        </div>
        <div className="hairline" style={{ width: 1, height: 16, background: 'var(--line-strong)' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            className="project-name"
            value={project.name}
            spellCheck={false}
            onChange={(event) => store.apply({ op: 'set_project_name', name: event.target.value || 'Untitled' })}
          />
          <IconButton icon="chevron" title="Project menu" size={13} onClick={() => setProjectMenu((value) => !value)} />
          {projectMenu ? (
            <div className="menu" onMouseLeave={() => setProjectMenu(false)}>
              <button type="button" onClick={() => requestProjectChange('new')}>
                New project
              </button>
              <button type="button" onClick={() => requestProjectChange('open')}>
                Open project…
              </button>
              <button type="button" onClick={() => void saveProject()}>
                Save {store.projectPath ? '' : 'as…'}
              </button>
              <button type="button" onClick={() => void saveProjectAs()}>
                Save as…
              </button>
              <div className="hairline" />
              <button type="button" onClick={() => window.editbay.revealInFolder(appInfo?.workspaceRoot ?? '')}>
                Show workspace
              </button>
            </div>
          ) : null}
        </div>
        <Chip>{project.canvas.width}×{project.canvas.height}</Chip>
        <Chip tone={agent.connected ? 'accent' : 'warn'}>
          <span className={agent.connected ? 'dot-live' : undefined} />
          {agent.connected ? settings.model.split('/').pop() : 'No model'}
        </Chip>
        <div className="titlebar-spacer" />
        {notice ? <Chip tone="accent">{notice}</Chip> : null}
        <Button size="sm" variant="ghost" icon="folder" onClick={importMedia}>
          Import
        </Button>
        <Button size="sm" variant="primary" icon="download" onClick={exportVideo}>
          Export
        </Button>
        <IconButton icon="settings" title="Settings" onClick={() => setSettingsOpen(true)} />
      </header>

      <div className="workspace">
        <nav className="rail">
          <button type="button" className={`rail-btn ${tab === 'agent' ? 'active' : ''}`} title="Agent" onClick={() => setTab('agent')}>
            <Icon name="sparkles" size={17} />
          </button>
          <button type="button" className="rail-btn" title="Import media" onClick={importMedia}>
            <Icon name="media" size={17} />
          </button>
          <button type="button" className={`rail-btn ${tab === 'brand' ? 'active' : ''}`} title="Brand memory" onClick={() => setTab('brand')}>
            <Icon name="brand" size={17} />
          </button>
          <button type="button" className={`rail-btn ${tab === 'skills' ? 'active' : ''}`} title="Skills" onClick={() => setTab('skills')}>
            <Icon name="layers" size={17} />
          </button>
          <div className="rail-spacer" />
          <button type="button" className={`rail-btn ${tab === 'settings' ? 'active' : ''}`} title="Settings" onClick={() => setTab('settings')}>
            <Icon name="settings" size={17} />
          </button>
        </nav>

        <main className="stage-col">
          <Stage store={store} onImport={importMedia} showSafeArea={settings.showSafeArea} />
          <Timeline store={store} />
        </main>

        <aside className="side">
          <div className="tabs">
            <button type="button" className={`tab ${tab === 'agent' ? 'active' : ''}`} onClick={() => setTab('agent')}>
              Agent
            </button>
            <button type="button" className={`tab ${tab === 'brand' ? 'active' : ''}`} onClick={() => setTab('brand')}>
              Brand
            </button>
            <button type="button" className={`tab ${tab === 'skills' ? 'active' : ''}`} onClick={() => setTab('skills')}>
              Skills
            </button>
            <button type="button" className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
              Settings
            </button>
          </div>
          <div className="side-body">
            {tab === 'agent' ? (
              <ChatPanel
                entries={agent.entries}
                busy={agent.busy}
                status={agent.status}
                connected={agent.connected}
                onSend={agent.send}
                onStop={agent.stop}
                onApply={agent.applyProposal}
                onDiscard={agent.discardProposal}
                onOpenSettings={() => setTab('settings')}
              />
            ) : null}
            {tab === 'brand' ? <BrandPanel store={store} /> : null}
            {tab === 'skills' ? <SkillsPanel /> : null}
            {tab === 'settings' ? <SettingsPanel settings={settings} onChange={setSettings} /> : null}
          </div>
        </aside>
      </div>

      <footer className="statusbar">
        <span>editbay {appInfo?.version ?? '0.1.0'}</span>
        <span className="sep" />
        <span>{durationSec}s</span>
        <span className="sep" />
        <span>{project.assets.length} assets</span>
        <span className="sep" />
        <span>{project.tracks.find((t) => t.kind === 'video')?.clips.length ?? 0} clips</span>
        <span className="sep" />
        <span>{providerPreset(settings.providerId).label}</span>
        <span className="spacer" />
        <span>{appInfo?.ffmpegVersion ? `ffmpeg ${/^\d+(\.\d+)*/.exec(appInfo.ffmpegVersion)?.[0] ?? 'ok'}` : 'ffmpeg not found'}</span>
        <span className="sep" />
        <span>{settings.autoApply ? 'auto-apply' : 'confirm edits'}</span>
      </footer>

      {pendingAction ? (
        <Modal
          title={pendingAction === 'new' ? 'Discard unsaved edits?' : 'Open another project?'}
          onClose={() => setPendingAction(null)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setPendingAction(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const action = pendingAction;
                  setPendingAction(null);
                  if (action === 'new') newProject();
                  else void openProject();
                }}
              >
                Discard and continue
              </Button>
            </>
          }
        >
          <div className="hint">
            This project has edits that are not saved to a project file. Save it first with Ctrl+S, or discard them and
            continue.
          </div>
        </Modal>
      ) : null}

      {exportState.active ? (
        <Modal title="Exporting" onClose={() => undefined}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="label">Rendering MP4 · H.264 · AAC</div>
            <Progress value={exportState.fraction} />
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {Math.round(exportState.fraction * 100)}%
            </div>
            <div className="hint">Preview is an approximation; the exported file is the reference.</div>
          </div>
        </Modal>
      ) : null}

      {exportState.done && exportState.outPath ? (
        <Modal
          title="Export complete"
          onClose={() => setExportState((state) => ({ ...state, done: false }))}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => window.editbay.revealInFolder(exportState.outPath!)}>
                Show in folder
              </Button>
              <Button size="sm" variant="primary" onClick={() => setExportState((state) => ({ ...state, done: false }))}>
                Done
              </Button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', userSelect: 'text', wordBreak: 'break-all' }}>
              {exportState.outPath}
            </div>
            <div className="hint">Check the file in your player before delivery. Preview and export can differ.</div>
          </div>
        </Modal>
      ) : null}

      {exportState.error ? (
        <Modal
          title="Export failed"
          onClose={() => setExportState((state) => ({ ...state, error: null }))}
          footer={
            <Button size="sm" onClick={() => setExportState((state) => ({ ...state, error: null }))}>
              Close
            </Button>
          }
        >
          <div className="error-text" style={{ userSelect: 'text' }}>
            {exportState.error}
          </div>
        </Modal>
      ) : null}

      {settingsOpen ? (
        <Modal title="Settings" onClose={() => setSettingsOpen(false)} width={620}>
          <SettingsPanel settings={settings} onChange={setSettings} />
        </Modal>
      ) : null}
    </div>
  );
}
