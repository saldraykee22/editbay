import { useCallback, useEffect, useRef, useState } from 'react';
import { Agent } from '@editbay/harness/agent';
import type { AgentRuntime } from '@editbay/harness/types';
import { applyCommands, describeChanges, type AgentCommand, type EditCommand } from '@editbay/core';
import { effectCatalog } from '@editbay/effects';
import type { ChatEntry } from '../components/ChatPanel';
import type { EditorStore } from './store';
import { providerPreset, getApiKey, type AppSettings } from './settings';
import { memory, receipts, skills, workspace, IpcProvider } from './workspace';

function isEditCommand(command: AgentCommand): command is EditCommand {
  return command.op !== 'clarify' && command.op !== 'unsupported';
}

function editCommands(commands: AgentCommand[]): EditCommand[] {
  return commands.filter(isEditCommand);
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `m_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export interface AgentController {
  entries: ChatEntry[];
  busy: boolean;
  status: string;
  connected: boolean;
  send: (text: string) => void;
  applyProposal: (id: string) => void;
  discardProposal: (id: string) => void;
  clear: () => void;
}

export function useAgentController({ store, settings }: { store: EditorStore; settings: AppSettings }): AgentController {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [connected, setConnected] = useState(false);
  const proposals = useRef(new Map<string, AgentCommand[]>());
  const abortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const preset = providerPreset(settings.providerId);
      if (!preset.requiresApiKey) {
        if (alive) setConnected(true);
        return;
      }
      const key = await getApiKey(settings.providerId);
      if (alive) setConnected(Boolean(key));
    })();
    return () => {
      alive = false;
    };
  }, [settings.providerId]);

  const push = useCallback((entry: ChatEntry) => {
    setEntries((current) => [...current, entry]);
  }, []);

  const send = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value || busy) return;
      push({ id: newId(), kind: 'user', text: value });
      setBusy(true);
      setStatus('Thinking');

      const runtime: AgentRuntime = {
        project: () => store.project,
        applyCommands: (commands) => store.applyBatch(editCommands(commands)),
        workspace,
        skills,
        memory,
        effects: effectCatalog,
        settings: {
          providerId: settings.providerId,
          model: settings.model,
          autoApply: settings.autoApply,
          temperature: settings.temperature,
          maxTokens: 2048,
          maxSteps: 10,
        },
      };

      const agent = new Agent({
        runtime,
        provider: new IpcProvider({ providerId: settings.providerId, baseUrl: settings.baseUrl }),
        providerConfig: { model: settings.model },
        receipts,
        maxSteps: 10,
      });

      const turn = { cancelled: false };
      abortRef.current = turn;

      void (async () => {
        let lastMessage = '';
        try {
          for await (const event of agent.run({
            text: value,
            selection: {
              clipId: store.selection.clipId,
              itemId: store.selection.itemId,
              playheadMs: store.playheadMs,
            },
          })) {
            if (turn.cancelled) break;
            if (event.type === 'status') {
              setStatus(event.text);
            } else if (event.type === 'message') {
              const message = event.text.trim();
              if (!message || message === lastMessage) continue;
              lastMessage = message;
              push({ id: newId(), kind: 'assistant', text: message });
            } else if (event.type === 'tool_end') {
              push({ id: newId(), kind: 'tool', name: event.call.name, ok: event.ok, summary: event.summary });
            } else if (event.type === 'proposal') {
              const before = store.project;
              const preview = applyCommands(before, editCommands(event.commands));
              const changes = preview.ok || preview.results.some((result) => result.ok)
                ? describeChanges(before, preview.project)
                : preview.results
                    .filter((result) => !result.ok)
                    .map((result) => (result.ok ? '' : result.error.message));
              const id = newId();
              proposals.current.set(id, event.commands);
              push({
                id,
                kind: 'proposal',
                summary: event.summary,
                changes: changes.length ? changes : ['No visible change'],
                commands: event.commands,
              });
            } else if (event.type === 'applied') {
              const okCount = event.results.filter((result) => result.ok).length;
              setStatus(`Applied ${okCount} change${okCount === 1 ? '' : 's'}`);
            } else if (event.type === 'error') {
              push({ id: newId(), kind: 'error', text: event.message });
            }
          }
        } catch (error) {
          push({ id: newId(), kind: 'error', text: error instanceof Error ? error.message : String(error) });
        } finally {
          setBusy(false);
          setStatus('');
        }
      })();
    },
    [busy, push, settings, store],
  );

  const applyProposal = useCallback(
    (id: string) => {
      const commands = proposals.current.get(id);
      if (!commands) return;
      const before = store.project;
      const batch = store.applyBatch(editCommands(commands));
      const changes = describeChanges(before, batch.project);
      const failed = batch.results.filter((result) => !result.ok);
      setEntries((current) =>
        current.map((entry) =>
          entry.id === id && entry.kind === 'proposal'
            ? {
                ...entry,
                applied: failed.length === 0,
                changes: changes.length ? changes : entry.changes,
                error: failed.length
                  ? failed.map((result) => (result.ok ? '' : result.error.message)).join('; ')
                  : undefined,
              }
            : entry,
        ),
      );
      proposals.current.delete(id);
    },
    [store],
  );

  const discardProposal = useCallback((id: string) => {
    proposals.current.delete(id);
    setEntries((current) => current.map((entry) => (entry.id === id && entry.kind === 'proposal' ? { ...entry, discarded: true } : entry)));
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    proposals.current.clear();
  }, []);

  return { entries, busy, status, connected, send, applyProposal, discardProposal, clear };
}
