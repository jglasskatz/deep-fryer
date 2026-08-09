import { describe, expect, it } from 'vitest';

/**
 * Integration tests over a real Postgres (migrations applied). They run
 * whenever DATABASE_URL is set — local dev and CI both have one — and skip
 * with a visible notice otherwise rather than faking a database.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('db integration', () => {
  it('provisions a tenant and enforces version-append numbering', async () => {
    const { getDb, provisionTenant, tenantBySlug, appendDimensionVersion, latestVersion, publishedDoughnut } =
      await import('./index.js');
    const db = getDb();
    const slug = `t-${Date.now().toString(36)}`;

    const { tenant, dimensions } = await provisionTenant(db, { slug, name: 'Test City' });
    expect(dimensions).toHaveLength(21);
    expect((await tenantBySlug(db, slug))?.id).toBe(tenant.id);

    const dimId = dimensions[0]!.dimensionId;
    const v1 = await latestVersion(db, dimId);
    expect(v1?.versionNum).toBe(1);

    const v2 = await appendDimensionVersion(db, {
      dimensionId: dimId,
      status: 'draft',
      data: v1!.data,
      origin: 'human',
      changeNote: 'test edit',
    });
    expect(v2.versionNum).toBe(2);
    expect((await latestVersion(db, dimId))?.id).toBe(v2.id);

    // Nothing published yet → portrait exists with zero dimensions.
    const portrait = await publishedDoughnut<{ dimensions: unknown[] }>(db, slug);
    expect(portrait?.dimensions).toHaveLength(0);

    const { tenants } = await import('./schema.js');
    const { eq } = await import('drizzle-orm');
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
  });

  it('review_notes: append-only with substance and reject-reason constraints', async () => {
    const { getDb, provisionTenant } = await import('./index.js');
    const { findings, researchRuns, researchSessions, reviewNotes, tenants } =
      await import('./schema.js');
    const { and, eq } = await import('drizzle-orm');
    const db = getDb();
    const slug = `t-${Date.now().toString(36)}-rn`;

    const { tenant, dimensions } = await provisionTenant(db, { slug, name: 'Review City' });
    const dimId = dimensions[0]!.dimensionId;
    try {
      const [run] = await db
        .insert(researchRuns)
        .values({
          tenantId: tenant.id,
          status: 'complete',
          plan: { sessions: [], config_hash: 'x', plugin_version: 'test' },
          configSnapshot: {
            region: { name: 'x', definition: 'x' },
            source_priority: { tiers: [{ tier: 1, name: 'x', description: 'x' }] },
            recency: { default_max_age_years: 5 },
            scale_policy: { default_accepted: ['city'] },
          },
        })
        .returning();
      const [session] = await db
        .insert(researchSessions)
        .values({ runId: run!.id, dimensionId: dimId, kind: 'dimension', status: 'complete' })
        .returning();
      const [finding] = await db
        .insert(findings)
        .values({
          sessionId: session!.id,
          dimensionId: dimId,
          indicatorSlug: 'test-ind',
          payload: {
            kind: 'gap',
            indicator_slug: 'test-ind',
            reason: 'test',
            scales_tried: ['city'],
            searched_at: 'now',
          },
          verification: {
            url_ok: true,
            schema_ok: true,
            recency_ok: true,
            scale_ok: true,
            content_supported: 'uncertain',
          },
        })
        .returning();

      // A row with no disposition, no annotation, no note carries no substance.
      await expect(
        db.insert(reviewNotes).values({
          tenantId: tenant.id,
          runId: run!.id,
          reviewerLabel: 'tester',
        }),
      ).rejects.toThrow(/review_notes_has_substance/);

      // Rejecting without a reason code or note attests to nothing.
      await expect(
        db.insert(reviewNotes).values({
          tenantId: tenant.id,
          runId: run!.id,
          dimensionId: dimId,
          findingId: finding!.id,
          disposition: 'rejected',
          reviewerLabel: 'tester',
        }),
      ).rejects.toThrow(/review_notes_reject_needs_reason/);

      // A disposition must point at a finding.
      await expect(
        db.insert(reviewNotes).values({
          tenantId: tenant.id,
          runId: run!.id,
          disposition: 'verified',
          reviewerLabel: 'tester',
        }),
      ).rejects.toThrow(/review_notes_disposition_needs_finding/);

      // Legitimate rows: a rejection with a reason code, then a superseding verify.
      const [first] = await db
        .insert(reviewNotes)
        .values({
          tenantId: tenant.id,
          runId: run!.id,
          dimensionId: dimId,
          findingId: finding!.id,
          disposition: 'rejected',
          annotation: { reason_code: 'wrong_value' },
          reviewerLabel: 'tester',
        })
        .returning();
      await db.insert(reviewNotes).values({
        tenantId: tenant.id,
        runId: run!.id,
        dimensionId: dimId,
        findingId: finding!.id,
        disposition: 'verified',
        note: 'checked the exhibit myself',
        reviewerLabel: 'tester',
        createdAt: new Date(Date.now() + 1000),
      });

      // Append-only: the immutability trigger forbids UPDATE and DELETE.
      await expect(
        db.update(reviewNotes).set({ note: 'edited' }).where(eq(reviewNotes.id, first!.id)),
      ).rejects.toThrow(/immutable/);
      await expect(
        db.delete(reviewNotes).where(eq(reviewNotes.id, first!.id)),
      ).rejects.toThrow(/immutable/);

      // Latest-wins: the reducer sees the supersession.
      const { currentDispositions } = await import('@deep-fryer/core');
      const rows = await db
        .select()
        .from(reviewNotes)
        .where(and(eq(reviewNotes.runId, run!.id), eq(reviewNotes.findingId, finding!.id)));
      const current = currentDispositions(rows);
      expect(current).toHaveLength(1);
      expect(current[0]!.state).toBe('verified');
    } finally {
      // findings and review_notes are immutable by trigger (correct in
      // production, inconvenient for a scratch tenant): disable the triggers
      // just long enough to clear the test rows, then cascade the tenant.
      const { sql } = await import('drizzle-orm');
      await db.execute(sql`ALTER TABLE review_notes DISABLE TRIGGER review_notes_immutable`);
      await db.execute(sql`ALTER TABLE findings DISABLE TRIGGER findings_immutable`);
      await db.execute(sql`DELETE FROM review_notes WHERE tenant_id = ${tenant.id}`);
      await db.execute(
        sql`DELETE FROM findings WHERE dimension_id IN (SELECT id FROM dimensions WHERE tenant_id = ${tenant.id})`,
      );
      await db.execute(sql`ALTER TABLE findings ENABLE TRIGGER findings_immutable`);
      await db.execute(sql`ALTER TABLE review_notes ENABLE TRIGGER review_notes_immutable`);
      // Runs first (cascades sessions, which reference dimensions), then the
      // tenant (cascades dimensions) — cascade order across FK chains is not
      // dependency-sorted.
      await db.delete(researchRuns).where(eq(researchRuns.tenantId, tenant.id));
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
  });
});

describe.skipIf(hasDb)('db integration (skipped)', () => {
  it('needs DATABASE_URL', () => {
    expect(hasDb).toBe(false);
  });
});
