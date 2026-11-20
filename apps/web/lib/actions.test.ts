import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onOneConnection } from '../test/one-connection';

/**
 * The admin plane's core server actions — a human edit, publishing, a
 * config change, the embed allowlist — as signed-in staff (not dev mode),
 * each on a one-connection pool (test/one-connection.ts): every query an
 * action makes while its userDb transaction is open must run on that
 * transaction. The session is read the way production reads it, through
 * the pooled client (test/database-session.ts), so an identity lookup inside
 * the transaction — the edit's author, audit()'s actor — would wait for a
 * second connection and fail the test just as a nested transaction would.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// Whoever `signedIn` names is the request's user.
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `ac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('admin actions on their own transaction', () => {
  const saved = process.env.AUTH_SECRET;
  const cleanup: { tenantId?: string; organizationId?: string; userIds: string[] } = { userIds: [] };
  let tenantSlug = '';
  let tenantId = '';
  let dimensionId = '';
  let renamedDimensionId = '';
  const people: Record<'owner' | 'editor', string> = { owner: '', editor: '' };

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const { tenant, dimensions } = await m.provisionTenant(db, { slug: uniq(), name: 'Admin City' });
    tenantSlug = tenant.slug;
    tenantId = tenant.id;
    dimensionId = dimensions[0]!.dimensionId;
    renamedDimensionId = dimensions[1]!.dimensionId;
    cleanup.tenantId = tenant.id;
    cleanup.organizationId = tenant.organizationId;
    for (const role of ['owner', 'editor'] as const) {
      const [user] = await db.insert(m.users).values({ email: `${uniq()}@${role}.example.gov` }).returning();
      people[role] = user!.id;
      cleanup.userIds.push(user!.id);
      await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: user!.id, role });
    }
  });

  afterAll(async () => {
    signedIn = null;
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();
    // Versions and audit entries go with the portrait (ON DELETE CASCADE).
    if (cleanup.tenantId) await db.delete(m.tenants).where(eq(m.tenants.id, cleanup.tenantId));
    if (cleanup.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, cleanup.organizationId));
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
  });

  async function auditOf(entityId: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const rows = await m.getDb().select().from(m.auditLog).where(eq(m.auditLog.entityId, entityId)).orderBy(m.auditLog.id);
    return rows.map((r) => [r.action, r.userId]);
  }

  it('clears the wedge when the final measured indicator is removed', async () => {
    signedIn = people.editor;
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const base = (await m.latestVersion(db, dimensionId))!;
    await m.appendDimensionVersion(db, { dimensionId, status: 'draft', origin: 'human', createdBy: people.editor,
      data: base.data, vizLevel: 75, changeNote: 'Historical scored fixture.' });
    const result = await (await import('./actions')).saveDimensionEdit({ tenantSlug, dimensionId,
      data: { ...base.data, indicators: [] }, changeNote: 'Remove the unsupported last indicator.' });
    expect(result.ok).toBe(true);
    expect((await m.latestVersion(db, dimensionId))!.vizLevel).toBeNull();
  });

  it('saves a human edit, reading the threshold overrides and its author on its own transaction', async () => {
    // It used to read the overrides through configValue, a second userDb
    // transaction, and the author and audit actor through getAuth(), each a
    // session read on the pooled client — all while its transaction held a
    // connection.
    const m = await import('@deep-fryer/db');
    const previous = (await m.latestVersion(m.getDb(), dimensionId))!;
    signedIn = people.editor;
    const res = await onOneConnection(async () =>
      (await import('./actions')).saveDimensionEdit({
        tenantSlug,
        dimensionId,
        data: previous.data,
        changeNote: 'Reworded the context.',
      }),
    );
    expect(res).toMatchObject({ ok: true, data: { versionNum: previous.versionNum + 1 } });
    const { versionId } = (res as { ok: true; data: { versionId: string } }).data;
    const { eq } = await import('drizzle-orm');
    const [version] = await m.getDb().select().from(m.dimensionVersions).where(eq(m.dimensionVersions.id, versionId));
    expect(version).toMatchObject({ origin: 'human', createdBy: people.editor, changeNote: 'Reworded the context.' });
    expect(await auditOf(versionId)).toEqual([['create_human_version', people.editor]]);
  });

  it('saves a renamed indicator whose value is unchanged without a supporting source, keeping its key', async () => {
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const base = (await m.latestVersion(db, renamedDimensionId))!;
    const [uninsured, ...rest] = base.data.indicators;
    expect(uninsured!.key).toBe('uninsured-rate');
    // A measured value, sourced, as research or an earlier edit left it.
    await m.appendDimensionVersion(db, { dimensionId: renamedDimensionId, status: 'draft', origin: 'human', createdBy: people.editor,
      changeNote: 'Measured fixture.', vizLevel: null,
      data: { ...base.data, indicators: [{ ...uninsured!, value: 9, year: 2024, source: 'County health survey', source_url: 'https://health.example.gov/survey' }, ...rest] } });
    const measured = (await m.latestVersion(db, renamedDimensionId))!;

    signedIn = people.editor;
    const { saveDimensionEdit } = await import('./actions');
    const renamed = { ...measured.data.indicators[0]!, name: 'People with no health insurance' };
    expect(renamed.supporting_source_url).toBeUndefined();
    const res = await onOneConnection(() => saveDimensionEdit({ tenantSlug, dimensionId: renamedDimensionId,
      data: { ...measured.data, indicators: [renamed, ...measured.data.indicators.slice(1)] }, changeNote: 'Clearer name.' }));
    expect(res).toMatchObject({ ok: true, data: { versionNum: measured.versionNum + 1 } });
    const saved = (await m.latestVersion(db, renamedDimensionId))!;
    expect(saved.data.indicators[0]).toMatchObject({ key: 'uninsured-rate', name: 'People with no health insurance', value: 9 });
    // The renamed row is still scored against its framework threshold.
    expect(saved.data.indicators[0]!.scoring?.threshold_ref).toBe('health.uninsured-rate');
    expect(saved.data.indicators.map((i) => i.key)).toEqual(base.data.indicators.map((i) => i.key));

    // A changed value still needs one, renamed or not.
    const changed = await saveDimensionEdit({ tenantSlug, dimensionId: renamedDimensionId,
      data: { ...saved.data, indicators: [{ ...saved.data.indicators[0]!, name: 'Uninsured', value: 11 }, ...saved.data.indicators.slice(1)] },
      changeNote: 'New figure.' });
    expect(changed).toMatchObject({ ok: false, error: expect.stringContaining('supporting source URL') });
    expect((await m.latestVersion(db, renamedDimensionId))!.id).toBe(saved.id);
  });

  it('records why, for each of the run’s findings, when an edit comes from a review card, and refuses one without a cause', async () => {
    const m = await import('@deep-fryer/db');
    const { eq, sql } = await import('drizzle-orm');
    const db = m.getDb();
    const editedDimension = renamedDimensionId;
    const [run] = await db.insert(m.researchRuns).values({
      tenantId, status: 'complete', configSnapshot: {} as never,
      plan: { sessions: [], config_hash: 'h', plugin_version: 'v', strategy: 'deep', strategy_version: 1 },
    }).returning();
    const [session] = await db.insert(m.researchSessions).values({ runId: run!.id, kind: 'dimension', dimensionId: editedDimension, status: 'complete' }).returning();
    const recorded = await db.insert(m.findings).values(['uninsured-rate', 'life-expectancy'].map((slug) => ({
      sessionId: session!.id, dimensionId: editedDimension, indicatorSlug: slug,
      payload: { kind: 'gap' as const, indicator_slug: slug, reason: 'None.', scales_tried: ['city' as const], searched_at: new Date().toISOString() },
    }))).returning();
    try {
      const base = (await m.latestVersion(db, editedDimension))!;
      signedIn = people.editor;
      const { saveDimensionEdit } = await import('./actions');
      const edit = (review: unknown, changeNote = 'The survey year was 2019, not 2023.') =>
        saveDimensionEdit({ tenantSlug, dimensionId: editedDimension, data: base.data, changeNote, review: review as never });

      expect(await edit({ runId: run!.id, cause: '' })).toEqual({ ok: false, error: 'Choose why first. Nothing was saved.' });
      expect(await edit({ runId: run!.id, cause: 'approve' })).toEqual({ ok: false, error: 'Choose why first. Nothing was saved.' });
      expect(await edit({ runId: 'not-a-run', cause: 'wrong_year' })).toMatchObject({ ok: false, error: expect.stringContaining('not part of this portrait') });
      expect((await m.latestVersion(db, editedDimension))!.id).toBe(base.id);

      const res = await onOneConnection(() => edit({ runId: run!.id, cause: 'wrong_year' }));
      expect(res).toMatchObject({ ok: true, data: { versionNum: base.versionNum + 1 } });
      const labels = await db.select().from(m.reviewLabels).where(eq(m.reviewLabels.runId, run!.id));
      expect(labels.map((l) => l.findingId).sort()).toEqual(recorded.map((f) => f.id).sort());
      for (const label of labels) {
        expect(label).toMatchObject({ decision: 'edit', cause: 'wrong_year', note: 'The survey year was 2019, not 2023.', strategy: 'deep', strategyVersion: 1, reviewerId: people.editor });
      }

      // An ordinary edit, not from a review card, records no label.
      expect(await saveDimensionEdit({ tenantSlug, dimensionId: editedDimension, data: base.data, changeNote: 'Tidied.' })).toMatchObject({ ok: true });
      expect(await db.select().from(m.reviewLabels).where(eq(m.reviewLabels.runId, run!.id))).toHaveLength(2);
    } finally {
      // Findings are immutable even to the owner; this test's go in one
      // transaction that lifts the trigger for that delete only.
      await db.transaction(async (tx) => {
        await tx.execute(sql`alter table findings disable trigger findings_immutable`);
        await tx.delete(m.findings).where(eq(m.findings.sessionId, session!.id));
        await tx.execute(sql`alter table findings enable trigger findings_immutable`);
      });
      await db.delete(m.researchSessions).where(eq(m.researchSessions.id, session!.id));
    }
  });

  it('publishes a version on its own transaction, audit entry included', async () => {
    // publishVersionFor writes its audit entry on the caller's transaction.
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const draft = (await m.latestVersion(m.getDb(), dimensionId))!;
    signedIn = people.editor;
    const res = await onOneConnection(async () =>
      (await import('./actions')).publishVersion({ tenantSlug, versionId: draft.id }),
    );
    expect(res).toEqual({ ok: true, data: undefined });
    const [dimension] = await m.getDb().select().from(m.dimensions).where(eq(m.dimensions.id, dimensionId));
    expect(dimension!.publishedVersionId).toBe(draft.id);
    expect(await auditOf(dimensionId)).toEqual([['publish', people.editor]]);
  });

  it('changes a config key on its own transaction, recording who changed it', async () => {
    signedIn = people.owner;
    const value = { 'housing.cost_burden': { target: 25, rationale: 'City housing plan target.' } };
    const res = await onOneConnection(async () =>
      (await import('./actions')).updateConfig({ tenantSlug, key: 'threshold_overrides', value }),
    );
    expect(res).toEqual({ ok: true, data: undefined });
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const [row] = await m
      .getDb()
      .select()
      .from(m.tenantConfig)
      .where(and(eq(m.tenantConfig.tenantId, tenantId), eq(m.tenantConfig.key, 'threshold_overrides')));
    expect(row).toMatchObject({ value, updatedBy: people.owner });
    expect((await auditOf(tenantId)).filter(([action]) => action === 'config:threshold_overrides')).toEqual([
      ['config:threshold_overrides', people.owner],
    ]);
  });

  it('starts a new portrait with stand-ins on, and stores only a known research mode', async () => {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const { researchModeOf } = await import('@deep-fryer/core');
    const stored = async () => {
      const [row] = await m
        .getDb()
        .select()
        .from(m.tenantConfig)
        .where(and(eq(m.tenantConfig.tenantId, tenantId), eq(m.tenantConfig.key, 'research_mode')));
      return row?.value;
    };
    expect(await stored()).toBe('right_first_then_fill');
    signedIn = people.owner;
    const { updateConfig } = await import('./actions');
    expect(await updateConfig({ tenantSlug, key: 'research_mode', value: 'fill everything' })).toMatchObject({ ok: false });
    expect(await stored()).toBe('right_first_then_fill');
    expect(await updateConfig({ tenantSlug, key: 'research_mode', value: 'right_first' })).toEqual({ ok: true, data: undefined });
    expect(researchModeOf(await stored())).toBe('right_first');
  });

  it('saves the embed allowlist on its own transaction, audit entry included', async () => {
    signedIn = people.owner;
    const res = await onOneConnection(async () =>
      (await import('./actions')).updateEmbedOrigins({ tenantSlug, origins: ['https://www.example.gov/'] }),
    );
    expect(res).toEqual({ ok: true, data: undefined });
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [tenant] = await m.getDb().select().from(m.tenants).where(eq(m.tenants.id, tenantId));
    expect(tenant!.embedOrigins).toEqual(['https://www.example.gov']);
    expect((await auditOf(tenantId)).filter(([action]) => action === 'embed_origins')).toEqual([
      ['embed_origins', people.owner],
    ]);
  });
});
