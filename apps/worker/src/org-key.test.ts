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
});
