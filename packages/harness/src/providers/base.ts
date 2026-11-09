/**
 * Shared provider plumbing: safe HTTP/SSE handling, error mapping, abort
 * support and a stable marker for empty model responses.
 */

export type FetchLike = typeof fetch;

/** Marker carried by ProviderError when a provider returned no usable output. */
export const EMPTY_RESPONSE = 'EMPTY_RESPONSE';

export interface ProviderErrorOptions {
  status?: number;
  code?: string;
  providerId?: string;
  retryable?: boolean;
  /** Server-requested delay before a retry, from `Retry-After`. */
  retryAfterMs?: number;
  cause?: unknown;
}

export class ProviderError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly providerId?: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(message: string, options: ProviderErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProviderError';
    if (options.status !== undefined) this.status = options.status;
    if (options.code !== undefined) this.code = options.code;
    if (options.providerId !== undefined) this.providerId = options.providerId;
    this.retryable = options.retryable ?? false;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

export function emptyResponseError(providerLabel: string): ProviderError {
  return new ProviderError(
    `${EMPTY_RESPONSE}: ${providerLabel} returned an empty response. Try again or switch models.`,
    { code: 'empty_response', retryable: true },
  );
}

/** Readable HTTP error; never includes headers, so API keys cannot leak. */
export function httpError(
  status: number,
  providerLabel: string,
  body?: string,
  retryAfterMs?: number,
): ProviderError {
  const detail = body === undefined ? '' : snippet(body);
  const retryDelay = retryAfterMs === undefined ? {} : { retryAfterMs };
  if (status === 401 || status === 403) {
    return new ProviderError(
      `API key rejected (HTTP ${status}) by ${providerLabel}. Check or replace the API key.`,
      { status, code: 'auth', retryable: false },
    );
  }
  if (status === 429) {
    return new ProviderError(
      `Rate limited (HTTP 429) by ${providerLabel}. Wait a moment and try again.`,
      { status, code: 'rate_limit', retryable: true, ...retryDelay },
    );
  }
  if (status === 404) {
    return new ProviderError(
      `Model or endpoint not found (HTTP 404) on ${providerLabel}${detail === '' ? '' : `: ${detail}`}`,
      { status, code: 'not_found', retryable: false },
    );
  }
  if (status >= 500) {
    return new ProviderError(
      `Provider unavailable (HTTP ${status}) on ${providerLabel}${detail === '' ? '' : `: ${detail}`}`,
      { status, code: 'server', retryable: true, ...retryDelay },
    );
  }
  return new ProviderError(
    `Provider request failed (HTTP ${status}) on ${providerLabel}${detail === '' ? '' : `: ${detail}`}`,
    { status, code: 'http', retryable: false },
  );
}

/** Parse a `Retry-After` header (seconds or an HTTP date) into milliseconds. */
export function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

export function networkError(error: unknown, providerLabel: string): ProviderError {
  const message = errorMessage(error);
  return new ProviderError(
    `Provider unreachable: could not connect to ${providerLabel}${message === '' ? '' : ` (${message})`}`,
    { code: 'network', retryable: true, cause: error },
  );
}

export function isAbortError(error: unknown): boolean {
  return (
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: unknown }).name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ABORT_ERR')
  );
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Normalized AbortError so callers can rely on `name === 'AbortError'`. */
export function abortError(): Error {
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
}

export interface ParsedBody {
  /** Decoded JSON value, or an array of SSE payloads. */
  payload: unknown;
  isSse: boolean;
  sseEvents: unknown[];
}

/**
 * Send a request and decode JSON or an SSE transcript. Network, HTTP and
 * empty-body failures are mapped to ProviderError.
 */
export async function sendRequest(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  providerLabel: string,
): Promise<ParsedBody> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw networkError(error, providerLabel);
  }

  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '';
    }
    throw httpError(
      response.status,
      providerLabel,
      body,
      parseRetryAfterMs(response.headers.get('retry-after')),
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw networkError(error, providerLabel);
  }
  if (text.trim() === '') throw emptyResponseError(providerLabel);

  const contentType = response.headers.get('content-type') ?? '';
  const looksLikeSse =
    contentType.toLowerCase().includes('text/event-stream') || text.trimStart().startsWith('data:');

  if (looksLikeSse) {
    const sseEvents = parseSseEvents(text);
    return { payload: sseEvents, isSse: true, sseEvents };
  }

  const payload = parseJson(text);
  if (payload === undefined) {
    throw new ProviderError(
      `Invalid JSON response from ${providerLabel}: ${snippet(text)}`,
      { code: 'invalid_response' },
    );
  }
  return { payload, isSse: false, sseEvents: [] };
}

/** Parse an SSE transcript into the JSON payload of each `data:` line. */
export function parseSseEvents(text: string): unknown[] {
  const events: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice('data:'.length).trim();
    if (data === '' || data === '[DONE]') continue;
    const parsed = parseJson(data);
    if (parsed !== undefined) events.push(parsed);
  }
  return events;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Narrowing helpers (no `any`)                                        */
/* ------------------------------------------------------------------ */

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function parseArguments(value: unknown): Record<string, unknown> {
  if (asRecord(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    const parsed = parseJson(value);
    if (asRecord(parsed)) return parsed as Record<string, unknown>;
  }
  return {};
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function mergeHeaders(
  base: Record<string, string>,
  extra?: Record<string, string>,
): Record<string, string> {
  return extra === undefined ? base : { ...base, ...extra };
}

export function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`;
}

export function isOpenRouterHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai') || host.endsWith('.openrouter.io');
  } catch {
    return false;
  }
}

function snippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}
