import { describe, expect, it } from 'vitest';

/**
 * lock_tenant_owners (migration 0014): the last-owner guard's count, run on
 * the acting request's own transaction. It counts every owner of a portrait
 * — tenant-level owners and the owners of the organization holding it —
 * even for a caller whose role cannot read the organization's members, and
 * it locks what it counts, so two requests deciding about the same
 * portrait's owners run one after the other: the second sees what the first
 * changed, instead of a snapshot from before it.
 */
type DbExecutor = import('./client.js').DbExecutor;
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('lock_tenant_owners', () => {
  async function setup(orgOwners: number) {
    const m = await import('./index.js');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Owner Town' });
    const people = await db
      .insert(m.users)
      .values(Array.from({ length: 2 + orgOwners }, () => ({ email: `${uniq()}@owner.example.gov` })))
      .returning();
    const [a, b, ...org] = people.map((p) => p.id) as [string, string, ...string[]];
    await db.insert(m.tenantMembers).values([
      { tenantId: tenant.id, userId: a, role: 'owner' },
      { tenantId: tenant.id, userId: b, role: 'owner' },
    ]);
    if (org.length) {
      await db
        .insert(m.organizationMembers)
        .values(org.map((userId) => ({ organizationId: tenant.organizationId, userId, role: 'owner' as const })));
    }
    const cleanup = async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
      await db.delete(m.users).where(inArray(m.users.id, people.map((p) => p.id)));
    };
    return { m, db, tenant, a, b, org, cleanup };
  }

  async function ownerCount(tx: DbExecutor, tenantId: string): Promise<number> {
    const { sql } = await import('drizzle-orm');
    const rows = await tx.execute<{ n: number }>(sql`select public.lock_tenant_owners(${tenantId}::uuid) as n`);
    return rows[0]!.n;
  }

  /** Resolves once some backend is waiting on a row lock inside lock_tenant_owners. */
  async function someoneWaits(db: DbExecutor): Promise<void> {
    const { sql } = await import('drizzle-orm');
    for (let i = 0; i < 80; i++) {
      const [row] = await db.execute<{ n: number }>(sql`
        select count(*)::int as n from pg_stat_activity
         where datname = current_database() and wait_event_type = 'Lock'
           and query like ${'%lock_tenant_owners%'}`);
      if (row!.n > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('nobody waited for the owner rows');
  }

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  }

  /**
   * Waits for the held transaction `running` to reach `step`, or fails with
   * its own error if it ends first. Awaiting `step` alone would turn any
   * failure before it (an assertion, a missing grant) into a test timeout
   * that reports the real error only as an unhandled rejection, and that
   * abandons the test before its finally blocks run cleanup().
   */
  function reached(step: Promise<void>, running: Promise<unknown>): Promise<void> {
    return Promise.race([
      step,
      running.then(() => {
        throw new Error('the held transaction ended before it got there');
      }),
    ]);
  }

  it('may be called by the app role only, since it takes row locks', async () => {
    const m = await import('./index.js');
    const { sql } = await import('drizzle-orm');
    const [row] = await m.getDb().execute<{ everyone: boolean; app: boolean }>(sql`
      select has_function_privilege('public', 'public.lock_tenant_owners(uuid)', 'EXECUTE') as everyone,
             has_function_privilege('deep_fryer_app', 'public.lock_tenant_owners(uuid)', 'EXECUTE') as app`);
    expect(row).toEqual({ everyone: false, app: true });
  });

  it('counts the organization’s owners for a tenant-level owner who cannot read them', async () => {
    const { m, db, tenant, a, cleanup } = await setup(1);
    const { eq } = await import('drizzle-orm');
    try {
      const asA = <T>(fn: (tx: DbExecutor) => Promise<T>) => m.withAuthContext(db, a, fn);
      // Under its own role the tenant owner sees no organization members…
      expect(
        await asA((tx) =>
          tx.select().from(m.organizationMembers).where(eq(m.organizationMembers.organizationId, tenant.organizationId)),
        ),
      ).toEqual([]);
      // …but the count includes the organization's owner, as member_role() does.
      expect(await asA((tx) => ownerCount(tx, tenant.id))).toBe(3);
    } finally {
      await cleanup();
    }
  });

  it('makes a second request wait for the first, then leaves out the owner the first one demoted', async () => {
    const { m, db, tenant, a, b, cleanup } = await setup(0);
    const { and, eq } = await import('drizzle-orm');
    try {
      const demoted = deferred();
      const commit = deferred();
      // A demotes B: counts (two owners, so allowed), demotes, and holds the
      // transaction open until B's own request is waiting.
      const first = m.withAuthContext(db, a, async (tx) => {
        expect(await ownerCount(tx, tenant.id)).toBe(2);
        await tx
          .update(m.tenantMembers)
          .set({ role: 'editor' })
          .where(and(eq(m.tenantMembers.tenantId, tenant.id), eq(m.tenantMembers.userId, b)));
        demoted.resolve();
        await commit.promise;
      });
      try {
        await reached(demoted.promise, first);
        // At the same moment B wants to demote A, and counts first. Without
        // the lock it would still count B (its snapshot predates A's commit)
        // and go ahead, leaving no owner.
        const second = m.withAuthContext(db, b, (tx) => ownerCount(tx, tenant.id));
        await someoneWaits(db);
        commit.resolve();
        await first;
        expect(await second).toBe(1);
      } finally {
        commit.resolve();
        await first;
      }
    } finally {
      await cleanup();
    }
  });

  it('also waits for a removal of one of the organization’s owners', async () => {
    const { m, db, tenant, a, org, cleanup } = await setup(2);
    const { and, eq } = await import('drizzle-orm');
    try {
      const removed = deferred();
      const commit = deferred();
      // An organization owner is removed, its owner rows locked first (as
      // apps/web removeOrgMember does), while A counts the portrait's owners.
      const first = db.transaction(async (tx) => {
        await tx
          .select({ userId: m.organizationMembers.userId })
          .from(m.organizationMembers)
          .where(and(eq(m.organizationMembers.organizationId, tenant.organizationId), eq(m.organizationMembers.role, 'owner')))
          .for('update');
        await tx
          .delete(m.organizationMembers)
          .where(and(eq(m.organizationMembers.organizationId, tenant.organizationId), eq(m.organizationMembers.userId, org[1]!)));
        removed.resolve();
        await commit.promise;
      });
      try {
        await reached(removed.promise, first);
        const second = m.withAuthContext(db, a, (tx) => ownerCount(tx, tenant.id));
        await someoneWaits(db);
        commit.resolve();
        await first;
        // A and B on the portrait, and the one organization owner left.
        expect(await second).toBe(3);
      } finally {
        commit.resolve();
        await first;
      }
    } finally {
      await cleanup();
    }
  });
});
