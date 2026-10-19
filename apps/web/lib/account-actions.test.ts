import { AsyncLocalStorage } from 'node:async_hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Deleting an account (lib/account-actions.ts) against the owner locks the
 * member actions take (lib/member-actions.ts, migration 0014).
 *
 * deleteAccount refuses an organization's last owner. It decides that on
 * locked owner rows inside its own transaction, so two co-owners deleting
 * their accounts at once cannot both go ahead. And it takes its locks in the
 * order the member actions take theirs, so it queues behind one of them
 * instead of deadlocking with it. Both races are made deterministic here: a
 * test-held transaction takes the contested locks first, the requests start
 * and are seen waiting (pg_stat_activity), and only then does the test let
 * go.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// Each request's user is whoever `requestUser` holds for it; the session is
// read through the pooled client, as in production (test/database-session.ts).
const requestUser = new AsyncLocalStorage<string>();
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(requestUser.getStore() ?? null)),
  signOut: vi.fn(),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `aa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('deleteAccount and the owner locks', () => {
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
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const db = m.getDb();
    // Memberships go with the portrait and the organization.
    if (cleanup.tenantIds.length) await db.delete(m.tenants).where(inArray(m.tenants.id, cleanup.tenantIds));
    if (cleanup.organizationIds.length) {
      await db.delete(m.organizations).where(inArray(m.organizations.id, cleanup.organizationIds));
    }
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
  });

  async function person(label: string) {
    const m = await import('@deep-fryer/db');
    const email = `${uniq()}@${label}.example.gov`;
    const [user] = await m.getDb().insert(m.users).values({ email }).returning();
    cleanup.userIds.push(user!.id);
    return { id: user!.id, email };
  }

  /** A portrait, and the organization holding it with these owners. */
  async function portrait(orgOwners: string[]) {
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const name = `Account City ${uniq()}`;
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name });
    cleanup.tenantIds.push(tenant.id);
    cleanup.organizationIds.push(tenant.organizationId);
    for (const userId of orgOwners) {
      await db.insert(m.organizationMembers).values({ organizationId: tenant.organizationId, userId, role: 'owner' });
    }
    return { tenant, name };
  }

  async function orgOwners(organizationId: string) {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const rows = await m
      .getDb()
      .select({ userId: m.organizationMembers.userId })
      .from(m.organizationMembers)
      .where(and(eq(m.organizationMembers.organizationId, organizationId), eq(m.organizationMembers.role, 'owner')));
    return rows.map((r) => r.userId);
  }

  /** deleteAccount as `who`, settled: a successful deletion ends in redirect('/'). */
  async function deleteAs(who: { id: string; email: string }) {
    const { deleteAccount } = await import('./account-actions');
    return requestUser.run(who.id, () =>
      deleteAccount({ confirm: who.email }).then(
        (result) => result,
        (err: unknown) => {
          if (String((err as { digest?: unknown } | null)?.digest).startsWith('NEXT_REDIRECT')) return 'redirected';
          throw err;
        },
      ),
    );
  }

  /** Resolves once `n` other backends of this database are waiting on a lock. */
  async function waiting(n: number): Promise<void> {
    const m = await import('@deep-fryer/db');
    const { sql } = await import('drizzle-orm');
    for (let i = 0; i < 120; i++) {
      const [row] = await m.getDb().execute<{ n: number }>(sql`
        select count(*)::int as n from pg_stat_activity
         where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`);
      if (row!.n >= n) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`fewer than ${n} requests ever waited on a lock`);
  }

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  }

  /**
   * Waits for `step`, or fails with `running`'s own error if it ends first —
   * not a timeout that hides the error and skips the test's cleanup.
   */
  function reached(step: Promise<void>, running: Promise<unknown>): Promise<void> {
    return Promise.race([
      step,
      running.then(() => {
        throw new Error('the held transaction ended before it took its locks');
      }),
    ]);
  }

  it('leaves one owner, not none, when an organization’s two owners delete their accounts at the same moment', async () => {
    // The sole-owner check used to run before the transaction, without a
    // lock: each request still counted the other owner, and the two DELETEs
    // touch different rows, so both went ahead.
    const [g1, g2] = [await person('g1'), await person('g2')];
    const { tenant, name } = await portrait([g1.id, g2.id]);
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const held = deferred();
    const release = deferred();
    // Another request is changing the organization's owners: both deletions
    // reach their locks while it holds them.
    const blocker = m.getDb().transaction(async (tx) => {
      await tx
        .select({ userId: m.organizationMembers.userId })
        .from(m.organizationMembers)
        .where(and(eq(m.organizationMembers.organizationId, tenant.organizationId), eq(m.organizationMembers.role, 'owner')))
        .orderBy(m.organizationMembers.userId)
        .for('update');
      held.resolve();
      await release.promise;
    });
    let results: unknown[];
    try {
      await reached(held.promise, blocker);
      const both = Promise.all([deleteAs(g1), deleteAs(g2)]);
      await waiting(2);
      release.resolve();
      await blocker;
      results = await both;
    } finally {
      release.resolve();
      await blocker;
    }
    expect(results).toContainEqual('redirected');
    expect(results).toContainEqual({
      ok: false,
      error: `You are the only owner of ${name}. Invite another owner first.`,
    });
    expect(await orgOwners(tenant.organizationId)).toHaveLength(1);
  });

  it('queues behind a member action holding the portrait’s owner locks, instead of deadlocking with it', async () => {
    // changeTenantMemberRole locks the portrait's owners — the organization's
    // owners among them — and only then changes the member's row. When that
    // member is an organization owner deleting their account, the deletion
    // used to delete the portrait row first and then wait for its own
    // organization owner row: each held what the other wanted, and Postgres
    // ended one of them with "deadlock detected".
    const [other, leaving] = [await person('other'), await person('leaving')];
    const { tenant } = await portrait([other.id, leaving.id]);
    const m = await import('@deep-fryer/db');
    const { and, eq, sql } = await import('drizzle-orm');
    const db = m.getDb();
    await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: leaving.id, role: 'editor' });

    const counted = deferred();
    const change = deferred();
    // The other organization owner changes the leaving owner's portrait role,
    // as changeTenantMemberRole does: count (and lock) the owners, then update.
    const member = m.withAuthContext(db, other.id, async (tx) => {
      const [row] = await tx.execute<{ n: number }>(sql`select public.lock_tenant_owners(${tenant.id}::uuid) as n`);
      expect(row!.n).toBe(2);
      counted.resolve();
      await change.promise;
      await tx
        .update(m.tenantMembers)
        .set({ role: 'viewer' })
        .where(and(eq(m.tenantMembers.tenantId, tenant.id), eq(m.tenantMembers.userId, leaving.id)));
    });
    let deleted: unknown;
    try {
      await reached(counted.promise, member);
      const deletion = deleteAs(leaving);
      await waiting(1);
      change.resolve();
      await member;
      deleted = await deletion;
    } finally {
      change.resolve();
      await member.catch(() => undefined);
    }
    expect(deleted).toBe('redirected');
    expect(await orgOwners(tenant.organizationId)).toEqual([other.id]);
    const left = await db.select().from(m.tenantMembers).where(eq(m.tenantMembers.userId, leaving.id));
    expect(left).toEqual([]);
  });

  it('takes the unused sign-in links sent to the address with the account, and nobody else’s', async () => {
    // Auth.js keys a link by the address itself and deletes it only when it is used, so these would keep the
    // address an account deleted for good — the privacy notice says deleting removes it.
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const db = m.getDb();
    const leaving = await person('tokens');
    const other = await person('tokens-other');
    const soon = new Date(Date.now() + 10 * 60_000);
    await db.insert(m.verificationTokens).values([
      { identifier: leaving.email, token: `${uniq()}-a`, expires: soon },
      { identifier: leaving.email.toUpperCase(), token: `${uniq()}-b`, expires: new Date(Date.now() - 60_000) },
      { identifier: other.email, token: `${uniq()}-c`, expires: soon },
    ]);
    const identifiers = [leaving.email, leaving.email.toUpperCase(), other.email];
    try {
      expect(await deleteAs(leaving)).toBe('redirected');
      const left = await db
        .select({ identifier: m.verificationTokens.identifier })
        .from(m.verificationTokens)
        .where(inArray(m.verificationTokens.identifier, identifiers));
      expect(left).toEqual([{ identifier: other.email }]);
    } finally {
      await db.delete(m.verificationTokens).where(inArray(m.verificationTokens.identifier, identifiers));
    }
  });
});
