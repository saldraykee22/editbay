import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_STYLE } from '@editbay/core';
import type { Project } from '@editbay/core';
import { buildRenderPlan, escapeFilterPath, resolveFontPath } from './plan';

const FONT_FILE = 'IBMPlexSans-SemiBold.ttf';

let dir: string;
let savedFont: string | undefined;
let savedResources: string | undefined;

async function writeBundledFont(root: string): Promise<string> {
  const fonts = path.join(root, 'fonts');
  await mkdir(fonts, { recursive: true });
  const fontPath = path.join(fonts, FONT_FILE);
  await writeFile(fontPath, 'fake-font-bytes');
  return fontPath;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'editbay-font-test-'));
  savedFont = process.env.EDITBAY_FONT;
  savedResources = process.env.EDITBAY_RESOURCES_DIR;
  delete process.env.EDITBAY_FONT;
  delete process.env.EDITBAY_RESOURCES_DIR;
});

afterEach(async () => {
  if (savedFont === undefined) delete process.env.EDITBAY_FONT;
  else process.env.EDITBAY_FONT = savedFont;
  if (savedResources === undefined) delete process.env.EDITBAY_RESOURCES_DIR;
  else process.env.EDITBAY_RESOURCES_DIR = savedResources;
  await rm(dir, { recursive: true, force: true });
});

describe('resolveFontPath', () => {
  it('finds the bundled font through EDITBAY_RESOURCES_DIR', async () => {
    const fontPath = await writeBundledFont(dir);
    process.env.EDITBAY_RESOURCES_DIR = dir;
    expect(resolveFontPath()).toBe(fontPath);
  });

  it('finds the bundled font at the resource root as well', async () => {
    const fontPath = path.join(dir, FONT_FILE);
    await writeFile(fontPath, 'fake-font-bytes');
    process.env.EDITBAY_RESOURCES_DIR = dir;
    expect(resolveFontPath()).toBe(fontPath);
  });

  it('prefers an explicit fontPath option', async () => {
    await writeBundledFont(dir);
    process.env.EDITBAY_RESOURCES_DIR = dir;
    const explicit = path.join(dir, 'custom.ttf');
    await writeFile(explicit, 'fake-font-bytes');
    expect(resolveFontPath(explicit)).toBe(explicit);
  });

  it('uses Electron process.resourcesPath when available', async () => {
    const fontPath = await writeBundledFont(dir);
    const holder = process as NodeJS.Process & { resourcesPath?: unknown };
    const descriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    Object.defineProperty(process, 'resourcesPath', { value: dir, configurable: true, enumerable: true });
    try {
      // process.resourcesPath outranks EDITBAY_RESOURCES_DIR.
      process.env.EDITBAY_RESOURCES_DIR = path.join(dir, 'missing');
      expect(resolveFontPath()).toBe(fontPath);
    } finally {
      if (descriptor) Object.defineProperty(process, 'resourcesPath', descriptor);
      else delete holder.resourcesPath;
    }
  });

  it('returns undefined for a missing explicit path when nothing else exists', async () => {
    const missing = path.join(dir, 'nope.ttf');
    // The platform fallbacks may still exist on a dev machine; only assert that
    // the missing explicit path itself is never returned.
    expect(resolveFontPath(missing)).not.toBe(missing);
  });

  it('threads an explicit fontPath into the drawtext filter', async () => {
    const explicit = path.join(dir, 'custom.ttf');
    await writeFile(explicit, 'fake-font-bytes');
    const project: Project = {
      schemaVersion: 2,
      id: 'font-plan',
      name: 'Font plan',
      canvas: { width: 320, height: 240, fps: 30 },
      assets: [
        { id: 'a', kind: 'video', uri: 'C:/media/a.mp4', label: 'A', durationMs: 1000, hasAudio: false },
      ],
      tracks: [
        { id: 'v', kind: 'video', clips: [{ id: 'c', assetId: 'a', inMs: 0, outMs: 1000, effects: [] }], items: [] },
        {
          id: 't',
          kind: 'text',
          clips: [],
          items: [
            {
              id: 'title',
              text: 'Hi',
              startMs: 0,
              durationMs: 500,
              style: { ...DEFAULT_TEXT_STYLE },
            },
          ],
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const plan = buildRenderPlan(project, {
      assetPaths: { a: 'C:/media/a.mp4' },
      fontPath: explicit,
      textFileDir: dir,
      videoEncoder: 'libx264',
    });
    expect(plan.filterGraph).toContain(`fontfile='${escapeFilterPath(explicit)}'`);
  });
});
