import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FREE_SETUP_LIMITS } from '@deep-fryer/core';

/**
 * The seats /start's last step says are left are the ones the invitation
 * form applies (lib/invitations.ts seatsInEffect, the count createInvitation
 * refuses on), against real Postgres: a new group holds its owner and may
 * invite up to the setup limit, a pending invitation keeps a seat, and when
 * none is left the page's "0" and the form's refusal agree.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  emailDeliverable: () => false,
}));

describe.skipIf(!hasDb)('seats left on /start and the invitation form', () => {
  const cleanup: { tenantId: string; organizationId: string; userId: string }[] = [];
  let organizationId = '';
  let tenantId = '';

  beforeAll(async () => {
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const slug = uniq();
    const [owner] = await db.insert(m.users).values({ email: `${uniq()}@owner.example.org` }).returning();
    const org = await m.provisionOrganization(db, { slug, name: 'Seat Check Group', ownerUserId: owner!.id });
    const { tenant } = await m.provisionTenant(db, { slug, name: 'Seat Check', organizationId: org.id });
    organizationId = org.id;
    tenantId = tenant.id;
    cleanup.push({ tenantId: tenant.id, organizationId: org.id, userId: owner!.id });
  }, 60_000);

  afterAll(async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    for (const c of cleanup) {
      await db.delete(m.invitations).where(eq(m.invitations.tenantId, c.tenantId));
      await db.delete(m.tenants).where(eq(m.tenants.id, c.tenantId));
      await db.delete(m.organizations).where(eq(m.organizations.id, c.organizationId));
      await db.delete(m.users).where(eq(m.users.id, c.userId));
    }
  });

  it('counts the owner, then each pending invitation, and agrees with the refusal at zero', async () => {
    const { createInvitation, seatsInEffect } = await import('@/lib/invitations');
    const { getDb } = await import('@deep-fryer/db');
    const db = getDb();
    const invite = (email: string) =>
      createInvitation({
        scope: { kind: 'tenant', tenantId, role: 'editor' },
        email,
        invitedBy: null,
        inviterName: null,
        targetName: 'Seat Check',
      });

    const limit = FREE_SETUP_LIMITS.seats;
    expect(await seatsInEffect(db, organizationId)).toEqual({ limit, members: 1, pending: 0, left: limit - 1 });

    for (let i = 1; i < limit; i++) {
      await invite(`${uniq()}@invited.example.org`);
      expect((await seatsInEffect(db, organizationId)).left).toBe(limit - 1 - i);
    }
    expect(await seatsInEffect(db, organizationId)).toEqual({ limit, members: 1, pending: limit - 1, left: 0 });
    await expect(invite(`${uniq()}@one-too-many.example.org`)).rejects.toThrow(/seats/);
  });
});
