import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { UserError } from './action-result';

/**
 * Checking an organization's Anthropic API key before it is stored
 * (SPEC-v7 §4: "Validated on entry (one call to the Models API)").
 *
 * Deliberately not a server action module: everything here takes a key and
 * calls Anthropic with it, and an exported async function in a 'use server'
 * file is an endpoint anyone can call — a free key-checking oracle. The
 * action that uses this (api-key-actions.ts saveApiKey) first requires an
 * organization owner.
 *
 * Every message below is shown to the owner as is (UserError), so none of
 * them contains the key, and neither does anything logged here.
 */

/** Anthropic API keys start with this; Admin keys ("sk-ant-admin…") and OAuth tokens share it. */
export const ANTHROPIC_KEY_PREFIX = 'sk-ant-';

/** Bounds generous enough for any key format Anthropic has issued, tight enough to refuse pasted prose. */
const MIN_KEY_CHARS = 40;
const MAX_KEY_CHARS = 256;
const KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]+$/;

/**
 * The first-party API. The key is an Anthropic Console key, so it is only
 * ever sent to Anthropic — not to a gateway an ANTHROPIC_BASE_URL in this
 * server's environment might name (the worker withholds that too, see
 * apps/worker/src/session.ts sessionEnv).
 */
const ANTHROPIC_API = 'https://api.anthropic.com';

/** One retry and a short timeout: someone is waiting on the billing page. */
const VALIDATE_TIMEOUT_MS = 15_000;

export const KEY_REJECTED =
  'Anthropic did not accept that key. Check that you copied all of it and that it has not been disabled or deleted in the Anthropic Console, then try again.';
export const KEY_FORBIDDEN =
  'Anthropic recognized that key but did not give it permission to use the API (its workspace or organization may be disabled). Check it in the Anthropic Console, or use another key.';
export const KEY_UNREACHABLE = 'We could not reach Anthropic to check the key; try again.';
export const KEY_UNCHECKED = 'Anthropic could not check the key just now; try again in a minute.';

/** What is wrong with the key's form, or null when it is worth asking Anthropic about. */
export function apiKeyFormatProblem(apiKey: string): string | null {
  if (!apiKey) return 'Paste your Anthropic API key.';
  if (!apiKey.startsWith(ANTHROPIC_KEY_PREFIX)) {
    return `That is not an Anthropic API key — they start with "${ANTHROPIC_KEY_PREFIX}". Create one in the Anthropic Console under API keys.`;
  }
  if (apiKey.startsWith('sk-ant-admin')) {
    return 'That is an Admin API key, which cannot run research. Create a regular API key in the Anthropic Console.';
  }
  if (!KEY_SHAPE.test(apiKey) || apiKey.length < MIN_KEY_CHARS || apiKey.length > MAX_KEY_CHARS) {
    return 'That does not look like a complete Anthropic API key. Copy it again from the Anthropic Console.';
  }
  return null;
}

/**
 * The owner-facing reading of whatever the validation call threw. Typed
 * SDK errors, most specific first (APIConnectionError is a subclass of
 * APIError in the TypeScript SDK, so it is checked before the catch-all):
 *
 * - 401 → the key is wrong, revoked, or not an API key at all;
 * - 403 → a real key without API permission;
 * - no response (network, DNS, timeout) → try again;
 * - anything else from the API (429, 5xx, …) → Anthropic could not answer;
 *   the key may be fine, so say so rather than calling it invalid.
 *
 * Unexpected errors are logged by class and status only — an SDK error's
 * message carries the response body, and no error here should be able to
 * put request details in a log line.
 */
export function anthropicKeyError(err: unknown): UserError {
  if (err instanceof Anthropic.AuthenticationError) return new UserError(KEY_REJECTED);
  if (err instanceof Anthropic.PermissionDeniedError) return new UserError(KEY_FORBIDDEN);
  if (err instanceof Anthropic.APIConnectionError) return new UserError(KEY_UNREACHABLE);
  if (err instanceof Anthropic.APIError) {
    console.warn(`[api-key] Anthropic answered the key check with ${err.status ?? 'no status'} (${err.type ?? 'unknown type'})`);
    return new UserError(KEY_UNCHECKED);
  }
  console.error(`[api-key] key check failed: ${err instanceof Error ? err.name : typeof err}`);
  return new UserError(KEY_UNCHECKED);
}

/**
 * Ask Anthropic whether `apiKey` works: list one model (the cheapest call
 * that needs a valid key; it spends no tokens). Resolves when the key was
 * accepted; throws a UserError saying what to do otherwise.
 *
 * The client gets the key explicitly and `authToken: null`, so an
 * ANTHROPIC_AUTH_TOKEN in this server's environment can never be sent
 * alongside it (or make an invalid key look valid).
 */
export async function validateAnthropicKey(apiKey: string): Promise<void> {
  const problem = apiKeyFormatProblem(apiKey);
  if (problem) throw new UserError(problem);
  const client = new Anthropic({
    apiKey,
    authToken: null,
    baseURL: ANTHROPIC_API,
    maxRetries: 1,
    timeout: VALIDATE_TIMEOUT_MS,
  });
  try {
    await client.models.list({ limit: 1 });
  } catch (err) {
    throw anthropicKeyError(err);
  }
}
