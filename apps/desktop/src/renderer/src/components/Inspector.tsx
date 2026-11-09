import { useState } from 'react';
import type { TextItem } from '@editbay/core';
import { Button, Field, Input, Modal, Select, Textarea } from '@editbay/ui';
import { EditorStore, useEditorVersion } from '../state/store';
import { clipDurationMs } from '../lib/compositor';

export type InspectorTarget = { kind: 'text'; id: string } | { kind: 'clip'; id: string } | null;

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
  if (!target) return null;
  return target.kind === 'text' ? (
    <TextInspector store={store} itemId={target.id} onClose={onClose} />
  ) : (
    <ClipInspector store={store} clipId={target.id} onClose={onClose} />
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
    store.apply({ op: 'set_volume', clipId: clip.id, volume: Math.min(2, Math.max(0, Number(volume) || 1)) });
    store.apply({ op: 'set_clip_speed', clipId: clip.id, speed: Math.min(4, Math.max(0.25, Number(speed) || 1)) });
    store.apply({
      op: 'set_clip_transform',
      clipId: clip.id,
      transform: {
        scale: Math.min(8, Math.max(0.05, Number(scale) || 1)),
        opacity: Math.min(1, Math.max(0, Number(opacity) || 1)),
      },
    });
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
        {asset?.label ?? 'clip'} · {(clipDurationMs(clip) / 1000).toFixed(2)}s
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
