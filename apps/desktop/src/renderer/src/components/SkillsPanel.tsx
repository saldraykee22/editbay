import { useEffect, useState } from 'react';
import { Button, Chip, Field, Input, Section, Textarea } from '@editbay/ui';
import { skills as skillStore } from '../state/workspace';

interface SkillCard {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  body: string;
  path: string;
}

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillCard[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', description: '', triggers: '', body: '' });

  const load = async () => {
    const list = await skillStore.list();
    setSkills(
      list.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        triggers: skill.triggers,
        body: skill.body,
        path: `skills/${skill.id}/SKILL.md`,
      })),
    );
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    const id = form.id.trim().replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    if (!id || !form.name.trim()) return;
    await skillStore.save({
      id,
      name: form.name.trim(),
      description: form.description.trim(),
      triggers: form.triggers
        .split(',')
        .map((trigger) => trigger.trim())
        .filter(Boolean),
      version: '1',
      builtin: false,
      createdAt: new Date().toISOString(),
      body: form.body,
    });
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
