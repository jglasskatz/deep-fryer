import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * "Build my doughnut" and the research gate with an organization's own API
 * key (SPEC-v7 §4), against real Postgres as the dev-mode identity. The
 * queue is graphile-worker's and is stubbed for research runs; the gate,
 * the plan, and the run rows are the production code path.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

vi.mock('@deep-fryer/research', async (orig) => ({
  ...(await orig<typeof import('@deep-fryer/research')>()),
  enqueueResearchApply: vi.fn(async () => {}),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

describe.skipIf(!hasDb)('buildDoughnut and the organization-key gate', () => {
  const savedSecret = process.env.AUTH_SECRET;
  const cleanup: (() => Promise<unknown>)[] = [];
  beforeAll(() => {
    delete process.env.AUTH_SECRET;
  });
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
    if (savedSecret !== undefined) process.env.AUTH_SECRET = savedSecret;
  });

  /**
   * A portrait on a trial whose allowance is `allowance` sessions, with a key
   * on file when `withKey` (a stand-in ciphertext: nothing here decrypts it).
   */
  async function portrait({ allowance, withKey, status }: { allowance: number; withKey: boolean; status?: 'canceled' }) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const org = await m.provisionOrganization(db, { slug: uniq(), name: 'Doughnut Town', startTrial: true });
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Doughnut Town', organizationId: org.id });
    await db
      .update(m.subscriptions)
      .set({ researchSessionsOverride: allowance, ...(status ? { status } : {}) })
      .where(eq(m.subscriptions.organizationId, org.id));
    if (withKey) {
      await m.upsertOrganizationApiKey(db, {
        organizationId: org.id,
        ciphertext: 'v1:stand-in:ciphertext',
        keyHint: 'Ab12',
        createdBy: null,
        validatedAt: new Date(),
      });
    }
    cleanup.push(async () => {
      await db.delete(m.researchRuns).where(eq(m.researchRuns.tenantId, tenant.id));
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, org.id));
    });
    const runs = () => db.select().from(m.researchRuns).where(eq(m.researchRuns.tenantId, tenant.id));
    const applyAudit = () =>
      db
        .select()
        .from(m.auditLog)
        .where(eq(m.auditLog.tenantId, tenant.id))
        .then((rows) => rows.filter((r) => r.entity === 'research_run' && r.action === 'apply'));
    return { org, tenant, runs, applyAudit };
  }

  it('plans and applies the full run on the trial allowance in one click, once', async () => {
    const { buildDoughnut } = await import('./research-actions');
    const { tenant, runs, applyAudit } = await portrait({ allowance: 30, withKey: false });

    const res = await buildDoughnut({ tenantSlug: tenant.slug });
    expect(res).toMatchObject({ ok: true, data: { sessionCount: 22, funding: 'plan' } });
    const [run] = await runs();
    expect(run!.status).toBe('planned');
    expect(run!.appliedAt).toBeInstanceOf(Date);
    expect(run!.plan.sessions).toHaveLength(22);
    expect((await applyAudit())[0]!.after).toMatchObject({ sessions: 22, funding: 'plan', via: 'build_doughnut' });

    // A second click while the first run is queued would spend twice.
    const again = await buildDoughnut({ tenantSlug: tenant.slug });
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/already under way/) });
    expect(await runs()).toHaveLength(1);
  });

  it('runs on the organization key past an allowance that could not hold it', async () => {
    const { buildDoughnut } = await import('./research-actions');
    const { tenant, runs, applyAudit } = await portrait({ allowance: 5, withKey: true });

    const res = await buildDoughnut({ tenantSlug: tenant.slug });
    expect(res).toMatchObject({ ok: true, data: { sessionCount: 22, funding: 'organization_key' } });
    expect((await runs())[0]!.appliedAt).toBeInstanceOf(Date);
    expect((await applyAudit())[0]!.after).toMatchObject({ funding: 'organization_key' });
  });

  it('refuses without a key when the allowance cannot hold the run, leaving nothing planned', async () => {
    const { buildDoughnut } = await import('./research-actions');
    const { tenant, runs } = await portrait({ allowance: 5, withKey: false });

    const res = await buildDoughnut({ tenantSlug: tenant.slug });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/needs 22 research sessions; 5 of 5 remain/) });
    expect(await runs()).toEqual([]);
  });

  it('still requires good standing with a key on file', async () => {
    const { buildDoughnut } = await import('./research-actions');
    const { tenant, runs } = await portrait({ allowance: 30, withKey: true, status: 'canceled' });

    const res = await buildDoughnut({ tenantSlug: tenant.slug });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/subscription is canceled/) });
    expect(await runs()).toEqual([]);
  });

  it('lets a policy analysis past a spent allowance on the organization key, and records who paid', async () => {
    const { createPolicyAnalysis } = await import('./policy-actions');
    const { setPortraitFeatures } = await import('./test-features');
    const m = await import('@deep-fryer/db');
    const { eq, sql } = await import('drizzle-orm');
    const { tenant } = await portrait({ allowance: 0, withKey: true });
    await setPortraitFeatures(tenant.id, { policy_analysis: true });

    const res = await createPolicyAnalysis({
      tenantSlug: tenant.slug,
      title: 'Cooling centers',
      brief: 'Open a cooling center in every community district from June through September, with extended hours.',
    });
    expect(res).toMatchObject({ ok: true });
    const { id } = (res as { ok: true; data: { id: string } }).data;
    cleanup.push(() => m.getDb().execute(sql`select graphile_worker.remove_job(${`policy:${id}`})`));
    const [entry] = await m
      .getDb()
      .select()
      .from(m.auditLog)
      .where(eq(m.auditLog.entityId, id));
    expect(entry!.after).toMatchObject({ funding: 'organization_key' });
  });
});
