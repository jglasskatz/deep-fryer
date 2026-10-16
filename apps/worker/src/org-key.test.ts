import { afterAll, describe, expect, it } from 'vitest';
import { encryptSecret, keyHint, parseSecretsKey } from '@deep-fryer/core/secrets';

/**
 * orgApiKeyForTenant against Postgres: the worker reads the ciphertext the
 * web app stored (as the table owner, which the app role cannot), decrypts
 * it with DF_SECRETS_KEY, and either returns the organization's key or fails
 * loudly — never null for a key that is on file, because null means "use the
 * deployment's key".
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const randomSecretsKey = () => btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(32))));
const API_KEY = `sk-ant-api03-${'Zx9'.repeat(30)}-Q7rT`;

describe.skipIf(!hasDb)('orgApiKeyForTenant (Postgres)', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  /** A portrait whose organization may store a key encrypted under `secretsKey`. */
  async function portrait() {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Key Town' });
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    });
    const store = async (secretsKey: string, organizationId = tenant.organizationId) => {
      const ciphertext = await encryptSecret(API_KEY, parseSecretsKey(secretsKey), organizationId);
      await m.upsertOrganizationApiKey(db, {
        organizationId: tenant.organizationId,
        ciphertext,
        keyHint: keyHint(API_KEY),
        createdBy: null,
        validatedAt: new Date(),
      });
    };
    return { db, tenant, store };
  }

  it('returns null when the organization has no key (its sessions use the deployment key)', async () => {
    const { orgApiKeyForTenant } = await import('./org-key.js');
    const { db, tenant } = await portrait();
    expect(await orgApiKeyForTenant(db, tenant.id, randomSecretsKey())).toBeNull();
    // No key on file needs no DF_SECRETS_KEY either.
    expect(await orgApiKeyForTenant(db, tenant.id, undefined)).toBeNull();
  });

  it('round-trips the key the web app stored', async () => {
    const { orgApiKeyForTenant } = await import('./org-key.js');
    const { db, tenant, store } = await portrait();
    const secretsKey = randomSecretsKey();
    await store(secretsKey);
    expect(await orgApiKeyForTenant(db, tenant.id, secretsKey)).toBe(API_KEY);
  });

  it('fails with a staff-readable error — not null — when DF_SECRETS_KEY was rotated or is missing', async () => {
    const { ORG_KEY_NO_SECRETS_KEY, ORG_KEY_UNREADABLE, OrgKeyUnavailableError, orgApiKeyForTenant } = await import(
      './org-key.js'
    );
    const { db, tenant, store } = await portrait();
    await store(randomSecretsKey());

    const rotated = await orgApiKeyForTenant(db, tenant.id, randomSecretsKey()).catch((e: unknown) => e);
    expect(rotated).toBeInstanceOf(OrgKeyUnavailableError);
    expect((rotated as Error).message).toBe(ORG_KEY_UNREADABLE);
    expect((rotated as Error).message).toMatch(/never used in its place/);
    expect((rotated as Error).message).not.toContain(API_KEY.slice(-12));

    await expect(orgApiKeyForTenant(db, tenant.id, undefined)).rejects.toThrow(ORG_KEY_NO_SECRETS_KEY);
    await expect(orgApiKeyForTenant(db, tenant.id, 'too-short')).rejects.toThrow(OrgKeyUnavailableError);
  });

  it('does not decrypt a ciphertext made for another organization', async () => {
    const { OrgKeyUnavailableError, orgApiKeyForTenant } = await import('./org-key.js');
    const { db, tenant, store } = await portrait();
    const secretsKey = randomSecretsKey();
    // Sealed for a different organization id, then written onto this one's row.
    await store(secretsKey, '00000000-0000-4000-8000-000000000000');
    await expect(orgApiKeyForTenant(db, tenant.id, secretsKey)).rejects.toThrow(OrgKeyUnavailableError);
  });
  it('picks the key from the funding stored on the work, not from what is on file now', async () => {
    const { ORG_KEY_REMOVED, OrgKeyUnavailableError, sessionApiKey } = await import('./org-key.js');
    const { db, tenant, store } = await portrait();
    const secretsKey = randomSecretsKey();

    // Key-funded work with no key on file (removed after it was queued) fails;
    // it never comes back as null, which would mean "use the deployment's key".
    const removed = await sessionApiKey(db, tenant.id, 'organization_key', secretsKey).catch((e: unknown) => e);
    expect(removed).toBeInstanceOf(OrgKeyUnavailableError);
    expect((removed as Error).message).toBe(ORG_KEY_REMOVED);
    expect(ORG_KEY_REMOVED.length).toBeLessThanOrEqual(400);

    await store(secretsKey);
    expect(await sessionApiKey(db, tenant.id, 'organization_key', secretsKey)).toBe(API_KEY);
    // Plan-funded work stays on the deployment's key with a key on file — the
    // key is not even read, so no DF_SECRETS_KEY is needed for it.
    expect(await sessionApiKey(db, tenant.id, 'plan', secretsKey)).toBeNull();
    expect(await sessionApiKey(db, tenant.id, 'plan', undefined)).toBeNull();
  });
});

describe('orgKeyRejected', () => {
  /** The bundled CLI's (0.3.220) error-frame texts for the two dead-key cases it reports as invalid_request. */
  const DISABLED_ORG = 'Your ANTHROPIC_API_KEY belongs to a disabled organization \u00b7 Update or unset the environment variable';
  const API_KEYS_OFF =
    'Your organization has disabled API key authentication \u00b7 Unset ANTHROPIC_API_KEY and run /login to sign in with your claude.ai account';

  it('names only the errors no retry can fix', async () => {
    const { isKeyRejectedError, keyRejection } = await import('./org-key.js');
    for (const e of ['authentication_failed', 'billing_error', 'model_not_found', 'oauth_org_not_allowed']) {
      expect(isKeyRejectedError(e)).toBe(true);
      expect(keyRejection(e)).toBe(e);
    }
    for (const e of ['rate_limit', 'overloaded', 'server_error', 'invalid_request', 'unknown', 'max_output_tokens', undefined]) {
      expect(isKeyRejectedError(e)).toBe(false);
      expect(keyRejection(e, 'Overloaded')).toBeNull();
    }
  });

  it('reads a disabled organization and API keys turned off out of an invalid_request frame', async () => {
    const { keyRejection } = await import('./org-key.js');
    expect(keyRejection('invalid_request', DISABLED_ORG)).toBe('organization_disabled');
    expect(keyRejection('invalid_request', API_KEYS_OFF)).toBe('api_key_auth_disabled');
    // The subscription-login variant of the same message.
    expect(keyRejection('invalid_request', 'Your ANTHROPIC_API_KEY belongs to a disabled organization \u00b7 Unset the environment variable to use your subscription instead')).toBe(
      'organization_disabled',
    );
    // Any other invalid request (a malformed message, a prompt too long) may be the session's own doing: retried as before.
    expect(keyRejection('invalid_request', 'API Error: 400 messages.1.content: text content blocks must be non-empty')).toBeNull();
    expect(keyRejection('invalid_request')).toBeNull();
    // The wording alone, on another error, is not a key refusal.
    expect(keyRejection('server_error', DISABLED_ORG)).toBeNull();
  });

  it('tells staff whose key was refused and what an organization owner can do, within what a row keeps', async () => {
    const { OrgKeyUnavailableError, orgKeyRejected } = await import('./org-key.js');
    const rejections = [
      'authentication_failed',
      'billing_error',
      'model_not_found',
      'oauth_org_not_allowed',
      'organization_disabled',
      'api_key_auth_disabled',
    ] as const;
    const messages = new Set<string>();
    for (const rejection of rejections) {
      const err = orgKeyRejected(rejection, 'claude-opus-5-'.padEnd(80, 'x'), { input_tokens: 5, output_tokens: 1 });
      expect(err).toBeInstanceOf(OrgKeyUnavailableError);
      expect(err.message).toMatch(/this organization's own API key/i);
      expect(err.message).toContain("the deployment's own key is never used in its place");
      expect(err.message).toMatch(/An organization owner can .* then start this again\.$/);
      expect(err.message.length).toBeLessThanOrEqual(400);
      // What the session spent before the refusal rides along for the caller to record.
      expect(err.usage).toEqual({ input_tokens: 5, output_tokens: 1 });
      expect(err.rejection).toBe(rejection);
      // The organization's own key is the organization's to fix, not the operator's —
      // except a model id the API did not find, which the service's model setting can cause too.
      if (rejection === 'model_not_found') {
        expect(err.message).toMatch(/the key may not allow it, or the model setting is wrong/);
        expect(err.message).toMatch(/or ask the operator to check the setting/);
        expect(err.message).not.toMatch(/administrator/);
      } else {
        expect(err.message).not.toMatch(/administrator|operator/);
      }
      messages.add(err.message);
    }
    // Each refusal has its own reason.
    expect(messages.size).toBe(rejections.length);
    expect(orgKeyRejected('model_not_found', 'claude-opus-5').message).toContain('(claude-opus-5)');
    expect(orgKeyRejected('model_not_found', 'claude-opus-5').model).toBe('claude-opus-5');
    expect(orgKeyRejected('billing_error', 'claude-opus-5').usage).toBeUndefined();
  });

  it('names the model the error frame says was not found, which may be a refusal fallback’s', async () => {
    const { modelNamedIn, rejectedKeyError } = await import('./org-key.js');
    const notFound = "There's an issue with the selected model (claude-opus-4-8). It may not exist or you may not have access to it.";
    expect(modelNamedIn(notFound)).toBe('claude-opus-4-8');
    expect(modelNamedIn('The model claude-sonnet-5 is not available on your bedrock deployment. Try switching to x')).toBe('claude-sonnet-5');
    expect(modelNamedIn('Overloaded')).toBeNull();
    expect(modelNamedIn(undefined)).toBeNull();

    // Started on claude-opus-5; the CLI's refusal fallback asked for claude-opus-4-8, which the key may not use.
    const err = rejectedKeyError({ apiError: 'model_not_found', apiErrorText: notFound }, 'claude-opus-5');
    expect(err?.message).toContain('(claude-opus-4-8)');
    expect(err?.model).toBe('claude-opus-4-8');
    // Without a model in the text, the session's own model is named.
    expect(rejectedKeyError({ apiError: 'model_not_found' }, 'claude-opus-5')?.message).toContain('(claude-opus-5)');
    expect(rejectedKeyError({ apiError: 'invalid_request', apiErrorText: DISABLED_ORG }, 'claude-opus-5')?.rejection).toBe('organization_disabled');
    expect(rejectedKeyError({ apiError: 'overloaded' }, 'claude-opus-5')).toBeNull();
    expect(rejectedKeyError({}, 'claude-opus-5')).toBeNull();
  });

  it('tells the operator which model id was not found, and where to look', async () => {
    const { modelNotFoundLog } = await import('./org-key.js');
    expect(modelNotFoundLog('claude-opus-5-typo', false)).toBe(
      'Anthropic reported model_not_found for model "claude-opus-5-typo" on the deployment\'s API key: check that ANTHROPIC_MODEL / VERIFIER_MODEL name a valid model id',
    );
    expect(modelNotFoundLog('claude-opus-5', true)).toMatch(/on the organization's own API key: .*, or that the key's workspace may use it$/);
  });
});
