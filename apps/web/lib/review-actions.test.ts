import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onOneConnection } from '../test/one-connection';

/**
 * The review queue's writes (SPEC.md §9) — approve a run's findings (and
 * publish them), flag a data gap — as a signed-in editor, each on a
 * one-connection pool (test/one-connection.ts). Both read the editor's
 * identity inside their userDb transaction (the version's author, audit()'s
 * actor, publishVersionFor's audit); the session is read through the pooled
 * client as in production (test/database-session.ts), so a read that is not
 * answered by the transaction would wait for a second connection and fail.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// Whoever `signedIn` names is the request's user.
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `rv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('review actions on their own transaction', () => {
  const saved = process.env.AUTH_SECRET;
  const cleanup: { tenantId?: string; organizationId?: string; sessionId?: string; editor?: string } = {};
  let tenantSlug = '';
  let dimensions: { dimensionId: string; slug: string }[] = [];
  let runId = '';

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const provisioned = await m.provisionTenant(db, { slug: uniq(), name: 'Review City' });
    const { tenant } = provisioned;
    tenantSlug = tenant.slug;
    dimensions = provisioned.dimensions;
    cleanup.tenantId = tenant.id;
    cleanup.organizationId = tenant.organizationId;
    const [editor] = await db.insert(m.users).values({ email: `${uniq()}@editor.example.gov` }).returning();
    cleanup.editor = editor!.id;
    await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: editor!.id, role: 'editor' });

    // A finished run with one finding for the first dimension, as the worker
    // records it: an honest gap.
    const [run] = await db
      .insert(m.researchRuns)
      .values({
        tenantId: tenant.id,
        status: 'complete',
        plan: { sessions: [], config_hash: 'h', plugin_version: 'v' },
        configSnapshot: {} as never,
      })
      .returning();
    runId = run!.id;
    const [session] = await db
      .insert(m.researchSessions)
      .values({ runId, kind: 'dimension', dimensionId: dimensions[0]!.dimensionId, status: 'complete' })
      .returning();
    cleanup.sessionId = session!.id;
    await db.insert(m.findings).values({
      sessionId: session!.id,
      dimensionId: dimensions[0]!.dimensionId,
      indicatorSlug: 'water-access',
      payload: {
        kind: 'gap',
        indicator_slug: 'water-access',
        reason: 'No city-level series is published.',
        scales_tried: ['city', 'county'],
        searched_at: new Date().toISOString(),
      },
    });
  });

  afterAll(async () => {
    signedIn = null;
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { eq, sql } = await import('drizzle-orm');
    const db = m.getDb();
    // Findings are immutable (migration 0001's trigger refuses even the
    // owner), and they hold the portrait's dimensions and sessions in place.
    // This test's own finding goes in one transaction that lifts the trigger
    // for that one delete only: DDL is transactional, so no other session
    // ever sees findings without it.
    if (cleanup.sessionId) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`alter table findings disable trigger findings_immutable`);
        await tx.delete(m.findings).where(eq(m.findings.sessionId, cleanup.sessionId!));
        await tx.execute(sql`alter table findings enable trigger findings_immutable`);
      });
    }
    // Then the session (it points at a dimension) and the dimensions with
    // their versions (an approved version points at the run), before the
    // portrait takes the run, its config, and its audit entries with it.
    if (cleanup.sessionId) await db.delete(m.researchSessions).where(eq(m.researchSessions.id, cleanup.sessionId));
    if (cleanup.tenantId) {
      await db.delete(m.dimensions).where(eq(m.dimensions.tenantId, cleanup.tenantId));
      await db.delete(m.tenants).where(eq(m.tenants.id, cleanup.tenantId));
    }
    if (cleanup.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, cleanup.organizationId));
    if (cleanup.editor) await db.delete(m.users).where(eq(m.users.id, cleanup.editor));
  });

  async function auditOf(entityId: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const rows = await m.getDb().select().from(m.auditLog).where(eq(m.auditLog.entityId, entityId)).orderBy(m.auditLog.id);
    return rows.map((r) => [r.action, r.userId]);
  }

  async function publishedVersionOf(dimensionId: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await m.getDb().select().from(m.dimensions).where(eq(m.dimensions.id, dimensionId));
    return row!.publishedVersionId;
  }

  it('approves and publishes a run’s findings on one transaction', async () => {
    const dimensionId = dimensions[0]!.dimensionId;
    signedIn = cleanup.editor!;
    const res = await onOneConnection(async () =>
      (await import('./review-actions')).approveFindings({ tenantSlug, runId, dimensionId, publish: true }),
    );
    expect(res).toMatchObject({ ok: true });
    const { versionId } = (res as { ok: true; data: { versionId: string } }).data;
    expect(await publishedVersionOf(dimensionId)).toBe(versionId);
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [version] = await m.getDb().select().from(m.dimensionVersions).where(eq(m.dimensionVersions.id, versionId));
    expect(version).toMatchObject({ origin: 'research', researchRunId: runId, createdBy: cleanup.editor });
    expect(version!.data.gaps).toEqual([expect.objectContaining({ indicator: 'water-access' })]);
    expect(await auditOf(versionId)).toEqual([['approve_findings', cleanup.editor]]);
    expect(await auditOf(dimensionId)).toEqual([['publish', cleanup.editor]]);
  });

  it('flags a data gap and publishes it on one transaction', async () => {
    const dimensionId = dimensions[1]!.dimensionId;
    signedIn = cleanup.editor!;
    const res = await onOneConnection(async () =>
      (await import('./review-actions')).flagGap({ tenantSlug, dimensionId, indicator: 'air-quality', reason: 'No monitor in the city.' }),
    );
    expect(res).toMatchObject({ ok: true });
    const { versionId } = (res as { ok: true; data: { versionId: string } }).data;
    expect(await publishedVersionOf(dimensionId)).toBe(versionId);
    expect(await auditOf(versionId)).toEqual([['flag_gap', cleanup.editor]]);
    expect(await auditOf(dimensionId)).toEqual([['publish', cleanup.editor]]);
  });
});

/**
 * "Approve all unflagged" (the draft doughnut's bulk action): once every
 * flagged dimension of a settled run has been dealt with on its card
 * (review-disposes-each-flag), the dimensions whose every finding passed are
 * approved as drafts — never published — in one transaction under the run's
 * approval lock, after the reviewer checked a random sample; one audit entry
 * per finding; running it again approves nothing twice.
 */
describe.skipIf(!hasDb)('approve all unflagged', () => {
  const saved = process.env.AUTH_SECRET;
  const PASS = { url_ok: true, schema_ok: true, recency_ok: true, scale_ok: true, content_supported: 'pass' as const };
  const ids: { tenantId?: string; organizationId?: string; users: string[]; sessions: string[] } = { users: [], sessions: [] };
  let editor = '';
  let viewer = '';
  let outsider = '';
  let tenantSlug = '';
  let dims: { dimensionId: string; slug: string }[] = [];
  let runId = '';
  let secondRunId = '';
  let runningRunId = '';
  /** Finding ids by dimension index. */
  const findingIds = new Map<number, string[]>();

  const indicator = (slug: string, levelPct: number) => ({
    kind: 'indicator' as const,
    indicator_slug: slug,
    name: `Indicator ${slug}`,
    value: 12,
    unit: '%',
    year: 2025,
    target: 5,
    level_pct: levelPct,
    scoring: { threshold_ref: slug, function: 'lower_is_better' as const, inputs: { value: 12 }, worked_math: 'm' },
    source: 'City statistics office',
    source_url: 'https://stats.example.gov/series',
    source_tier: 1,
    evidence: { snapshot_path: 'evidence/a.png', captured_at: '2026-09-01T00:00:00Z' },
    confidence: 'high' as const,
    geographic_scale: 'city' as const,
  });
  const narrative = (name: string) => ({ name, icon: '', description: 'd', context: 'c', indicators: [], actions: [] });
  const laterRun = async (dimIndexes: number[]) => {
    const m = await import('@deep-fryer/db');
    await m
      .getDb()
      .insert(m.researchRuns)
      .values({
        tenantId: ids.tenantId!,
        plan: {
          sessions: dimIndexes.map((i) => ({
            kind: 'dimension' as const,
            dimension_slug: dims[i]!.slug,
            prompt: 'p',
            tool_allowlist: [],
            output_schema_ref: 'o',
            config_hash: 'h',
          })),
          config_hash: 'h',
          plugin_version: 'v',
        },
        configSnapshot: {} as never,
      });
  };

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const provisioned = await m.provisionTenant(db, { slug: uniq(), name: 'Bulk City' });
    const { tenant } = provisioned;
    tenantSlug = tenant.slug;
    dims = provisioned.dimensions;
    ids.tenantId = tenant.id;
    ids.organizationId = tenant.organizationId;
    const people = await db
      .insert(m.users)
      .values([{ email: `${uniq()}@editor.example.gov` }, { email: `${uniq()}@viewer.example.gov` }, { email: `${uniq()}@elsewhere.example.org` }])
      .returning();
    [editor, viewer, outsider] = people.map((u) => u.id) as [string, string, string];
    ids.users = people.map((u) => u.id);
    await db.insert(m.tenantMembers).values([
      { tenantId: tenant.id, userId: editor, role: 'editor' },
      { tenantId: tenant.id, userId: viewer, role: 'viewer' },
    ]);

    // Versions from before the runs (not "since the run began"): the eighth
    // dimension's narrative is kept by approval; the third's lets a reviewer
    // flag it as a data gap later.
    await m.appendDimensionVersion(db, {
      dimensionId: dims[7]!.dimensionId,
      status: 'draft',
      data: { name: 'Energy', icon: '⚡', description: 'Power for every home.', context: 'c', indicators: [], actions: ['Insulate'] },
      vizLevel: null,
      origin: 'human',
      changeNote: 'seed',
    });
    await m.appendDimensionVersion(db, {
      dimensionId: dims[2]!.dimensionId,
      status: 'draft',
      data: narrative('Air'),
      vizLevel: null,
      origin: 'human',
      changeNote: 'seed',
    });

    const plan = { sessions: [], config_hash: 'h', plugin_version: 'v' };
    const [run, second, running] = await db
      .insert(m.researchRuns)
      .values([
        { tenantId: tenant.id, status: 'complete', appliedAt: new Date(), plan, configSnapshot: {} as never },
        { tenantId: tenant.id, status: 'complete', appliedAt: new Date(), plan, configSnapshot: {} as never },
        { tenantId: tenant.id, status: 'running', appliedAt: new Date(), plan, configSnapshot: {} as never },
      ])
      .returning();
    runId = run!.id;
    secondRunId = second!.id;
    runningRunId = running!.id;

    // One session per dimension, and what each recorded.
    type Case = { dim: number; run: string; status: 'complete' | 'failed'; findings: { payload: unknown; verification: unknown }[] };
    const cases: Case[] = [
      // 0: two passing indicators — approved in bulk.
      { dim: 0, run: runId, status: 'complete', findings: [{ payload: indicator('a1', 30), verification: PASS }, { payload: indicator('a2', -20), verification: PASS }] },
      // 1: one passes, one red-flagged — open until approved on its card.
      { dim: 1, run: runId, status: 'complete', findings: [{ payload: indicator('b1', 1), verification: PASS }, { payload: indicator('b2', 1), verification: { ...PASS, url_ok: false } }] },
      // 2: a gap card — open until a reviewer flags the data gap.
      {
        dim: 2,
        run: runId,
        status: 'complete',
        findings: [
          {
            payload: { kind: 'gap', indicator_slug: 'c1', reason: 'No series.', scales_tried: ['city'], searched_at: '2026-09-01T00:00:00Z' },
            verification: { ...PASS, content_supported: 'uncertain' },
          },
        ],
      },
      // 3: never verified — open until approved on its card.
      { dim: 3, run: runId, status: 'complete', findings: [{ payload: indicator('d1', 1), verification: null }] },
      // 4: its session failed — open until planned for research again.
      { dim: 4, run: runId, status: 'failed', findings: [{ payload: indicator('e1', 1), verification: PASS }] },
      // 6: already approved from this run — never approved twice.
      { dim: 6, run: runId, status: 'complete', findings: [{ payload: indicator('g1', 1), verification: PASS }] },
      // 7: one passing indicator on a dimension with a version — approved in bulk, narrative kept.
      { dim: 7, run: runId, status: 'complete', findings: [{ payload: indicator('h1', 60), verification: PASS }] },
      // 10: passing, but a later run researches it again — left alone.
      { dim: 10, run: runId, status: 'complete', findings: [{ payload: indicator('k1', 1), verification: PASS }] },
      // 8: the second run's one passing indicator — for the double submit.
      { dim: 8, run: secondRunId, status: 'complete', findings: [{ payload: indicator('i1', 1), verification: PASS }] },
      // 9: the running run's finished session — not approvable until the run settles.
      { dim: 9, run: runningRunId, status: 'complete', findings: [{ payload: indicator('j1', 1), verification: PASS }] },
    ];
    for (const c of cases) {
      const [session] = await db
        .insert(m.researchSessions)
        .values({ runId: c.run, kind: 'dimension', dimensionId: dims[c.dim]!.dimensionId, status: c.status })
        .returning();
      ids.sessions.push(session!.id);
      for (const f of c.findings) {
        const [row] = await db
          .insert(m.findings)
          .values({
            sessionId: session!.id,
            dimensionId: dims[c.dim]!.dimensionId,
            indicatorSlug: (f.payload as { indicator_slug: string }).indicator_slug,
            payload: f.payload as never,
            verification: f.verification as never,
          })
          .returning();
        findingIds.set(c.dim, [...(findingIds.get(c.dim) ?? []), row!.id]);
      }
    }

    await m.appendDimensionVersion(db, {
      dimensionId: dims[6]!.dimensionId,
      status: 'draft',
      data: narrative('Approved'),
      vizLevel: null,
      origin: 'research',
      researchRunId: runId,
    });
    await laterRun([10]);
  });

  afterAll(async () => {
    signedIn = null;
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { eq, inArray, sql } = await import('drizzle-orm');
    const db = m.getDb();
    // As above: this test's own findings go with the immutability trigger
    // lifted inside one transaction, then sessions, dimensions (their
    // versions point at the runs) and the portrait with its runs and audit.
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
    if (ids.users.length) await db.delete(m.users).where(inArray(m.users.id, ids.users));
  });

  /** Every version approved from `run`, as [dimension index, version], in dimension order. */
  async function runVersions(run: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const rows = await m.getDb().select().from(m.dimensionVersions).where(eq(m.dimensionVersions.researchRunId, run));
    const index = new Map(dims.map((d, i) => [d.dimensionId, i]));
    return rows.map((v) => [index.get(v.dimensionId)!, v] as const).sort((a, b) => a[0] - b[0]);
  }

  async function bulkAudit() {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    return m
      .getDb()
      .select()
      .from(m.auditLog)
      .where(and(eq(m.auditLog.tenantId, ids.tenantId!), eq(m.auditLog.action, 'approve_finding')));
  }

  /**
   * What the confirmation would send for the findings of these dimensions:
   * their count, and every one as checked — with three or fewer the sample is
   * all of them (SPOT_CHECK_SIZE), so this is exactly the sample.
   */
  const confirmed = (dimIndexes: number[]) => {
    const passed = dimIndexes.flatMap((i) => findingIds.get(i) ?? []);
    return { expectedFindings: passed.length, spotChecked: passed };
  };

  it('refuses anyone below editor, approving nothing', async () => {
    const { approveUnflaggedFindings } = await import('./review-actions');
    for (const who of [viewer, outsider, null]) {
      signedIn = who;
      const res = await approveUnflaggedFindings({ tenantSlug, runId, expectedFindings: 99, spotChecked: [] });
      expect(res).toMatchObject({ ok: false });
    }
    expect((await runVersions(runId)).map(([i]) => i)).toEqual([6]);
    expect(await bulkAudit()).toEqual([]);
  });

  it('refuses a run still in progress, and any run while a flag is still open', async () => {
    signedIn = editor;
    const { approveUnflaggedFindings } = await import('./review-actions');
    const running = await approveUnflaggedFindings({ tenantSlug, runId: runningRunId, expectedFindings: 1, spotChecked: findingIds.get(9)! });
    expect(running).toMatchObject({ ok: false, error: expect.stringContaining("hasn't finished") });
    expect(await runVersions(runningRunId)).toEqual([]);

    const open = await approveUnflaggedFindings({ tenantSlug, runId, expectedFindings: 3, spotChecked: [] });
    expect(open).toMatchObject({ ok: false, error: expect.stringContaining('4 dimensions of this run still have flagged findings') });
    expect((await runVersions(runId)).map(([i]) => i)).toEqual([6]);
  });

  it('once each flag is dealt with on its card, still refuses more than confirmed or an unchecked sample', async () => {
    signedIn = editor;
    const { approveFindings, approveUnflaggedFindings, flagGap } = await import('./review-actions');
    // Each open dimension disposed of individually: approved on its card (1, 3),
    // flagged as a data gap (2), planned for research again (4).
    expect(await approveFindings({ tenantSlug, runId, dimensionId: dims[1]!.dimensionId })).toMatchObject({ ok: true });
    expect(await approveFindings({ tenantSlug, runId, dimensionId: dims[3]!.dimensionId })).toMatchObject({ ok: true });
    expect(
      await flagGap({ tenantSlug, dimensionId: dims[2]!.dimensionId, indicator: 'c1', reason: 'Nothing at city scale.' }),
    ).toMatchObject({ ok: true });
    await laterRun([4]);

    const { expectedFindings, spotChecked } = confirmed([0, 7]);
    expect(expectedFindings).toBe(3);
    const tooMany = await approveUnflaggedFindings({ tenantSlug, runId, expectedFindings: 2, spotChecked });
    expect(tooMany).toMatchObject({ ok: false, error: expect.stringContaining('Reload') });
    const unchecked = await approveUnflaggedFindings({ tenantSlug, runId, expectedFindings, spotChecked: spotChecked.slice(1) });
    expect(unchecked).toMatchObject({ ok: false, error: expect.stringContaining('spot-check') });
    expect((await runVersions(runId)).map(([i]) => i)).toEqual([1, 3, 6]);
    expect(await bulkAudit()).toEqual([]);
  });

  it('approves, as drafts, only dimensions whose every finding passed — audited per finding, on one transaction', async () => {
    signedIn = editor;
    const { expectedFindings, spotChecked } = confirmed([0, 7]);
    const res = await onOneConnection(async () =>
      (await import('./review-actions')).approveUnflaggedFindings({ tenantSlug, runId, expectedFindings, spotChecked }),
    );
    expect(res).toMatchObject({ ok: true, data: { findings: 3 } });
    const { data } = res as { ok: true; data: { versions: { dimension: string }[] } };
    expect(data.versions.map((v) => v.dimension)).toEqual([dims[0]!.slug, dims[7]!.slug]);

    const versions = await runVersions(runId);
    expect(versions.map(([i]) => i)).toEqual([0, 1, 3, 6, 7]);
    const { deriveVizLevel } = await import('@deep-fryer/core');
    for (const [i, v] of versions.filter(([i]) => i === 0 || i === 7)) {
      expect(v, `dimension ${i}`).toMatchObject({ status: 'draft', origin: 'research', createdBy: editor, publishedAt: null });
      expect(v.vizLevel).toBe(deriveVizLevel(v.data));
    }
    const first = versions.find(([i]) => i === 0)![1];
    expect(first.data.indicators.map((x) => x.name)).toEqual(['Indicator a1', 'Indicator a2']);
    const energy = versions.find(([i]) => i === 7)![1];
    expect(energy.data).toMatchObject({ name: 'Energy', icon: '⚡', description: 'Power for every home.', actions: ['Insulate'] });

    // Nothing published by it: the one published version is the reviewer's own data-gap wedge.
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const rows = await m.getDb().select().from(m.dimensions).where(eq(m.dimensions.tenantId, ids.tenantId!));
    expect(rows.filter((d) => d.publishedVersionId).map((d) => d.id)).toEqual([dims[2]!.dimensionId]);

    // One audit entry per finding approved, by the editor, naming its version; the sample marked.
    const entries = await bulkAudit();
    expect(entries.map((e) => e.entityId).sort()).toEqual([...spotChecked].sort());
    const versionByDim = new Map(versions.map(([i, v]) => [dims[i]!.slug, v.id]));
    for (const e of entries) {
      expect(e).toMatchObject({ entity: 'finding', userId: editor });
      const after = e.after as { dimension: string; version_id: string; run_id: string; bulk: boolean; spot_checked: boolean };
      expect(after).toMatchObject({ run_id: runId, bulk: true, spot_checked: true });
      expect(after.version_id).toBe(versionByDim.get(after.dimension));
    }
  });

  it('approves nothing twice: again afterwards, or twice at once', async () => {
    signedIn = editor;
    const { approveUnflaggedFindings } = await import('./review-actions');
    const again = await approveUnflaggedFindings({ tenantSlug, runId, ...confirmed([0, 7]) });
    expect(again).toMatchObject({ ok: true, data: { findings: 0, versions: [] } });
    expect((await runVersions(runId)).map(([i]) => i)).toEqual([0, 1, 3, 6, 7]);
    expect(await bulkAudit()).toHaveLength(3);

    // A double submit: the run's approval lock makes the second wait, then find it done.
    const twice = confirmed([8]);
    const both = await Promise.all([
      approveUnflaggedFindings({ tenantSlug, runId: secondRunId, ...twice }),
      approveUnflaggedFindings({ tenantSlug, runId: secondRunId, ...twice }),
    ]);
    expect(both.map((r) => (r as { ok: true; data: { findings: number } }).data.findings).sort()).toEqual([0, 1]);
    expect((await runVersions(secondRunId)).map(([i]) => i)).toEqual([8]);
    expect(await bulkAudit()).toHaveLength(4);
  });
});
