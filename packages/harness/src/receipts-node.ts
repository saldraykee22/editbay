import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Receipt } from './types';
import { createReceipt, type CreateReceiptInput } from './receipts';

export { createReceipt };
export type { CreateReceiptInput };

/**
 * Append-only JSONL receipt log, one file per UTC day:
 *   <root>/receipts/YYYY-MM-DD.jsonl
 *
 * Node-only. The renderer uses its workspace bridge instead.
 */
export class FileReceiptStore {
  readonly root: string;
  private readonly receiptsDir: string;

  constructor(root: string) {
    if (typeof root !== 'string' || root.trim() === '') {
      throw new Error('ReceiptStore requires a workspace root');
    }
    this.root = path.resolve(root);
    this.receiptsDir = path.join(this.root, 'receipts');
  }

  filePathFor(at: string): string {
    return path.join(this.receiptsDir, `${receiptDay(at)}.jsonl`);
  }

  async append(receipt: Receipt): Promise<void> {
    await fs.mkdir(this.receiptsDir, { recursive: true });
    await fs.appendFile(this.filePathFor(receipt.at), `${JSON.stringify(receipt)}\n`, 'utf8');
  }

  /** Create and persist a receipt in one step. */
  async record(input: CreateReceiptInput): Promise<Receipt> {
    const receipt = createReceipt(input);
    await this.append(receipt);
    return receipt;
  }

  /** Newest first, across day files. Corrupt lines are skipped. */
  async readRecent(limit = 20): Promise<Receipt[]> {
    const max = Math.max(0, Math.floor(limit));
    if (max === 0) return [];

    let files: string[];
    try {
      files = (await fs.readdir(this.receiptsDir)).filter((name) => name.endsWith('.jsonl'));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    files.sort((a, b) => b.localeCompare(a));

    const receipts: Receipt[] = [];
    for (const file of files) {
      if (receipts.length >= max) break;
      const dayReceipts = await this.readFile(path.join(this.receiptsDir, file));
      for (let index = dayReceipts.length - 1; index >= 0 && receipts.length < max; index -= 1) {
        const receipt = dayReceipts[index];
        if (receipt) receipts.push(receipt);
      }
    }
    return receipts;
  }

  async readDay(day: string): Promise<Receipt[]> {
    return this.readFile(path.join(this.receiptsDir, `${day}.jsonl`));
  }

  private async readFile(file: string): Promise<Receipt[]> {
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }

    const receipts: Receipt[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (isReceipt(parsed)) receipts.push(parsed);
      } catch {
        // A truncated write must not break the whole receipt log.
      }
    }
    return receipts;
  }
}

export function createReceiptStore(root: string): FileReceiptStore {
  return new FileReceiptStore(root);
}

function receiptDay(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid receipt timestamp: ${at}`);
  }
  return date.toISOString().slice(0, 10);
}

function isReceipt(value: unknown): value is Receipt {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.at === 'string' &&
    typeof record.kind === 'string' &&
    typeof record.summary === 'string'
  );
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
