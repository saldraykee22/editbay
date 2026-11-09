import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeWithRetry } from './export';

describe('removeWithRetry', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'editbay-remove-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('removes a temp file', async () => {
    const file = path.join(dir, 'out.mp4.tmp-abc.mp4');
    await writeFile(file, 'partial');
    await removeWithRetry(file);
    expect(await readdir(dir)).toEqual([]);
  });

  it('tolerates a missing target', async () => {
    await expect(removeWithRetry(path.join(dir, 'missing.mp4'))).resolves.toBeUndefined();
  });

  it('removes a text temp directory recursively', async () => {
    const nested = path.join(dir, 'editbay-export-text');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, 'editbay-text-0.txt'), 'hello');
    await removeWithRetry(nested, { recursive: true });
    expect(await readdir(dir)).toEqual([]);
  });
});
