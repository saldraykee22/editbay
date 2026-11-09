import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../providers/base';
import {
  beginOpenRouterAuth,
  buildAuthorizeUrl,
  exchangeCode,
} from './openrouter';

describe('OpenRouter OAuth', () => {
  it('builds an authorize URL with PKCE parameters', () => {
    const url = new URL(
      buildAuthorizeUrl({
        callbackUrl: 'editbay://auth/callback',
        codeChallenge: 'abc123',
        state: 'state-1',
        clientId: 'editbay',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(url.searchParams.get('callback_url')).toBe('editbay://auth/callback');
    expect(url.searchParams.get('code_challenge')).toBe('abc123');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('client_id')).toBe('editbay');
  });

  it('beginOpenRouterAuth returns a verifier that matches the challenge', () => {
    const result = beginOpenRouterAuth({ callbackUrl: 'http://127.0.0.1:7777/callback' });
    expect(result.method).toBe('S256');
    expect(result.verifier).toHaveLength(43);
    expect(result.authorizeUrl).toContain(encodeURIComponent(result.challenge));
    expect(new URL(result.authorizeUrl).searchParams.get('state')).toBe(result.state);
  });

  it('exchanges a code for a key with the documented POST body', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl: FetchLike = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ key: 'sk-or-v1-test', user_id: 'user_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const credentials = await exchangeCode({
      code: 'auth-code',
      codeVerifier: 'verifier-value',
      fetchImpl,
    });

    expect(credentials).toEqual({ key: 'sk-or-v1-test', userId: 'user_1' });
    expect(capturedUrl).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(capturedInit?.method).toBe('POST');
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      code: 'auth-code',
      code_verifier: 'verifier-value',
    });
  });

  it('maps exchange failures to readable errors', async () => {
    const fetchImpl: FetchLike = async () =>
      new Response('invalid code', { status: 400, headers: { 'content-type': 'text/plain' } });

    await expect(
      exchangeCode({ code: 'bad', codeVerifier: 'v', fetchImpl }),
    ).rejects.toThrow(/OpenRouter code exchange failed \(HTTP 400\)/);
  });

  it('rejects a successful response with no key', async () => {
    const fetchImpl: FetchLike = async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });

    await expect(
      exchangeCode({ code: 'code', codeVerifier: 'v', fetchImpl }),
    ).rejects.toThrow(/returned no API key/);
  });

  it('requires a code and verifier', async () => {
    await expect(exchangeCode({ code: '', codeVerifier: 'v' })).rejects.toThrow(/authorization code/);
    await expect(exchangeCode({ code: 'c', codeVerifier: '' })).rejects.toThrow(/PKCE verifier/);
  });
});
