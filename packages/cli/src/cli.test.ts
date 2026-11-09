import { describe, expect, it } from 'vitest';
import { run, type CliIo } from './cli';

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

describe('editbay cli surface', () => {
  it('prints help with no arguments and with --help', async () => {
    const bare = capture();
    expect(await run([], bare.io)).toBe(0);
    expect(bare.stdout()).toContain('Usage');

    const flagged = capture();
    expect(await run(['--help'], flagged.io)).toBe(0);
    expect(flagged.stdout()).toContain('apply --json');
    expect(flagged.stdout()).toContain('--workspace <dir>');
    expect(flagged.stderr()).toBe('');
  });

  it('prints the version and the JSON form', async () => {
    const human = capture();
    expect(await run(['version'], human.io)).toBe(0);
    expect(human.stdout().trim()).toMatch(/^editbay \d+\.\d+\.\d+/);

    const json = capture();
    expect(await run(['version', '--json'], json.io)).toBe(0);
    const parsed = JSON.parse(json.stdout()) as { name: string; version: string };
    expect(parsed.name).toBe('editbay');
    expect(parsed.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exits 1 for an unknown command', async () => {
    const cap = capture();
    expect(await run(['nonsense'], cap.io)).toBe(1);
    expect(cap.stderr()).toContain('unknown command');
    expect(cap.stdout()).toBe('');
  });

  it('exits 1 for unknown flags', async () => {
    const cap = capture();
    expect(await run(['summary', '--explode'], cap.io)).toBe(1);
    expect(cap.stderr()).toContain('editbay:');
  });
});
