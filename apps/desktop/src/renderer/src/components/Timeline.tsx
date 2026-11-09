import { useEffect, useMemo, useRef, useState } from 'react';
import type { Clip, TextItem, Track } from '@editbay/core';
import { clipTimelineDurationMs } from '@editbay/core';
import { Button, IconButton } from '@editbay/ui';
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
const LANE_H = 44;
const LANE_GAP = 6;
const TRACK_PAD = 6;
const WAVEFORM_BUCKETS = 72;

/** Renderer-side caches keyed by assetId + source time window. */
const filmstripCache = new Map<string, string[]>();
const filmstripPending = new Set<string>();
const waveformCache = new Map<string, number[]>();
const waveformPending = new Set<string>();

function formatRuler(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return `${seconds}s`;
}

function computeTextLanes(
  items: TextItem[],
  drag: DragState | null,
): { laneById: Map<string, number>; laneCount: number } {
  const laneById = new Map<string, number>();
  if (items.length === 0) return { laneById, laneCount: 1 };

  const decorated = items.map((item, index) => {
    const dragging = drag && drag.kind === 'text' && drag.id === item.id;
    const startMs = Math.max(0, item.startMs + (dragging ? drag.deltaMs : 0));
    const endMs = startMs + Math.max(200, item.durationMs);
    return { item, index, startMs, endMs };
  });

  decorated.sort((a, b) => (a.startMs !== b.startMs ? a.startMs - b.startMs : a.index - b.index));

  const laneEnds: number[] = [];
  for (const entry of decorated) {
    let assigned = -1;
    for (let lane = 0; lane < laneEnds.length; lane += 1) {
      if ((laneEnds[lane] ?? 0) <= entry.startMs) {
        assigned = lane;
        laneEnds[lane] = entry.endMs;
        break;
      }
    }
    if (assigned < 0) {
      assigned = laneEnds.length;
      laneEnds.push(entry.endMs);
    }
    laneById.set(entry.item.id, assigned);
  }

  return { laneById, laneCount: Math.max(1, laneEnds.length) };
}

export function Timeline({ store }: { store: EditorStore }) {
  useEditorVersion(store);
  const playheadMs = usePlayhead(store);
  const project = store.project;
  const [userZoom, setUserZoom] = useState<number | null>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [editing, setEditing] = useState<{ kind: 'text'; id: string } | { kind: 'clip'; id: string } | null>(null);
  const [, setMediaTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset to Fit mode when a different project is loaded.
  useEffect(() => {
    setUserZoom(null);
  }, [project.id]);

  // Measure visible timeline width so Fit zoom fills ~95% of available space.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateWidth = () => {
      if (el.clientWidth > 0) setScrollWidth(el.clientWidth);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const duration = store.durationMs;
  const durationSeconds = Math.max(1, duration / 1000);
  const fitZoom = useMemo(() => {
    if (scrollWidth <= 0 || duration <= 0) return store.pxPerSec;
    return Math.max(18, Math.min(400, Math.round((scrollWidth * 0.95) / durationSeconds)));
  }, [scrollWidth, duration, durationSeconds, store.pxPerSec]);

  const pxPerSec = userZoom ?? fitZoom;

  useEffect(() => {
    store.pxPerSec = pxPerSec;
  }, [pxPerSec, store]);

  // Ctrl + wheel zoom on the timeline scroll container.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      setUserZoom((prev) => {
        const current = prev ?? fitZoom;
        return Math.max(18, Math.min(400, Math.round(current * factor)));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fitZoom]);

  const contentWidth =
    userZoom === null
      ? Math.max(scrollWidth, Math.ceil(durationSeconds * pxPerSec))
      : Math.max(scrollWidth, Math.ceil((durationSeconds + 0.5) * pxPerSec));
  const contentSeconds = pxPerSec > 0 ? Math.max(durationSeconds, contentWidth / pxPerSec) : durationSeconds;

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

  // Fetch filmstrip frames for video clips and waveform peaks for audio clips.
  useEffect(() => {
    let cancelled = false;
    const bump = () => {
      if (!cancelled) setMediaTick((v) => v + 1);
    };

    for (const track of project.tracks) {
      for (const clip of track.clips) {
        const asset = project.assets.find((a) => a.id === clip.assetId);
        if (!asset) continue;

        if ((track.kind === 'video' || track.kind === 'overlay') && (asset.kind === 'video' || asset.kind === 'image')) {
          const clipWidth = Math.max(12, (clipTimelineDurationMs(clip) / 1000) * pxPerSec);
          const count = Math.max(2, Math.min(12, Math.round(clipWidth / 56)));
          const key = `${asset.id}:${clip.inMs}-${clip.outMs}:${count}`;
          if (!filmstripCache.has(key) && !filmstripPending.has(key) && typeof window.editbay?.filmstrip === 'function') {
            filmstripPending.add(key);
            void window.editbay
              .filmstrip(asset.uri, { inMs: clip.inMs, outMs: clip.outMs, count, width: 140 })
              .then((frames) => {
                if (frames && frames.length > 0) {
                  filmstripCache.set(key, frames);
                  bump();
                }
              })
              .catch(() => undefined)
              .finally(() => {
                filmstripPending.delete(key);
              });
          }
        }

        if (track.kind === 'audio' && (asset.kind === 'audio' || asset.hasAudio)) {
          const key = `${asset.id}:${clip.inMs}-${clip.outMs}:${WAVEFORM_BUCKETS}`;
          if (!waveformCache.has(key) && !waveformPending.has(key) && typeof window.editbay?.peaks === 'function') {
            waveformPending.add(key);
            void window.editbay
              .peaks(asset.uri, { buckets: WAVEFORM_BUCKETS, inMs: clip.inMs, outMs: clip.outMs })
              .then((peaks) => {
                if (peaks && peaks.length > 0) {
                  waveformCache.set(key, peaks);
                  bump();
                }
              })
              .catch(() => undefined)
              .finally(() => {
                waveformPending.delete(key);
              });
          }
        }
      }
    }

    return () => {
      cancelled = true;
    };
  }, [project, pxPerSec]);

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

    const frameCount = Math.max(2, Math.min(12, Math.round(width / 56)));
    const filmstripKey = asset ? `${asset.id}:${clip.inMs}-${clip.outMs}:${frameCount}` : '';
    const frames = filmstripKey ? filmstripCache.get(filmstripKey) : undefined;

    const waveformKey = asset ? `${asset.id}:${clip.inMs}-${clip.outMs}:${WAVEFORM_BUCKETS}` : '';
    const peaks = track.kind === 'audio' && waveformKey ? waveformCache.get(waveformKey) : undefined;

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
        {frames && frames.length > 0 ? (
          <div className="clip-filmstrip" aria-hidden="true">
            {frames.map((src, frameIndex) => (
              <div
                key={frameIndex}
                className="clip-filmstrip-frame"
                style={{ backgroundImage: `url(${src})` }}
              />
            ))}
          </div>
        ) : asset?.thumbnailUri ? (
          <div className="thumb" style={{ backgroundImage: `url(${asset.thumbnailUri})` }} />
        ) : null}

        {peaks && peaks.length > 0 ? (
          <svg
            className="clip-waveform"
            viewBox={`0 0 ${peaks.length * 4} 44`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {(() => {
              const maxPeak = Math.max(0.15, ...peaks);
              return peaks.map((peak, peakIdx) => {
                const ratio = Math.min(1, peak / maxPeak);
                const barH = Math.max(4, Math.min(36, Math.round(ratio * 30)));
                return (
                  <rect
                    key={peakIdx}
                    x={peakIdx * 4 + 1}
                    y={Math.round((44 - barH) / 2)}
                    width={2}
                    height={barH}
                    rx={0.75}
                  />
                );
              });
            })()}
          </svg>
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

  const renderText = (item: TextItem, lane: number) => {
    const dragging = drag && drag.id === item.id;
    const left = msToPx(item.startMs + (dragging ? drag.deltaMs : 0));
    const width = Math.max(18, msToPx(item.durationMs));
    const selected = store.selection.itemId === item.id;
    const top = TRACK_PAD + lane * (LANE_H + LANE_GAP);
    return (
      <div
        key={item.id}
        className={`clip text-clip ${selected ? 'selected' : ''}`}
        style={{ left, width, top, height: LANE_H }}
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

  const tracks = project.tracks
    .filter((t) => t.kind === 'video' || t.kind === 'overlay' || t.kind === 'text' || t.kind === 'audio')
    .slice(0, 4);

  const trackLayouts = useMemo(() => {
    return tracks.map((track) => {
      if (track.kind !== 'text') {
        return { track, height: TRACK_H, laneById: new Map<string, number>() };
      }
      const { laneById, laneCount } = computeTextLanes(track.items, drag);
      const height =
        laneCount <= 1 ? TRACK_H : TRACK_PAD * 2 + laneCount * LANE_H + (laneCount - 1) * LANE_GAP;
      return { track, height, laneById };
    });
  }, [tracks, drag]);

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
            const active = [...(project.tracks.find((t) => t.kind === 'video')?.clips ?? [])].find((clip) => {
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
        <Button
          size="sm"
          variant="ghost"
          className={`fit-btn ${userZoom === null ? 'active' : ''}`}
          title="Fit project to timeline width"
          onClick={() => {
            setUserZoom(null);
            if (scrollRef.current) scrollRef.current.scrollLeft = 0;
          }}
        >
          Fit
        </Button>
        <IconButton
          icon="x"
          title="Zoom out (Ctrl+Wheel)"
          onClick={() => setUserZoom((z) => Math.max(18, Math.round((z ?? fitZoom) * 0.8)))}
        />
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', minWidth: 46, textAlign: 'center' }}>
          {pxPerSec}px
        </span>
        <IconButton
          icon="plus"
          title="Zoom in (Ctrl+Wheel)"
          onClick={() => setUserZoom((z) => Math.min(400, Math.round((z ?? fitZoom) * 1.25)))}
        />
      </div>
      <div className="timeline-body">
        <div className="track-labels">
          <div style={{ height: 24, borderBottom: '1px solid var(--line)' }} />
          {trackLayouts.map(({ track, height }) => (
            <div key={track.id} className={`track-label ${track.kind}`} style={{ height }}>
              <span className="dot" />
              <span>{track.kind}</span>
            </div>
          ))}
        </div>
        <div className="timeline-scroll" ref={scrollRef}>
          <div style={{ width: contentWidth, minWidth: '100%', position: 'relative' }}>
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
            {trackLayouts.map(({ track, height, laneById }) => (
              <div key={track.id} className="track-row" style={{ height }}>
                {track.kind === 'text'
                  ? track.items.map((item) => renderText(item, laneById.get(item.id) ?? 0))
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
