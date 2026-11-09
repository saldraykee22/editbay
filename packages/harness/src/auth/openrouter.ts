import { asRecord, asString, parseJson, type FetchLike } from '../providers/base';
import { createPkce, type PkcePair } from './pkce';

export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/api/v1/auth/keys';

export interface AuthorizeUrlOptions {
  /** URL OpenRouter should redirect back to (deep link or localhost). */
  callbackUrl: string;
  codeChallenge: string;
  state?: string;
  clientId?: string;
  authBaseUrl?: string;
}

export interface BeginAuthOptions {
  callbackUrl: string;
  state?: string;
  clientId?: string;
  authBaseUrl?: string;
  verifierByteLength?: number;
}

export interface BeginAuthResult extends PkcePair {
  authorizeUrl: string;
}

export interface ExchangeCodeOptions {
  code: string;
  codeVerifier: string;
  /** Override for tests or self-hosted proxies. */
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export interface OpenRouterCredentials {
  key: string;
  userId?: string;
}

/** Build the OpenRouter OAuth authorize URL for a PKCE attempt. */
export function buildAuthorizeUrl(options: AuthorizeUrlOptions): string {
  if (!options.callbackUrl || !options.codeChallenge) {
    throw new Error('OpenRouter authorize URL needs callbackUrl and codeChallenge');
  }
  const base = options.authBaseUrl?.trim() || OPENROUTER_AUTH_URL;
  const url = new URL(base);
  url.searchParams.set('callback_url', options.callbackUrl);
  url.searchParams.set('code_challenge', options.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (options.state) url.searchParams.set('state', options.state);
  if (options.clientId) url.searchParams.set('client_id', options.clientId);
  return url.toString();
}

/** Generate a verifier/challenge/state and the matching authorize URL. */
export function beginOpenRouterAuth(options: BeginAuthOptions): BeginAuthResult {
  const pkce = createPkce(options.verifierByteLength ?? 32);
  const state = options.state ?? pkce.state;
  return {
    ...pkce,
    state,
    authorizeUrl: buildAuthorizeUrl({
      callbackUrl: options.callbackUrl,
      codeChallenge: pkce.challenge,
      state,
      ...(options.clientId !== undefined ? { clientId: options.clientId } : {}),
      ...(options.authBaseUrl !== undefined ? { authBaseUrl: options.authBaseUrl } : {}),
    }),
  };
}

/**
 * Exchange an authorization code for an OpenRouter API key.
 * Pure and testable: pass `fetchImpl` instead of hitting the network.
 */
export async function exchangeCode(options: ExchangeCodeOptions): Promise<OpenRouterCredentials> {
  if (!options.code) throw new Error('OpenRouter code exchange requires an authorization code');
  if (!options.codeVerifier) throw new Error('OpenRouter code exchange requires a PKCE verifier');

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available for OpenRouter sign-in');
  }
  const url = options.baseUrl?.trim() || OPENROUTER_KEYS_URL;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: options.code,
        code_verifier: options.codeVerifier,
      }),
    });
  } catch (error) {
    throw new Error(
      `Provider unreachable: could not reach OpenRouter (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter code exchange failed (HTTP ${response.status}): ${snippet(text)}`);
  }

  const payload = parseJson(text);
  const record = asRecord(payload);
  const key = asString(record?.key);
  if (!key) {
    throw new Error('OpenRouter code exchange returned no API key');
  }
  const userId = asString(record?.user_id);
  return { key, ...(userId !== undefined ? { userId } : {}) };
}

/** Convenience wrapper for the full callback half of the flow. */
export function completeOpenRouterAuth(options: ExchangeCodeOptions): Promise<OpenRouterCredentials> {
  return exchangeCode(options);
}

function snippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}
