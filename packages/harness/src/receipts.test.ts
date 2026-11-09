import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createReceipt, FileReceiptStore } from './receipts-node';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'editbay-receipts-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('receipts', () => {
  it('creates a receipt with a generated id and timestamp', () => {
    const receipt = createReceipt({ kind: 'agent_turn', summary: 'Trimmed the intro' });
    expect(receipt.id).toMatch(/^rcp_/);
    expect(Date.parse(receipt.at)).not.toBeNaN();
    expect(receipt.kind).toBe('agent_turn');
    expect(receipt.summary).toBe('Trimmed the intro');
  });

  it('honours explicit id, timestamp and detail', () => {
    const receipt = createReceipt({
      id: 'fixed',
      at: '2026-03-04T10:00:00.000Z',
      kind: 'command_batch',
      summary: 'Batch',
      detail: { count: 2 },
    });
    expect(receipt).toEqual({
      id: 'fixed',
      at: '2026-03-04T10:00:00.000Z',
      kind: 'command_batch',
      summary: 'Batch',
      detail: { count: 2 },
    });
  });

  it('appends JSONL to the UTC day file', async () => {
    const store = new FileReceiptStore(root);
    await store.record({
      kind: 'memory_write',
      summary: 'Saved a note',
      at: '2026-03-04T23:59:00.000Z',
    });

    const file = path.join(root, 'receipts', '2026-03-04.jsonl');
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed: unknown = JSON.parse(lines[0] ?? '');
    expect(parsed).toMatchObject({ kind: 'memory_write', summary: 'Saved a note' });
  });

  it('reads recent receipts newest first across days', async () => {
    const store = new FileReceiptStore(root);
    await store.record({ kind: 'agent_turn', summary: 'old', at: '2026-03-04T09:00:00.000Z' });
    await store.record({ kind: 'agent_turn', summary: 'middle', at: '2026-03-05T09:00:00.000Z' });
    await store.record({ kind: 'agent_turn', summary: 'new', at: '2026-03-05T10:00:00.000Z' });

    const recent = await store.readRecent(3);
    expect(recent.map((item) => item.summary)).toEqual(['new', 'middle', 'old']);
    expect(await store.readRecent(1)).toHaveLength(1);
  });

  it('reads a single day and skips corrupt lines', async () => {
    const store = new FileReceiptStore(root);
    await mkdir(path.join(root, 'receipts'), { recursive: true });
    await writeFile(
      path.join(root, 'receipts', '2026-03-06.jsonl'),
      ['{not json', JSON.stringify({ id: 'ok', at: '2026-03-06T00:00:00.000Z', kind: 'export', summary: 'ok' }), ''].join('\n'),
      'utf8',
    );

    const day = await store.readDay('2026-03-06');
    expect(day).toHaveLength(1);
    expect(day[0]?.id).toBe('ok');
    expect(await store.readRecent()).toHaveLength(1);
  });

  it('returns an empty log for a missing folder', async () => {
    const store = new FileReceiptStore(root);
    expect(await store.readRecent()).toEqual([]);
    expect(await store.readDay('2026-01-01')).toEqual([]);
  });

  it('rejects invalid timestamps', () => {
    expect(() => createReceipt({ kind: 'export', summary: 'x', at: 'not-a-date' })).not.toThrow();
    const store = new FileReceiptStore(root);
    expect(() => store.filePathFor('not-a-date')).toThrow(/Invalid receipt timestamp/);
  });
});
