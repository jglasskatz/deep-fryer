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
