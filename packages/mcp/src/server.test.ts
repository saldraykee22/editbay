import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_TEXT_STYLE, createEmptyProject } from '@editbay/core';
import type { Project } from '@editbay/core';
import { isFfmpegAvailable, resolveFfmpeg, runCommand } from '@editbay/engine';
import { HeadlessStudio } from '@editbay/kit';
import { createEditbayServer } from './server';

type ToolReply = CallToolResult;

interface Harness {
  client: Client;
  server: McpServer;
  studio: HeadlessStudio;
  root: string;
}

interface ProjectPayload {
  name: string;
  canvas: { width: number; height: number; fps: number };
  durationMs: number;
  assets: Array<{ id: string; label: string; kind: string; durationMs: number }>;
  tracks: Array<{
    id: string;
    kind: string;
    clips: Array<{
      id: string;
      assetId: string;
      label: string;
      inMs: number;
      outMs: number;
      startMs: number;
      effects: Array<{ id: string; type: string }>;
    }>;
  }>;
  texts: Array<{ id: string; text: string; startMs: number; durationMs: number }>;
  summary: string;
}

const SEED_ASSET_ID = 'a_seed';
const SEED_CLIP_ID = 'c_seed';

const roots: string[] = [];
const harnesses: Harness[] = [];

function textOf(reply: ToolReply): string {
  const [first] = reply.content;
  if (!first || first.type !== 'text') throw new Error('expected a text content block');
  return first.text;
}

function jsonOf<T>(reply: ToolReply): T {
  return JSON.parse(textOf(reply)) as T;
}

/** A project written straight to disk, so `HeadlessStudio.open` reads real JSON. */
function seedProject(root: string): Project {
  const project = createEmptyProject('MCP seed');
  project.assets.push({
    id: SEED_ASSET_ID,
    kind: 'video',
    uri: join(root, 'assets', 'secret-clip.mp4'),
    label: 'Seed clip',
    durationMs: 4000,
    width: 320,
    height: 240,
    fps: 30,
    hasAudio: false,
    origin: 'imported',
  });

  const videoTrack = project.tracks.find((track) => track.kind === 'video');
  const textTrack = project.tracks.find((track) => track.kind === 'text');
  if (!videoTrack || !textTrack) throw new Error('empty project is missing expected tracks');

  videoTrack.clips.push({
    id: SEED_CLIP_ID,
    assetId: SEED_ASSET_ID,
    inMs: 500,
    outMs: 3000,
    effects: [],
  });
  textTrack.items.push({
    id: 't_seed',
    text: 'Hello',
    startMs: 0,
    durationMs: 1000,
    style: { ...DEFAULT_TEXT_STYLE },
  });
  return project;
}

async function createHarness(options: { seeded: boolean }): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'editbay-mcp-'));
  roots.push(root);

  const projectPath = join(root, 'project', 'editbay.json');
  await mkdir(dirname(projectPath), { recursive: true });
  if (options.seeded) {
    await writeFile(projectPath, JSON.stringify(seedProject(root)), 'utf8');
  }

  const studio = await HeadlessStudio.open({
    projectPath,
    workspaceRoot: join(root, 'workspace'),
    name: 'MCP test',
  });
  const server = createEditbayServer(studio);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'editbay-mcp-test', version: '0.0.0' });
  await client.connect(clientTransport);

  const harness: Harness = { client, server, studio, root };
  harnesses.push(harness);
  return harness;
}

async function call(harness: Harness, name: string, args: Record<string, unknown> = {}): Promise<ToolReply> {
  const reply = await harness.client.callTool({ name, arguments: args });
  return reply as unknown as ToolReply;
}

describe('editbay mcp server', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({ seeded: true });
  });

  it('lists every expected tool', async () => {
    const listed = await harness.client.listTools();
    const names = new Set(listed.tools.map((tool) => tool.name));
    expect(listed.tools.length).toBeGreaterThanOrEqual(15);
    for (const name of [
      'get_project',
      'apply_commands',
      'import_media',
      'probe_media',
      'undo',
      'redo',
      'export_video',
      'extract_frame',
      'list_effects',
      'list_skills',
      'read_skill',
      'write_skill',
      'remember',
      'search_memory',
      'get_brand',
      'save_brand',
      'get_help',
    ]) {
      expect(names.has(name), `missing tool ${name}`).toBe(true);
    }
    const applyTool = listed.tools.find((tool) => tool.name === 'apply_commands');
    expect(applyTool?.description).toContain('undoable');
  });

  it('returns a markdown cheat sheet from get_help', async () => {
    const reply = await call(harness, 'get_help');
    const text = textOf(reply);
    expect(reply.isError).toBeFalsy();
    expect(text).toContain('apply_commands');
    expect(text).toContain('trim_clip');
    expect(text).toContain('assetId');
    expect(text).toContain('Example batch');
  });

  it('reads a project without leaking asset paths', async () => {
    const reply = await call(harness, 'get_project');
    const raw = textOf(reply);
    const project = JSON.parse(raw) as ProjectPayload;

    expect(project.name).toBe('MCP seed');
    expect(project.canvas).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(project.assets).toHaveLength(1);
    expect(project.assets[0]?.label).toBe('Seed clip');
    expect(project.assets[0]?.kind).toBe('video');
    expect(project.durationMs).toBeGreaterThanOrEqual(2500);
    expect(project.texts).toHaveLength(1);
    expect(project.texts[0]?.text).toBe('Hello');

    const videoTrack = project.tracks.find((track) => track.kind === 'video');
    expect(videoTrack?.clips).toHaveLength(1);
    expect(videoTrack?.clips[0]?.id).toBe(SEED_CLIP_ID);
    expect(videoTrack?.clips[0]?.label).toBe('Seed clip');
    expect(videoTrack?.clips[0]?.inMs).toBe(500);
    expect(videoTrack?.clips[0]?.outMs).toBe(3000);
    expect(videoTrack?.clips[0]?.startMs).toBe(0);

    const summary = JSON.parse(project.summary) as { project: string; duration: number };
    expect(summary.project).toBe('MCP seed');
    expect(summary.duration).toBeGreaterThan(0);

    const escapedUri = JSON.stringify(join(harness.root, 'assets', 'secret-clip.mp4')).slice(1, -1);
    expect(raw).not.toContain(escapedUri);
    expect(raw).not.toContain('secret-clip.mp4');
    expect(raw).not.toContain('"uri"');
  });

  it('applies a text + trim batch through apply_commands', async () => {
    const reply = await call(harness, 'apply_commands', {
      commands: [
        { op: 'add_text', text: 'Second line', startMs: 1000, durationMs: 1500 },
        { op: 'trim_clip', clipId: SEED_CLIP_ID, inMs: 1000, outMs: 2500 },
      ],
    });
    expect(reply.isError).toBeFalsy();
    const payload = jsonOf<{
      ok: boolean;
      changes: string[];
      results: Array<{ ok: boolean; op: string }>;
      durationMs: number;
    }>(reply);
    expect(payload.ok).toBe(true);
    expect(payload.changes.length).toBeGreaterThan(0);
    expect(payload.results).toHaveLength(2);
    expect(payload.results.every((result) => result.ok)).toBe(true);
    expect(payload.results[1]?.op).toBe('trim_clip');
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);

    const project = jsonOf<ProjectPayload>(await call(harness, 'get_project'));
    expect(project.texts).toHaveLength(2);
    const clip = project.tracks.find((track) => track.kind === 'video')?.clips[0];
    expect(clip?.inMs).toBe(1000);
    expect(clip?.outMs).toBe(2500);
  });

  it('rejects an unknown op with an actionable tool error', async () => {
    const reply = await call(harness, 'apply_commands', { commands: [{ op: 'dance' }] });
    expect(reply.isError).toBe(true);
    expect(textOf(reply)).toContain('Unsupported command op: dance');
  });

  it('lists valid clip ids when a command targets a missing clip', async () => {
    const reply = await call(harness, 'apply_commands', {
      commands: [{ op: 'trim_clip', clipId: 'missing-clip', inMs: 0, outMs: 1000 }],
    });
    expect(reply.isError).toBe(true);
    const text = textOf(reply);
    expect(text).toContain('not found');
    expect(text).toContain(SEED_CLIP_ID);
  });

  it('undoes and redoes one batch', async () => {
    const undone = jsonOf<{ ok: boolean; durationMs: number }>(await call(harness, 'undo'));
    expect(undone.ok).toBe(true);
    expect(undone.durationMs).toBeGreaterThanOrEqual(0);
    const afterUndo = jsonOf<ProjectPayload>(await call(harness, 'get_project'));
    expect(afterUndo.texts).toHaveLength(1);

    const redone = jsonOf<{ ok: boolean }>(await call(harness, 'redo'));
    expect(redone.ok).toBe(true);
    const afterRedo = jsonOf<ProjectPayload>(await call(harness, 'get_project'));
    expect(afterRedo.texts).toHaveLength(2);
  });

  it('lists builtin effects and transitions', async () => {
    const payload = jsonOf<{
      effects: Array<{ id: string; name: string; params: Array<{ key: string }> }>;
      transitions: Array<{ id: string; defaultDurationMs: number }>;
    }>(await call(harness, 'list_effects'));
    expect(payload.effects.length).toBeGreaterThan(0);
    expect(payload.effects.some((effect) => effect.id === 'fade')).toBe(true);
    expect(payload.effects.some((effect) => effect.id === 'kenburns')).toBe(true);
    expect(payload.transitions.some((transition) => transition.id === 'fade')).toBe(true);
    const kenburns = payload.effects.find((effect) => effect.id === 'kenburns');
    expect(kenburns?.params.length).toBeGreaterThan(0);
  });

  it('writes, lists and reads a skill', async () => {
    const written = jsonOf<{ ok: boolean; id: string }>(
      await call(harness, 'write_skill', {
        id: 'mcp-test-skill',
        name: 'MCP test skill',
        description: 'Shows up in tests.',
        triggers: ['mcp', 'test'],
        body: '# Steps\n\n1. Call get_project.\n2. Trim the hook.',
      }),
    );
    expect(written.ok).toBe(true);
    expect(written.id).toBe('mcp-test-skill');

    const listed = jsonOf<{ skills: Array<{ id: string; triggers: string[] }> }>(await call(harness, 'list_skills'));
    const found = listed.skills.find((skill) => skill.id === 'mcp-test-skill');
    expect(found).toBeDefined();
    expect(found?.triggers).toContain('mcp');

    const read = jsonOf<{ id: string; body: string; description: string }>(
      await call(harness, 'read_skill', { id: 'mcp-test-skill' }),
    );
    expect(read.id).toBe('mcp-test-skill');
    expect(read.description).toBe('Shows up in tests.');
    expect(read.body).toContain('Trim the hook');
  });

  it('reports missing skills with the valid ids', async () => {
    const reply = await call(harness, 'read_skill', { id: 'does-not-exist' });
    expect(reply.isError).toBe(true);
    expect(textOf(reply)).toContain('mcp-test-skill');
  });

  it('stores and searches memory notes', async () => {
    const remembered = jsonOf<{ ok: boolean; id: string; title: string }>(
      await call(harness, 'remember', {
        title: 'MCP memory test',
        body: 'The brand accent is teal.',
        tags: ['brand', 'color'],
      }),
    );
    expect(remembered.ok).toBe(true);
    expect(remembered.title).toBe('MCP memory test');

    const found = jsonOf<{ entries: Array<{ title: string; body: string }> }>(
      await call(harness, 'search_memory', { query: 'teal' }),
    );
    expect(found.entries.length).toBeGreaterThan(0);
    expect(found.entries[0]?.title).toBe('MCP memory test');
    expect(found.entries[0]?.body).toContain('teal');
  });

  it('round-trips a brand profile', async () => {
    const missing = await call(harness, 'get_brand', { id: 'acme-test' });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('Brand not found');

    const saved = jsonOf<{ ok: boolean; id: string }>(
      await call(harness, 'save_brand', {
        id: 'acme-test',
        name: 'Acme',
        body: 'Bold, warm, direct.',
        colors: ['#0E1F1A', '#46E0B0'],
        fonts: ['IBM Plex Sans'],
      }),
    );
    expect(saved.ok).toBe(true);

    const brand = jsonOf<{ name: string; colors: string[]; fonts: string[]; body: string }>(
      await call(harness, 'get_brand', { id: 'acme-test' }),
    );
    expect(brand.name).toBe('Acme');
    expect(brand.colors).toEqual(['#0E1F1A', '#46E0B0']);
    expect(brand.fonts).toEqual(['IBM Plex Sans']);
    expect(brand.body).toContain('warm');
  });

  it('returns a tool error when probing a missing file', async () => {
    const reply = await call(harness, 'probe_media', { path: join(harness.root, 'missing.mp4') });
    expect(reply.isError).toBe(true);
    expect(textOf(reply)).toContain('Could not probe');
  });
});

const ffmpegAvailable = isFfmpegAvailable();
const ffmpegSuite = ffmpegAvailable ? describe : describe.skip;

ffmpegSuite('editbay mcp server (real ffmpeg)', () => {
  let harness: Harness;
  let clipPath: string;
  let importedAssetId = '';

  beforeAll(async () => {
    harness = await createHarness({ seeded: false });
    clipPath = join(harness.root, 'media', 'clip.mp4');
    await mkdir(dirname(clipPath), { recursive: true });
    const result = await runCommand(
      resolveFfmpeg(),
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=160x120:r=15:d=1',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=1',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-shortest',
        clipPath,
      ],
      { timeoutMs: 60_000 },
    );
    if (result.code !== 0) throw new Error(`fixture ffmpeg failed: ${result.stderr.slice(-1000)}`);
  });

  it('imports a generated clip and exposes ids without the path', async () => {
    const reply = await call(harness, 'import_media', { paths: [clipPath] });
    expect(reply.isError).toBeFalsy();
    const payload = jsonOf<{
      imported: Array<{ assetId: string; clipId?: string; label: string; kind: string; durationMs: number }>;
    }>(reply);
    expect(payload.imported).toHaveLength(1);
    const entry = payload.imported[0];
    expect(entry?.assetId).toBeTruthy();
    expect(entry?.clipId).toBeTruthy();
    expect(entry?.kind).toBe('video');
    expect(entry?.label).toBe('clip.mp4');
    expect(entry?.durationMs).toBeGreaterThan(0);
    importedAssetId = entry?.assetId ?? '';

    const raw = textOf(await call(harness, 'get_project'));
    const escaped = JSON.stringify(clipPath).slice(1, -1);
    expect(raw).not.toContain(escaped);
    expect(raw).not.toContain('"uri"');
  });

  it('probes the imported file', async () => {
    const probe = jsonOf<{ width?: number; height?: number; hasAudio: boolean; durationMs: number }>(
      await call(harness, 'probe_media', { path: clipPath }),
    );
    expect(probe.width).toBe(160);
    expect(probe.height).toBe(120);
    expect(probe.hasAudio).toBe(true);
    expect(probe.durationMs).toBeGreaterThan(0);
  });

  it('extracts a frame to disk', async () => {
    const outPath = join(harness.root, 'frames', 'still.jpg');
    const reply = await call(harness, 'extract_frame', { assetId: importedAssetId, atMs: 100, outPath });
    expect(reply.isError).toBeFalsy();
    const payload = jsonOf<{ outPath: string }>(reply);
    expect(payload.outPath).toBe(outPath);
    expect(existsSync(outPath)).toBe(true);
    const info = await stat(outPath);
    expect(info.size).toBeGreaterThan(0);
  });

  it('exports a draft mp4', async () => {
    const canvas = await call(harness, 'apply_commands', {
      commands: [{ op: 'set_canvas', width: 320, height: 240, fps: 15 }],
    });
    expect(canvas.isError).toBeFalsy();

    const outPath = join(harness.root, 'out', 'export.mp4');
    const reply = await call(harness, 'export_video', { outPath, quality: 'draft' });
    expect(reply.isError).toBeFalsy();
    const payload = jsonOf<{ outPath: string; sizeBytes: number; durationMs: number; elapsedMs: number }>(reply);
    expect(payload.outPath).toBe(outPath);
    expect(payload.sizeBytes).toBeGreaterThan(0);
    expect(payload.durationMs).toBeGreaterThan(0);
    expect(payload.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(existsSync(outPath)).toBe(true);
  });
});

afterAll(async () => {
  for (const entry of harnesses) {
    await entry.client.close();
    await entry.server.close();
  }
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
