import { AsyncLocalStorage } from 'node:async_hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onOneConnection } from '../test/one-connection';

/**
 * Membership changes and the last-owner guard (SPEC-v4 §2), as signed-in
 * owners under row-level security.
 *
 * A portrait's owners are its tenant-level owners plus the owners of the
 * organization holding it; demoting, removing, or leaving as the last of
 * them is refused, and the same for an organization's last owner. The guard
 * counts on the action's own transaction (migration 0014 for portraits,
 * where a tenant owner cannot read the organization's members), so each
 * action runs here on a one-connection pool (test/one-connection.ts), with
 * the session read through the pooled client as in production
 * (test/database-session.ts). And it locks what it counts: two owners
 * demoting each other at the same moment leave one owner, not none.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// Whoever `signedIn` names is the request's user — or, for requests run at
// the same time, whoever `requestUser` holds for that request.
let signedIn: string | null = null;
const requestUser = new AsyncLocalStorage<string>();
vi.mock('@/auth', () => ({
  auth: vi.fn(async () =>
    (await import('../test/database-session')).databaseSession(requestUser.getStore() ?? signedIn),
  ),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `ma-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const LAST_OWNER = { ok: false, error: 'This is the last owner. Make someone else an owner first.' };

describe.skipIf(!hasDb)('member actions and the last-owner guard', () => {
  const saved = process.env.AUTH_SECRET;
  const cleanup: { tenantIds: string[]; organizationIds: string[]; userIds: string[] } = {
    tenantIds: [],
    organizationIds: [],
    userIds: [],
  };

  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-secret';
  });

  afterAll(async () => {
    signedIn = null;
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const db = m.getDb();
    // Memberships and audit entries go with the portrait and the organization.
    if (cleanup.tenantIds.length) await db.delete(m.tenants).where(inArray(m.tenants.id, cleanup.tenantIds));
    if (cleanup.organizationIds.length) {
      await db.delete(m.organizations).where(inArray(m.organizations.id, cleanup.organizationIds));
    }
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
  });

  async function person(label: string) {
    const m = await import('@deep-fryer/db');
    const [user] = await m.getDb().insert(m.users).values({ email: `${uniq()}@${label}.example.gov` }).returning();
    cleanup.userIds.push(user!.id);
    return user!.id;
  }

  /** A portrait with these tenant-level members, in an organization with these owners. */
  async function portrait(members: Record<string, 'owner' | 'editor'>, orgOwners: string[] = []) {
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Member City' });
    cleanup.tenantIds.push(tenant.id);
    cleanup.organizationIds.push(tenant.organizationId);
    for (const [userId, role] of Object.entries(members)) {
      await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId, role });
    }
    for (const userId of orgOwners) {
      await db.insert(m.organizationMembers).values({ organizationId: tenant.organizationId, userId, role: 'owner' });
    }
    return tenant;
  }

  async function tenantRole(tenantId: string, userId: string) {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const [row] = await m
      .getDb()
      .select({ role: m.tenantMembers.role })
      .from(m.tenantMembers)
      .where(and(eq(m.tenantMembers.tenantId, tenantId), eq(m.tenantMembers.userId, userId)));
    return row?.role ?? null;
  }

  async function auditOf(tenantId: string, userId: string) {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const rows = await m
      .getDb()
      .select()
      .from(m.auditLog)
      .where(and(eq(m.auditLog.tenantId, tenantId), eq(m.auditLog.entityId, userId)))
      .orderBy(m.auditLog.id);
    return rows.map((r) => [r.action, r.userId]);
  }

  it('demotes an owner on its own transaction, counting the organization’s owners it cannot read', async () => {
    const [a, b, orgOwner] = [await person('a'), await person('b'), await person('org')];
    const tenant = await portrait({ [a]: 'owner', [b]: 'owner' }, [orgOwner]);
    signedIn = a;
    const res = await onOneConnection(async () =>
      (await import('./member-actions')).changeTenantMemberRole({ tenantSlug: tenant.slug, userId: b, role: 'editor' }),
    );
    expect(res).toEqual({ ok: true, data: undefined });
    expect(await tenantRole(tenant.id, b)).toBe('editor');
    expect(await auditOf(tenant.id, b)).toEqual([['change_role', a]]);

    // A is the last tenant-level owner, but the organization's owner still
    // administers the portrait, so A may step down — a count without the
    // organization's owners (A's own role cannot see them) would refuse.
    const stepDown = await onOneConnection(async () =>
      (await import('./member-actions')).changeTenantMemberRole({ tenantSlug: tenant.slug, userId: a, role: 'editor' }),
    );
    expect(stepDown).toEqual({ ok: true, data: undefined });
  });

  it('refuses to demote or remove the last owner, and to let the last owner leave', async () => {
    const [a, e] = [await person('a'), await person('e')];
    const tenant = await portrait({ [a]: 'owner', [e]: 'editor' });
    signedIn = a;
    const run = <T>(fn: (actions: typeof import('./member-actions')) => Promise<T>) =>
      onOneConnection(async () => fn(await import('./member-actions')));
    expect(await run((x) => x.changeTenantMemberRole({ tenantSlug: tenant.slug, userId: a, role: 'viewer' }))).toEqual(LAST_OWNER);
    expect(await run((x) => x.removeTenantMember({ tenantSlug: tenant.slug, userId: a }))).toEqual(LAST_OWNER);
    expect(await run((x) => x.leaveTenant({ tenantSlug: tenant.slug }))).toEqual({
      ok: false,
      error: 'You are the last owner. Make someone else an owner first.',
    });
    expect(await tenantRole(tenant.id, a)).toBe('owner');
    // Demoting someone who is not an owner needs no count at all.
    expect(await run((x) => x.changeTenantMemberRole({ tenantSlug: tenant.slug, userId: e, role: 'viewer' }))).toEqual({
      ok: true,
      data: undefined,
    });
  });

  it('removes an owner, and lets an owner leave, on their own transactions', async () => {
    const [a, b, c] = [await person('a'), await person('b'), await person('c')];
    const tenant = await portrait({ [a]: 'owner', [b]: 'owner', [c]: 'owner' });
    signedIn = a;
    const removed = await onOneConnection(async () =>
      (await import('./member-actions')).removeTenantMember({ tenantSlug: tenant.slug, userId: b }),
    );
    expect(removed).toEqual({ ok: true, data: undefined });
    expect(await tenantRole(tenant.id, b)).toBeNull();
    expect(await auditOf(tenant.id, b)).toEqual([['remove', a]]);

    signedIn = c;
    const left = await onOneConnection(async () => (await import('./member-actions')).leaveTenant({ tenantSlug: tenant.slug }));
    expect(left).toEqual({ ok: true, data: undefined });
    expect(await tenantRole(tenant.id, c)).toBeNull();
    expect(await tenantRole(tenant.id, a)).toBe('owner');
  });

  it('removes an organization owner on its own transaction, but never the last one', async () => {
    const [o1, o2] = [await person('o1'), await person('o2')];
    const tenant = await portrait({}, [o1, o2]);
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [org] = await m.getDb().select().from(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    signedIn = o1;
    const remove = (userId: string) =>
      onOneConnection(async () => (await import('./member-actions')).removeOrgMember({ orgSlug: org!.slug, userId }));
    expect(await remove(o2)).toEqual({ ok: true, data: undefined });
    expect(await remove(o1)).toEqual({
      ok: false,
      error: 'This is the last organization owner. Invite another owner first.',
    });
    const owners = await m
      .getDb()
      .select({ userId: m.organizationMembers.userId })
      .from(m.organizationMembers)
      .where(eq(m.organizationMembers.organizationId, tenant.organizationId));
    expect(owners).toEqual([{ userId: o1 }]);
  });

  it('leaves one owner, not none, when two owners demote each other at the same moment', async () => {
    // The count used to come from a separate snapshot, without a lock: each
    // request still counted the other as an owner and both went ahead.
    const [a, b] = [await person('a'), await person('b')];
    const tenant = await portrait({ [a]: 'owner', [b]: 'owner' });
    const { changeTenantMemberRole } = await import('./member-actions');
    const results = await Promise.all([
      requestUser.run(a, () => changeTenantMemberRole({ tenantSlug: tenant.slug, userId: b, role: 'editor' })),
      requestUser.run(b, () => changeTenantMemberRole({ tenantSlug: tenant.slug, userId: a, role: 'editor' })),
    ]);
    expect(results).toContainEqual({ ok: true, data: undefined });
    expect(results).toContainEqual(LAST_OWNER);
    const roles = [await tenantRole(tenant.id, a), await tenantRole(tenant.id, b)];
    expect(roles.sort()).toEqual(['editor', 'owner']);
  });
});
