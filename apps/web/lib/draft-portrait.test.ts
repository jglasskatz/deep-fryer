import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { deriveVizLevel, type FindingPayload, type FindingVerification } from '@deep-fryer/core';
import type { Dimension, DimensionVersion, Finding, ResearchRun } from '@deep-fryer/db';
import { onOneConnection } from '../test/one-connection';
import {
  bulkApprovalPlan,
  bulkVerdict,
  draftDimension,
  draftHref,
  draftNote,
  findingApprovable,
  findingFlagged,
  researchVersionData,
  SPOT_CHECK_SIZE,
  spotCheckSample,
  type RunResearch,
} from './draft-portrait';

/**
 * The draft doughnut's rules (lib/draft-portrait.ts): a run's findings become
 * a wedge exactly as approving them makes a version, every dimension the run
 * has not produced shows as published, and bulk approval takes only
 * dimensions whose every finding passed. Then the page's read, as a
 * signed-in editor of a portrait that has not published yet, on one pooled
 * connection (test/one-connection.ts).
 */

let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));

const PASS: FindingVerification = { url_ok: true, schema_ok: true, recency_ok: true, scale_ok: true, content_supported: 'pass' };

function indicator(slug: string, levelPct: number): FindingPayload {
  return {
    kind: 'indicator',
    indicator_slug: slug,
    name: `Indicator ${slug}`,
    value: 12,
    unit: '%',
    year: 2025,
    target: 5,
    level_pct: levelPct,
    scoring: {
      threshold_ref: slug,
      function: 'lower_is_better',
      inputs: { value: 12, target: 5, scale: 5 },
      worked_math: 'level_pct = (12 − 5) ⁄ 5 × 100',
    },
    source: 'City statistics office',
    source_url: 'https://stats.example.gov/series',
    source_tier: 1,
    evidence: { snapshot_path: 'evidence/a.png', captured_at: '2026-09-01T00:00:00Z' },
    confidence: 'high',
    geographic_scale: 'city',
  };
}

const gap = (slug: string): FindingPayload => ({
  kind: 'gap',
  indicator_slug: slug,
  reason: 'No city series is published.',
  scales_tried: ['city', 'county'],
  searched_at: '2026-09-01T00:00:00Z',
});

let seq = 0;
const finding = (payload: FindingPayload, verification: FindingVerification | null = PASS) => ({
  id: `f${++seq}`,
  payload,
  verification,
});

const dim = (id: string, over: Partial<Dimension> = {}): Dimension => ({
  id,
  tenantId: 't',
  ring: 'social',
  slug: id,
  canonicalSlug: null,
  displayOrder: 0,
  publishedVersionId: null,
  archivedAt: null,
  ...over,
});

function version(dimensionId: string, over: Partial<DimensionVersion> = {}): DimensionVersion {
  return {
    id: `v-${dimensionId}-${over.versionNum ?? 1}`,
    dimensionId,
    versionNum: 1,
    status: 'published',
    data: {
      name: 'Housing',
      icon: '🏠',
      description: 'Homes people can afford.',
      context: 'Rents rose.',
      indicators: [],
      actions: ['Join the tenants union'],
    },
    vizLevel: -40,
    origin: 'human',
    researchRunId: null,
    changeNote: 'seed',
    createdBy: null,
    createdAt: new Date('2026-01-01'),
    publishedAt: new Date('2026-01-02'),
    ...over,
  };
}

describe('researchVersionData (what approving a run makes)', () => {
  it('takes indicators and gaps from the findings and the narrative from the latest version', () => {
    const base = version('d').data;
    const data = researchVersionData(base, 'housing', [indicator('rent-burden', 30), gap('evictions')]);
    expect(data).toMatchObject({
      name: 'Housing',
      icon: '🏠',
      description: 'Homes people can afford.',
      context: 'Rents rose.',
      actions: base.actions,
    });
    expect(data.indicators).toEqual([
      expect.objectContaining({ name: 'Indicator rent-burden', value: 12, level_pct: 30, source_tier: 1 }),
    ]);
    expect(data.gaps).toEqual([
      { indicator: 'evictions', reason: 'No city series is published.', scales_tried: ['city', 'county'], searched_at: '2026-09-01T00:00:00Z' },
    ]);
  });

  it('names the dimension by its slug without a version, and skips output that matched no schema', () => {
    const data = researchVersionData(null, 'housing', [{ not: 'a finding' } as never]);
    expect(data).toMatchObject({ name: 'housing', indicators: [], gaps: undefined, actions: [] });
  });
});

describe('which findings need a look, and which may be approved in bulk', () => {
  it('flags gap cards and every finding a check failed, as the review card counts them', () => {
    expect(findingFlagged(finding(gap('g')))).toBe(true);
    expect(findingFlagged(finding(indicator('a', 1), { ...PASS, url_ok: false }))).toBe(true);
    expect(findingFlagged(finding(indicator('a', 1), { ...PASS, content_supported: 'uncertain' }))).toBe(true);
    expect(findingFlagged(finding(indicator('a', 1), { ...PASS, partial_output: true }))).toBe(true);
    expect(findingFlagged(finding(indicator('a', 1)))).toBe(false);
  });

  it('approves only verified, passing indicators: a finding never judged is not "passed"', () => {
    expect(findingApprovable(finding(indicator('a', 1)))).toBe(true);
    expect(findingApprovable(finding(indicator('a', 1), null))).toBe(false);
    expect(findingApprovable(finding(gap('g')))).toBe(false);
    expect(findingApprovable(finding(indicator('a', 1), { ...PASS, recency_ok: false }))).toBe(false);
  });

  it('judges a dimension as a whole, and leaves alone what a person already dealt with', () => {
    const ok = {
      findings: [finding(indicator('a', 1))],
      sessionsComplete: true,
      approved: false,
      reviewedByHand: false,
      superseded: false,
    };
    expect(bulkVerdict(ok)).toBe('eligible');
    expect(bulkVerdict({ ...ok, approved: true })).toBe('approved');
    // A disposition outranks a flag: the person has ruled on the dimension.
    const flaggedFindings = [...ok.findings, finding(gap('g'))];
    expect(bulkVerdict({ ...ok, findings: flaggedFindings, reviewedByHand: true })).toBe('reviewed_by_hand');
    expect(bulkVerdict({ ...ok, findings: flaggedFindings, superseded: true })).toBe('superseded');
    expect(bulkVerdict({ ...ok, sessionsComplete: false })).toBe('session_incomplete');
    expect(bulkVerdict({ ...ok, findings: flaggedFindings })).toBe('flagged');
    expect(bulkVerdict({ ...ok, findings: [...ok.findings, finding(indicator('b', 2), null)] })).toBe('unverified');
  });

  it('draws the spot-check sample at random but reproducibly, from the run id', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `finding-${i}`);
    const sample = spotCheckSample(ids, 'run-1');
    expect(sample).toHaveLength(SPOT_CHECK_SIZE);
    expect(new Set(sample).size).toBe(SPOT_CHECK_SIZE);
    expect(sample.every((id) => ids.includes(id))).toBe(true);
    // The same run draws the same sample whatever order the findings come in…
    expect(spotCheckSample([...ids].reverse(), 'run-1')).toEqual(sample);
    // …another run draws its own, and a short list is checked whole.
    expect(spotCheckSample(ids, 'run-2')).not.toEqual(sample);
    expect(spotCheckSample(['only'], 'run-1')).toEqual(['only']);
  });

  it('plans over the portrait’s dimensions in display order: flags open, dispositions, the sample', () => {
    const dims = [
      dim('a', { displayOrder: 1 }),
      dim('b', { displayOrder: 2 }),
      dim('c', { displayOrder: 3 }),
      dim('d', { displayOrder: 4 }),
      dim('e', { displayOrder: 5 }),
      dim('f', { displayOrder: 6 }),
    ];
    const complete = (id: string) => [{ id, status: 'complete' }];
    const research: RunResearch = {
      run: { id: 'run-1' } as ResearchRun,
      sessionsByDim: new Map([
        ['a', complete('s1')],
        ['b', complete('s2')],
        ['c', complete('s3')],
        ['e', complete('s5')],
        ['f', complete('s6')],
      ]),
      findingsByDim: new Map([
        ['a', [finding(indicator('a1', 1)), finding(indicator('a2', 5))] as Finding[]],
        ['b', [finding(indicator('b1', 1), { ...PASS, scale_ok: false })] as Finding[]],
        ['c', [finding(indicator('c1', 1))] as Finding[]],
        ['e', [finding(gap('e1'))] as Finding[]],
        ['f', [finding(indicator('f1', 1), { ...PASS, url_ok: false })] as Finding[]],
      ]),
      runVersionByDim: new Map([['c', version('c', { status: 'draft' })]]),
      reviewedByHand: new Set(['e']),
      supersededSlugs: new Set(['f']),
    };
    const plan = bulkApprovalPlan(dims, research);
    expect(plan.eligible.map((e) => [e.dimension.id, e.findings.length])).toEqual([['a', 2]]);
    expect(plan.findingCount).toBe(2);
    expect(plan.open.map((h) => [h.dimension.id, h.reason])).toEqual([['b', 'flagged']]);
    expect(plan.disposed).toEqual({ approved: 1, reviewed_by_hand: 1, superseded: 1 });
    // Fewer passing findings than the sample size: every one is checked.
    expect(plan.sample.map((f) => f.id).sort()).toEqual(plan.eligible[0]!.findings.map((f) => f.id).sort());
  });
});

describe('draftDimension (one wedge of the draft)', () => {
  const d = { id: 'd', slug: 'housing', ring: 'social' as const, displayOrder: 3, publishedVersionId: 'v-d-1' };
  const published = version('d');

  it('shows unapproved findings as approving them would, scored by the core engine', () => {
    const fs = [finding(indicator('rent', 30)), finding(indicator('crowding', -20)), finding(gap('evictions'))];
    const w = draftDimension({ dimension: d, latest: published, published, runVersion: null, findings: fs, pending: false });
    const expected = researchVersionData(published.data, 'housing', fs.map((f) => f.payload));
    expect(w).toMatchObject({ source: 'research', name: 'Housing', findings: 3, flagged: 1, versionNum: null });
    expect(w.data).toEqual(expected);
    expect(w.vizLevel).toBe(deriveVizLevel(expected));
    expect(w.vizLevel).toBe(60); // worst of 30 and -20: 30% maps to 60 on the -100…150 scale
  });

  it('shows the version approved from this run while it is a draft, and the published one once published', () => {
    const fs = [finding(indicator('rent', 30))];
    const approved = version('d', { versionNum: 2, status: 'draft', vizLevel: 60, researchRunId: 'r' });
    expect(draftDimension({ dimension: d, latest: approved, published, runVersion: approved, findings: fs, pending: false })).toMatchObject({
      source: 'approved',
      versionNum: 2,
      vizLevel: 60,
    });
    const live = version('d', { versionNum: 2, status: 'published', vizLevel: 60, researchRunId: 'r' });
    expect(
      draftDimension({ dimension: { ...d, publishedVersionId: live.id }, latest: live, published: live, runVersion: live, findings: fs, pending: false }),
    ).toMatchObject({ source: 'published', versionNum: 2 });
  });

  it('falls back to the published version, or to no data, for a dimension the run has not produced', () => {
    expect(draftDimension({ dimension: d, latest: published, published, runVersion: null, findings: [], pending: true })).toMatchObject({
      source: 'published',
      vizLevel: -40,
      versionNum: 1,
      pending: true,
    });
    expect(
      draftDimension({ dimension: { ...d, publishedVersionId: null }, latest: null, published: null, runVersion: null, findings: [], pending: false }),
    ).toMatchObject({ source: 'none', name: 'housing', vizLevel: null, data: null });
  });
});

describe('where a draft wedge leads, and what its row says', () => {
  const researched = { dimensionId: 'd1', findings: 2 };
  it('opens the dimension’s review card once the run has settled, and the run page until then', () => {
    expect(draftHref('nyc', researched, { id: 'r1', settled: true })).toBe('/nyc/admin/review?run=r1#review-d1');
    expect(draftHref('nyc', researched, { id: 'r1', settled: false })).toBe('/nyc/admin/research/r1');
    expect(draftHref('nyc', { dimensionId: 'd2', findings: 0 }, { id: 'r1', settled: true })).toBe('/nyc/admin/dim/d2');
  });

  it('says where the data comes from', () => {
    const base = { versionNum: null, findings: 2, flagged: 1, pending: false };
    expect(draftNote({ ...base, source: 'research' }, true)).toBe('From this run, not yet approved · 1 flagged');
    expect(draftNote({ ...base, source: 'research' }, false)).toContain('review opens when the run finishes');
    expect(draftNote({ ...base, source: 'approved', versionNum: 4 }, true)).toBe('Approved as draft v4, not yet published · 1 flagged');
    expect(draftNote({ ...base, source: 'published', versionNum: 2, findings: 0, pending: true }, false)).toBe(
      'Being researched now · showing published v2',
    );
    expect(draftNote({ ...base, source: 'none', findings: 0 }, true)).toBe('No data · nothing from this run, nothing published');
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `dp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('draftPortrait as an editor', () => {
  const saved = process.env.AUTH_SECRET;
  const ids: { tenantId?: string; organizationId?: string; editor?: string; runId?: string; sessions: string[] } = { sessions: [] };
  let dims: { dimensionId: string; slug: string }[] = [];

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const provisioned = await m.provisionTenant(db, { slug: uniq(), name: 'Draft City' });
    ids.tenantId = provisioned.tenant.id;
    ids.organizationId = provisioned.tenant.organizationId;
    dims = provisioned.dimensions;
    const [editor] = await db.insert(m.users).values({ email: `${uniq()}@editor.example.gov` }).returning();
    ids.editor = editor!.id;
    await db.insert(m.tenantMembers).values({ tenantId: provisioned.tenant.id, userId: editor!.id, role: 'editor' });

    // The third dimension is published already (and so the portrait is public).
    const published = await m.appendDimensionVersion(db, {
      dimensionId: dims[2]!.dimensionId,
      status: 'published',
      data: { ...version('x').data, name: 'Published one' },
      vizLevel: -50,
      origin: 'human',
      changeNote: 'seed',
      publishedAt: new Date(),
    });
    await db.update(m.dimensions).set({ publishedVersionId: published.id }).where(eq(m.dimensions.id, dims[2]!.dimensionId));

    // A running run: the first dimension's session finished with one passing
    // indicator; the second's is still running, one finding recorded so far.
    const [run] = await db
      .insert(m.researchRuns)
      .values({
        tenantId: provisioned.tenant.id,
        status: 'running',
        appliedAt: new Date(),
        plan: {
          sessions: dims.slice(0, 3).map((d) => ({
            kind: 'dimension' as const,
            dimension_slug: d.slug,
            prompt: 'p',
            tool_allowlist: [],
            output_schema_ref: 'o',
            config_hash: 'h',
          })),
          config_hash: 'h',
          plugin_version: 'v',
        },
        configSnapshot: {} as never,
      })
      .returning();
    ids.runId = run!.id;
    const sessions = await db
      .insert(m.researchSessions)
      .values([
        { runId: run!.id, kind: 'dimension', dimensionId: dims[0]!.dimensionId, status: 'complete' },
        { runId: run!.id, kind: 'dimension', dimensionId: dims[1]!.dimensionId, status: 'running' },
      ])
      .returning();
    ids.sessions = sessions.map((s) => s.id);
    await db.insert(m.findings).values([
      { sessionId: sessions[0]!.id, dimensionId: dims[0]!.dimensionId, indicatorSlug: 'a', payload: indicator('a', 30), verification: PASS },
      { sessionId: sessions[1]!.id, dimensionId: dims[1]!.dimensionId, indicatorSlug: 'b', payload: indicator('b', 80), verification: PASS },
    ]);
  });

  afterAll(async () => {
    signedIn = null;
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { inArray, sql } = await import('drizzle-orm');
    const db = m.getDb();
    // Findings are immutable (migration 0001's trigger refuses even the
    // owner); this test's own go in one transaction that lifts the trigger
    // for that delete only, as review-actions.test.ts does.
    if (ids.sessions.length) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`alter table findings disable trigger findings_immutable`);
        await tx.delete(m.findings).where(inArray(m.findings.sessionId, ids.sessions));
        await tx.execute(sql`alter table findings enable trigger findings_immutable`);
      });
      await db.delete(m.researchSessions).where(inArray(m.researchSessions.id, ids.sessions));
    }
    if (ids.tenantId) {
      await db.delete(m.dimensions).where(eq(m.dimensions.tenantId, ids.tenantId));
      await db.delete(m.tenants).where(eq(m.tenants.id, ids.tenantId));
    }
    if (ids.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, ids.organizationId));
    if (ids.editor) await db.delete(m.users).where(eq(m.users.id, ids.editor));
  });

  it('fills in finished sessions only, falls back to published, and offers no bulk approval mid-run — on one connection', async () => {
    signedIn = ids.editor!;
    const draft = await onOneConnection(async () => (await import('./draft-portrait')).draftPortrait(ids.tenantId!));
    expect(draft.run?.id).toBe(ids.runId);
    expect(draft.phase).toBe('running');
    expect(draft.bulk).toBeNull();
    const byId = new Map(draft.dimensions.map((d) => [d.dimensionId, d]));
    expect(byId.get(dims[0]!.dimensionId)).toMatchObject({ source: 'research', findings: 1, vizLevel: 60, pending: false });
    // Still running: its first finding is not shown yet.
    expect(byId.get(dims[1]!.dimensionId)).toMatchObject({ source: 'none', findings: 0, pending: true });
    expect(byId.get(dims[2]!.dimensionId)).toMatchObject({ source: 'published', name: 'Published one', vizLevel: -50, pending: true });
    expect(draft.dimensions).toHaveLength(dims.length);
  });

  it('once the run has settled, shows every session’s findings and what bulk approval would take', async () => {
    const m = await import('@deep-fryer/db');
    await m.getDb().update(m.researchRuns).set({ status: 'failed', completedAt: new Date() }).where(eq(m.researchRuns.id, ids.runId!));
    signedIn = ids.editor!;
    const draft = await (await import('./draft-portrait')).draftPortrait(ids.tenantId!, ids.runId);
    const byId = new Map(draft.dimensions.map((d) => [d.dimensionId, d]));
    // A session a settled run left "running" stopped; its findings are shown (and not bulk-approvable).
    expect(byId.get(dims[1]!.dimensionId)).toMatchObject({ source: 'research', findings: 1, pending: false });
    expect(draft.bulk?.eligible.map((e) => e.dimension.id)).toEqual([dims[0]!.dimensionId]);
    expect(draft.bulk?.open).toEqual([expect.objectContaining({ reason: 'session_incomplete' })]);
    expect(draft.bulk?.sample.map((f) => f.dimensionId)).toEqual([dims[0]!.dimensionId]);
  });
});
