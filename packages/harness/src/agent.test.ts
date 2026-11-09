import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type {
  AgentCommand,
  ApplyResult,
  BatchResult,
  EditCommand,
  Project,
} from '@editbay/core';
import type {
  AgentEvent,
  AgentRuntime,
  AgentTurnInput,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Provider,
  ProviderConfig,
} from './types';
import type { EffectCatalog } from '@editbay/effects';
import { Agent } from './agent';
import { FileMemoryStore } from './memory';
import { FileSkillStore } from './skills';
import { FileReceiptStore } from './receipts-node';
import { NodeWorkspace } from './workspace';
import { ProviderError } from './providers/base';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'editbay-agent-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const project: Project = {
  schemaVersion: 2,
  id: 'p1',
  name: 'Demo',
  canvas: { width: 1080, height: 1920, fps: 30 },
  brandId: 'acme',
  assets: [
    {
      id: 'asset-1',
      kind: 'video',
      uri: 'C:\\secret\\clip.mp4',
      label: 'Hero',
      durationMs: 5000,
    },
  ],
  tracks: [
    {
      id: 'track-1',
      kind: 'video',
      clips: [{ id: 'clip-1', assetId: 'asset-1', inMs: 0, outMs: 5000, effects: [] }],
      items: [],
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

type FakeResponse = ChatResponse | Error;

class FakeProvider implements Provider {
  readonly id = 'fake';
  readonly label = 'Fake provider';
  readonly requiresApiKey = false;
  readonly defaultBaseUrl = 'http://fake.local';
  readonly defaultModel = 'fake-1';
  readonly requests: ChatRequest[] = [];
  private index = 0;

  constructor(
    private readonly responses: FakeResponse[] | ((request: ChatRequest) => ChatResponse | Promise<ChatResponse>),
  ) {}

  async chat(request: ChatRequest, _config: ProviderConfig): Promise<ChatResponse> {
    this.requests.push(request);
    if (typeof this.responses === 'function') return this.responses(request);
    const next = this.responses[this.index];
    this.index += 1;
    if (!next) throw new Error('FakeProvider ran out of responses');
    if (next instanceof Error) throw next;
    return next;
  }
}

interface Harness {
  runtime: AgentRuntime;
  provider: FakeProvider;
  receipts: FileReceiptStore;
  applied: AgentCommand[][];
}

function buildRuntime(autoApply: boolean, withUndo = false) {
  const applied: AgentCommand[][] = [];
  const skills = new FileSkillStore({ root });
  const memory = new FileMemoryStore(root);
  const effects = {
    effects: [
      {
        id: 'fade',
        name: 'Fade',
        category: 'motion',
        description: 'Fade in.',
        params: [],
        builtin: true,
      },
    ],
    transitions: [],
  } as unknown as EffectCatalog;

  const runtime = {
    project: () => project,
    applyCommands: (commands: AgentCommand[]): BatchResult => {
      applied.push(commands);
      const results: ApplyResult[] = commands.map((command) => ({
        ok: true,
        command: command as EditCommand,
        project,
        changes: ['changed'],
        createdIds: {},
      }));
      return { ok: true, project, changes: ['changed'], results };
    },
    workspace: new NodeWorkspace(root),
    skills,
    memory,
    effects,
    settings: { providerId: 'fake', model: 'fake-1', autoApply, maxSteps: 8 },
    ...(withUndo
      ? {
          undo: (): BatchResult => ({ ok: true, project, changes: ['reverted'], results: [] }),
        }
      : {}),
  };

  return { runtime, applied };
}

async function makeHarness(
  responses: FakeResponse[] | ((request: ChatRequest) => ChatResponse | Promise<ChatResponse>),
  autoApply = false,
): Promise<Harness> {
  const memory = new FileMemoryStore(root);
  await memory.saveBrand({
    id: 'acme',
    name: 'Acme',
    body: 'Warm and direct.',
    colors: ['#112233'],
    fonts: ['Inter'],
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const built = buildRuntime(autoApply);
  const provider = new FakeProvider(responses);
  const receipts = new FileReceiptStore(root);
  const agent = new Agent({
    runtime: built.runtime,
    provider,
    receipts,
    maxSteps: 8,
  });
  return { runtime: built.runtime, provider, receipts, applied: built.applied, agent } as Harness & {
    agent: Agent;
  };
}

async function collect(agent: Agent, input: string | AgentTurnInput): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of agent.run(typeof input === 'string' ? { text: input } : input)) {
    events.push(event);
  }
  return events;
}

describe('Agent', () => {
  it('runs a tool-call loop, applies commands and finishes with a message', async () => {
    const harness = await makeHarness(
      [
        {
          text: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'apply_commands',
              arguments: { commands: [{ op: 'trim_clip', clipId: 'clip-1', inMs: 500 }] },
            },
          ],
        },
        { text: 'Trimmed the intro.', toolCalls: [] },
      ],
      true,
    );
    const agent = new Agent({
      runtime: harness.runtime,
      provider: harness.provider,
      receipts: harness.receipts,
    });

    const events = await collect(agent, 'trim the first half second');

    expect(harness.applied).toHaveLength(1);
    expect(harness.applied[0]?.[0]?.op).toBe('trim_clip');

    const types = events.map((event) => event.type);
    expect(types).toContain('tool_start');
    expect(types).toContain('tool_end');
    expect(types).toContain('applied');
    expect(types.filter((type) => type === 'status').length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toEqual({ type: 'done', text: 'Trimmed the intro.' });
    expect(events.find((event) => event.type === 'message')).toMatchObject({
      type: 'message',
      text: 'Trimmed the intro.',
    });

    const firstRequest = harness.provider.requests[0];
    expect(firstRequest?.tools?.map((tool) => tool.name)).toContain('apply_commands');
    const prompt = firstRequest?.messages[0]?.content ?? '';
    expect(prompt).toContain('- fade');
    expect(prompt).toContain('Acme');
    expect(prompt).not.toContain('secret');
    expect(prompt).not.toContain('clip.mp4');

    const toolMessage = harness.provider.requests[1]?.messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('"ok":true');
    expect(toolMessage?.content).not.toContain('secret');
  });

  it('emits a proposal instead of applying when autoApply is off', async () => {
    const harness = await makeHarness(
      [
        {
          text: JSON.stringify([{ op: 'set_volume', clipId: 'clip-1', volume: 0.5 }]),
          toolCalls: [],
        },
      ],
      false,
    );
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, 'lower the volume');

    expect(harness.applied).toHaveLength(0);
    const proposal = events.find((event) => event.type === 'proposal');
    expect(proposal).toMatchObject({ type: 'proposal' });
    if (proposal?.type === 'proposal') {
      expect(proposal.commands[0]?.op).toBe('set_volume');
      expect(proposal.summary).toContain('set_volume');
    }
    expect(events.some((event) => event.type === 'applied')).toBe(false);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('applies text JSON when autoApply is on', async () => {
    const harness = await makeHarness(
      [
        {
          text: '```json\n[{"op":"trim_clip","clipId":"clip-1","inMs":100}]\n```',
          toolCalls: [],
        },
      ],
      true,
    );
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, 'trim it');

    expect(harness.applied).toHaveLength(1);
    expect(events.some((event) => event.type === 'applied')).toBe(true);
    expect(events.some((event) => event.type === 'proposal')).toBe(false);
    const done = events.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type === 'done') expect(done.text).toContain('Applied 1 edit');
  });

  it('keeps prose around a JSON proposal and strips the JSON block from the message', async () => {
    const harness = await makeHarness([
      {
        text: 'Here is the plan.\n```json\n[{"op":"set_volume","clipId":"clip-1","volume":0.5}]\n```',
        toolCalls: [],
      },
    ]);
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, 'quieter');
    const message = events.find((event) => event.type === 'message');
    expect(message?.type === 'message' ? message.text : '').toBe('Here is the plan.');
    expect(events.some((event) => event.type === 'proposal')).toBe(true);
  });

  it('surfaces clarify commands as a question without a proposal', async () => {
    const harness = await makeHarness([
      { text: '[{"op":"clarify","question":"Which clip should I trim?"}]', toolCalls: [] },
    ]);
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, 'trim it');
    expect(events.find((event) => event.type === 'message')).toMatchObject({
      type: 'message',
      text: 'Which clip should I trim?',
    });
    expect(events.some((event) => event.type === 'proposal')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'done', text: 'Which clip should I trim?' });
  });

  it('surfaces unsupported commands as a reason', async () => {
    const harness = await makeHarness([
      { text: '{"op":"unsupported","reason":"HDR grading is not supported."}', toolCalls: [] },
    ]);
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, 'grade HDR');
    expect(events.at(-1)).toEqual({
      type: 'done',
      text: 'HDR grading is not supported.',
    });
  });

  it('stops after ask_user and does not call the model again', async () => {
    const harness = await makeHarness([
      {
        text: '',
        toolCalls: [{ id: 'call_ask', name: 'ask_user', arguments: { question: 'Which clip?' } }],
      },
    ]);
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, 'make it better');

    expect(harness.provider.requests).toHaveLength(1);
    expect(events.find((event) => event.type === 'message')).toMatchObject({
      type: 'message',
      text: 'Which clip?',
    });
    expect(events.at(-1)).toEqual({ type: 'done', text: 'Which clip?' });
  });

  it('converts an apply_commands tool call into a proposal when autoApply is off', async () => {
    const harness = await makeHarness(
      [
        {
          text: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'apply_commands',
              arguments: { commands: [{ op: 'delete_clip', clipId: 'clip-1' }] },
            },
          ],
        },
      ],
      false,
    );
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, 'delete it');

    // The project is untouched: no runtime batch was applied and no event fired.
    expect(harness.applied).toHaveLength(0);
    expect(events.some((event) => event.type === 'applied')).toBe(false);
    const proposal = events.find((event) => event.type === 'proposal');
    expect(proposal?.type).toBe('proposal');
    if (proposal?.type === 'proposal') {
      expect(proposal.commands[0]?.op).toBe('delete_clip');
    }
    expect(events.at(-1)?.type).toBe('done');
    // apply_commands is not advertised to the model in proposal mode.
    const firstRequest = harness.provider.requests[0];
    expect(firstRequest?.tools?.map((tool) => tool.name)).not.toContain('apply_commands');
  });

  it('maps provider 401 errors to an error event', async () => {
    const harness = await makeHarness([
      new ProviderError('API key rejected (HTTP 401) by Fake provider.', { status: 401 }),
    ]);
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, 'edit');

    expect(events.find((event) => event.type === 'error')).toMatchObject({
      type: 'error',
    });
    const error = events.find((event) => event.type === 'error');
    expect(error?.type === 'error' ? error.message : '').toMatch(/API key rejected/);
    expect(events.at(-1)?.type).toBe('done');
    expect(events.some((event) => event.type === 'message')).toBe(false);
  });

  it('reports an empty provider response as EMPTY_RESPONSE', async () => {
    const empty: ChatResponse = { text: '   ', toolCalls: [] };
    const harness = await makeHarness([empty, empty, empty]);
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, 'edit');
    const error = events.find((event) => event.type === 'error');
    expect(error?.type === 'error' ? error.message : '').toMatch(/EMPTY_RESPONSE/);
  });

  it('stops at maxSteps when the model keeps calling tools', async () => {
    const harness = await makeHarness(() => ({
      text: '',
      toolCalls: [{ id: 'call_read', name: 'read_project', arguments: {} }],
    }));
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider, maxSteps: 2 });

    const events = await collect(agent, 'loop');

    expect(harness.provider.requests).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: 'done', text: 'Stopped after 2 steps.' });
    expect(events.filter((event) => event.type === 'status')).toHaveLength(2);
  });

  it('writes an agent_turn receipt for every turn', async () => {
    const harness = await makeHarness([{ text: 'All good.', toolCalls: [] }]);
    const agent = new Agent({
      runtime: harness.runtime,
      provider: harness.provider,
      receipts: harness.receipts,
    });

    await collect(agent, 'check the timeline');

    const receipts = await harness.receipts.readRecent(5);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.kind).toBe('agent_turn');
    expect(receipts[0]?.summary).toBe('All good.');
    expect(receipts[0]?.detail).toMatchObject({ providerId: 'fake', model: 'fake-1', steps: 1 });
  });

  it('supports the (runtime, provider, options) constructor form', async () => {
    const harness = await makeHarness([{ text: 'Hi.', toolCalls: [] }]);
    const agent = new Agent(harness.runtime, harness.provider, { receipts: harness.receipts });

    const events = await collect(agent, 'hello');
    expect(events.at(-1)).toEqual({ type: 'done', text: 'Hi.' });
  });

  it('passes the abort signal to the provider and stops before running tools', async () => {
    const controller = new AbortController();
    const harness = await makeHarness(() => {
      // The user hits Stop while the model is thinking; the tool call in the
      // response must never be executed.
      controller.abort();
      return {
        text: '',
        toolCalls: [{ id: 'call_read', name: 'read_project', arguments: {} }],
      };
    });
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, { text: 'read it', signal: controller.signal });

    expect(harness.provider.requests).toHaveLength(1);
    expect(harness.provider.requests[0]?.signal).toBe(controller.signal);
    expect(events.some((event) => event.type === 'tool_start')).toBe(false);
    expect(events.some((event) => event.type === 'tool_end')).toBe(false);
    expect(events.find((event) => event.type === 'error')).toMatchObject({
      type: 'error',
      message: 'Cancelled.',
    });
    expect(events.at(-1)?.type).toBe('done');
  });

  it('does not call the provider at all when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = await makeHarness([{ text: 'never', toolCalls: [] }]);
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, { text: 'edit', signal: controller.signal });

    expect(harness.provider.requests).toHaveLength(0);
    expect(events.find((event) => event.type === 'error')).toMatchObject({ message: 'Cancelled.' });
  });

  it('retries a retryable provider error once and succeeds', async () => {
    const harness = await makeHarness([
      new ProviderError('Rate limited (HTTP 429).', {
        status: 429,
        code: 'rate_limit',
        retryable: true,
        retryAfterMs: 1,
      }),
      { text: 'Recovered.', toolCalls: [] },
    ]);
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, 'edit');

    expect(harness.provider.requests).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: 'done', text: 'Recovered.' });
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });

  it('gives up after two retries on persistent retryable errors', async () => {
    const retryable = (): ProviderError =>
      new ProviderError('Provider unavailable (HTTP 503).', {
        status: 503,
        code: 'server',
        retryable: true,
        retryAfterMs: 1,
      });
    const harness = await makeHarness([retryable(), retryable(), retryable(), retryable()]);
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    const events = await collect(agent, 'edit');

    // One initial attempt plus at most two retries.
    expect(harness.provider.requests).toHaveLength(3);
    expect(events.find((event) => event.type === 'error')).toMatchObject({ type: 'error' });
  });

  it('caps a long conversation history while keeping tool call pairs intact', async () => {
    const history: ChatMessage[] = [];
    for (let index = 0; index < 32; index += 1) {
      history.push({ role: 'user', content: `request ${index}` });
      history.push({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: `call_${index}`, name: 'read_project', arguments: {} }],
      });
      history.push({
        role: 'tool',
        content: '{"ok":true}',
        toolCallId: `call_${index}`,
        name: 'read_project',
      });
    }
    for (let index = 0; index < 4; index += 1) {
      history.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: `tail ${index}` });
    }
    expect(history).toHaveLength(100);

    const harness = await makeHarness([{ text: 'Done.', toolCalls: [] }]);
    const agent = new Agent({ runtime: harness.runtime, provider: harness.provider });

    await collect(agent, { text: 'continue', history });

    const sent = harness.provider.requests[0]?.messages ?? [];
    const historyMessages = sent.slice(1, -1);
    expect(sent[0]?.role).toBe('system');
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'continue' });
    expect(historyMessages.length).toBeLessThanOrEqual(24);

    // Every tool result must still follow its assistant tool call.
    for (let index = 1; index < sent.length; index += 1) {
      const message = sent[index];
      if (message?.role !== 'tool') continue;
      const previous = sent[index - 1];
      expect(previous?.role).toBe('assistant');
      expect(previous?.toolCalls?.some((call) => call.id === message.toolCallId)).toBe(true);
    }
  });
});
