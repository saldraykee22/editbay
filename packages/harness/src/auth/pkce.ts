import { createHash, randomBytes } from 'node:crypto';

/** RFC 7636 unreserved verifier characters, length 43..128. */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
  state: string;
}

/** Base64url without padding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

/** Create a PKCE verifier from `byteLength` random bytes (32..96). */
export function createVerifier(byteLength = 32): string {
  if (!Number.isInteger(byteLength) || byteLength < 32 || byteLength > 96) {
    throw new Error('PKCE verifier byte length must be an integer between 32 and 96');
  }
  return base64UrlEncode(randomBytes(byteLength));
}

/** S256 challenge: BASE64URL(SHA256(ASCII(verifier))). */
export function createChallenge(verifier: string): string {
  if (!VERIFIER_RE.test(verifier)) {
    throw new Error(
      'PKCE verifier must be 43-128 characters using only A-Z, a-z, 0-9, "-", ".", "_" and "~"',
    );
  }
  return base64UrlEncode(createHash('sha256').update(verifier, 'ascii').digest());
}

export function createState(byteLength = 16): string {
  if (!Number.isInteger(byteLength) || byteLength < 8 || byteLength > 64) {
    throw new Error('OAuth state byte length must be an integer between 8 and 64');
  }
  return base64UrlEncode(randomBytes(byteLength));
}

/** Convenience bundle for a fresh OAuth PKCE attempt. */
export function createPkce(byteLength = 32): PkcePair {
  const verifier = createVerifier(byteLength);
  return {
    verifier,
    challenge: createChallenge(verifier),
    method: 'S256',
    state: createState(),
  };
}
