import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { defaultPortraitConfig } from '@deep-fryer/contract';
import { computeScoring, resolveThreshold, type IndicatorFindingPayload } from '@deep-fryer/core';
import * as m from '@deep-fryer/db';
import { onOneConnection } from '../test/one-connection';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
let signedIn: string | null = null;
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)) }));
const unique = () => `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const pass = { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true, content_supported: 'pass' as const };
const payload: IndicatorFindingPayload = {
  kind: 'indicator', indicator_slug: 'food-insecurity-rate', name: 'Food insecurity', value: 12, unit: '%', year: 2025, target: 5,
  ...computeScoring(12, 'food.food-insecurity-rate', resolveThreshold('food.food-insecurity-rate')!),
  source: 'City statistics', source_url: 'https://example.gov/food', source_tier: 1,
  evidence: { snapshot_path: 'evidence/source.png', captured_at: '2026-10-23T00:00:00Z' }, confidence: 'high', geographic_scale: 'city',
};

describe.skipIf(!process.env.DATABASE_URL)('human application of machine audits (Postgres/RLS)', () => {
  let tenant: m.Tenant;
  let editor = '', reviewer = '', outsider = '';
  let dims: { dimensionId: string; slug: string }[];
  const runIds: string[] = [];
  const savedAuth = process.env.AUTH_SECRET;
  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const seeded = await m.provisionTenant(m.getDb(), { slug: unique(), name: 'Audit City' });
    tenant = seeded.tenant; dims = seeded.dimensions;
    for (const label of ['editor', 'reviewer', 'outsider']) {
      const [user] = await m.getDb().insert(m.users).values({ email: `${unique()}@${label}.example.org` }).returning();
      if (label === 'editor') editor = user!.id;
      else if (label === 'reviewer') reviewer = user!.id;
      else outsider = user!.id;
    }
    await m.getDb().insert(m.tenantMembers).values([editor, reviewer].map((userId) => ({ tenantId: tenant.id, userId, role: 'editor' as const })));
    signedIn = editor;
  });
  afterAll(async () => {
    signedIn = null;
    if (savedAuth === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedAuth;
    if (!tenant) return;
    const db = m.getDb();
    const sessions = await db.select({ id: m.researchSessions.id }).from(m.researchSessions)
      .innerJoin(m.researchRuns, eq(m.researchRuns.id, m.researchSessions.runId)).where(eq(m.researchRuns.tenantId, tenant.id));
    await db.transaction(async (tx) => {
      await tx.execute(sql`alter table findings disable trigger findings_immutable`);
      if (sessions.length) await tx.delete(m.findings).where(inArray(m.findings.sessionId, sessions.map((s) => s.id)));
      await tx.execute(sql`alter table findings enable trigger findings_immutable`);
    });
    if (sessions.length) await db.delete(m.researchSessions).where(inArray(m.researchSessions.id, sessions.map((s) => s.id)));
    await db.delete(m.dimensions).where(eq(m.dimensions.tenantId, tenant.id));
    await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
    await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    await db.delete(m.users).where(inArray(m.users.id, [editor, reviewer, outsider]));
  });
  async function seed(index: number, disposition: m.FindingAudit['disposition'], correction: m.FindingAudit['correction'] = null) {
    const db = m.getDb(); const dimensionId = dims[index]!.dimensionId;
    const [run] = await db.insert(m.researchRuns).values({ tenantId: tenant.id, status: 'complete', appliedAt: new Date(),
      plan: { sessions: [], config_hash: 'test', plugin_version: 'test' }, configSnapshot: defaultPortraitConfig('Audit City', 'Municipal limits') }).returning();
    runIds.push(run!.id);
    const [session] = await db.insert(m.researchSessions).values({ runId: run!.id, kind: 'dimension', dimensionId, status: 'complete' }).returning();
    const [finding] = await db.insert(m.findings).values({ sessionId: session!.id, dimensionId, indicatorSlug: payload.indicator_slug, payload, verification: pass }).returning();
    const [audit] = await db.insert(m.findingAudits).values({ findingId: finding!.id, source: 'workflow', disposition, reason: 'Source exhibit supports this decision.', correction }).returning();
    return { run: run!, finding: finding!, audit: audit!, dimensionId };
  }
  const input = (f: Awaited<ReturnType<typeof seed>>) => ({ tenantSlug: tenant.slug, runId: f.run.id, dimensionId: f.dimensionId, expectedAuditIds: [f.audit.id] });

  it('keeps recommendations private and immutable independently of application authorization', async () => {
    const f = await seed(0, 'approve');
    // Even an authenticated editor cannot leak a private portrait through
    // the cacheable public metadata projection.
    expect(await (await import('./public-api-metadata')).publicApiMetadata(tenant.slug)).toBeNull();
    expect(await m.withAuthContext(m.getDb(), outsider, (db) => db.select().from(m.findingAudits).where(eq(m.findingAudits.id, f.audit.id)))).toEqual([]);
    expect((await m.withAuthContext(m.getDb(), editor, (db) => db.select().from(m.findingAudits).where(eq(m.findingAudits.id, f.audit.id)))).length).toBe(1);
    await expect(m.withAuthContext(m.getDb(), editor, (db) => db.update(m.findingAudits).set({ reason: 'Tampered' }).where(eq(m.findingAudits.id, f.audit.id)))).rejects.toThrow();
    await expect(m.getDb().update(m.findingAudits).set({ reason: 'Tampered' }).where(eq(m.findingAudits.id, f.audit.id))).rejects.toThrow(/immutable/);
    signedIn = outsider;
    expect((await (await import('./machine-audit-actions')).applyMachineAudits(input(f))).ok).toBe(false);
    signedIn = editor;
  });

  it('binds application to the shown IDs, rescales corrections, stays draft and is idempotent', async () => {
    const f = await seed(1, 'edit', { value: 10 });
    const actions = await import('./machine-audit-actions');
    expect((await actions.applyMachineAudits({ ...input(f), expectedAuditIds: [] })).ok).toBe(false);
    const result = await onOneConnection(() => actions.applyMachineAudits(input(f)));
    expect(result.ok).toBe(true); if (!result.ok || !result.data.versionId) throw new Error('missing draft');
    const [v] = await m.getDb().select().from(m.dimensionVersions).where(eq(m.dimensionVersions.id, result.data.versionId));
    expect(v).toMatchObject({ origin: 'human', status: 'draft', createdBy: editor });
    expect(v!.data.indicators[0]).toMatchObject({ value: 10, level_pct: 100 });
    expect((await m.getDb().select().from(m.findings).where(eq(m.findings.id, f.finding.id)))[0]!.payload).toEqual(payload);
    const repeated = await actions.applyMachineAudits(input(f));
    expect(repeated).toMatchObject({ ok: true, data: { versionId: result.data.versionId } });
    const versions = await m.getDb().select().from(m.dimensionVersions).where(eq(m.dimensionVersions.researchRunId, f.run.id));
    expect(versions).toHaveLength(1);
    const applied = (await m.getDb().select().from(m.findingAudits).where(eq(m.findingAudits.id, f.audit.id)))[0]!;
    expect(applied.appliedBy).toBe(editor);
    await expect(m.getDb().update(m.findingAudits).set({ appliedBy: reviewer }).where(eq(m.findingAudits.id, f.audit.id))).rejects.toThrow(/only once/);

    await m.getDb().update(m.tenantConfig).set({ value: { require_approval: 'all', dual_review_on_edits: true, first_post_requires_approval: false } })
      .where(and(eq(m.tenantConfig.tenantId, tenant.id), eq(m.tenantConfig.key, 'review_policy')));
    expect((await actions.publishReviewed({ tenantSlug: tenant.slug, versionIds: [v!.id] })).ok).toBe(false);
    const gap = await (await import('./review-actions')).flagGap({ tenantSlug: tenant.slug, dimensionId: dims[8]!.dimensionId,
      indicator: 'unavailable-local-series', reason: 'No supported local value is available.' });
    expect(gap).toMatchObject({ ok: true, data: { published: false, requiresSecondReview: true } });
    expect((await m.latestVersion(m.getDb(), dims[8]!.dimensionId))!.status).toBe('draft');
    await expect(m.withAuthContext(m.getDb(), editor, (db) => db.update(m.dimensionVersions)
      .set({ status: 'published', publishedAt: new Date() }).where(eq(m.dimensionVersions.id, v!.id)))).rejects.toThrow(/second editor/);
    await expect(m.withAuthContext(m.getDb(), editor, (db) => db.insert(m.dimensionVersions).values({
      dimensionId: f.dimensionId, versionNum: 900, status: 'draft', origin: 'human', data: v!.data, createdBy: reviewer,
    }))).rejects.toThrow(/author/);
    signedIn = reviewer;
    expect(await onOneConnection(() => actions.publishReviewed({ tenantSlug: tenant.slug, versionIds: [v!.id] }))).toMatchObject({ ok: true, data: { published: 1 } });
    expect(await (await import('./public-api-metadata')).publicApiMetadata(tenant.slug)).toMatchObject({ organization: { slug: tenant.slug } });
    signedIn = editor;
  });

  it('rejects into an honest gap and plans re-research without spending or publishing', async () => {
    const reject = await seed(2, 'reject'); const again = await seed(3, 're_research');
    const actions = await import('./machine-audit-actions');
    const rejected = await actions.applyMachineAudits(input(reject));
    expect(rejected.ok).toBe(true); if (!rejected.ok || !rejected.data.versionId) throw new Error('missing draft');
    const v = (await m.getDb().select().from(m.dimensionVersions).where(eq(m.dimensionVersions.id, rejected.data.versionId)))[0]!;
    expect(v.data.indicators).toEqual([]); expect(v.data.gaps).toHaveLength(1); expect(v.vizLevel).toBeNull();
    const rerun = await onOneConnection(() => actions.applyMachineAudits(input(again)));
    expect(rerun.ok).toBe(true); if (!rerun.ok || !rerun.data.runId) throw new Error('missing rerun');
    const r = (await m.getDb().select().from(m.researchRuns).where(eq(m.researchRuns.id, rerun.data.runId)))[0]!;
    expect(r).toMatchObject({ status: 'planned', appliedAt: null, requestedBy: editor });
    expect(r.plan.sessions.some((s) => s.prompt.includes('Source exhibit supports'))).toBe(true);
    expect(await actions.applyMachineAudits(input(again))).toMatchObject({ ok: true, data: { runId: r.id } });
  });

  it('makes bulk opt-in, requires source spot checks and preserves pending audit flags', async () => {
    const f = await seed(4, 'approve'); const actions = await import('./machine-audit-actions');
    const request = { tenantSlug: tenant.slug, runId: f.run.id, expectedFindings: 1, spotChecked: [f.finding.id] };
    expect((await actions.applyMachineApproved(request)).ok).toBe(false);
    await m.getDb().update(m.tenantConfig).set({ value: { require_approval: 'all', dual_review_on_edits: false, first_post_requires_approval: false, audit_apply: 'bulk' } })
      .where(and(eq(m.tenantConfig.tenantId, tenant.id), eq(m.tenantConfig.key, 'review_policy')));
    expect((await actions.applyMachineApproved({ ...request, spotChecked: [] })).ok).toBe(false);
    expect(await actions.applyMachineApproved(request)).toMatchObject({ ok: true, data: { findings: 1 } });
    expect(await actions.applyMachineApproved(request)).toMatchObject({ ok: true, data: { findings: 0 } });
    const bad = await seed(5, 're_research');
    const ordinary = await (await import('./review-actions')).approveUnflaggedFindings({ tenantSlug: tenant.slug, runId: bad.run.id, expectedFindings: 1, spotChecked: [bad.finding.id] });
    expect(ordinary.ok).toBe(false);
  });
});
