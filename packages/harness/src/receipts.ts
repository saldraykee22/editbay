import type { Receipt } from './types';

export interface CreateReceiptInput {
  kind: Receipt['kind'];
  summary: string;
  detail?: Record<string, unknown>;
  /** Override the timestamp (useful in tests and when replaying imports). */
  at?: string;
  /** Override the generated id. */
  id?: string;
}

/**
 * Build a receipt value without writing it. Pure and platform-agnostic so the
 * renderer can create receipts and persist them through its workspace bridge.
 */
export function createReceipt(input: CreateReceiptInput): Receipt {
  const at = input.at ?? new Date().toISOString();
  const receipt: Receipt = {
    id: input.id ?? `rcp_${randomId()}`,
    at,
    kind: input.kind,
    summary: input.summary,
  };
  if (input.detail !== undefined) receipt.detail = input.detail;
  return receipt;
}

function randomId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
