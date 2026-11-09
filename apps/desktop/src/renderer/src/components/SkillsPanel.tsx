import { useEffect, useState } from 'react';
import { Button, Chip, Field, Input, Section, Textarea } from '@editbay/ui';

interface SkillCard {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  body: string;
  path: string;
}

function parseSkill(text: string, fallbackId: string): { name: string; description: string; triggers: string[]; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { name: fallbackId, description: '', triggers: [], body: text };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const triggers = (meta['triggers'] ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => t.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  return { name: meta['name'] ?? fallbackId, description: meta['description'] ?? '', triggers, body: match[2] ?? '' };
}

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillCard[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', description: '', triggers: '', body: '' });

  const load = async () => {
    const dirs = await window.editbay.workspace.list('skills');
    const loaded: SkillCard[] = [];
    for (const dir of dirs) {
      const path = `${dir.name}/SKILL.md`;
      const content = await window.editbay.workspace.read(`skills/${path}`);
      if (!content) continue;
      const parsed = parseSkill(content, dir.name);
      loaded.push({ id: dir.name, ...parsed, path: `skills/${path}` });
    }
    setSkills(loaded.sort((a, b) => a.name.localeCompare(b.name)));
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    const id = form.id.trim().replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    if (!id || !form.name.trim()) return;
    const content = `---\nid: ${id}\nname: ${form.name.trim()}\ndescription: ${form.description.trim()}\ntriggers: [${form.triggers
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .join(', ')}]\nversion: 1\nbuiltin: false\ncreated: ${new Date().toISOString()}\n---\n\n${form.body.trim()}\n`;
    await window.editbay.workspace.write(`skills/${id}/SKILL.md`, content);
    setCreating(false);
    setForm({ id: '', name: '', description: '', triggers: '', body: '' });
    await load();
    setSelected(id);
  };

  const current = skills.find((skill) => skill.id === selected) ?? null;

  return (
    <div className="scroll-y">
      <Section
        title="Skills"
        action={
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setCreating((value) => !value)}>
            New
          </Button>
        }
      >
        <div className="hint">
          Playbooks the agent loads when your request matches. Built-ins ship with Editbay; the agent can also write new ones
          after you teach it a house style.
        </div>

        {creating ? (
          <div className="proposal">
            <Field label="Id">
              <Input value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder="reels-hook" />
            </Field>
            <Field label="Name">
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Reels hook" />
            </Field>
            <Field label="Description">
              <Input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Cuts a 3-second hook before the intro"
              />
            </Field>
            <Field label="Triggers" hint="Comma separated phrases.">
              <Input value={form.triggers} onChange={(event) => setForm({ ...form, triggers: event.target.value })} placeholder="reels, hook, short" />
            </Field>
            <Field label="Instructions">
              <Textarea rows={8} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} />
            </Field>
            <div className="row">
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={create} icon="save">
                Create skill
              </Button>
            </div>
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 6 }}>
          {skills.length === 0 && !creating ? <div className="hint">No skills installed yet.</div> : null}
          {skills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              className="proposal"
              style={{
                textAlign: 'left',
                borderColor: selected === skill.id ? 'var(--accent-line)' : 'var(--line)',
                background: 'var(--panel)',
                cursor: 'pointer',
              }}
              onClick={() => setSelected(selected === skill.id ? null : skill.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 12 }}>{skill.name}</div>
                <Chip>{skill.triggers.length} triggers</Chip>
              </div>
              <div className="hint">{skill.description}</div>
              {selected === skill.id ? (
                <pre
                  className="mono"
                  style={{ whiteSpace: 'pre-wrap', fontSize: 10.5, color: 'var(--text-dim)', margin: 0, userSelect: 'text' }}
                >
                  {skill.body.slice(0, 1200)}
                </pre>
              ) : null}
            </button>
          ))}
        </div>
      </Section>

      {current ? (
        <>
          <div className="hairline" />
          <Section title="How to use">
            <div className="hint">
              Ask in the chat and mention the trigger, or just describe the result you want — matching is automatic. Disable a
              skill by deleting its folder from the workspace.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {current.triggers.map((trigger) => (
                <Chip key={trigger}>{trigger}</Chip>
              ))}
            </div>
          </Section>
        </>
      ) : null}
    </div>
  );
}
