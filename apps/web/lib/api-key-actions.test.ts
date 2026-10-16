import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { onOneConnection } from '../test/one-connection';

/**
 * saveApiKey / removeApiKey (SPEC-v7 §4) against real Postgres, as the
 * dev-mode identity (no AUTH_SECRET: the local developer is an owner
 * everywhere). Anthropic's Models API is stubbed at the SDK method, so what
 * is under test is everything around it: encryption at rest, the hint, the
 * audit trail without the key, and the refusals. A second block checks the
 * database's own rules for the table — row-level security and the column
 * grants that keep the ciphertext from the app role — with real users.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const randomSecretsKey = () => btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(32))));
const API_KEY = `sk-ant-api03-${'Hy6tR'.repeat(18)}-Jk8M`;
const OTHER_KEY = `sk-ant-api03-${'Bn2wQ'.repeat(18)}-Zz9P`;

// Server actions revalidate pages; there is no Next request here.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// For the signed-in block at the end: whoever `signedIn` names is the
// request's user, the session read through the pooled client as in
// production (test/database-session.ts). Dev mode never calls auth().
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));

describe.skipIf(!hasDb)('saveApiKey and removeApiKey', () => {
  const saved = { AUTH_SECRET: process.env.AUTH_SECRET, DF_SECRETS_KEY: process.env.DF_SECRETS_KEY };
  const secretsKey = randomSecretsKey();
  const cleanup: (() => Promise<unknown>)[] = [];
  beforeAll(() => {
    delete process.env.AUTH_SECRET;
    process.env.DF_SECRETS_KEY = secretsKey;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /** An organization with two portraits (each portrait's audit trail records key changes). */
  async function organization() {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const org = await m.provisionOrganization(db, { slug: uniq(), name: 'Keyholder City', startTrial: true });
    const { tenant: a } = await m.provisionTenant(db, { slug: uniq(), name: 'Keyholder City', organizationId: org.id });
    const { tenant: b } = await m.provisionTenant(db, { slug: uniq(), name: 'Keyholder North', organizationId: org.id });
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.organizationId, org.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, org.id));
    });
    const keyAudit = () =>
      db
        .select()
        .from(m.auditLog)
        .where(eq(m.auditLog.entity, 'organization_api_key'))
        .then((rows) => rows.filter((r) => r.entityId === org.id));
    const stored = async () => {
      const [row] = await db.select().from(m.organizationApiKeys).where(eq(m.organizationApiKeys.organizationId, org.id));
      return row ?? null;
    };
    return { org, portraits: [a, b], keyAudit, stored };
  }

  const anthropicAccepts = () =>
    vi.spyOn(Anthropic.Models.prototype, 'list').mockImplementation(() => Promise.resolve({ data: [] }) as never);

  it('validates, encrypts, and stores the key; the page, the result, and the audit see only its hint', async () => {
    const { saveApiKey } = await import('./api-key-actions');
    const { decryptSecret, parseSecretsKey } = await import('@deep-fryer/core/secrets');
    const { org, portraits, keyAudit, stored } = await organization();
    const list = anthropicAccepts();

    const res = await saveApiKey(org.slug, `  ${API_KEY}\n`);
    expect(res).toMatchObject({ ok: true, data: { keyHint: 'Jk8M' } });
    expect(JSON.stringify(res)).not.toContain(API_KEY);
    expect(list).toHaveBeenCalledTimes(1);

    const row = await stored();
    expect(row).toMatchObject({ provider: 'anthropic', keyHint: 'Jk8M' });
    expect(row!.validatedAt).toBeInstanceOf(Date);
    expect(row!.ciphertext.startsWith('v1:')).toBe(true);
    expect(row!.ciphertext).not.toContain(API_KEY.slice(13, 30));
    // Encrypted at rest under DF_SECRETS_KEY and bound to this organization.
    expect(await decryptSecret(row!.ciphertext, parseSecretsKey(secretsKey), org.id)).toBe(API_KEY);

    const audit = await keyAudit();
    expect(audit.map((a) => a.tenantId).sort()).toEqual(portraits.map((p) => p.id).sort());
    expect(audit[0]).toMatchObject({ action: 'save', before: null, after: { key_hint: 'Jk8M', provider: 'anthropic' } });
    const recorded = JSON.stringify(audit.map((a) => [a.before, a.after]));
    expect(recorded).not.toContain(API_KEY);
    expect(recorded).not.toContain(row!.ciphertext);

    // Replacing records the old and new hints and re-encrypts.
    const replaced = await saveApiKey(org.slug, OTHER_KEY);
    expect(replaced).toMatchObject({ ok: true, data: { keyHint: 'Zz9P' } });
    expect((await stored())!.keyHint).toBe('Zz9P');
    expect((await keyAudit()).filter((a) => a.action === 'replace')[0]).toMatchObject({
      before: { key_hint: 'Jk8M' },
      after: { key_hint: 'Zz9P' },
    });
  });

  it('removes the key, and says so when there is none', async () => {
    const { removeApiKey, saveApiKey } = await import('./api-key-actions');
    const { org, keyAudit, stored } = await organization();
    anthropicAccepts();
    await saveApiKey(org.slug, API_KEY);

    expect(await removeApiKey(org.slug)).toEqual({ ok: true, data: { removed: true } });
    expect(await stored()).toBeNull();
    expect((await keyAudit()).filter((a) => a.action === 'remove')[0]).toMatchObject({ before: { key_hint: 'Jk8M' }, after: null });
    expect(await removeApiKey(org.slug)).toEqual({ ok: false, error: 'There is no API key on file for this organization.' });
  });

  it('stores nothing when Anthropic rejects the key or the key is malformed', async () => {
    const { saveApiKey } = await import('./api-key-actions');
    const { KEY_REJECTED } = await import('./anthropic-key');
    const { org, stored } = await organization();
    vi.spyOn(Anthropic.Models.prototype, 'list').mockImplementation(
      () => Promise.reject(new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', new Headers())) as never,
    );
    expect(await saveApiKey(org.slug, API_KEY)).toEqual({ ok: false, error: KEY_REJECTED });
    expect(await saveApiKey(org.slug, 'sk-live-not-anthropic-but-long-enough-to-look-real')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/start with "sk-ant-"/),
    });
    expect(await stored()).toBeNull();
  });

  it('refuses before calling Anthropic when the server has no DF_SECRETS_KEY', async () => {
    const { saveApiKey } = await import('./api-key-actions');
    const { org, stored } = await organization();
    const list = anthropicAccepts();
    delete process.env.DF_SECRETS_KEY;
    try {
      const res = await saveApiKey(org.slug, API_KEY);
      expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/operator has not set DF_SECRETS_KEY/) });
      process.env.DF_SECRETS_KEY = 'not-32-bytes';
      expect(await saveApiKey(org.slug, API_KEY)).toMatchObject({ ok: false, error: expect.stringMatching(/not a valid 32-byte key/) });
    } finally {
      process.env.DF_SECRETS_KEY = secretsKey;
    }
    expect(list).not.toHaveBeenCalled();
    expect(await stored()).toBeNull();
  });

  it('refuses an unknown organization', async () => {
    const { saveApiKey, removeApiKey } = await import('./api-key-actions');
    expect(await saveApiKey('no-such-org-anywhere', API_KEY)).toEqual({ ok: false, error: 'Unknown organization.' });
    expect(await removeApiKey('no-such-org-anywhere')).toEqual({ ok: false, error: 'Unknown organization.' });
  });
});

/**
 * The table's database rules (migration 0011) through the helpers the
 * actions use: owners may write and read the hint, nobody else may do
 * either, and the app role can never select the ciphertext — not even an
 * owner's own.
 */
describe.skipIf(!hasDb)('organization_api_keys under row-level security', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  it('lets owners write and read the hint, keeps everyone else out, and never shows the app role the ciphertext', async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const [owner, billing, outsider] = await db
      .insert(m.users)
      .values([{ email: `${uniq()}@owner.gov` }, { email: `${uniq()}@billing.gov` }, { email: `${uniq()}@elsewhere.gov` }])
      .returning();
    const org = await m.provisionOrganization(db, { slug: uniq(), name: 'RLS City', ownerUserId: owner!.id });
    await db.insert(m.organizationMembers).values({ organizationId: org.id, userId: billing!.id, role: 'billing' });
    cleanup.push(async () => {
      await db.delete(m.organizations).where(eq(m.organizations.id, org.id));
      for (const u of [owner, billing, outsider]) await db.delete(m.users).where(eq(m.users.id, u!.id));
    });
    const values = { organizationId: org.id, ciphertext: 'v1:aaaa:bbbb', keyHint: 'Ab12', createdBy: owner!.id, validatedAt: new Date() };
    const as = <T>(userId: string, fn: (tx: typeof db) => Promise<T>) => m.withAuthContext(db, userId, fn as never) as Promise<T>;

    // Not an owner: cannot store a key (billing contacts neither).
    for (const who of [billing!, outsider!]) {
      await expect(as(who.id, (tx) => m.upsertOrganizationApiKey(tx, values))).rejects.toThrow(/row-level security/);
    }

    await as(owner!.id, (tx) => m.upsertOrganizationApiKey(tx, values));
    // Replacing goes through ON CONFLICT DO UPDATE under the same rules.
    await as(owner!.id, (tx) => m.upsertOrganizationApiKey(tx, { ...values, keyHint: 'Cd34' }));
    expect(await as(owner!.id, (tx) => m.organizationApiKeyInfo(tx, org.id))).toMatchObject({ keyHint: 'Cd34', provider: 'anthropic' });
    expect(await as(billing!.id, (tx) => m.organizationApiKeyInfo(tx, org.id))).toBeNull();
    expect(await as(outsider!.id, (tx) => m.organizationApiKeyInfo(tx, org.id))).toBeNull();

    // The ciphertext column is not granted to the app role at all.
    await expect(
      as(owner!.id, (tx) =>
        tx.select({ c: m.organizationApiKeys.ciphertext }).from(m.organizationApiKeys).where(eq(m.organizationApiKeys.organizationId, org.id)),
      ),
    ).rejects.toThrow(/permission denied/);

    expect(await as(outsider!.id, (tx) => m.deleteOrganizationApiKey(tx, org.id))).toBeNull();
    expect(await as(owner!.id, (tx) => m.deleteOrganizationApiKey(tx, org.id))).toBe('Cd34');
  });
});

/**
 * The same actions for a signed-in organization owner (not dev mode), each on
 * a one-connection pool (test/one-connection.ts). A key change is audited on
 * every portrait of the organization inside the action's userDb transaction,
 * and audit() reads its actor with getAuth(): in a server action that was a
 * session read on the pooled client per portrait, each waiting for a second
 * connection while the transaction held the first.
 */
describe.skipIf(!hasDb)('saveApiKey and removeApiKey as a signed-in owner', () => {
  const saved = { AUTH_SECRET: process.env.AUTH_SECRET, DF_SECRETS_KEY: process.env.DF_SECRETS_KEY };
  const cleanup: (() => Promise<unknown>)[] = [];
  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-secret';
    process.env.DF_SECRETS_KEY = randomSecretsKey();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    signedIn = null;
    for (const fn of cleanup.reverse()) await fn();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('saves and removes the key on their own transactions, auditing each portrait as the owner', async () => {
    const m = await import('@deep-fryer/db');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();
    const [owner] = await db.insert(m.users).values({ email: `${uniq()}@owner.example.gov` }).returning();
    const org = await m.provisionOrganization(db, { slug: uniq(), name: 'Signed-in City', startTrial: true, ownerUserId: owner!.id });
    const { tenant: a } = await m.provisionTenant(db, { slug: uniq(), name: 'Signed-in City', organizationId: org.id });
    const { tenant: b } = await m.provisionTenant(db, { slug: uniq(), name: 'Signed-in North', organizationId: org.id });
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.organizationId, org.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, org.id));
      await db.delete(m.users).where(eq(m.users.id, owner!.id));
    });
    vi.spyOn(Anthropic.Models.prototype, 'list').mockImplementation(() => Promise.resolve({ data: [] }) as never);

    signedIn = owner!.id;
    const saveRes = await onOneConnection(async () => (await import('./api-key-actions')).saveApiKey(org.slug, API_KEY));
    expect(saveRes).toMatchObject({ ok: true, data: { keyHint: 'Jk8M' } });
    const removeRes = await onOneConnection(async () => (await import('./api-key-actions')).removeApiKey(org.slug));
    expect(removeRes).toEqual({ ok: true, data: { removed: true } });

    const log = await db
      .select()
      .from(m.auditLog)
      .where(inArray(m.auditLog.tenantId, [a.id, b.id]))
      .then((rows) => rows.filter((r) => r.entity === 'organization_api_key'));
    expect(log.map((l) => [l.tenantId, l.action, l.userId]).sort()).toEqual(
      [
        [a.id, 'save', owner!.id],
        [b.id, 'save', owner!.id],
        [a.id, 'remove', owner!.id],
        [b.id, 'remove', owner!.id],
      ].sort(),
    );
    signedIn = null;
  });
});
