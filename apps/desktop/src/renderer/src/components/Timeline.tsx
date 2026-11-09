import { useMemo, useRef, useState } from 'react';
import type { Clip, TextItem, Track } from '@editbay/core';
import { clipTimelineDurationMs } from '@editbay/core';
import { Button, Field, IconButton, Input, Modal, Select, Textarea } from '@editbay/ui';
import { EditorStore, useEditorVersion, usePlayhead } from '../state/store';
import { videoClips } from '../lib/compositor';
import { Inspector } from './Inspector';

interface DragState {
  kind: 'clip' | 'trim-left' | 'trim-right' | 'text';
  id: string;
  startX: number;
  deltaMs: number;
  original: { inMs: number; outMs: number; startMs: number };
}

const TRACK_H = 56;

function formatRuler(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return `${seconds}s`;
}

export function Timeline({ store }: { store: EditorStore }) {
  useEditorVersion(store);
  const playheadMs = usePlayhead(store);
  const project = store.project;
  const [zoom, setZoom] = useState(store.pxPerSec);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [editing, setEditing] = useState<{ kind: 'text'; id: string } | { kind: 'clip'; id: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const pxPerSec = zoom;
  const duration = store.durationMs;
  const contentSeconds = Math.max(6, duration / 1000 + 1.5);
  const contentWidth = contentSeconds * pxPerSec;

  const clipStarts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of videoClips(project)) map.set(entry.clip.id, entry.startMs);
    return map;
  }, [project]);

  const tickStep = pxPerSec >= 120 ? 0.5 : pxPerSec >= 60 ? 1 : pxPerSec >= 30 ? 2 : 5;
  const ticks = useMemo(() => {
    const list: number[] = [];
    for (let t = 0; t <= contentSeconds; t += tickStep) list.push(t);
    return list;
  }, [contentSeconds, tickStep]);

  const msToPx = (ms: number) => (ms / 1000) * pxPerSec;

  const seekFromEvent = (clientX: number) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    const x = clientX - rect.left + scroll.scrollLeft;
    store.setPlayhead((x / pxPerSec) * 1000);
  };

  const beginDrag = (event: React.PointerEvent, state: Omit<DragState, 'startX' | 'deltaMs'>) => {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({ ...state, startX: event.clientX, deltaMs: 0 });
    if (state.kind === 'clip' || state.kind === 'text') {
      store.select(state.kind === 'clip' ? { clipId: state.id } : { itemId: state.id });
    }
  };

  const moveDrag = (event: React.PointerEvent) => {
    if (!drag) return;
    const deltaPx = event.clientX - drag.startX;
    setDrag({ ...drag, deltaMs: (deltaPx / pxPerSec) * 1000 });
  };

  const endDrag = (event: React.PointerEvent) => {
    if (!drag) return;
    const deltaMs = Math.round(drag.deltaMs);
    const { original, id, kind } = drag;
    setDrag(null);
    if (Math.abs(deltaMs) < 40) return;

    if (kind === 'clip') {
      const location = project.tracks
        .flatMap((track) => track.clips.map((clip) => ({ track, clip })))
        .find((entry) => entry.clip.id === id);
      if (!location) return;

      if (location.track.kind !== 'video') {
        // Audio and overlay clips are placed absolutely; the drop must persist.
        const startMs = Math.max(0, Math.round(original.startMs + deltaMs));
        store.apply({ op: 'set_audio_start', clipId: id, startMs });
        return;
      }

      const clips = location.track.clips;
      const currentIndex = clips.findIndex((c) => c.id === id);
      if (currentIndex < 0) return;
      const currentStart = clipStarts.get(id) ?? 0;
      const targetStart = currentStart + deltaMs;
      let targetIndex = clips.length - 1;
      let cursor = 0;
      for (let i = 0; i < clips.length; i += 1) {
        const clip = clips[i];
        if (!clip) continue;
        const mid = cursor + clipTimelineDurationMs(clip) / 2;
        if (targetStart < mid) {
          targetIndex = i;
          break;
        }
        cursor += clipTimelineDurationMs(clip);
      }
      if (targetIndex !== currentIndex) {
        store.apply({ op: 'move_clip', clipId: id, toIndex: targetIndex });
      }
      return;
    }

    if (kind === 'trim-left' || kind === 'trim-right') {
      const location = project.tracks
        .flatMap((track) => track.clips.map((clip) => ({ track, clip })))
        .find((entry) => entry.clip.id === id);
      if (!location) return;
      const speed = location.clip.speed && location.clip.speed > 0 ? location.clip.speed : 1;
      // Trim handles move on the timeline; source time advances by speed.
      const sourceDeltaMs = Math.round(deltaMs * speed);
      const nextIn = Math.round(original.inMs + (kind === 'trim-left' ? sourceDeltaMs : 0));
      const nextOut = Math.round(original.outMs + (kind === 'trim-right' ? sourceDeltaMs : 0));
      store.apply({ op: 'trim_clip', clipId: id, inMs: Math.max(0, nextIn), outMs: Math.max(nextIn + 100, nextOut) });
      return;
    }

    if (kind === 'text') {
      const track = project.tracks.find((t) => t.kind === 'text');
      const item = track?.items.find((i) => i.id === id);
      if (!item) return;
      store.apply({ op: 'edit_text', itemId: id, startMs: Math.max(0, item.startMs + deltaMs) });
    }
    void event;
  };

  const renderClip = (track: Track, clip: Clip, index: number) => {
    const asset = project.assets.find((a) => a.id === clip.assetId);
    const isVideoTrack = track.kind === 'video';
    const startMs = isVideoTrack ? (clipStarts.get(clip.id) ?? 0) : (clip.startMs ?? 0);
    const durationMs = clipTimelineDurationMs(clip);
    const dragging = drag && drag.id === clip.id;
    const shift = dragging ? drag.deltaMs : 0;
    const selected = store.selection.clipId === clip.id;
    const left = msToPx(startMs + (dragging ? shift : 0));
    const width = Math.max(12, msToPx(durationMs));
    const className = `clip ${selected ? 'selected' : ''} ${track.kind === 'audio' ? 'audio-clip' : ''}`;

    return (
      <div
        key={clip.id}
        className={className}
        style={{ left, width }}
        onPointerDown={(event) => {
          event.stopPropagation();
          beginDrag(event, {
            kind: 'clip',
            id: clip.id,
            original: { inMs: clip.inMs, outMs: clip.outMs, startMs: startMs },
          });
        }}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onDoubleClick={() => setEditing({ kind: 'clip', id: clip.id })}
        title={`${asset?.label ?? clip.assetId} · ${(durationMs / 1000).toFixed(2)}s`}
      >
        {asset?.thumbnailUri ? (
          <div className="thumb" style={{ backgroundImage: `url(${asset.thumbnailUri})` }} />
        ) : null}
        <div className="meta">
          <div className="name">{asset?.label ?? `clip ${index + 1}`}</div>
          <div className="dur">{(durationMs / 1000).toFixed(2)}s</div>
        </div>
        <div
          className="handle left"
          onPointerDown={(event) => {
            event.stopPropagation();
            beginDrag(event, {
              kind: 'trim-left',
              id: clip.id,
              original: { inMs: clip.inMs, outMs: clip.outMs, startMs },
            });
          }}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
        />
        <div
          className="handle right"
          onPointerDown={(event) => {
            event.stopPropagation();
            beginDrag(event, {
              kind: 'trim-right',
              id: clip.id,
              original: { inMs: clip.inMs, outMs: clip.outMs, startMs },
            });
          }}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
        />
      </div>
    );
  };

  const renderText = (item: TextItem) => {
    const dragging = drag && drag.id === item.id;
    const left = msToPx(item.startMs + (dragging ? drag.deltaMs : 0));
    const width = Math.max(18, msToPx(item.durationMs));
    const selected = store.selection.itemId === item.id;
    return (
      <div
        key={item.id}
        className={`clip text-clip ${selected ? 'selected' : ''}`}
        style={{ left, width, top: 6 }}
        onPointerDown={(event) => {
          event.stopPropagation();
          beginDrag(event, {
            kind: 'text',
            id: item.id,
            original: { inMs: 0, outMs: 0, startMs: item.startMs },
          });
        }}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onDoubleClick={() => setEditing({ kind: 'text', id: item.id })}
        title={item.text}
      >
        <div className="meta">
          <div className="name">{item.text || 'Text'}</div>
          <div className="dur">
            {(item.startMs / 1000).toFixed(1)}s · {(item.durationMs / 1000).toFixed(1)}s
          </div>
        </div>
      </div>
    );
  };

  const tracks = project.tracks.filter((t) => t.kind === 'video' || t.kind === 'text' || t.kind === 'audio').slice(0, 3);

  return (
    <div className="timeline">
      <div className="timeline-head">
        <span className="label">Timeline</span>
        <span className="chip mono">{(duration / 1000).toFixed(2)}s</span>
        <span className="chip mono">{project.tracks.find((t) => t.kind === 'video')?.clips.length ?? 0} clips</span>
        <div style={{ flex: 1 }} />
        <IconButton icon="undo" title="Undo (Ctrl+Z)" onClick={() => store.undo()} />
        <IconButton icon="redo" title="Redo (Ctrl+Shift+Z)" onClick={() => store.redo()} />
        <IconButton
          icon="type"
          title="Add text at playhead"
          onClick={() => {
            store.apply({
              op: 'add_text',
              text: 'New text',
              startMs: playheadMs,
              durationMs: 3000,
            });
          }}
        />
        <IconButton
          icon="scissors"
          title="Split at playhead (S)"
          onClick={() => {
            const active = [...project.tracks.find((t) => t.kind === 'video')?.clips ?? []].find((clip) => {
              const start = clipStarts.get(clip.id) ?? 0;
              return playheadMs > start && playheadMs < start + clipTimelineDurationMs(clip);
            });
            if (active) {
              const start = clipStarts.get(active.id) ?? 0;
              store.apply({ op: 'split_clip', clipId: active.id, atMs: playheadMs - start });
            }
          }}
        />
        <IconButton
          icon="trash"
          title="Delete selection (Del)"
          onClick={() => {
            if (store.selection.clipId) store.apply({ op: 'delete_clip', clipId: store.selection.clipId });
            if (store.selection.itemId) store.apply({ op: 'delete_text', itemId: store.selection.itemId });
          }}
        />
        <div className="hairline" style={{ width: 1, height: 16, background: 'var(--line-strong)' }} />
        <IconButton icon="x" title="Zoom out" onClick={() => setZoom((z) => Math.max(18, Math.round(z * 0.8)))} />
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', width: 42, textAlign: 'center' }}>
          {pxPerSec}px
        </span>
        <IconButton icon="plus" title="Zoom in" onClick={() => setZoom((z) => Math.min(260, Math.round(z * 1.25)))} />
      </div>
      <div className="timeline-body">
        <div className="track-labels">
          <div style={{ height: 24, borderBottom: '1px solid var(--line)' }} />
          {tracks.map((track) => (
            <div key={track.id} className={`track-label ${track.kind}`}>
              <span className="dot" />
              {track.kind}
              <span className="mono" style={{ marginLeft: 'auto', fontSize: 9 }}>
                {track.kind === 'text' ? track.items.length : track.clips.length}
              </span>
            </div>
          ))}
        </div>
        <div className="timeline-scroll" ref={scrollRef}>
          <div style={{ width: contentWidth, position: 'relative' }}>
            <div
              className="ruler"
              onPointerDown={(event) => {
                seekFromEvent(event.clientX);
                (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (event.buttons === 1) seekFromEvent(event.clientX);
              }}
            >
              {ticks.map((t) => (
                <div key={t} className="ruler-tick" style={{ left: t * pxPerSec }}>
                  {formatRuler(t)}
                </div>
              ))}
            </div>
            {tracks.map((track) => (
              <div key={track.id} className="track-row" style={{ height: TRACK_H }}>
                {track.kind === 'text'
                  ? track.items.map(renderText)
                  : track.clips.map((clip, index) => renderClip(track, clip, index))}
              </div>
            ))}
            <div className="playhead" style={{ left: msToPx(playheadMs) }} />
          </div>
        </div>
      </div>
      <Inspector store={store} target={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
