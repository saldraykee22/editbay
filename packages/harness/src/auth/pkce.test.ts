import { describe, expect, it } from 'vitest';
import {
  base64UrlDecode,
  base64UrlEncode,
  createChallenge,
  createPkce,
  createState,
  createVerifier,
} from './pkce';

describe('PKCE', () => {
  it('matches the RFC 7636 Appendix B test vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(createChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('creates verifiers at the RFC length boundaries', () => {
    const min = createVerifier(32);
    const max = createVerifier(96);
    expect(min).toHaveLength(43);
    expect(max).toHaveLength(128);
    expect(min).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(max).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('rejects invalid verifier lengths', () => {
    expect(() => createVerifier(16)).toThrow(/between 32 and 96/);
    expect(() => createVerifier(100)).toThrow(/between 32 and 96/);
    expect(() => createVerifier(32.5)).toThrow(/between 32 and 96/);
  });

  it('rejects invalid verifier characters and lengths in createChallenge', () => {
    expect(() => createChallenge('too-short')).toThrow(/43-128/);
    expect(() => createChallenge('a'.repeat(129))).toThrow(/43-128/);
    expect(() => createChallenge(`${'a'.repeat(42)}+`)).toThrow(/43-128/);
  });

  it('creates a complete S256 pair with state', () => {
    const pair = createPkce();
    expect(pair.method).toBe('S256');
    expect(pair.state.length).toBeGreaterThan(10);
    expect(createChallenge(pair.verifier)).toBe(pair.challenge);
  });

  it('produces unpadded base64url and round-trips bytes', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = base64UrlEncode(bytes);
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect([...base64UrlDecode(encoded)]).toEqual([...bytes]);
  });

  it('generates unique state values', () => {
    const values = new Set(Array.from({ length: 20 }, () => createState()));
    expect(values.size).toBe(20);
  });
});
