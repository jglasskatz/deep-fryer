import { describe, expect, it } from 'vitest';
import {
  SecretDecryptError,
  SecretsKeyError,
  decryptSecret,
  encryptSecret,
  keyHint,
  parseSecretsKey,
} from './secrets.js';

/** A DF_SECRETS_KEY value as `openssl rand -base64 32` would print it. */
function randomSecretsKey(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

const API_KEY = `sk-ant-api03-${'A1b2C3d4'.repeat(11)}-wXyZ`;
const ORG = '7c1e2d3f-0000-4000-8000-000000000001';

describe('encryptSecret / decryptSecret', () => {
  it('round-trips, with a fresh IV every time and nothing of the plaintext in the token', async () => {
    const key = parseSecretsKey(randomSecretsKey());
    const a = await encryptSecret(API_KEY, key, ORG);
    const b = await encryptSecret(API_KEY, key, ORG);
    expect(a).toMatch(/^v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]+=*$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('sk-ant');
    expect(a).not.toContain('wXyZ');
    expect(await decryptSecret(a, key, ORG)).toBe(API_KEY);
    expect(await decryptSecret(b, key, ORG)).toBe(API_KEY);
    // Without associated data, too (and unicode survives).
    expect(await decryptSecret(await encryptSecret('ключ ✓', key), key)).toBe('ключ ✓');
  });

  it('detects tampering with the ciphertext, the tag, or the IV', async () => {
    const key = parseSecretsKey(randomSecretsKey());
    const token = await encryptSecret(API_KEY, key, ORG);
    const [v, iv, sealed] = token.split(':') as [string, string, string];
    /** Flip one bit of the byte at `at` (negative counts from the end: -1 is the tag's last byte). */
    const flip = (b64: string, at: number) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const i = at < 0 ? bytes.length + at : at;
      bytes[i] = bytes[i]! ^ 0x01;
      return btoa(String.fromCharCode(...bytes));
    };
    await expect(decryptSecret(`${v}:${iv}:${flip(sealed, 0)}`, key, ORG)).rejects.toThrow(SecretDecryptError);
    await expect(decryptSecret(`${v}:${iv}:${flip(sealed, -1)}`, key, ORG)).rejects.toThrow(
      /different DF_SECRETS_KEY, or it has been altered/,
    );
    await expect(decryptSecret(`${v}:${flip(iv, 3)}:${sealed}`, key, ORG)).rejects.toThrow(SecretDecryptError);
    // Bound to its owner: the same token does not open for another organization.
    await expect(decryptSecret(token, key, 'another-organization')).rejects.toThrow(SecretDecryptError);
    // Malformed and unversioned tokens are refused before any crypto.
    await expect(decryptSecret(`v2:${iv}:${sealed}`, key, ORG)).rejects.toThrow(/not a recognized secret token/);
    await expect(decryptSecret(API_KEY, key, ORG)).rejects.toThrow(SecretDecryptError);
    await expect(decryptSecret(`v1:${iv}:AAAA`, key, ORG)).rejects.toThrow(/truncated/);
  });

  it('refuses to open a token with the wrong key (a rotated DF_SECRETS_KEY)', async () => {
    const token = await encryptSecret(API_KEY, parseSecretsKey(randomSecretsKey()), ORG);
    const error = await decryptSecret(token, parseSecretsKey(randomSecretsKey()), ORG).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SecretDecryptError);
    // The message names the cause for an operator and leaks neither secret.
    expect((error as Error).message).toMatch(/different DF_SECRETS_KEY/);
    expect((error as Error).message).not.toContain(token);
  });
});

describe('parseSecretsKey', () => {
  it('accepts 32 bytes of base64 (surrounding whitespace allowed)', () => {
    expect(parseSecretsKey(`  ${randomSecretsKey()}\n`)).toHaveLength(32);
  });

  it('refuses a missing, short, long, or non-base64 key', async () => {
    expect(() => parseSecretsKey(undefined)).toThrow(SecretsKeyError);
    expect(() => parseSecretsKey('')).toThrow(/not set/);
    expect(() => parseSecretsKey(btoa('only sixteen b!!'))).toThrow(/32 bytes, not 16/);
    expect(() => parseSecretsKey(btoa('x'.repeat(33)))).toThrow(/32 bytes, not 33/);
    expect(() => parseSecretsKey('not base64 at all, but long enough to look like a key')).toThrow(/must be base64/);
    // Raw material of the wrong length is refused at use, too.
    await expect(encryptSecret('x', new Uint8Array(16))).rejects.toThrow(SecretsKeyError);
  });
});

describe('keyHint', () => {
  it('is the last four characters', () => {
    expect(keyHint(API_KEY)).toBe('wXyZ');
    expect(keyHint(` ${API_KEY}\n`)).toBe('wXyZ');
  });
});
