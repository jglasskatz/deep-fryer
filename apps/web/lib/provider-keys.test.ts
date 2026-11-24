import { describe, expect, it, vi } from 'vitest';
import { SecretDecryptError, encryptSecret, parseSecretsKey } from '@deep-fryer/core/secrets';
import { UserError } from './action-result';
import {
  anthropicModelAccessMessage,
  configuredAnthropicRequiredModels,
  decryptProviderKey,
  encryptProviderKey,
  providerKeyAssociatedData,
  providerKeyFormatProblem,
  providerValidationMessages,
  validateProviderKey,
} from './provider-keys';

const randomSecretsKey = () =>
  parseSecretsKey(btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(32)))));

const ANTHROPIC_KEY = `sk-ant-api03-${'aB3dE5'.repeat(15)}-xYz1`;
const OPENAI_KEY = `sk-proj-${'kL9mN2pQ4r'.repeat(6)}`;
const GOOGLE_KEY = `AIzaSy${'D3fG7hJ2kL9mN4pQ8rS1tU5vW0xY2z'}`;

describe('providerKeyFormatProblem', () => {
  it('validates Anthropic, OpenAI, and Google Gemini key shapes', () => {
    expect(providerKeyFormatProblem('anthropic', ANTHROPIC_KEY)).toBeNull();
    expect(providerKeyFormatProblem('openai', OPENAI_KEY)).toBeNull();
    expect(providerKeyFormatProblem('google', GOOGLE_KEY)).toBeNull();

    // Cross-provider mistakes are caught cleanly.
    expect(providerKeyFormatProblem('openai', ANTHROPIC_KEY)).toMatch(/Anthropic API key/);
    expect(providerKeyFormatProblem('openai', 'not-a-key')).toMatch(/start with "sk-"/);
    expect(providerKeyFormatProblem('google', OPENAI_KEY)).toMatch(/start with "AIza"/);
    expect(providerKeyFormatProblem('google', 'AIza-short')).toMatch(/complete Google Gemini API key/);
  });
});

describe('encryptProviderKey / decryptProviderKey', () => {
  it('binds AES-256-GCM ciphertext to organizationId + provider and rejects cross-org or cross-provider replay', async () => {
    const keyMaterial = randomSecretsKey();
    const orgA = '11111111-1111-4111-8111-111111111111';
    const orgB = '22222222-2222-4222-8222-222222222222';
    expect(providerKeyAssociatedData(orgA, 'openai')).toBe(`${orgA}:openai`);

    const cipher = await encryptProviderKey(OPENAI_KEY, keyMaterial, orgA, 'openai');
    expect(cipher.startsWith('v1:')).toBe(true);
    expect(await decryptProviderKey(cipher, keyMaterial, orgA, 'openai')).toBe(OPENAI_KEY);

    // Wrong organization or wrong provider fails authenticated decryption.
    await expect(decryptProviderKey(cipher, keyMaterial, orgB, 'openai')).rejects.toThrow(SecretDecryptError);
    await expect(decryptProviderKey(cipher, keyMaterial, orgA, 'google')).rejects.toThrow(SecretDecryptError);
    await expect(decryptProviderKey(cipher, keyMaterial, orgA, 'anthropic')).rejects.toThrow(SecretDecryptError);
  });

  it('keeps backward-compatible decryption fallback for legacy Anthropic rows bound to organizationId alone', async () => {
    const keyMaterial = randomSecretsKey();
    const orgId = '33333333-3333-4333-8333-333333333333';
    const legacyCipher = await encryptSecret(ANTHROPIC_KEY, keyMaterial, orgId);

    // Legacy Anthropic row decrypts seamlessly.
    expect(await decryptProviderKey(legacyCipher, keyMaterial, orgId, 'anthropic')).toBe(ANTHROPIC_KEY);
    // Legacy fallback does NOT open non-Anthropic rows.
    await expect(decryptProviderKey(legacyCipher, keyMaterial, orgId, 'openai')).rejects.toThrow(SecretDecryptError);
  });
});

describe('validateProviderKey (mocked fetch)', () => {
  it('validates OpenAI keys against /v1/models with Bearer auth and maps 401/403/500', async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const okFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), auth: headers.get('authorization') });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    await expect(validateProviderKey('openai', OPENAI_KEY, { fetch: okFetch })).resolves.toBeUndefined();
    expect(calls).toEqual([{ url: 'https://api.openai.com/v1/models', auth: `Bearer ${OPENAI_KEY}` }]);

    const rejectFetch = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    await expect(validateProviderKey('openai', OPENAI_KEY, { fetch: rejectFetch })).rejects.toThrow(
      new UserError(providerValidationMessages('openai').rejected),
    );

    const forbidFetch = vi.fn(async () => new Response('forbidden', { status: 403 }));
    await expect(validateProviderKey('openai', OPENAI_KEY, { fetch: forbidFetch })).rejects.toThrow(
      new UserError(providerValidationMessages('openai').forbidden),
    );
  });

  it('validates Google Gemini keys via x-goog-api-key header (never URL query) and maps 400 API_KEY_INVALID', async () => {
    const seen: Array<{ url: string; keyHeader: string | null }> = [];
    const okFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), keyHeader: headers.get('x-goog-api-key') });
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    });

    await expect(validateProviderKey('google', GOOGLE_KEY, { fetch: okFetch })).resolves.toBeUndefined();
    expect(seen).toEqual([
      {
        url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
        keyHeader: GOOGLE_KEY,
      },
    ]);
    expect(seen[0]!.url).not.toContain(GOOGLE_KEY);

    const invalidFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' },
          }),
          { status: 400 },
        ),
    );
    await expect(validateProviderKey('google', GOOGLE_KEY, { fetch: invalidFetch })).rejects.toThrow(
      new UserError(providerValidationMessages('google').rejected),
    );
  });

  it('checks GET /v1/models/<id> for configured Anthropic researcher/verifier models and fails fast on missing model access (P2.2)', async () => {
    const requestedUrls: string[] = [];
    const okFetch = vi.fn(async (input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({ id: 'ok' }), { status: 200 });
    });

    await expect(
      validateProviderKey('anthropic', ANTHROPIC_KEY, {
        fetch: okFetch,
        requiredModels: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5', '  '],
      }),
    ).resolves.toBeUndefined();

    expect(requestedUrls).toEqual([
      'https://api.anthropic.com/v1/models?limit=1',
      'https://api.anthropic.com/v1/models/claude-sonnet-5-5',
      'https://api.anthropic.com/v1/models/claude-opus-5-5',
    ]);

    const missingOpusFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/claude-opus-5-5')) {
        return new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error' } }), { status: 404 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    const err = await validateProviderKey('anthropic', ANTHROPIC_KEY, {
      fetch: missingOpusFetch,
      requiredModels: ['claude-sonnet-5-5', 'claude-opus-5-5'],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as Error).message).toBe(anthropicModelAccessMessage('claude-opus-5-5'));
    expect((err as Error).message).toContain('claude-opus-5-5');
    expect((err as Error).message).not.toContain(ANTHROPIC_KEY);

    expect(
      configuredAnthropicRequiredModels({
        ANTHROPIC_MODEL: 'claude-sonnet-5-5',
        VERIFIER_MODEL: 'claude-opus-5-5',
      }),
    ).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);
    // Non-Anthropic verifier models are ignored by Anthropic model validation.
    expect(
      configuredAnthropicRequiredModels({
        ANTHROPIC_MODEL: 'claude-sonnet-5',
        VERIFIER_MODEL: 'gpt-5',
      }),
    ).toEqual(['claude-sonnet-5']);
  });
});
