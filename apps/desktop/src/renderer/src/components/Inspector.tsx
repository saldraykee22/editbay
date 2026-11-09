import { useEffect, useRef, useState } from 'react';
import type { Clip, TextItem } from '@editbay/core';
import { clipTimelineDurationMs } from '@editbay/core';
import { Button, Field, IconButton, Input, Modal, Select, Textarea } from '@editbay/ui';
import { EditorStore, useEditorVersion } from '../state/store';

export type InspectorTarget = { kind: 'text'; id: string } | { kind: 'clip'; id: string } | null;

/** `Number('0') || 1` must not turn a deliberate 0 into 100%. */
function numberOr(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function Inspector({
  store,
  target,
  onClose,
}: {
  store: EditorStore;
  target: InspectorTarget;
  onClose: () => void;
}) {
  useEditorVersion(store);

  const overlayTrack = store.project.tracks.find((track) => track.kind === 'overlay');
  const selectedOverlayId =
    store.selection.clipId ?? (target?.kind === 'clip' ? target.id : undefined);
  const selectedOverlay = selectedOverlayId
    ? overlayTrack?.clips.find((clip) => clip.id === selectedOverlayId)
    : undefined;

  return (
    <>
      {selectedOverlay ? (
        <OverlayInspector
          key={selectedOverlay.id}
          store={store}
          clip={selectedOverlay}
          onClose={() => {
            store.select({});
            if (target?.kind === 'clip' && target.id === selectedOverlay.id) onClose();
          }}
        />
      ) : null}
      {target?.kind === 'text' ? (
        <TextInspector store={store} itemId={target.id} onClose={onClose} />
      ) : target?.kind === 'clip' && (!selectedOverlay || selectedOverlay.id !== target.id) ? (
        <ClipInspector store={store} clipId={target.id} onClose={onClose} />
      ) : null}
    </>
  );
}

function OverlaySliderField({
  label,
  name,
  value,
  min,
  max,
  step = 0.01,
  onCommit,
}: {
  label: string;
  name: 'x' | 'y' | 'scale' | 'opacity';
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const draggingRef = useRef(false);
  const numInputRef = useRef<HTMLInputElement>(null);
  const commitRef = useRef<(raw: string) => void>(() => undefined);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitRaw = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = round3(Math.min(max, Math.max(min, parsed)));
    setDraft(String(clamped));
    if (Math.abs(clamped - value) < 1e-6) return;
    onCommit(clamped);
  };
  commitRef.current = commitRaw;

  useEffect(() => {
    const el = numInputRef.current;
    if (!el) return;
    const onNativeChange = () => commitRef.current(el.value);
    el.addEventListener('change', onNativeChange);
    return () => el.removeEventListener('change', onNativeChange);
  }, []);

  const numericDraft = Number(draft);
  const sliderValue = Number.isFinite(numericDraft) ? Math.min(max, Math.max(min, numericDraft)) : value;

  return (
    <div className="overlay-inspector-field">
      <span className="label">{label}</span>
      <input
        type="range"
        aria-label={`${label} slider`}
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onPointerDown={() => {
          draggingRef.current = true;
        }}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (!draggingRef.current) commitRaw(next);
        }}
        onPointerUp={(event) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          commitRaw((event.currentTarget as HTMLInputElement).value);
        }}
        onPointerCancel={(event) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          commitRaw((event.currentTarget as HTMLInputElement).value);
        }}
      />
      <input
        ref={numInputRef}
        type="number"
        className="input"
        name={name}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commitRaw(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitRaw((event.currentTarget as HTMLInputElement).value);
          }
        }}
      />
    </div>
  );
}

function OverlayInspector({
  store,
  clip,
  onClose,
}: {
  store: EditorStore;
  clip: Clip;
  onClose: () => void;
}) {
  const asset = store.project.assets.find((entry) => entry.id === clip.assetId);
  const x = round3(Math.min(1, Math.max(0, (clip.transform?.x ?? 0) + 0.5)));
  const y = round3(Math.min(1, Math.max(0, (clip.transform?.y ?? 0) + 0.5)));
  const scale = round3(Math.min(1, Math.max(0.05, clip.transform?.scale ?? 0.2)));
  const opacity = round3(Math.min(1, Math.max(0, clip.transform?.opacity ?? 1)));

  return (
    <div className="overlay-inspector" role="region" aria-label="Overlay inspector">
      <span className="label">Overlay</span>
      <span className="chip mono">
        {asset?.label ?? 'overlay'} · {(clipTimelineDurationMs(clip) / 1000).toFixed(2)}s
      </span>
      <OverlaySliderField
        label="X"
        name="x"
        value={x}
        min={0}
        max={1}
        onCommit={(next) => store.apply({ op: 'set_overlay', clipId: clip.id, x: next })}
      />
      <OverlaySliderField
        label="Y"
        name="y"
        value={y}
        min={0}
        max={1}
        onCommit={(next) => store.apply({ op: 'set_overlay', clipId: clip.id, y: next })}
      />
      <OverlaySliderField
        label="Scale"
        name="scale"
        value={scale}
        min={0.05}
        max={1}
        onCommit={(next) => store.apply({ op: 'set_overlay', clipId: clip.id, scale: next })}
      />
      <OverlaySliderField
        label="Opacity"
        name="opacity"
        value={opacity}
        min={0}
        max={1}
        onCommit={(next) => store.apply({ op: 'set_overlay', clipId: clip.id, opacity: next })}
      />
      <div style={{ flex: 1 }} />
      <IconButton
        icon="trash"
        title="Delete overlay"
        onClick={() => {
          store.apply({ op: 'delete_clip', clipId: clip.id });
          onClose();
        }}
      />
      <IconButton icon="x" title="Close overlay inspector" onClick={onClose} />
    </div>
  );
}

function TextInspector({ store, itemId, onClose }: { store: EditorStore; itemId: string; onClose: () => void }) {
  const item = store.project.tracks.flatMap((track) => track.items).find((entry) => entry.id === itemId);
  if (!item) return null;
  return <TextForm key={item.id} store={store} item={item} onClose={onClose} />;
}

function TextForm({ store, item, onClose }: { store: EditorStore; item: TextItem; onClose: () => void }) {
  const [text, setText] = useState(item.text);
  const [start, setStart] = useState(String(Math.round(item.startMs / 100) / 10));
  const [duration, setDuration] = useState(String(Math.round(item.durationMs / 100) / 10));
  const [fontSize, setFontSize] = useState(String(item.style.fontSize));
  const [color, setColor] = useState(item.style.color);
  const [y, setY] = useState(String(item.style.y));
  const [animation, setAnimation] = useState<NonNullable<TextItem['animation']>>(item.animation ?? 'none');

  const apply = () => {
    store.apply({
      op: 'edit_text',
      itemId: item.id,
      text,
      startMs: Math.max(0, Math.round(Number(start) * 1000) || 0),
      durationMs: Math.max(200, Math.round(Number(duration) * 1000) || 3000),
      animation: animation as TextItem['animation'],
      style: {
        fontSize: Math.max(8, Number(fontSize) || item.style.fontSize),
        color,
        y: Math.min(1, Math.max(0, Number(y) || item.style.y)),
      },
    });
    onClose();
  };

  return (
    <Modal
      title="Text"
      onClose={onClose}
      footer={
        <>
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            onClick={() => {
              store.apply({ op: 'delete_text', itemId: item.id });
              onClose();
            }}
          >
            Delete
          </Button>
          <div style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <Field label="Text">
        <Textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Start (s)">
          <Input value={start} onChange={(event) => setStart(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Duration (s)">
          <Input value={duration} onChange={(event) => setDuration(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Font size (px)">
          <Input value={fontSize} onChange={(event) => setFontSize(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Vertical position (0-1)">
          <Input value={y} onChange={(event) => setY(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Colour">
          <Input type="color" value={color} onChange={(event) => setColor(event.target.value)} style={{ padding: 2 }} />
        </Field>
        <Field label="Animation">
          <Select value={animation} onChange={(event) => setAnimation(event.target.value as NonNullable<TextItem['animation']>)}>
            <option value="none">None</option>
            <option value="fade">Fade</option>
            <option value="rise">Rise</option>
            <option value="typewriter">Typewriter</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function ClipInspector({ store, clipId, onClose }: { store: EditorStore; clipId: string; onClose: () => void }) {
  const found = store.project.tracks
    .flatMap((track) => track.clips.map((clip) => ({ track, clip })))
    .find((entry) => entry.clip.id === clipId);
  if (!found) return null;
  const { clip } = found;
  const asset = store.project.assets.find((entry) => entry.id === clip.assetId);
  const [volume, setVolume] = useState(String(clip.volume ?? 1));
  const [speed, setSpeed] = useState(String(clip.speed ?? 1));
  const [scale, setScale] = useState(String(clip.transform?.scale ?? 1));
  const [opacity, setOpacity] = useState(String(clip.transform?.opacity ?? 1));

  const apply = () => {
    store.applyBatch([
      { op: 'set_volume', clipId: clip.id, volume: Math.min(2, Math.max(0, numberOr(volume, clip.volume ?? 1))) },
      { op: 'set_clip_speed', clipId: clip.id, speed: Math.min(4, Math.max(0.25, numberOr(speed, clip.speed ?? 1))) },
      {
        op: 'set_clip_transform',
        clipId: clip.id,
        transform: {
          scale: Math.min(8, Math.max(0.05, numberOr(scale, clip.transform?.scale ?? 1))),
          opacity: Math.min(1, Math.max(0, numberOr(opacity, clip.transform?.opacity ?? 1))),
        },
      },
    ]);
    onClose();
  };

  return (
    <Modal
      title="Clip"
      onClose={onClose}
      footer={
        <>
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            onClick={() => {
              store.apply({ op: 'delete_clip', clipId: clip.id });
              onClose();
            }}
          >
            Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="layers"
            onClick={() => {
              store.apply({ op: 'duplicate_clip', clipId: clip.id });
              onClose();
            }}
          >
            Duplicate
          </Button>
          <div style={{ flex: 1 }} />
          <Button size="sm" variant="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <div className="hint">
        {asset?.label ?? 'clip'} · {(clipTimelineDurationMs(clip) / 1000).toFixed(2)}s
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Volume (0-2)">
          <Input value={volume} onChange={(event) => setVolume(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Speed (0.25-4)">
          <Input value={speed} onChange={(event) => setSpeed(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Scale">
          <Input value={scale} onChange={(event) => setScale(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Opacity (0-1)">
          <Input value={opacity} onChange={(event) => setOpacity(event.target.value)} inputMode="decimal" />
        </Field>
      </div>
    </Modal>
  );
}
