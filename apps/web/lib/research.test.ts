import { describe, expect, it, vi } from 'vitest';

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// The queue is graphile-worker's; the gate under test is ours.
vi.mock('@deep-fryer/research', async (orig) => ({
  ...(await orig<typeof import('@deep-fryer/research')>()),
  enqueueResearchApply: vi.fn(async () => {}),
}));

describe.skipIf(!hasDb)('applyRun — the research quota gate', () => {
  it('lets a trial run one full pass, then refuses what would exceed the allowance', async () => {
    const { createPlannedRun, applyRun } = await import('./research');
    const { getDb, provisionOrganization, provisionTenant, organizations, tenants, researchRuns } =
      await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const org = await provisionOrganization(db, { slug: uniq(), name: 'Gate Town', startTrial: true });
    const { tenant } = await provisionTenant(db, { slug: uniq(), name: 'Gate Town', organizationId: org.id });

    // Trial: 30 sessions. A full pass is 22.
    const full = await createPlannedRun({ tenantId: tenant.id });
    expect(full.sessionCount).toBe(22);
    await applyRun(tenant.id, full.run.id);

    const again = await createPlannedRun({ tenantId: tenant.id });
    await expect(applyRun(tenant.id, again.run.id)).rejects.toThrow(/needs 22 research sessions; 8 of 30 remain/);
    // Refused runs stay plannable later — nothing was reserved.
    const [row] = await db.select().from(researchRuns).where(eq(researchRuns.id, again.run.id));
    expect(row!.appliedAt).toBeNull();

    // Applying the same run twice is refused.
    await expect(applyRun(tenant.id, full.run.id)).rejects.toThrow(/already applied/);

    await db.delete(researchRuns).where(eq(researchRuns.tenantId, tenant.id));
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  });

  it('refuses research for an organization without a plan', async () => {
    const { createPlannedRun, applyRun } = await import('./research');
    const { getDb, provisionOrganization, provisionTenant, organizations, tenants, researchRuns } =
      await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const org = await provisionOrganization(db, { slug: uniq(), name: 'No Plan' });
    const { tenant } = await provisionTenant(db, { slug: uniq(), name: 'No Plan', organizationId: org.id });
    const planned = await createPlannedRun({ tenantId: tenant.id });
    await expect(applyRun(tenant.id, planned.run.id)).rejects.toThrow(/no plan yet/);
    await db.delete(researchRuns).where(eq(researchRuns.tenantId, tenant.id));
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  });
});
