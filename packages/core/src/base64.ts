/**
 * Standard base64 (RFC 4648 §4, with padding) for byte arrays, without
 * Node's Buffer, so the modules that use it — the secrets-at-rest format
 * (secrets.ts) and the deployment check of DF_SECRETS_KEY (deploy-env.ts) —
 * stay isomorphic like the rest of @deep-fryer/core. `btoa`/`atob` are
 * globals in Node 20+ and every browser; they work on "binary strings" (one
 * char per byte), which is what the loops below convert to and from.
 *
 * Internal to the package: not exported from index.ts.
 */

/** The standard alphabet with optional trailing padding — nothing else (no whitespace, no base64url). */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Decode standard base64. Throws on anything outside the alphabet or with
 * an impossible length, rather than silently decoding a prefix — callers
 * check lengths, and a truncated value must not pass as a shorter one.
 */
export function decodeBase64(text: string): Uint8Array {
  if (!BASE64.test(text) || text.length % 4 === 1) throw new Error('not valid base64');
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
