import { useEffect, useRef, useState } from 'react';
import { Button, Chip, Icon, Spinner } from '@editbay/ui';

export type ChatEntry =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'error'; text: string }
  | { id: string; kind: 'tool'; name: string; ok: boolean; summary: string }
  | {
      id: string;
      kind: 'proposal';
      summary: string;
      changes: string[];
      commands: unknown[];
      applied?: boolean;
      discarded?: boolean;
      error?: string;
    };

const QUICK_PROMPTS = [
  'Tighten the intro and put the logo line at the end',
  'Make a 15 second cut for Reels with captions',
  'Add a calm fade between the first two clips',
  'Grade the whole video warm and cinematic',
];

export function ChatPanel({
  entries,
  busy,
  status,
  connected,
  onSend,
  onApply,
  onDiscard,
  onOpenSettings,
}: {
  entries: ChatEntry[];
  busy: boolean;
  status: string;
  connected: boolean;
  onSend: (text: string) => void;
  onApply: (id: string) => void;
  onDiscard: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [entries, busy, status]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    setText('');
    onSend(value);
  };

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {entries.length === 0 ? (
          <div style={{ display: 'grid', gap: 14, paddingTop: 8 }}>
            <div>
              <div className="label" style={{ marginBottom: 6 }}>
                Editbay · AI editor
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>
                Describe the cut, the pacing, the look. I edit the timeline with validated commands and show you what
                changed. Everything stays on this machine.
              </div>
            </div>
            {!connected ? (
              <div className="proposal">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Icon name="key" size={14} />
                  <div style={{ fontSize: 12 }}>Connect a model to start</div>
                </div>
                <div className="hint">OpenRouter OAuth, your own API key, or a local model. No account required.</div>
                <div className="row">
                  <Button size="sm" variant="primary" onClick={onOpenSettings} icon="bolt">
                    Connect
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                <div className="label">Try</div>
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="btn ghost"
                    style={{ justifyContent: 'flex-start', height: 'auto', padding: '7px 9px', whiteSpace: 'normal', textAlign: 'left' }}
                    onClick={() => onSend(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {entries.map((entry) => {
          if (entry.kind === 'user') {
            return (
              <div key={entry.id} className="msg user fade-in">
                <div className="msg-role">You</div>
                <div className="msg-body">{entry.text}</div>
              </div>
            );
          }
          if (entry.kind === 'assistant') {
            return (
              <div key={entry.id} className="msg assistant fade-in">
                <div className="msg-role">Editbay</div>
                <div className="msg-body">{entry.text}</div>
              </div>
            );
          }
          if (entry.kind === 'error') {
            return (
              <div key={entry.id} className="msg error fade-in">
                <div className="msg-role">Error</div>
                <div className="msg-body">{entry.text}</div>
              </div>
            );
          }
          if (entry.kind === 'tool') {
            return (
              <div key={entry.id} className="msg-tool fade-in">
                <span className={entry.ok ? 'ok' : 'fail'}>{entry.ok ? '✓' : '×'}</span>
                <span>{entry.name}</span>
                <span>· {entry.summary}</span>
              </div>
            );
          }
          return (
            <div key={entry.id} className="proposal fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="label">{entry.applied ? 'Applied' : entry.discarded ? 'Discarded' : 'Proposed edit'}</div>
                <Chip tone={entry.applied ? 'accent' : entry.error ? 'danger' : undefined}>
                  {entry.commands.length} command{entry.commands.length === 1 ? '' : 's'}
                </Chip>
              </div>
              {entry.summary ? <div style={{ fontSize: 12.5 }}>{entry.summary}</div> : null}
              <div className="changes">
                {entry.changes.map((change, index) => (
                  <div key={index} style={{ display: 'flex', gap: 6 }}>
                    <span style={{ color: 'var(--accent)' }}>·</span>
                    <span>{change}</span>
                  </div>
                ))}
              </div>
              {entry.error ? <div className="error-text">{entry.error}</div> : null}
              {!entry.applied && !entry.discarded ? (
                <div className="row">
                  <Button size="sm" variant="ghost" onClick={() => onDiscard(entry.id)}>
                    Discard
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => onApply(entry.id)} icon="check">
                    Apply
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}

        {busy ? (
          <div className="msg-tool">
            <Spinner />
            <span>{status || 'Thinking…'}</span>
          </div>
        ) : null}
      </div>

      <div className="composer">
        <textarea
          value={text}
          placeholder={connected ? 'Describe the edit…  (Enter to send, Shift+Enter for a new line)' : 'Connect a model first…'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-row">
          <Chip>{connected ? 'Ready' : 'No model'}</Chip>
          <div style={{ flex: 1 }} />
          <span className="kbd">Enter</span>
          <Button size="sm" variant="primary" onClick={submit} disabled={busy || !text.trim()} icon="send">
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
