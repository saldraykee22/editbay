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
import type { EffectCatalog } from '@editbay/effects';
import type { AgentRuntime, ToolCall } from './types';
import { FileMemoryStore } from './memory';
import { FileSkillStore } from './skills';
import { NodeWorkspace } from './workspace';
import {
  buildToolSpecs,
  executeTool,
  safeProject,
  type ToolContext,
} from './tools';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'editbay-tools-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const project: Project = {
  schemaVersion: 2,
  id: 'p1',
  name: 'Demo',
  canvas: { width: 1080, height: 1920, fps: 30 },
  assets: [
    {
      id: 'asset-1',
      kind: 'video',
      uri: 'C:\\secret\\clip.mp4',
      thumbnailUri: 'C:\\secret\\thumb.jpg',
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

function success(command: AgentCommand): ApplyResult {
  return {
    ok: true,
    command: command as EditCommand,
    project,
    changes: ['changed'],
    createdIds: {},
  };
}

function makeRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  const effects = {
    effects: [
      {
        id: 'fade',
        name: 'Fade',
        category: 'motion',
        description: 'Fade in.',
        params: [{ key: 'duration', label: 'Duration', type: 'number', default: 500, min: 0, max: 4000 }],
        builtin: true,
      },
    ],
    transitions: [
      { id: 'crossfade', name: 'Crossfade', description: 'Dissolve.', defaultDurationMs: 400 },
    ],
  } as unknown as EffectCatalog;

  return {
    project: () => project,
    applyCommands: (commands) => ({
      ok: true,
      project,
      changes: ['changed'],
      results: commands.map((command) => success(command)),
    }),
    workspace: new NodeWorkspace(root),
    skills: new FileSkillStore({ root }),
    memory: new FileMemoryStore(root),
    effects,
    settings: { providerId: 'fake', model: 'fake-1' },
    ...overrides,
  };
}

function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `call_${name}`, name, arguments: args };
}

describe('tool specs', () => {
  it('exposes all required tools with unique names', () => {
    const specs = buildToolSpecs();
    const names = specs.map((spec) => spec.name);
    expect(names).toEqual([
      'read_project',
      'list_assets',
      'apply_commands',
      'undo',
      'search_memory',
      'remember',
      'list_skills',
      'read_skill',
      'write_skill',
      'list_effects',
      'ask_user',
    ]);
    expect(new Set(names).size).toBe(names.length);
    for (const spec of specs) {
      expect(spec.description.length).toBeGreaterThan(10);
      expect(spec.parameters).toHaveProperty('type', 'object');
    }
  });

  it('omits apply_commands from the model tools in proposal mode', () => {
    const auto = buildToolSpecs({ autoApply: true }).map((spec) => spec.name);
    const proposal = buildToolSpecs({ autoApply: false }).map((spec) => spec.name);

    expect(auto).toContain('apply_commands');
    expect(proposal).not.toContain('apply_commands');
    expect(proposal).toContain('read_project');
  });

  it('never advertises overlay tracks to the model', () => {
    for (const spec of buildToolSpecs()) {
      expect(spec.description.toLowerCase()).not.toContain('overlay');
      expect(JSON.stringify(spec.parameters).toLowerCase()).not.toContain('overlay');
    }
    expect(buildToolSpecs().map((spec) => spec.name)).not.toContain('add_track');
  });
});

describe('read tools', () => {
  it('read_project returns state without asset URIs', async () => {
    const result = await executeTool(call('read_project'), { runtime: makeRuntime() });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Demo');
    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('clip.mp4');
    expect(serialized).toContain('Hero');
  });

  it('list_assets exposes labels but never URIs or thumbnails', async () => {
    const result = await executeTool(call('list_assets'), { runtime: makeRuntime() });
    expect(result.ok).toBe(true);
    const data = result.data as { assets: Array<Record<string, unknown>> };
    expect(data.assets[0]?.label).toBe('Hero');
    expect(data.assets[0]).not.toHaveProperty('uri');
    expect(data.assets[0]).not.toHaveProperty('thumbnailUri');
  });

  it('safeProject keeps tracks and strips paths', () => {
    const safe = safeProject(project);
    expect(safe).not.toHaveProperty('assets.0.uri');
    expect(JSON.stringify(safe)).not.toContain('secret');
    expect(JSON.stringify(safe)).toContain('clip-1');
  });
});

describe('apply_commands', () => {
  it('applies commands and returns per-command results', async () => {
    let captured: AgentCommand[] = [];
    const runtime = makeRuntime({
      applyCommands: (commands) => {
        captured = commands;
        return {
          ok: true,
          project,
          changes: ['trimmed'],
          results: commands.map((command) => success(command)),
        };
      },
    });

    const result = await executeTool(
      call('apply_commands', {
        commands: [
          { op: 'trim_clip', clipId: 'clip-1', inMs: 500 },
          { op: 'set_volume', clipId: 'clip-1', volume: 0.8 },
        ],
      }),
      { runtime },
    );

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(2);
    expect(captured[0]?.op).toBe('trim_clip');
    expect(result.summary).toBe('Applied 2 commands.');
    const data = result.data as { results: Array<Record<string, unknown>> };
    expect(data.results).toHaveLength(2);
    expect(data.results[0]?.ok).toBe(true);
    expect(result.applied).toHaveLength(2);
  });

  it('returns per-command errors without throwing or aborting', async () => {
    const runtime = makeRuntime({
      applyCommands: (commands) => ({
        ok: false,
        project,
        changes: [],
        results: commands.map((command, index) =>
          index === 0
            ? success(command)
            : {
                ok: false,
                command: command as EditCommand,
                error: { code: 'not_found', message: 'clip missing' },
              },
        ),
      }),
    });

    const result = await executeTool(
      call('apply_commands', {
        commands: [
          { op: 'trim_clip', clipId: 'clip-1', inMs: 0 },
          { op: 'delete_clip', clipId: 'missing' },
        ],
      }),
      { runtime },
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('1 failed');
    const data = result.data as { results: Array<Record<string, unknown>> };
    expect(data.results[1]?.ok).toBe(false);
    expect((data.results[1]?.error as { message?: string }).message).toBe('clip missing');
  });

  it('fails cleanly when the runtime is missing', async () => {
    const result = await executeTool(
      call('apply_commands', { commands: [{ op: 'undo' }] }),
      {} satisfies ToolContext,
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/runtime is not available/);
  });

  it('rejects malformed command arrays', async () => {
    const result = await executeTool(
      call('apply_commands', { commands: [{ nope: true }] }),
      { runtime: makeRuntime() },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/string "op"/);
  });

  it('refuses to mutate the project in proposal mode', async () => {
    let applied = 0;
    const runtime = makeRuntime({
      applyCommands: (commands) => {
        applied += 1;
        return {
          ok: true,
          project,
          changes: [],
          results: commands.map((command) => success(command)),
        };
      },
      settings: { providerId: 'fake', model: 'fake-1', autoApply: false },
    });

    const result = await executeTool(
      call('apply_commands', { commands: [{ op: 'delete_clip', clipId: 'clip-1' }] }),
      { runtime },
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/Proposal mode/);
    expect(applied).toBe(0);
  });

  it('reports how many commands were skipped when the batch stops early', async () => {
    const runtime = makeRuntime({
      applyCommands: (commands) => ({
        ok: false,
        project,
        changes: ['changed'],
        results: commands.slice(0, 2).map((command, index) =>
          index === 0
            ? success(command)
            : {
                ok: false,
                command: command as EditCommand,
                error: { code: 'not_found', message: 'clip missing' },
              },
        ),
      }),
    });

    const result = await executeTool(
      call('apply_commands', {
        commands: [
          { op: 'trim_clip', clipId: 'clip-1', inMs: 0 },
          { op: 'delete_clip', clipId: 'missing' },
          { op: 'set_volume', clipId: 'clip-1', volume: 0.5 },
        ],
      }),
      { runtime },
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/skipped/);
    const data = result.data as { skipped?: number; results: unknown[] };
    expect(data.skipped).toBe(1);
    expect(data.results).toHaveLength(2);
  });
});

describe('undo', () => {
  it('reports unavailable undo', async () => {
    const result = await executeTool(call('undo'), { runtime: makeRuntime() });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/not available/);
  });

  it('calls the runtime undo when present', async () => {
    const batch: BatchResult = {
      ok: true,
      project,
      changes: ['reverted'],
      results: [success({ op: 'trim_clip', clipId: 'clip-1' })],
    };
    const runtime = {
      ...makeRuntime(),
      undo: () => batch,
    } as AgentRuntime & { undo: () => BatchResult };

    const result = await executeTool(call('undo'), { runtime });
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/Undid/);
    expect(result.data).toMatchObject({ ok: true });
  });
});

describe('memory and skills tools', () => {
  it('remembers and searches notes', async () => {
    const runtime = makeRuntime();
    const saved = await executeTool(
      call('remember', {
        title: 'Launch color',
        body: 'Teal is only for CTAs.',
        tags: ['color'],
      }),
      { runtime },
    );
    expect(saved.ok).toBe(true);

    const found = await executeTool(call('search_memory', { query: 'teal' }), { runtime });
    expect(found.ok).toBe(true);
    const data = found.data as { entries: Array<{ title: string }> };
    expect(data.entries[0]?.title).toBe('Launch color');
  });

  it('saves, lists and reads skills', async () => {
    const runtime = makeRuntime();
    const saved = await executeTool(
      call('write_skill', {
        id: 'punch-in',
        name: 'Punch in',
        description: 'Add a subtle punch-in.',
        triggers: ['punch in'],
        body: 'Scale to 1.08 for 400ms.',
      }),
      { runtime },
    );
    expect(saved.ok).toBe(true);

    const list = await executeTool(call('list_skills'), { runtime });
    const listData = list.data as { skills: Array<{ id: string }> };
    expect(listData.skills.map((skill) => skill.id)).toContain('punch-in');

    const read = await executeTool(call('read_skill', { id: 'punch-in' }), { runtime });
    expect(read.ok).toBe(true);
    expect((read.data as { body: string }).body).toContain('Scale to 1.08');
  });

  it('errors on unknown skill ids', async () => {
    const result = await executeTool(call('read_skill', { id: 'missing' }), {
      runtime: makeRuntime(),
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/Skill not found/);
  });
});

describe('effects and clarification', () => {
  it('lists effect ids and params', async () => {
    const result = await executeTool(call('list_effects'), { runtime: makeRuntime() });
    expect(result.ok).toBe(true);
    const data = result.data as {
      effects: Array<{ id: string; params: Array<{ key: string }> }>;
      transitions: Array<{ id: string }>;
    };
    expect(data.effects[0]?.id).toBe('fade');
    expect(data.effects[0]?.params[0]?.key).toBe('duration');
    expect(data.transitions[0]?.id).toBe('crossfade');
  });

  it('ask_user returns a clarification signal', async () => {
    const result = await executeTool(call('ask_user', { question: 'Which clip?' }), {
      runtime: makeRuntime(),
    });
    expect(result.ok).toBe(true);
    expect(result.clarification).toBe('Which clip?');
  });

  it('returns a readable error for unknown tools', async () => {
    const result = await executeTool(call('teleport'), { runtime: makeRuntime() });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/Unknown tool/);
  });
});
