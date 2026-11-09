import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '@editbay/core';
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

describe('captions CLI command', () => {
  let dir: string;
  let projectPath: string;
  let workspace: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'editbay-cli-captions-'));
    projectPath = path.join(dir, 'editbay.json');
    workspace = path.join(dir, '.editbay');
    // Initialize project
    const initCap = capture();
    await run(['init', '--project', projectPath, '--workspace', workspace], initCap.io);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('imports an SRT file and adds captions to the text track', async () => {
    const srtPath = path.join(dir, 'subs.srt');
    await writeFile(
      srtPath,
      `1\n00:00:01,000 --> 00:00:03,000\nHello World\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond Cue\n`,
      'utf8',
    );

    const cap = capture();
    const code = await run(['captions', srtPath, '--project', projectPath, '--workspace', workspace], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('imported 2 captions');

    const project = JSON.parse(await readFile(projectPath, 'utf8')) as Project;
    const textTrack = project.tracks.find((t) => t.kind === 'text');
    expect(textTrack?.items).toHaveLength(2);
    expect(textTrack?.items[0]?.text).toBe('Hello World');
    expect(textTrack?.items[0]?.startMs).toBe(1000);
    expect(textTrack?.items[1]?.text).toBe('Second Cue');
  });

  it('supports --offset and --json output', async () => {
    const vttPath = path.join(dir, 'subs.vtt');
    await writeFile(
      vttPath,
      `WEBVTT\n\n00:01.000 --> 00:03.000\nVTT Cue One\n\n00:04.000 --> 00:06.000\nVTT Cue Two\n`,
      'utf8',
    );

    const cap = capture();
    const code = await run(
      ['captions', vttPath, '--offset', '1500', '--json', '--project', projectPath, '--workspace', workspace],
      cap.io,
    );
    expect(code).toBe(0);
    const json = JSON.parse(cap.stdout()) as { added: number; warnings: string[] };
    expect(json.added).toBe(2);
    expect(json.warnings).toEqual([]);

    const project = JSON.parse(await readFile(projectPath, 'utf8')) as Project;
    const textTrack = project.tracks.find((t) => t.kind === 'text');
    expect(textTrack?.items[0]?.startMs).toBe(2500);
    expect(textTrack?.items[1]?.startMs).toBe(5500);
  });

  it('undo reverts all imported captions in one step', async () => {
    const srtPath = path.join(dir, 'subs.srt');
    await writeFile(
      srtPath,
      `1\n00:00:01,000 --> 00:00:03,000\nCue 1\n\n2\n00:00:04,000 --> 00:00:06,000\nCue 2\n`,
      'utf8',
    );

    const cap1 = capture();
    await run(['captions', srtPath, '--project', projectPath, '--workspace', workspace], cap1.io);

    const capUndo = capture();
    const undoCode = await run(['undo', '--project', projectPath, '--workspace', workspace], capUndo.io);
    expect(undoCode).toBe(0);

    const project = JSON.parse(await readFile(projectPath, 'utf8')) as Project;
    const textTrack = project.tracks.find((t) => t.kind === 'text');
    expect(textTrack?.items).toHaveLength(0);
  });

  it('fails gracefully when file argument is missing or does not exist', async () => {
    const cap1 = capture();
    const code1 = await run(['captions', '--project', projectPath, '--workspace', workspace], cap1.io);
    expect(code1).toBe(1);
    expect(cap1.stderr()).toContain('captions needs a subtitle file');

    const cap2 = capture();
    const code2 = await run(
      ['captions', path.join(dir, 'missing.srt'), '--project', projectPath, '--workspace', workspace],
      cap2.io,
    );
    expect(code2).toBe(1);
    expect(cap2.stderr()).toContain('Caption file not found');
  });
});
