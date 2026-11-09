import { useEffect, useState } from 'react';
import { createId, type Asset } from '@editbay/core';
import { Button, Chip, Field, Input, Section, Textarea } from '@editbay/ui';
import type { EditorStore } from '../state/store';
import { memory } from '../state/workspace';
import { parseCommaList, parseHexList } from '../lib/frontmatter';

const BRAND_ID = 'default';

interface BrandDraft {
  name: string;
  colors: string;
  fonts: string;
  logoPath: string;
  body: string;
}

interface Note {
  path: string;
  title: string;
  body: string;
}

export function BrandPanel({ store }: { store: EditorStore }) {
  const [brand, setBrand] = useState<BrandDraft>({ name: '', colors: '', fonts: '', logoPath: '', body: '' });
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);

  const refreshNotes = async () => {
    const entries = await memory.entries();
    setNotes(entries.slice(0, 30).map((entry) => ({ path: entry.path, title: entry.title, body: entry.body })));
  };

  useEffect(() => {
    void (async () => {
      const loaded = await memory.getBrand(BRAND_ID);
      if (loaded) {
        setBrand({
          name: loaded.name,
          colors: loaded.colors.join(', '),
          fonts: loaded.fonts.join(', '),
          logoPath: loaded.logoPath ?? '',
          body: loaded.body,
        });
      }
      await refreshNotes();
    })();
  }, []);

  const persistBrand = async (next: BrandDraft) => {
    const trimmedLogo = next.logoPath.trim();
    await memory.saveBrand({
      id: BRAND_ID,
      name: next.name.trim() || 'My brand',
      colors: parseHexList(next.colors),
      fonts: parseCommaList(next.fonts),
      ...(trimmedLogo ? { logoPath: trimmedLogo } : {}),
      body: next.body,
      updatedAt: new Date().toISOString(),
    });
    // The agent loads `project.brandId` at the start of every turn.
    store.setBrandId(BRAND_ID);
  };

  const save = async () => {
    await persistBrand(brand);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const chooseLogo = async () => {
    const picked = await window.editbay.pickLogo();
    if (!picked) return;
    const next = { ...brand, logoPath: picked };
    setBrand(next);
    await persistBrand(next);
  };

  const addLogoToVideo = async () => {
    const logoPath = brand.logoPath.trim();
    if (!logoPath) return;
    const [probe, thumbnail] = await Promise.all([
      window.editbay.probeMedia(logoPath).catch(() => null),
      window.editbay.thumbnail(logoPath, 0, 320).catch(() => undefined),
    ]);
    const label = logoPath.split(/[\\/]/).pop() || 'logo.png';
    const asset: Asset = {
      id: createId('a'),
      kind: 'image',
      uri: logoPath,
      label,
      durationMs: 5000,
      width: probe?.width ?? 200,
      height: probe?.height ?? 200,
      thumbnailUri: thumbnail,
      origin: 'imported',
      createdAt: new Date().toISOString(),
    };
    const projectDuration = store.durationMs > 0 ? store.durationMs : 5000;
    const batch = store.applyBatch([
      { op: 'add_asset', asset },
      {
        op: 'add_overlay',
        assetId: asset.id,
        startMs: 0,
        durationMs: projectDuration,
        x: 0.88,
        y: 0.08,
        scale: 0.16,
      },
    ]);
    const second = batch.results[1];
    if (second?.ok && second.createdIds.clip) {
      store.select({ clipId: second.createdIds.clip });
    }
  };

  const remember = async () => {
    const text = draft.trim();
    if (!text) return;
    const title = text.split('\n')[0]?.slice(0, 80).trim() || 'Brand note';
    await memory.remember({ title, body: text, tags: ['brand'], source: 'user' });
    setDraft('');
    await refreshNotes();
  };

  return (
    <div className="scroll-y">
      <Section title="Brand memory">
        <div className="hint">
          What Editbay remembers about this client: voice, products, colours, do/don't. Stored as readable markdown in your
          workspace, owned by you.
        </div>
        <Field label="Brand name">
          <Input value={brand.name} onChange={(event) => setBrand({ ...brand, name: event.target.value })} placeholder="Acme Coffee" />
        </Field>
        <Field label="Colours" hint="Comma separated hex values.">
          <Input value={brand.colors} onChange={(event) => setBrand({ ...brand, colors: event.target.value })} placeholder="#0B0B0B, #5BE9A6" />
        </Field>
        <Field label="Fonts">
          <Input value={brand.fonts} onChange={(event) => setBrand({ ...brand, fonts: event.target.value })} placeholder="IBM Plex Sans" />
        </Field>
        <Field label="Logo" hint={brand.logoPath.trim() ? brand.logoPath.split(/[\\/]/).pop() : 'Optional brand mark for video overlays.'}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button size="sm" variant="ghost" icon="folder" onClick={chooseLogo}>
              Choose logo
            </Button>
            {brand.logoPath.trim() ? (
              <Button size="sm" variant="ghost" icon="plus" onClick={addLogoToVideo}>
                Add logo to video
              </Button>
            ) : null}
          </div>
        </Field>
        <Field label="Identity notes" hint="Tone, audience, products, what to avoid. The agent reads this before every edit.">
          <Textarea
            rows={10}
            value={brand.body}
            onChange={(event) => setBrand({ ...brand, body: event.target.value })}
            placeholder={'## Who they are\nSpecialty coffee roaster in Istanbul.\n\n## Voice\nWarm, direct, no hype. Never say "game-changer".\n\n## Always\nLogo line at the end. Turkish captions.'}
          />
        </Field>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Button variant="primary" size="sm" onClick={save} icon="save">
            Save identity
          </Button>
          {saved ? <Chip tone="accent">Saved</Chip> : null}
        </div>
      </Section>

      <div className="hairline" />

      <Section title="Remembered facts">
        <Field label="Add a note">
          <Textarea
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="The client always wants prices in TL, never USD."
          />
        </Field>
        <Button size="sm" onClick={remember} icon="brain">
          Remember
        </Button>
        <div style={{ display: 'grid', gap: 6 }}>
          {notes.length === 0 ? <div className="hint">Nothing remembered yet.</div> : null}
          {notes.map((note) => (
            <div key={note.path} className="proposal" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
              <div style={{ fontSize: 12 }}>{note.title}</div>
              <div className="hint" style={{ whiteSpace: 'pre-wrap' }}>
                {note.body.slice(0, 220)}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
