import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * createPolicyAnalysis — the research quota gate applied to policy analyses.
 * Runs as the dev-mode identity (no AUTH_SECRET: the local developer is
 * owner everywhere), against real Postgres; only the job queue (graphile-
 * worker's) and Next's cache revalidation are stubbed.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const enqueue = vi.hoisted(() => vi.fn(async (_id: string) => {}));
vi.mock('@deep-fryer/research', async (orig) => ({
  ...(await orig<typeof import('@deep-fryer/research')>()),
  enqueuePolicyAnalysis: enqueue,
}));
// Server actions revalidate pages; there is no Next request here.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const BRIEF =
  'Expand the city’s cooling-center network to every community district, open from June through September, with extended hours during heat advisories.';

describe.skipIf(!hasDb)('createPolicyAnalysis', () => {
  const savedSecret = process.env.AUTH_SECRET;
  const cleanup: (() => Promise<unknown>)[] = [];
  beforeAll(() => {
    delete process.env.AUTH_SECRET;
  });
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
    if (savedSecret !== undefined) process.env.AUTH_SECRET = savedSecret;
  });

  /** A portrait whose organization is on a trial with `allowance` research sessions. */
  async function portrait(allowance: number | null) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const org = await m.provisionOrganization(db, { slug: uniq(), name: 'Policy Town', startTrial: allowance !== null });
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Policy Town', organizationId: org.id });
    if (allowance !== null) {
      await db
        .update(m.subscriptions)
        .set({ researchSessionsOverride: allowance })
        .where(eq(m.subscriptions.organizationId, org.id));
    }
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, org.id));
    });
    return { org, tenant };
  }

  async function analysesOf(tenantId: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    return m
      .getDb()
      .select()
      .from(m.policyAnalyses)
      .where(eq(m.policyAnalyses.tenantId, tenantId));
  }

  it('queues an analysis within the allowance, then refuses what would exceed it', async () => {
    const { createPolicyAnalysis } = await import('./policy-actions');
    const { DEV_USER_ID } = await import('./auth');
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const { tenant } = await portrait(1);

    const res = await createPolicyAnalysis({
      tenantSlug: tenant.slug,
      title: '  Cooling   centers  ',
      brief: BRIEF,
      sourceUrl: 'https://example.gov/cooling.pdf',
    });
    expect(res.ok).toBe(true);
    const { id } = (res as { ok: true; data: { id: string } }).data;
    expect(enqueue).toHaveBeenLastCalledWith(id);

    const [row] = await analysesOf(tenant.id);
    expect(row).toMatchObject({
      id,
      status: 'queued',
      title: 'Cooling centers',
      brief: BRIEF,
      sourceUrl: 'https://example.gov/cooling.pdf',
      requestedBy: DEV_USER_ID,
    });
    const audit = await m
      .getDb()
      .select()
      .from(m.auditLog)
      .where(and(eq(m.auditLog.tenantId, tenant.id), eq(m.auditLog.entity, 'policy_analysis')));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityId: id, action: 'create' });

    // The one session is now spent: the next analysis is refused, and nothing is inserted.
    const refused = await createPolicyAnalysis({ tenantSlug: tenant.slug, title: 'Second', brief: BRIEF });
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { ok: false; error: string }).error).toMatch(
      /A policy analysis uses 1 research session; 0 of 1 remain this billing period/,
    );
    expect(await analysesOf(tenant.id)).toHaveLength(1);
  });

  it('releases the session when the job cannot be queued', async () => {
    const { createPolicyAnalysis } = await import('./policy-actions');
    const { tenant } = await portrait(1);
    enqueue.mockRejectedValueOnce(new Error('connection refused'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const failed = await createPolicyAnalysis({ tenantSlug: tenant.slug, title: 'Queue down', brief: BRIEF });
    errorLog.mockRestore();
    expect(failed).toMatchObject({ ok: false });
    expect((failed as { ok: false; error: string }).error).toMatch(/could not be started.*not counted against your plan/);
    const [row] = await analysesOf(tenant.id);
    expect(row).toMatchObject({ status: 'failed' });
    expect(row!.error).toMatch(/could not be queued/);

    // Failed analyses are not billed, so the allowance of one still fits another.
    const retry = await createPolicyAnalysis({ tenantSlug: tenant.slug, title: 'Queue back', brief: BRIEF });
    expect(retry.ok).toBe(true);
  });

  it('refuses an organization without a plan with the billing message', async () => {
    const { createPolicyAnalysis } = await import('./policy-actions');
    const { tenant } = await portrait(null);
    const res = await createPolicyAnalysis({ tenantSlug: tenant.slug, title: 'No plan', brief: BRIEF });
    expect((res as { ok: false; error: string }).error).toMatch(/no plan yet/);
    expect(await analysesOf(tenant.id)).toHaveLength(0);
  });

  it('validates the title, brief length, and https-only source before spending anything', async () => {
    const { createPolicyAnalysis } = await import('./policy-actions');
    const { POLICY_BRIEF_MAX_CHARS } = await import('@deep-fryer/core');
    const { tenant } = await portrait(5);
    const attempt = async (over: Partial<{ title: string; brief: string; sourceUrl: string }>) =>
      createPolicyAnalysis({ tenantSlug: tenant.slug, title: 'Valid title', brief: BRIEF, ...over });

    expect(await attempt({ title: 'ab' })).toEqual({ ok: false, error: 'Give the analysis a title of at least 3 characters.' });
    expect((await attempt({ brief: 'Too short.' })) as { error: string }).toMatchObject({ error: expect.stringMatching(/at least 50 characters/) });
    expect((await attempt({ brief: 'x'.repeat(POLICY_BRIEF_MAX_CHARS + 1) })) as { error: string }).toMatchObject({
      error: expect.stringMatching(/over the 60,000-character limit/),
    });
    expect(await attempt({ sourceUrl: 'http://example.gov/brief' })).toEqual({ ok: false, error: 'The source link must start with https://.' });
    expect(await attempt({ sourceUrl: 'javascript:alert(1)' })).toMatchObject({ ok: false });
    expect(await analysesOf(tenant.id)).toHaveLength(0);

    // A blank source is "no source", not an invalid one.
    const ok = await attempt({ sourceUrl: '   ' });
    expect(ok.ok).toBe(true);
    const [row] = await analysesOf(tenant.id);
    expect(row!.sourceUrl).toBeNull();
  });

  it('refuses an unknown portrait', async () => {
    const { createPolicyAnalysis } = await import('./policy-actions');
    expect(await createPolicyAnalysis({ tenantSlug: uniq(), title: 'Nowhere', brief: BRIEF })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Unknown portrait/),
    });
  });
});
