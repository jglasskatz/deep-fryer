/**
 * Secrets at rest (SPEC-v7 §4): an organization's own Anthropic API key is
 * stored only as AES-256-GCM ciphertext, under a key the operator keeps in
 * DF_SECRETS_KEY (32 random bytes, base64). The web app encrypts when an
 * owner saves a key; only the worker decrypts, into the environment of that
 * organization's model sessions.
 *
 * Web Crypto (globalThis.crypto.subtle) rather than node:crypto, so the
 * module has no Node-only imports — but it is deliberately NOT exported from
 * the package index, which client bundles import: it is reached only as
 * `@deep-fryer/core/secrets`, from server code.
 *
 * Token format, versioned so the scheme can change without guessing what an
 * old row holds:
 *
 *   v1:<base64 IV (12 bytes)>:<base64 ciphertext followed by the 16-byte GCM tag>
 *
 * GCM is authenticated: a token that was altered, encrypted under another
 * DF_SECRETS_KEY (a rotated key), or bound to other associated data fails to
 * decrypt with SecretDecryptError — it never yields wrong plaintext.
 */
import { decodeBase64, encodeBase64 } from './base64.js';
import { SECRETS_KEY_BYTES, secretsKeyProblem } from './deploy-env.js';

const VERSION = 'v1';
/** 96-bit IVs are GCM's native size; one fresh random IV per encryption. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** DF_SECRETS_KEY is missing or is not a 32-byte base64 key. */
export class SecretsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsKeyError';
  }
}

/**
 * A token could not be opened: wrong key, altered ciphertext, different
 * associated data, or not a token at all. The message never contains the
 * token or the key.
 */
export class SecretDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretDecryptError';
  }
}

/**
 * DF_SECRETS_KEY as key material: exactly 32 bytes of standard base64.
 * Throws SecretsKeyError when it is unset, blank, or malformed — the same
 * rule the production boot check applies (deploy-env.ts secretsKeyProblem).
 */
export function parseSecretsKey(raw: string | null | undefined): Uint8Array {
  const value = raw?.trim();
  if (!value) throw new SecretsKeyError('DF_SECRETS_KEY is not set');
  const problem = secretsKeyProblem(value);
  if (problem) throw new SecretsKeyError(problem);
  return decodeBase64(value);
}

/**
 * A copy backed by its own ArrayBuffer. Web Crypto's DOM typings accept only
 * ArrayBuffer-backed views (not SharedArrayBuffer ones), and a Uint8Array
 * parameter may be either as far as TypeScript knows; copying a few dozen
 * bytes is the honest way to satisfy that in every consumer's lib setting.
 */
const own = (bytes: Uint8Array) => new Uint8Array(bytes);

/**
 * Import raw key material for one use. Non-extractable: once imported, the
 * CryptoKey cannot be exported back out of Web Crypto.
 */
async function importKey(keyMaterial: Uint8Array, usage: 'encrypt' | 'decrypt') {
  if (keyMaterial.length !== SECRETS_KEY_BYTES) {
    throw new SecretsKeyError(`the secrets key must be ${SECRETS_KEY_BYTES} bytes, not ${keyMaterial.length}`);
  }
  return globalThis.crypto.subtle.importKey('raw', own(keyMaterial), { name: 'AES-GCM' }, false, [usage]);
}

/**
 * GCM parameters. `associatedData` is authenticated but not encrypted: a
 * token sealed with one value opens only with the same value. Callers bind
 * a stored secret to its owner (the organization id), so a ciphertext
 * copied onto another organization's row is useless there.
 */
function gcm(iv: Uint8Array, associatedData: string | undefined) {
  return {
    name: 'AES-GCM',
    iv: own(iv),
    tagLength: TAG_BYTES * 8,
    ...(associatedData === undefined ? {} : { additionalData: new TextEncoder().encode(associatedData) }),
  };
}

/** Encrypt `plaintext` under `keyMaterial` (32 bytes) into a "v1:…" token. */
export async function encryptSecret(
  plaintext: string,
  keyMaterial: Uint8Array,
  associatedData?: string,
): Promise<string> {
  const key = await importKey(keyMaterial, 'encrypt');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await globalThis.crypto.subtle.encrypt(gcm(iv, associatedData), key, new TextEncoder().encode(plaintext));
  return `${VERSION}:${encodeBase64(iv)}:${encodeBase64(new Uint8Array(sealed))}`;
}

/**
 * Open a token made by encryptSecret with the same key and associated data.
 * Throws SecretDecryptError for anything else.
 */
export async function decryptSecret(
  token: string,
  keyMaterial: Uint8Array,
  associatedData?: string,
): Promise<string> {
  const parts = token.split(':');
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new SecretDecryptError('not a recognized secret token (expected "v1:<iv>:<ciphertext>")');
  }
  let iv: Uint8Array;
  let sealed: Uint8Array;
  try {
    iv = decodeBase64(parts[1]!);
    sealed = decodeBase64(parts[2]!);
  } catch {
    throw new SecretDecryptError('the secret token is not valid base64');
  }
  if (iv.length !== IV_BYTES || sealed.length < TAG_BYTES) {
    throw new SecretDecryptError('the secret token is truncated');
  }
  const key = await importKey(keyMaterial, 'decrypt');
  let plain: ArrayBuffer;
  try {
    plain = await globalThis.crypto.subtle.decrypt(gcm(iv, associatedData), key, own(sealed));
  } catch {
    // Web Crypto reports every GCM failure as one opaque OperationError; the
    // causes it covers are the ones worth naming to an operator.
    throw new SecretDecryptError(
      'the secret could not be decrypted: it was encrypted under a different DF_SECRETS_KEY, or it has been altered',
    );
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(plain);
}

/**
 * What the billing page shows to say which key is on file: the last four
 * characters. Short enough to be useless to anyone else (an Anthropic key
 * has about 90 random characters after its prefix), and stored in plain
 * text next to the ciphertext so pages never need to decrypt.
 */
export function keyHint(apiKey: string): string {
  return apiKey.trim().slice(-4);
}
