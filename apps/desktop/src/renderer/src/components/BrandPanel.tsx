import { useEffect, useState } from 'react';
import { Button, Chip, Field, Input, Section, Textarea } from '@editbay/ui';

const BRAND_PATH = 'brands/default/identity.md';

interface ParsedBrand {
  name: string;
  colors: string;
  fonts: string;
  body: string;
}

function parseBrand(text: string): ParsedBrand {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { name: 'My brand', colors: '', fonts: '', body: text };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { name: meta['name'] ?? 'My brand', colors: meta['colors'] ?? '', fonts: meta['fonts'] ?? '', body: match[2] ?? '' };
}

function serializeBrand(brand: ParsedBrand): string {
  return `---\nname: ${brand.name}\ncolors: ${brand.colors}\nfonts: ${brand.fonts}\nupdated: ${new Date().toISOString()}\n---\n\n${brand.body.trim()}\n`;
}

interface Note {
  path: string;
  title: string;
  body: string;
}

export function BrandPanel() {
  const [brand, setBrand] = useState<ParsedBrand>({ name: '', colors: '', fonts: '', body: '' });
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);

  const refreshNotes = async () => {
    const files = await window.editbay.workspace.list('memory');
    const loaded: Note[] = [];
    for (const file of files.filter((f) => f.name.endsWith('.md')).slice(-30).reverse()) {
      const content = await window.editbay.workspace.read(file.path);
      if (!content) continue;
      const titleMatch = /^#\s+(.*)$/m.exec(content);
      const body = content.replace(/^---[\s\S]*?---\r?\n?/, '').replace(/^#\s+.*$/m, '').trim();
      loaded.push({ path: file.path, title: titleMatch?.[1] ?? file.name, body });
    }
    setNotes(loaded);
  };

  useEffect(() => {
    void (async () => {
      const content = await window.editbay.workspace.read(BRAND_PATH);
      if (content) setBrand(parseBrand(content));
      await refreshNotes();
    })();
  }, []);

  const save = async () => {
    await window.editbay.workspace.write(BRAND_PATH, serializeBrand(brand));
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const remember = async () => {
    const text = draft.trim();
    if (!text) return;
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9ğüşıöç]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    const path = `memory/${new Date().toISOString().slice(0, 10)}-${slug || 'note'}.md`;
    const content = `---\ntitle: ${text.split('\n')[0]?.slice(0, 80)}\nsource: user\ncreated: ${new Date().toISOString()}\ntags: brand\n---\n\n# ${text.split('\n')[0]}\n\n${text}\n`;
    await window.editbay.workspace.write(path, content);
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
