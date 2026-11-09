import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, type CliIo } from '../cli';

interface Captured {
  io: CliIo;
  stdout: () => string;
  stderr: () => string;
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (text: string): void => {
        out.push(text);
      },
      err: (text: string): void => {
        err.push(text);
      },
    },
    stdout: (): string => out.join(''),
    stderr: (): string => err.join(''),
  };
}

describe('effects command', () => {
  let dir: string;
  let projectPath: string;
  let workspace: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'editbay-cli-effects-'));
    projectPath = path.join(dir, 'editbay.json');
    workspace = path.join(dir, '.editbay');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const baseArgs = (): string[] => ['--project', projectPath, '--workspace', workspace];

  it('lists at least ten effects as JSON', async () => {
    const cap = capture();
    expect(await run(['effects', '--json', ...baseArgs()], cap.io)).toBe(0);
    const catalog = JSON.parse(cap.stdout()) as {
      effects: Array<{ id: string; name: string; category: string; params: unknown[] }>;
      transitions: Array<{ id: string }>;
    };
    expect(catalog.effects.length).toBeGreaterThanOrEqual(10);
    const ids = catalog.effects.map((effect) => effect.id);
    expect(ids).toContain('fade');
    expect(ids).toContain('kenburns');
    expect(ids).toContain('zoom-punch');
    expect(catalog.transitions.length).toBeGreaterThanOrEqual(1);
    expect(cap.stderr()).toBe('');
  });

  it('prints a human readable catalog', async () => {
    const cap = capture();
    expect(await run(['effects', ...baseArgs()], cap.io)).toBe(0);
    expect(cap.stdout()).toContain('effects (');
    expect(cap.stdout()).toContain('fade');
    expect(cap.stdout()).toContain('transitions (');
  });
});
