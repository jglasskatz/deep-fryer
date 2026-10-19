import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  KEY_FORBIDDEN,
  KEY_REJECTED,
  KEY_UNCHECKED,
  KEY_UNREACHABLE,
  anthropicKeyError,
  apiKeyFormatProblem,
  validateAnthropicKey,
} from './anthropic-key';
import { UserError } from './action-result';

/**
 * Validating an organization's Anthropic API key before it is stored
 * (SPEC-v7 §4). The SDK call is mocked for the mapping (every failure has
 * an owner-facing message that never contains the key), and one test asks
 * the real API about an invalid key when api.anthropic.com is reachable.
 */
const WELL_FORMED = `sk-ant-api03-${'aB3dE5'.repeat(15)}-xYz1`;

describe('apiKeyFormatProblem', () => {
  it('accepts a well-formed key and refuses what is not one', () => {
    expect(apiKeyFormatProblem(WELL_FORMED)).toBeNull();
    expect(apiKeyFormatProblem('')).toMatch(/Paste your Anthropic API key/);
    expect(apiKeyFormatProblem('sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG')).toMatch(/start with "sk-ant-"/);
    expect(apiKeyFormatProblem(`sk-ant-admin01-${'a'.repeat(60)}`)).toMatch(/Admin API key/);
    expect(apiKeyFormatProblem('sk-ant-short')).toMatch(/complete Anthropic API key/);
    expect(apiKeyFormatProblem(`${WELL_FORMED} and some words`)).toMatch(/complete Anthropic API key/);
    expect(apiKeyFormatProblem(`sk-ant-${'a'.repeat(300)}`)).toMatch(/complete Anthropic API key/);
  });
});

describe('anthropicKeyError', () => {
  const headers = new Headers();
  it('maps each SDK failure to a message the owner can act on', () => {
    const cases: [unknown, string][] = [
      [new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', headers), KEY_REJECTED],
      [new Anthropic.PermissionDeniedError(403, { type: 'error' }, 'permission_error', headers), KEY_FORBIDDEN],
      [new Anthropic.APIConnectionError({ message: 'getaddrinfo ENOTFOUND' }), KEY_UNREACHABLE],
      [new Anthropic.APIConnectionTimeoutError(), KEY_UNREACHABLE],
      [new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', headers), KEY_UNCHECKED],
      [new Anthropic.InternalServerError(529, { type: 'error' }, 'overloaded', headers), KEY_UNCHECKED],
      [new TypeError('something else'), KEY_UNCHECKED],
    ];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const [err, message] of cases) {
      const mapped = anthropicKeyError(err);
      expect(mapped).toBeInstanceOf(UserError);
      expect(mapped.message).toBe(message);
    }
    warn.mockRestore();
    error.mockRestore();
  });
});

describe('validateAnthropicKey (mocked SDK)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists one model with exactly the given key, and resolves when Anthropic accepts it', async () => {
    let seen: { apiKey: string | null; authToken: string | null; baseURL: string } | null = null;
    const list = vi.spyOn(Anthropic.Models.prototype, 'list').mockImplementation(function (this: Anthropic.Models) {
      const client = (this as unknown as { _client: Anthropic })._client;
      seen = { apiKey: client.apiKey, authToken: client.authToken, baseURL: client.baseURL };
      return Promise.resolve({ data: [] }) as never;
    });
    const saved = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_AUTH_TOKEN = 'deployment-token';
    try {
      await expect(validateAnthropicKey(WELL_FORMED)).resolves.toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = saved;
    }
    expect(list).toHaveBeenCalledWith({ limit: 1 });
    // The deployment's bearer token never rides along, and the key goes to Anthropic only.
    expect(seen).toEqual({ apiKey: WELL_FORMED, authToken: null, baseURL: 'https://api.anthropic.com' });
  });

  it('turns a rejected key into the friendly message, without the key in it', async () => {
    vi.spyOn(Anthropic.Models.prototype, 'list').mockImplementation(
      () => Promise.reject(new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', new Headers())) as never,
    );
    const err = await validateAnthropicKey(WELL_FORMED).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as Error).message).toBe(KEY_REJECTED);
    expect((err as Error).message).not.toContain('xYz1');
  });

  it('refuses a malformed key without calling Anthropic', async () => {
    const list = vi.spyOn(Anthropic.Models.prototype, 'list');
    await expect(validateAnthropicKey('not-a-key')).rejects.toThrow(/start with "sk-ant-"/);
    expect(list).not.toHaveBeenCalled();
  });
});

/**
 * The real API, for the one answer that costs nothing: an invalid key is a
 * 401. Skipped when api.anthropic.com cannot be reached from where the tests
 * run (offline CI, a sandbox without egress).
 */
describe('validateAnthropicKey (live API)', () => {
  let online = false;
  beforeAll(async () => {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(5_000),
      });
      online = res.status > 0;
    } catch {
      online = false;
    }
  });

  it('says Anthropic did not accept an invalid key', async (ctx) => {
    if (!online) ctx.skip();
    const invalid = `sk-ant-api03-${'0'.repeat(86)}-AAAA`;
    await expect(validateAnthropicKey(invalid)).rejects.toThrow(KEY_REJECTED);
  });
});
