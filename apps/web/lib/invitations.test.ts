import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Accepting an invitation (SPEC-v4 §2) only ever adds authority. Someone who
 * already holds the invited role or a higher one keeps theirs, so an owner
 * accepting an older editor invitation is not demoted past the last-owner
 * rule; a lower role is raised to the invited one. Either way the invitation
 * is used up.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
// No invitation email is sent here: the link is what createInvitation returns either way.
vi.mock('./email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./email')>()),
  emailDeliverable: () => false,
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('acceptInvitation', () => {
  const cleanup: { tenantIds: string[]; organizationIds: string[]; userIds: string[] } = {
    tenantIds: [],
    organizationIds: [],
    userIds: [],
  };

  afterAll(async () => {
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const db = m.getDb();
    // Memberships and invitations go with the portrait and the organization.
    if (cleanup.tenantIds.length) await db.delete(m.tenants).where(inArray(m.tenants.id, cleanup.tenantIds));
    if (cleanup.organizationIds.length) {
      await db.delete(m.organizations).where(inArray(m.organizations.id, cleanup.organizationIds));
    }
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
  });

  /** A person, a portrait they hold `tenantRole` on, and its organization, where they hold `orgRole`. */
  async function setup(tenantRole: 'owner' | 'viewer' | null, orgRole: 'owner' | 'billing' | null) {
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const email = `${uniq()}@invited.example.gov`;
    const [user] = await db.insert(m.users).values({ email }).returning();
    cleanup.userIds.push(user!.id);
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Invite City' });
    cleanup.tenantIds.push(tenant.id);
    cleanup.organizationIds.push(tenant.organizationId);
    if (tenantRole) await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: user!.id, role: tenantRole });
    if (orgRole) {
      await db
        .insert(m.organizationMembers)
        .values({ organizationId: tenant.organizationId, userId: user!.id, role: orgRole });
    }
    return { m, db, user: { id: user!.id, email }, tenant };
  }

  /** An unexpired invitation for `email`, returning its raw token. */
  async function invite(
    scope: { tenantId: string } | { organizationId: string },
    email: string,
    role: string,
  ): Promise<string> {
    const m = await import('@deep-fryer/db');
    const { hashToken } = await import('./invitations');
    const token = randomBytes(24).toString('base64url');
    await m
      .getDb()
      .insert(m.invitations)
      .values({ ...scope, email, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) });
    return token;
  }

  async function tenantRoleOf(tenantId: string, userId: string) {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const [row] = await m
      .getDb()
      .select({ role: m.tenantMembers.role })
      .from(m.tenantMembers)
      .where(and(eq(m.tenantMembers.tenantId, tenantId), eq(m.tenantMembers.userId, userId)));
    return row?.role ?? null;
  }

  /** Hold the invitation until its acceptance is waiting, then change it before commit. */
  async function whileInvitationLocked(
    token: string,
    accept: () => Promise<void>,
    change: (tx: import('@deep-fryer/db').DbExecutor) => Promise<void>,
    waiters = 1,
  ) {
    const m = await import('@deep-fryer/db');
    const { eq, sql } = await import('drizzle-orm');
    const { hashToken } = await import('./invitations');
    let held!: (pid: number) => void;
    let release!: () => void;
    const locked = new Promise<number>((resolve) => { held = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const blocker = m.getDb().transaction(async (tx) => {
      await tx.select().from(m.invitations)
        .where(eq(m.invitations.tokenHash, hashToken(token))).for('update');
      const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      held(backend!.pid);
      await released;
      await change(tx);
    });
    let running: Promise<void> | undefined;
    try {
      const blockerPid = await Promise.race([
        locked, blocker.then(() => { throw new Error('invitation lock was not acquired'); }),
      ]);
      running = accept();
      // Attach a rejection handler immediately; propagate its result after releasing the lock.
      void running.catch(() => undefined);
      let waiting = false;
      for (let i = 0; i < 120; i++) {
        const [row] = await m.getDb().execute<{ n: number }>(sql`
          WITH RECURSIVE blocked(pid) AS (
            SELECT ${blockerPid}::int
            UNION
            SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
          )
          SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE pid IN (SELECT pid FROM blocked WHERE pid <> ${blockerPid})
             AND wait_event_type = 'Lock' AND query ILIKE '%"invitations"%'`);
        if (row!.n >= waiters) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting, `${waiters} acceptance(s) must have read the live invitation and be waiting to claim it`).toBe(true);
      release();
      await blocker;
      await running;
    } finally {
      release();
      await blocker;
      await running?.catch(() => undefined);
    }
  }

  it.each(['tenant', 'organization'] as const)(
    'does not grant %s membership if revocation wins after the live invitation lookup',
    async (kind) => {
      const { m, db, user, tenant } = await setup(null, null);
      const scope = kind === 'tenant' ? { tenantId: tenant.id } : { organizationId: tenant.organizationId };
      const token = await invite(scope, user.email, kind === 'tenant' ? 'editor' : 'billing');
      const { acceptInvitation, hashToken, liveInvitation } = await import('./invitations');
      const { eq } = await import('drizzle-orm');
      await whileInvitationLocked(token, async () => {
        await expect(acceptInvitation(token, user)).rejects.toThrow(/no longer valid/);
      }, async (tx) => {
        await tx.update(m.invitations).set({ revokedAt: new Date() })
          .where(eq(m.invitations.tokenHash, hashToken(token)));
      });
      expect(await tenantRoleOf(tenant.id, user.id)).toBeNull();
      const orgMemberships = await db.select().from(m.organizationMembers)
        .where(eq(m.organizationMembers.userId, user.id));
      expect(orgMemberships).toEqual([]);
      const [invitation] = await db.select().from(m.invitations)
        .where(eq(m.invitations.tokenHash, hashToken(token)));
      expect(invitation!.acceptedAt).toBeNull();
      expect(invitation!.acceptedBy).toBeNull();
      expect(invitation!.revokedAt).not.toBeNull();
      expect(await liveInvitation(token)).toBeNull();
    },
  );

  it('does not consume an invitation that expires before the claim can execute', async () => {
    const { m, db, user, tenant } = await setup(null, null);
    const token = await invite({ tenantId: tenant.id }, user.email, 'editor');
    const { acceptInvitation, hashToken } = await import('./invitations');
    const { eq } = await import('drizzle-orm');
    await whileInvitationLocked(token, async () => {
      await expect(acceptInvitation(token, user)).rejects.toThrow(/no longer valid/);
    }, async (tx) => {
      await tx.update(m.invitations).set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(m.invitations.tokenHash, hashToken(token)));
    });
    expect(await tenantRoleOf(tenant.id, user.id)).toBeNull();
    const [invitation] = await db.select().from(m.invitations)
      .where(eq(m.invitations.tokenHash, hashToken(token)));
    expect(invitation!.acceptedAt).toBeNull();
    expect(invitation!.acceptedBy).toBeNull();
  });

  it('rechecks expiry after waiting on a row lock even if no other transaction changes the invitation', async () => {
    const { m, db, user, tenant } = await setup(null, null);
    const token = await invite({ tenantId: tenant.id }, user.email, 'editor');
    const { acceptInvitation, hashToken } = await import('./invitations');
    const { eq, sql } = await import('drizzle-orm');
    await db.update(m.invitations).set({ expiresAt: new Date(Date.now() + 3_000) })
      .where(eq(m.invitations.tokenHash, hashToken(token)));
    await whileInvitationLocked(token, async () => {
      await expect(acceptInvitation(token, user)).rejects.toThrow(/no longer valid/);
    }, async (tx) => {
      // Let time pass without updating the row. A condition evaluated before
      // the lock wait (or transaction-stable now()) would incorrectly succeed.
      await tx.execute(sql`
        SELECT pg_sleep(greatest(0, extract(epoch FROM expires_at - clock_timestamp())) + 0.05)
          FROM invitations WHERE token_hash = ${hashToken(token)}`);
    });
    expect(await tenantRoleOf(tenant.id, user.id)).toBeNull();
    const [invitation] = await db.select().from(m.invitations)
      .where(eq(m.invitations.tokenHash, hashToken(token)));
    expect(invitation!.acceptedAt).toBeNull();
    expect(invitation!.acceptedBy).toBeNull();
  }, 10_000);

  it('grants membership once when two acceptances race for the same invitation', async () => {
    const { user, tenant } = await setup(null, null);
    const token = await invite({ tenantId: tenant.id }, user.email, 'editor');
    const { acceptInvitation, liveInvitation } = await import('./invitations');
    await whileInvitationLocked(token, async () => {
      const results = await Promise.allSettled([
        acceptInvitation(token, user), acceptInvitation(token, user),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    }, async () => {}, 2);
    expect(await tenantRoleOf(tenant.id, user.id)).toBe('editor');
    expect(await liveInvitation(token)).toBeNull();
  });

  it('keeps an owner an owner when they accept an editor invitation, and uses it up', async () => {
    const { user, tenant } = await setup('owner', null);
    const token = await invite({ tenantId: tenant.id }, user.email, 'editor');
    const { acceptInvitation, liveInvitation } = await import('./invitations');
    await acceptInvitation(token, user);
    expect(await tenantRoleOf(tenant.id, user.id)).toBe('owner');
    expect(await liveInvitation(token)).toBeNull();
  });

  it('raises a lower role to the invited one', async () => {
    const { user, tenant } = await setup('viewer', null);
    const token = await invite({ tenantId: tenant.id }, user.email, 'editor');
    const { acceptInvitation } = await import('./invitations');
    await acceptInvitation(token, user);
    expect(await tenantRoleOf(tenant.id, user.id)).toBe('editor');
  });

  it('keeps an organization owner an owner when they accept a billing invitation', async () => {
    const { m, user, tenant } = await setup(null, 'owner');
    const token = await invite({ organizationId: tenant.organizationId }, user.email, 'billing');
    const { acceptInvitation } = await import('./invitations');
    await acceptInvitation(token, user);
    const { and, eq } = await import('drizzle-orm');
    const [row] = await m
      .getDb()
      .select({ role: m.organizationMembers.role })
      .from(m.organizationMembers)
      .where(
        and(
          eq(m.organizationMembers.organizationId, tenant.organizationId),
          eq(m.organizationMembers.userId, user.id),
        ),
      );
    expect(row?.role).toBe('owner');
  });

  it('lets an organization with no plan invite the people who set its portrait up, up to the free seats', async () => {
    // Every organization /start creates has no subscription: setting up — inviting the team included — is free.
    const { m, user, tenant } = await setup(null, 'owner');
    const { FREE_SETUP_LIMITS } = await import('@deep-fryer/core');
    expect(await m.subscriptionFor(m.getDb(), tenant.organizationId)).toBeNull();
    const { createInvitation } = await import('./invitations');
    const invite = (n: number) =>
      createInvitation({
        scope: { kind: 'tenant', tenantId: tenant.id, role: 'editor' },
        email: `${uniq()}-${n}@colleague.example.gov`,
        invitedBy: user.id,
        inviterName: null,
        targetName: 'Invite City',
      });
    // The owner holds one of the three seats: two colleagues fit…
    expect(FREE_SETUP_LIMITS.seats).toBe(3);
    await expect(invite(1)).resolves.toMatchObject({ url: expect.stringContaining('/invite/') });
    await expect(invite(2)).resolves.toMatchObject({ url: expect.stringContaining('/invite/') });
    // …and a third waits for a plan, saying so.
    await expect(invite(3)).rejects.toThrow(
      /^Without a plan an organization has 3 seats, and all are in use or reserved by pending invitations\..*choose a plan under Billing/,
    );
  });
});
