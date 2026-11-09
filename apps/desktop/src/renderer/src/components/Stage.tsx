import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '@editbay/ui';
import type { Project } from '@editbay/core';
import { effectCatalog } from '@editbay/effects';
import { EditorStore, mediaUrl, useEditorVersion, usePlayhead } from '../state/store';
import {
  activeAudioClipsAt,
  activeClipsAt,
  activeOverlayClipsAt,
  drawFrame,
  sourceTimeMs,
  type ActiveClip,
  type MediaElement,
} from '../lib/compositor';

function formatTime(ms: number, fps = 30): string {
  const total = Math.max(0, Math.round(ms));
  const seconds = Math.floor(total / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const frames = Math.floor(((total % 1000) / 1000) * fps);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function useMediaElements(project: Project): Map<string, MediaElement> {
  const registry = useRef(new Map<string, MediaElement>());

  useEffect(() => {
    const map = registry.current;
    const seen = new Set<string>();
    for (const asset of project.assets) {
      seen.add(asset.id);
      if (map.has(asset.id)) continue;
      if (asset.kind === 'image') {
        const img = new Image();
        img.src = mediaUrl(asset.uri);
        map.set(asset.id, img);
      } else if (asset.kind === 'audio') {
        const audio = document.createElement('audio');
        audio.src = mediaUrl(asset.uri);
        audio.preload = 'auto';
        map.set(asset.id, audio);
      } else {
        const video = document.createElement('video');
        video.src = mediaUrl(asset.uri);
        video.preload = 'auto';
        video.playsInline = true;
        video.muted = false;
        video.volume = 1;
        map.set(asset.id, video);
      }
    }
    for (const key of [...map.keys()]) {
      if (!seen.has(key)) {
        const element = map.get(key);
        if (element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) {
          element.pause();
          element.removeAttribute('src');
          element.load();
        }
        map.delete(key);
      }
    }
  }, [project.assets]);

  return registry.current;
}

export function Stage({
  store,
  onImport,
  showSafeArea = false,
}: {
  store: EditorStore;
  onImport: () => void;
  showSafeArea?: boolean;
}) {
  useEditorVersion(store);
  const playheadMs = usePlayhead(store);
  const project = store.project;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const media = useMediaElements(project);
  const [muted, setMuted] = useState(false);
  const [fps, setFps] = useState(0);
  const [ratio, setRatio] = useState(project.canvas.width / project.canvas.height);

  useEffect(() => {
    setRatio(project.canvas.width / project.canvas.height);
  }, [project.canvas.width, project.canvas.height]);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.round(frame.clientWidth * dpr));
    const height = Math.max(2, Math.round(frame.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(resize);
    if (frameRef.current) observer.observe(frameRef.current);
    resize();
    return () => observer.disconnect();
  }, [resize]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let fpsAccum = 0;
    let fpsFrames = 0;

    const syncMedia = () => {
      const timeMs = store.playheadMs;
      const activeByAsset = new Map<string, ActiveClip>();
      for (const entry of activeClipsAt(project, timeMs)) activeByAsset.set(entry.asset.id, entry);
      // Overlay video clips (picture-in-picture) must play too; the compositor
      // draws them between the base picture and the text layer.
      for (const entry of activeOverlayClipsAt(project, timeMs)) activeByAsset.set(entry.asset.id, entry);
      for (const entry of activeAudioClipsAt(project, timeMs)) {
        if (!activeByAsset.has(entry.asset.id)) activeByAsset.set(entry.asset.id, entry);
      }

      for (const [assetId, element] of media) {
        if (!(element instanceof HTMLVideoElement) && !(element instanceof HTMLAudioElement)) continue;
        const active = activeByAsset.get(assetId);
        if (!active) {
          if (!element.paused) element.pause();
          continue;
        }
        const speed = active.clip.speed && active.clip.speed > 0 ? active.clip.speed : 1;
        const volume = Math.min(1, Math.max(0, active.clip.volume ?? 1));
        // The browser element cannot exceed 1.0; export still applies 0..2.
        element.volume = volume;
        element.muted = muted || active.trackMuted || volume === 0;
        if (Number.isFinite(speed) && speed > 0) element.playbackRate = speed;
        const target = Math.max(0, sourceTimeMs(active) / 1000);
        if (Math.abs(element.currentTime - target) > 0.35) element.currentTime = target;
        if (store.playing && element.paused) void element.play().catch(() => undefined);
        if (!store.playing && !element.paused) element.pause();
      }
    };

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (store.playing) {
        const next = store.playheadMs + dt;
        if (next >= store.durationMs) {
          store.setPlayhead(store.durationMs);
          store.setPlaying(false);
        } else {
          store.setPlayhead(next);
        }
      }
      syncMedia();
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) drawFrame(ctx, project, store.playheadMs, { width: canvas.width, height: canvas.height, catalog: effectCatalog, media, showSafeArea });
      }
      fpsAccum += dt;
      fpsFrames += 1;
      if (fpsAccum > 500) {
        setFps(Math.round((fpsFrames * 1000) / fpsAccum));
        fpsAccum = 0;
        fpsFrames = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const element of media.values()) {
        if (element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) element.pause();
      }
    };
  }, [project, media, muted, store, showSafeArea]);

  const scrubRef = useRef<HTMLDivElement>(null);
  const scrubTo = (clientX: number) => {
    const bar = scrubRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    store.setPlayhead(fraction * store.durationMs);
  };

  const duration = store.durationMs;
  const progress = duration > 0 ? playheadMs / duration : 0;

  return (
    <div className="stage">
      {project.assets.length === 0 ? (
        <div className="stage-empty fade-in">
          <div className="label">New project</div>
          <h1>Say what you want. Editbay cuts it.</h1>
          <p>
            Import your footage, then describe the edit in the panel on the right. Every change is a validated command — undo
            always works, and nothing leaves your machine except the text you approve.
          </p>
          <button type="button" className="dropzone" onClick={onImport}>
            <IconButton icon="plus" tabIndex={-1} style={{ pointerEvents: 'none' }} />
            <div>
              <div style={{ color: 'var(--text)' }}>Import video, audio or images</div>
              <div className="hint">mp4, mov, mp3, wav, png, jpg</div>
            </div>
          </button>
        </div>
      ) : (
        <>
          <div className="stage-frame" ref={frameRef} style={{ ['--canvas-ratio' as string]: ratio }}>
            <canvas ref={canvasRef} />
          </div>
          <div className="stage-badge mono">
            <span>
              {project.canvas.width}×{project.canvas.height}
            </span>
            <span>·</span>
            <span>{fps} fps ui</span>
          </div>
        </>
      )}

      <div className="transport">
        <IconButton
          icon={store.playing ? 'pause' : 'play'}
          title={store.playing ? 'Pause (space)' : 'Play (space)'}
          onClick={() => {
            if (store.playheadMs >= store.durationMs) store.setPlayhead(0);
            store.setPlaying(!store.playing);
          }}
          disabled={project.assets.length === 0}
        />
        <IconButton
          icon={muted ? 'x' : 'music'}
          title={muted ? 'Unmute' : 'Mute'}
          active={!muted}
          onClick={() => setMuted((m) => !m)}
        />
        <div className="transport-time mono">
          <b>{formatTime(playheadMs, project.canvas.fps)}</b> / {formatTime(duration, project.canvas.fps)}
        </div>
        <div
          className="scrub"
          ref={scrubRef}
          onPointerDown={(event) => {
            (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
            scrubTo(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) scrubTo(event.clientX);
          }}
        >
          <div className="scrub-track">
            <div className="scrub-fill" style={{ width: `${progress * 100}%` }} />
            <div className="scrub-handle" style={{ left: `${progress * 100}%` }} />
          </div>
        </div>
        <span className="chip mono">{project.canvas.fps} fps</span>
      </div>
    </div>
  );
}
