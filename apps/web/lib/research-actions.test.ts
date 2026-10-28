import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { publishInvolvementTestDimensions } from './test-involvement-dimensions';

/**
 * "Build my doughnut" and the research gate with an organization's own API
 * key (SPEC-v7 §4), against real Postgres as the dev-mode identity. The
 * queue is graphile-worker's and is stubbed for research runs; the gate,
 * the plan, and the run rows are the production code path — including the
 * gate's decision stored on the run or analysis (`funding`, migration 0012),
 * which the allowance count and the worker follow.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

vi.mock('@deep-fryer/research', async (orig) => ({
  ...(await orig<typeof import('@deep-fryer/research')>()),
  enqueueResearchApply: vi.fn(async () => {}),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

/**
 * A deployment that offers bring-your-own-key has DF_SECRETS_KEY (32 bytes,
 * base64); research on a key on file is refused without it (lib/billing.ts
 * orgKeyUnreadableMessage), so these tests run with one unless they say
 * otherwise. Likewise the deployment's own research key: compose tells the
 * web app it exists with DF_RESEARCH_KEY_CONFIGURED=true, and research the
 * plan pays for is refused without it (researchUnavailableMessage).
 */
const SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');

describe.skipIf(!hasDb)('buildDoughnut and the organization-key gate', () => {
  const saved = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    DF_SECRETS_KEY: process.env.DF_SECRETS_KEY,
    DF_RESEARCH_KEY_CONFIGURED: process.env.DF_RESEARCH_KEY_CONFIGURED,
  };
  const cleanup: (() => Promise<unknown>)[] = [];
  beforeAll(() => {
    delete process.env.AUTH_SECRET;
    process.env.DF_SECRETS_KEY = SECRETS_KEY;
    process.env.DF_RESEARCH_KEY_CONFIGURED = 'true';
  });
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /**
   * A portrait whose organization is on a paid plan with an allowance of
   * `allowance` sessions (in bad standing when `status` says so), or on no
   * plan at all when `allowance` is null — as every organization /start
   * creates is until it buys one — with a key on file when `withKey` (a
   * stand-in ciphertext: nothing here decrypts it).
   */
  async function portrait({
    allowance,
    withKey,
    status,
  }: {
    allowance: number | null;
    withKey: boolean;
    status?: 'canceled';
  }) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const { givePlan } = await import('./test-plans');
    const db = m.getDb();
    const org = await m.provisionOrganization(db, { slug: uniq(), name: 'Doughnut Town' });
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Doughnut Town', organizationId: org.id });
    if (allowance !== null) await givePlan(org.id, { researchSessions: allowance, ...(status ? { status } : {}) });
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

  it('plans and applies the full run on the plan’s allowance in one click, once', async () => {
    const { buildDoughnut } = await import('./research-actions');
    const { tenant, runs, applyAudit } = await portrait({ allowance: 30, withKey: false });

    const res = await buildDoughnut({ tenantSlug: tenant.slug });
    expect(res).toMatchObject({ ok: true, data: { sessionCount: 22, funding: 'plan' } });
    const [run] = await runs();
    expect(run!.status).toBe('planned');
    expect(run!.appliedAt).toBeInstanceOf(Date);
    expect(run!.plan.sessions).toHaveLength(22);
    // The gate's decision is stored with the apply: this run is the plan's to count.
    expect(run!.funding).toBe('plan');
    expect((await applyAudit())[0]!.after).toMatchObject({ sessions: 22, funding: 'plan', via: 'build_doughnut' });

    // A second click while the first run is queued would spend twice.
    const again = await buildDoughnut({ tenantSlug: tenant.slug });
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/already under way/) });
    expect(await runs()).toHaveLength(1);
  });

  it('runs on the organization key past an allowance that could not hold it', async () => {
    const { buildDoughnut } = await import('./research-actions');
    const m = await import('@deep-fryer/db');
    const { org, tenant, runs, applyAudit } = await portrait({ allowance: 5, withKey: true });

    const res = await buildDoughnut({ tenantSlug: tenant.slug });
    expect(res).toMatchObject({ ok: true, data: { sessionCount: 22, funding: 'organization_key' } });
    const [run] = await runs();
    expect(run!.appliedAt).toBeInstanceOf(Date);
    // Stored on the run, so the worker runs it on the key and the plan never counts it.
    expect(run!.funding).toBe('organization_key');
    expect((await applyAudit())[0]!.after).toMatchObject({ funding: 'organization_key' });
    const sub = await m.subscriptionFor(m.getDb(), org.id);
    expect(await m.researchSessionsUsed(m.getDb(), org.id, sub!.currentPeriodStart)).toBe(0);
  });

  it('records who pays for a request for more research, on the run and in its audit entry', async () => {
    const { requestResearch } = await import('./insight-actions');
    const { setPortraitFeatures } = await import('./test-features');
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const { tenant, runs } = await portrait({ allowance: 0, withKey: true });
    await setPortraitFeatures(tenant.id, { request_research: true });

    // One dimension: the region context plus its own session, past a spent allowance on the key.
    const res = await requestResearch({ tenantSlug: tenant.slug, dimensionSlug: 'housing', note: 'Use the 2025 data.' });
    expect(res).toMatchObject({ ok: true, data: { sessionCount: 2 } });
    const [run] = await runs();
    expect(run!.funding).toBe('organization_key');
    const [entry] = await m.getDb().select().from(m.auditLog).where(eq(m.auditLog.entityId, run!.id));
    expect(entry).toMatchObject({ action: 'request_research', after: { funding: 'organization_key', sessions: 2 } });
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
    // Exercise the funding gate with a valid published policy baseline.
    await publishInvolvementTestDimensions(tenant.id, ['housing']);

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
    // …and on the analysis itself, which the worker and the allowance count follow.
    const [analysis] = await m.getDb().select().from(m.policyAnalyses).where(eq(m.policyAnalyses.id, id));
    expect(analysis!.funding).toBe('organization_key');
  });

  it('refuses research on a key this server cannot read, instead of queuing work the worker would only fail', async () => {
    // DF_SECRETS_KEY lost in a restore, or removed by an operator: the worker
    // cannot decrypt the key, and work put on it never moves to the plan.
    const { buildDoughnut } = await import('./research-actions');
    const { createPolicyAnalysis } = await import('./policy-actions');
    const { billingSummary, previewResearchSpend, orgKeyUnreadableMessage } = await import('./billing');
    const ORG_KEY_UNREADABLE = orgKeyUnreadableMessage();
    const { setPortraitFeatures } = await import('./test-features');
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const { org, tenant, runs } = await portrait({ allowance: 30, withKey: true });
    await setPortraitFeatures(tenant.id, { policy_analysis: true });
    // Exercise the funding gate with a valid published policy baseline.
    await publishInvolvementTestDimensions(tenant.id, ['housing']);
    delete process.env.DF_SECRETS_KEY;
    try {
      // What /start shows before the click…
      expect(previewResearchSpend(await billingSummary(org.id), 22)).toMatchObject({
        funding: 'organization_key',
        allowed: false,
        message: ORG_KEY_UNREADABLE,
      });
      // …is what the click does: nothing planned, applied, or queued.
      expect(await buildDoughnut({ tenantSlug: tenant.slug })).toEqual({ ok: false, error: ORG_KEY_UNREADABLE });
      expect(await runs()).toEqual([]);
      const brief = 'Open a cooling center in every community district from June through September, with extended hours.';
      expect(await createPolicyAnalysis({ tenantSlug: tenant.slug, title: 'Cooling centers', brief })).toEqual({
        ok: false,
        error: ORG_KEY_UNREADABLE,
      });
      expect(await m.getDb().select().from(m.policyAnalyses).where(eq(m.policyAnalyses.tenantId, tenant.id))).toEqual([]);

      // Without a key on file the plan pays, so the missing secret changes nothing.
      const planOnly = await portrait({ allowance: 30, withKey: false });
      expect(previewResearchSpend(await billingSummary(planOnly.org.id), 22)).toMatchObject({ funding: 'plan', allowed: true });
      expect(await buildDoughnut({ tenantSlug: planOnly.tenant.slug })).toMatchObject({ ok: true, data: { funding: 'plan' } });
    } finally {
      process.env.DF_SECRETS_KEY = SECRETS_KEY;
    }
  });
  it('refuses an organization with no plan — setting up was free, building is not — leaving nothing planned', async () => {
    const { buildDoughnut } = await import('./research-actions');
    const { billingSummary, previewResearchSpend } = await import('./billing');
    for (const withKey of [false, true]) {
      const { org, tenant, runs } = await portrait({ allowance: null, withKey });
      // The build step shows a disabled button with the way to a plan…
      const preview = previewResearchSpend(await billingSummary(org.id), 22);
      expect(preview).toMatchObject({ allowed: false, message: expect.stringMatching(/^Choose a plan to build your doughnut/) });
      // …and a forged click is refused with the same words, whoever would have paid.
      expect(await buildDoughnut({ tenantSlug: tenant.slug })).toEqual({ ok: false, error: preview.message });
      expect(await runs()).toEqual([]);
    }
  });

  it('refuses plan-funded research on a server without a research key, before anything is spent, and still runs it on the organization key', async () => {
    const { buildDoughnut, applyResearchAction, planResearchAction } = await import('./research-actions');
    const { createPolicyAnalysis } = await import('./policy-actions');
    const { billingSummary, previewResearchSpend, researchUnavailableMessage } = await import('./billing');
    const { setPortraitFeatures } = await import('./test-features');
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const onPlan = await portrait({ allowance: 30, withKey: false });
    const onKey = await portrait({ allowance: 30, withKey: true });
    await setPortraitFeatures(onPlan.tenant.id, { policy_analysis: true });
    // Other fixtures stay unpublished to retain the initial-build coverage.
    await publishInvolvementTestDimensions(onPlan.tenant.id, ['housing']);
    for (const value of [undefined, '', 'false', 'TRUE']) {
      if (value === undefined) delete process.env.DF_RESEARCH_KEY_CONFIGURED;
      else process.env.DF_RESEARCH_KEY_CONFIGURED = value;
      try {
        // The build step's button is disabled…
        expect(previewResearchSpend(await billingSummary(onPlan.org.id), 22)).toMatchObject({ funding: 'plan', allowed: false });
        // …the one-click build is refused in plain words, with nothing planned, applied or counted…
        expect(await buildDoughnut({ tenantSlug: onPlan.tenant.slug })).toEqual({ ok: false, error: researchUnavailableMessage() });
        expect(await onPlan.runs()).toEqual([]);
        // …a run planned by hand (a re-run) cannot be applied…
        const planned = await planResearchAction({ tenantSlug: onPlan.tenant.slug });
        expect(planned.ok).toBe(true);
        const { runId } = (planned as { ok: true; data: { runId: string } }).data;
        expect(await applyResearchAction({ tenantSlug: onPlan.tenant.slug, runId })).toEqual({
          ok: false,
          error: researchUnavailableMessage(),
        });
        expect((await onPlan.runs()).every((r) => r.appliedAt === null)).toBe(true);
        await m.getDb().delete(m.researchRuns).where(eq(m.researchRuns.id, runId));
        // …and so is a policy analysis.
        const brief = 'Open a cooling center in every community district from June through September, with extended hours.';
        expect(await createPolicyAnalysis({ tenantSlug: onPlan.tenant.slug, title: 'Cooling centers', brief })).toEqual({
          ok: false,
          error: researchUnavailableMessage(),
        });
        expect(
          await m.getDb().select().from(m.policyAnalyses).where(eq(m.policyAnalyses.tenantId, onPlan.tenant.id)),
        ).toEqual([]);
      } finally {
        process.env.DF_RESEARCH_KEY_CONFIGURED = 'true';
      }
    }
    // The organization's own key never needed the deployment's: its build goes ahead without it.
    delete process.env.DF_RESEARCH_KEY_CONFIGURED;
    try {
      expect(previewResearchSpend(await billingSummary(onKey.org.id), 22)).toMatchObject({
        funding: 'organization_key',
        allowed: true,
      });
      expect(await buildDoughnut({ tenantSlug: onKey.tenant.slug })).toMatchObject({
        ok: true,
        data: { funding: 'organization_key' },
      });
    } finally {
      process.env.DF_RESEARCH_KEY_CONFIGURED = 'true';
    }
  });
});
