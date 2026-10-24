import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onOneConnection } from '../test/one-connection';

/**
 * The admin plane's core server actions — a human edit, publishing, a
 * config change, the embed allowlist — as signed-in staff (not dev mode),
 * each on a one-connection pool (test/one-connection.ts): every query an
 * action makes while its userDb transaction is open must run on that
 * transaction. The session is read the way production reads it, through
 * the pooled client (test/database-session.ts), so an identity lookup inside
 * the transaction — the edit's author, audit()'s actor — would wait for a
 * second connection and fail the test just as a nested transaction would.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// Whoever `signedIn` names is the request's user.
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `ac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('admin actions on their own transaction', () => {
  const saved = process.env.AUTH_SECRET;
  const cleanup: { tenantId?: string; organizationId?: string; userIds: string[] } = { userIds: [] };
  let tenantSlug = '';
  let tenantId = '';
  let dimensionId = '';
  const people: Record<'owner' | 'editor', string> = { owner: '', editor: '' };

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const { tenant, dimensions } = await m.provisionTenant(db, { slug: uniq(), name: 'Admin City' });
    tenantSlug = tenant.slug;
    tenantId = tenant.id;
    dimensionId = dimensions[0]!.dimensionId;
    cleanup.tenantId = tenant.id;
    cleanup.organizationId = tenant.organizationId;
    for (const role of ['owner', 'editor'] as const) {
      const [user] = await db.insert(m.users).values({ email: `${uniq()}@${role}.example.gov` }).returning();
      people[role] = user!.id;
      cleanup.userIds.push(user!.id);
      await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: user!.id, role });
    }
  });

  afterAll(async () => {
    signedIn = null;
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();
    // Versions and audit entries go with the portrait (ON DELETE CASCADE).
    if (cleanup.tenantId) await db.delete(m.tenants).where(eq(m.tenants.id, cleanup.tenantId));
    if (cleanup.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, cleanup.organizationId));
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
  });

  async function auditOf(entityId: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const rows = await m.getDb().select().from(m.auditLog).where(eq(m.auditLog.entityId, entityId)).orderBy(m.auditLog.id);
    return rows.map((r) => [r.action, r.userId]);
  }

  it('clears the wedge when the final measured indicator is removed', async () => {
    signedIn = people.editor;
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const base = (await m.latestVersion(db, dimensionId))!;
    await m.appendDimensionVersion(db, { dimensionId, status: 'draft', origin: 'human', createdBy: people.editor,
      data: base.data, vizLevel: 75, changeNote: 'Historical scored fixture.' });
    const result = await (await import('./actions')).saveDimensionEdit({ tenantSlug, dimensionId,
      data: { ...base.data, indicators: [] }, changeNote: 'Remove the unsupported last indicator.' });
    expect(result.ok).toBe(true);
    expect((await m.latestVersion(db, dimensionId))!.vizLevel).toBeNull();
  });

  it('saves a human edit, reading the threshold overrides and its author on its own transaction', async () => {
    // It used to read the overrides through configValue, a second userDb
    // transaction, and the author and audit actor through getAuth(), each a
    // session read on the pooled client — all while its transaction held a
    // connection.
    const m = await import('@deep-fryer/db');
    const previous = (await m.latestVersion(m.getDb(), dimensionId))!;
    signedIn = people.editor;
    const res = await onOneConnection(async () =>
      (await import('./actions')).saveDimensionEdit({
        tenantSlug,
        dimensionId,
        data: previous.data,
        changeNote: 'Reworded the context.',
      }),
    );
    expect(res).toMatchObject({ ok: true, data: { versionNum: previous.versionNum + 1 } });
    const { versionId } = (res as { ok: true; data: { versionId: string } }).data;
    const { eq } = await import('drizzle-orm');
    const [version] = await m.getDb().select().from(m.dimensionVersions).where(eq(m.dimensionVersions.id, versionId));
    expect(version).toMatchObject({ origin: 'human', createdBy: people.editor, changeNote: 'Reworded the context.' });
    expect(await auditOf(versionId)).toEqual([['create_human_version', people.editor]]);
  });

  it('publishes a version on its own transaction, audit entry included', async () => {
    // publishVersionFor writes its audit entry on the caller's transaction.
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const draft = (await m.latestVersion(m.getDb(), dimensionId))!;
    signedIn = people.editor;
    const res = await onOneConnection(async () =>
      (await import('./actions')).publishVersion({ tenantSlug, versionId: draft.id }),
    );
    expect(res).toEqual({ ok: true, data: undefined });
    const [dimension] = await m.getDb().select().from(m.dimensions).where(eq(m.dimensions.id, dimensionId));
    expect(dimension!.publishedVersionId).toBe(draft.id);
    expect(await auditOf(dimensionId)).toEqual([['publish', people.editor]]);
  });

  it('changes a config key on its own transaction, recording who changed it', async () => {
    signedIn = people.owner;
    const value = { 'housing.cost_burden': { target: 25, rationale: 'City housing plan target.' } };
    const res = await onOneConnection(async () =>
      (await import('./actions')).updateConfig({ tenantSlug, key: 'threshold_overrides', value }),
    );
    expect(res).toEqual({ ok: true, data: undefined });
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const [row] = await m
      .getDb()
      .select()
      .from(m.tenantConfig)
      .where(and(eq(m.tenantConfig.tenantId, tenantId), eq(m.tenantConfig.key, 'threshold_overrides')));
    expect(row).toMatchObject({ value, updatedBy: people.owner });
    expect((await auditOf(tenantId)).filter(([action]) => action === 'config:threshold_overrides')).toEqual([
      ['config:threshold_overrides', people.owner],
    ]);
  });

  it('saves the embed allowlist on its own transaction, audit entry included', async () => {
    signedIn = people.owner;
    const res = await onOneConnection(async () =>
      (await import('./actions')).updateEmbedOrigins({ tenantSlug, origins: ['https://www.example.gov/'] }),
    );
    expect(res).toEqual({ ok: true, data: undefined });
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [tenant] = await m.getDb().select().from(m.tenants).where(eq(m.tenants.id, tenantId));
    expect(tenant!.embedOrigins).toEqual(['https://www.example.gov']);
    expect((await auditOf(tenantId)).filter(([action]) => action === 'embed_origins')).toEqual([
      ['embed_origins', people.owner],
    ]);
  });
});
