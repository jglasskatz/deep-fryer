import { describe, expect, it, vi } from 'vitest';

/**
 * applyRun on a run that was already applied: a page opened before the run
 * started still offers "Apply", and the answer must say where the run is in
 * words — never "already applied (status: planned)" for a queued run.
 */

vi.mock('@deep-fryer/research', async (orig) => ({
  ...(await orig<typeof import('@deep-fryer/research')>()),
  enqueueResearchApply: vi.fn(async () => {}),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `ap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('applyRun on an applied run', () => {
  it('refuses in plain words, whatever state the run is in, and changes nothing', async () => {
    const { createPlannedRun, applyRun } = await import('./research');
    const { getDb, provisionTenant, organizations, tenants, researchRuns } = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const { tenant } = await provisionTenant(db, { slug: uniq(), name: 'Applied Town' });
    try {
      const { run } = await createPlannedRun({ tenantId: tenant.id });
      // Applied and queued: the worker has not claimed it yet (status still planned).
      const appliedAt = new Date(Date.now() - 60_000);
      await db.update(researchRuns).set({ appliedAt }).where(eq(researchRuns.id, run.id));

      const queued = applyRun(tenant.id, run.id);
      await expect(queued).rejects.toThrow(/already applied and is queued — it starts shortly/);
      await expect(applyRun(tenant.id, run.id)).rejects.not.toThrow(/status:/);

      await db.update(researchRuns).set({ status: 'running' }).where(eq(researchRuns.id, run.id));
      await expect(applyRun(tenant.id, run.id)).rejects.toThrow(/is running now/);
      await db.update(researchRuns).set({ status: 'failed' }).where(eq(researchRuns.id, run.id));
      await expect(applyRun(tenant.id, run.id)).rejects.toThrow(/run page says why/);

      // Nothing was re-stamped: the first apply's time stands.
      const [row] = await db.select().from(researchRuns).where(eq(researchRuns.id, run.id));
      expect(row!.appliedAt!.getTime()).toBe(appliedAt.getTime());
    } finally {
      await db.delete(researchRuns).where(eq(researchRuns.tenantId, tenant.id));
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
      await db.delete(organizations).where(eq(organizations.id, tenant.organizationId));
    }
  });
});
