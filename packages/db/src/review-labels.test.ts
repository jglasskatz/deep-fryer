import { describe, expect, it } from 'vitest';
import { withPostgresError } from './errors.js';

/**
 * Review labels (migration 0025) as the database itself enforces them,
 * whatever the app does: an editor of the portrait may record a decision
 * as themself; nobody else may record one; once written, a label is never
 * changed, and the app role can neither change nor remove it.
 */
type DbExecutor = import('./client.js').DbExecutor;
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `rl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('review labels under the app role', () => {
  it('are written by editors as themselves, for their own portrait’s findings, and never changed or removed', async () => {
    const m = await import('./index.js');
    const { eq, inArray, sql } = await import('drizzle-orm');
    const db = m.getDb();

    const a = await m.provisionTenant(db, { slug: uniq(), name: 'Label City A' });
    const b = await m.provisionTenant(db, { slug: uniq(), name: 'Label City B' });
    const [editor] = await db.insert(m.users).values({ email: `${uniq()}@a.gov` }).returning();
    const [viewer] = await db.insert(m.users).values({ email: `${uniq()}@a.gov` }).returning();
    await db.insert(m.tenantMembers).values([
      { tenantId: a.tenant.id, userId: editor!.id, role: 'editor' },
      { tenantId: a.tenant.id, userId: viewer!.id, role: 'viewer' },
    ]);
    const dimA = a.dimensions[0]!.dimensionId;
    const [run] = await db.insert(m.researchRuns).values({
      tenantId: a.tenant.id, status: 'complete', configSnapshot: {} as never,
      plan: { sessions: [], config_hash: 'h', plugin_version: 'v', strategy: 'standard', strategy_version: 1 },
    }).returning();
    const [runB] = await db.insert(m.researchRuns).values({
      tenantId: b.tenant.id, status: 'complete', configSnapshot: {} as never, plan: { sessions: [], config_hash: 'h', plugin_version: 'v' },
    }).returning();
    const [session] = await db.insert(m.researchSessions).values({ runId: run!.id, kind: 'dimension', dimensionId: dimA, status: 'complete' }).returning();
    const [finding] = await db.insert(m.findings).values({
      sessionId: session!.id, dimensionId: dimA, indicatorSlug: 'water-access',
      payload: { kind: 'gap', indicator_slug: 'water-access', reason: 'None.', scales_tried: ['city'], searched_at: new Date().toISOString() },
    }).returning();

    const label = (over: Partial<typeof m.reviewLabels.$inferInsert> = {}): typeof m.reviewLabels.$inferInsert => ({
      tenantId: a.tenant.id, findingId: finding!.id, runId: run!.id, dimensionId: dimA, decision: 'reject', cause: 'wrong_year',
      note: 'Says 2019.', strategy: 'standard', strategyVersion: 1, provider: 'anthropic', reviewerId: editor!.id, ...over,
    });
    const as = <T>(userId: string, fn: (tx: DbExecutor) => Promise<T>) => m.withAuthContext(db, userId, fn);

    try {
      // The editor records a decision as themself, and can read it back.
      await as(editor!.id, (tx) => tx.insert(m.reviewLabels).values(label()));
      const mine = await as(editor!.id, (tx) => tx.select().from(m.reviewLabels).where(eq(m.reviewLabels.tenantId, a.tenant.id)));
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ decision: 'reject', cause: 'wrong_year', strategy: 'standard', strategyVersion: 1, provider: 'anthropic' });

      // Not as someone else, not as a viewer, not for another portrait.
      await expect(withPostgresError(as(editor!.id, (tx) => tx.insert(m.reviewLabels).values(label({ reviewerId: viewer!.id })))))
        .rejects.toThrow(/row-level security/);
      await expect(withPostgresError(as(viewer!.id, (tx) => tx.insert(m.reviewLabels).values(label({ reviewerId: viewer!.id })))))
        .rejects.toThrow(/row-level security/);
      await expect(withPostgresError(as(editor!.id, (tx) => tx.insert(m.reviewLabels).values(label({ runId: runB!.id, findingId: null })))))
        .rejects.toThrow(/another portrait/);
      await expect(withPostgresError(as(editor!.id, (tx) => tx.insert(m.reviewLabels).values(label({ dimensionId: a.dimensions[1]!.dimensionId })))))
        .rejects.toThrow(/not from this run and dimension/);
      // A viewer reads no labels at all.
      expect(await as(viewer!.id, (tx) => tx.select().from(m.reviewLabels))).toHaveLength(0);

      // The table's own rules: approvals are correct as cited, and only they are;
      // "other" needs words; an unknown cause or provider is refused.
      for (const bad of [
        label({ decision: 'approve' }),
        label({ cause: 'correct_as_cited' }),
        label({ cause: 'other', note: null }),
        label({ cause: 'other', note: '   ' }),
        label({ cause: 'looks_off' as never }),
        label({ provider: 'elsewhere' as never }),
      ]) {
        await expect(withPostgresError(as(editor!.id, (tx) => tx.insert(m.reviewLabels).values(bad)))).rejects.toThrow(/check constraint/);
      }

      // The app role can neither change nor remove a label.
      await expect(withPostgresError(as(editor!.id, (tx) => tx.update(m.reviewLabels).set({ cause: 'out_of_date' }).where(eq(m.reviewLabels.id, mine[0]!.id)))))
        .rejects.toThrow(/permission denied/);
      await expect(withPostgresError(as(editor!.id, (tx) => tx.delete(m.reviewLabels).where(eq(m.reviewLabels.id, mine[0]!.id)))))
        .rejects.toThrow(/permission denied/);
      // Nor can the system context change one.
      await expect(withPostgresError(db.update(m.reviewLabels).set({ note: 'rewritten' }).where(eq(m.reviewLabels.id, mine[0]!.id))))
        .rejects.toThrow(/immutable/);
      const [kept] = await db.select().from(m.reviewLabels).where(eq(m.reviewLabels.id, mine[0]!.id));
      expect(kept).toMatchObject({ cause: 'wrong_year', note: 'Says 2019.' });
    } finally {
      // Findings are immutable even to the owner (migration 0001), so this
      // test's one finding goes in a transaction that lifts the trigger for
      // that delete only; its labels go with it.
      await db.transaction(async (tx) => {
        await tx.execute(sql`alter table findings disable trigger findings_immutable`);
        await tx.delete(m.findings).where(eq(m.findings.id, finding!.id));
        await tx.execute(sql`alter table findings enable trigger findings_immutable`);
      });
      await db.delete(m.researchSessions).where(eq(m.researchSessions.id, session!.id));
      for (const t of [a, b]) {
        await db.delete(m.dimensions).where(eq(m.dimensions.tenantId, t.tenant.id));
        await db.delete(m.tenants).where(eq(m.tenants.id, t.tenant.id));
        await db.delete(m.organizations).where(eq(m.organizations.id, t.tenant.organizationId));
      }
      await db.delete(m.users).where(inArray(m.users.id, [editor!.id, viewer!.id]));
    }
  });
});
