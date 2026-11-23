import 'server-only';
import { PROVIDER_META, type ResearchProvider } from '@deep-fryer/core';
import { SecretDecryptError, decryptSecret, encryptSecret } from '@deep-fryer/core/secrets';
import { UserError } from './action-result';
import { apiKeyFormatProblem, validateAnthropicKey } from './anthropic-key';

/**
 * Multi-provider organization API key validation and AES-256-GCM binding
 * (Anthropic, OpenAI, Google Gemini).
 *
 * Deliberately NOT a `'use server'` module so callers cannot invoke it as an
 * unauthenticated key-checking oracle. Server actions in `api-key-actions.ts`
 * verify org-owner access before calling into this module.
 *
 * All user-facing errors are plain `UserError` messages that never echo the
 * API key or response body.
 */

const VALIDATE_TIMEOUT_MS = 15_000;

const OPENAI_KEY_SHAPE = /^sk-[A-Za-z0-9_-]+$/;
const GOOGLE_KEY_SHAPE = /^AIza[A-Za-z0-9_-]+$/;

/**
 * AES-256-GCM associated data binding a stored key to both its organization
 * and its provider, preventing cross-organization or cross-provider replay.
 */
export function providerKeyAssociatedData(organizationId: string, provider: ResearchProvider): string {
  return `${organizationId}:${provider}`;
}

/** Encrypt an organization's provider key bound to `(organizationId, provider)`. */
export async function encryptProviderKey(
  apiKey: string,
  keyMaterial: Uint8Array,
  organizationId: string,
  provider: ResearchProvider,
): Promise<string> {
  return encryptSecret(apiKey, keyMaterial, providerKeyAssociatedData(organizationId, provider));
}

/**
 * Decrypt a stored organization provider key. Tries `(organizationId, provider)`
 * associated data first, falling back to legacy `organizationId`-only binding
 * for existing Anthropic rows stored before migration 0028.
 */
export async function decryptProviderKey(
  ciphertext: string,
  keyMaterial: Uint8Array,
  organizationId: string,
  provider: ResearchProvider,
): Promise<string> {
  try {
    return await decryptSecret(ciphertext, keyMaterial, providerKeyAssociatedData(organizationId, provider));
  } catch (err) {
    if (err instanceof SecretDecryptError && provider === 'anthropic') {
      return decryptSecret(ciphertext, keyMaterial, organizationId);
    }
    throw err;
  }
}

/**
 * Validate the syntactic shape of an API key for `provider`, returning an
 * owner-facing problem string or `null` when it is ready for live validation.
 */
export function providerKeyFormatProblem(provider: ResearchProvider, apiKey: string): string | null {
  if (provider === 'anthropic') return apiKeyFormatProblem(apiKey);
  if (provider === 'openai') {
    if (!apiKey) return 'Paste your OpenAI API key.';
    if (apiKey.startsWith('sk-ant-')) {
      return 'That looks like an Anthropic API key, not an OpenAI key. Select Anthropic or create a key on the OpenAI Platform.';
    }
    if (!apiKey.startsWith('sk-')) {
      return 'That is not an OpenAI API key — they start with "sk-". Create one on the OpenAI Platform under API keys.';
    }
    if (!OPENAI_KEY_SHAPE.test(apiKey) || apiKey.length < 20 || apiKey.length > 256) {
      return 'That does not look like a complete OpenAI API key. Copy it again from the OpenAI Platform.';
    }
    return null;
  }
  // Google Gemini
  if (!apiKey) return 'Paste your Google Gemini API key.';
  if (!apiKey.startsWith('AIza')) {
    return 'That is not a Google Gemini API key — they start with "AIza". Create one in Google AI Studio.';
  }
  if (!GOOGLE_KEY_SHAPE.test(apiKey) || apiKey.length < 30 || apiKey.length > 128) {
    return 'That does not look like a complete Google Gemini API key. Copy it again from Google AI Studio.';
  }
  return null;
}

export function providerValidationMessages(provider: ResearchProvider) {
  const { displayName, consoleName } = PROVIDER_META[provider];
  return {
    rejected: `${displayName} did not accept that key. Check that you copied all of it and that it has not been disabled or deleted in ${consoleName}, then try again.`,
    forbidden: `${displayName} recognized that key but did not give it permission to use the API. Check its permissions in ${consoleName}, or use another key.`,
    unreachable: `We could not reach ${displayName} to check the key; try again.`,
    unchecked: `${displayName} could not check the key just now; try again in a minute.`,
  };
}

/**
 * Validate `apiKey` live against `provider`'s Models endpoint (zero tokens
 * consumed). Resolves on success; throws an owner-facing `UserError` otherwise.
 */
export async function validateProviderKey(
  provider: ResearchProvider,
  apiKey: string,
  options: { fetch?: typeof fetch } = {},
): Promise<void> {
  const problem = providerKeyFormatProblem(provider, apiKey);
  if (problem) throw new UserError(problem);

  // When no custom fetch stub is provided for Anthropic, use the existing SDK
  // validator so existing Anthropic SDK spies and error mapping stay intact.
  if (provider === 'anthropic' && !options.fetch) {
    await validateAnthropicKey(apiKey);
    return;
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const msgs = providerValidationMessages(provider);

  let url: string;
  let headers: Record<string, string>;
  if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/models?limit=1';
    headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/models';
    headers = { Authorization: `Bearer ${apiKey}` };
  } else {
    url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';
    headers = { 'x-goog-api-key': apiKey };
  }

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
    });
  } catch {
    throw new UserError(msgs.unreachable);
  }

  if (res.ok) return;
  if (res.status === 401) throw new UserError(msgs.rejected);
  if (res.status === 403) throw new UserError(msgs.forbidden);
  // Google Gemini returns HTTP 400 with API_KEY_INVALID for malformed/revoked keys.
  if (provider === 'google' && res.status === 400) {
    const body = (await res.json().catch(() => null)) as {
      error?: { status?: string; message?: string; details?: Array<{ reason?: string }> };
    } | null;
    const isInvalidKey =
      body?.error?.status === 'INVALID_ARGUMENT' ||
      /api key not valid/i.test(body?.error?.message ?? '') ||
      Boolean(body?.error?.details?.some((d) => d.reason === 'API_KEY_INVALID'));
    if (isInvalidKey) throw new UserError(msgs.rejected);
  }
  console.warn(`[api-key] ${PROVIDER_META[provider].displayName} answered the key check with HTTP ${res.status}`);
  throw new UserError(msgs.unchecked);
}
