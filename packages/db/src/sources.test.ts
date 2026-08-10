import { describe, expect, it } from 'vitest';

/** Integration tests for the source knowledge base (migrations 0004/0005). */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('sources', () => {
  it('idempotent inserts, LEAST tier reconciliation, FTS search, provenance guard', async () => {
    const { getDb, provisionTenant, recordSource, reconcileSourceTier, searchSources, sourcesBySnapshotPaths } =
      await import('./index.js');
    const { sources, tenants } = await import('./schema.js');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const slug = `t-${Date.now().toString(36)}-src`;
    const { tenant } = await provisionTenant(db, { slug, name: 'Source City' });

    try {
      const base = {
        tenantId: tenant.id,
        url: 'https://data.example.gov/rent',
        urlHash: 'abc123def456',
        contentHash: 'c'.repeat(64),
        title: 'Rent burden report 2024',
        mediaType: 'html' as const,
        text: 'The median renter household spent 54.3% of income on rent in 2024. Pesticide data is elsewhere.',
        textSource: 'html' as const,
        extraction: 'capture' as const,
        snapshotPath: 'evidence/by-content/cccccccccccc.png',
        capturedAt: new Date('2026-08-01T00:00:00Z'),
      };

      // Idempotency: the same (tenant, url_hash, content_hash) collapses.
      const first = await recordSource(db, base);
      expect(first).not.toBeNull();
      expect(await recordSource(db, base)).toBeNull();

      // Tier reconciliation: LEAST wins, set-once from null.
      await reconcileSourceTier(db, tenant.id, base.snapshotPath, 4);
      await reconcileSourceTier(db, tenant.id, base.snapshotPath, 1);
      await reconcileSourceTier(db, tenant.id, base.snapshotPath, 3);
      const byPath = await sourcesBySnapshotPaths(db, tenant.id, [base.snapshotPath]);
      expect(byPath.get(base.snapshotPath)?.sourceTier).toBe(1);

      // FTS: websearch syntax with phrase + negation, mark-tagged headline.
      const hits = await searchSources(db, tenant.id, '"median renter" -unrelatedword');
      expect(hits).toHaveLength(1);
      expect(hits[0]!.headline).toContain('<mark>');
      expect(await searchSources(db, tenant.id, 'nonexistentterm9') ).toHaveLength(0);

      // Provenance guard: text is immutable; tier/text_public may change.
      await expect(
        db.update(sources).set({ text: 'tampered' }).where(eq(sources.id, first!.id)),
      ).rejects.toThrow(/provenance is immutable/);
      await db.update(sources).set({ textPublic: true }).where(eq(sources.id, first!.id));
    } finally {
      const { sql } = await import('drizzle-orm');
      await db.execute(sql`DELETE FROM sources WHERE tenant_id = ${tenant.id}`);
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
  });
});

describe.skipIf(hasDb)('sources (skipped)', () => {
  it('needs DATABASE_URL', () => {
    expect(hasDb).toBe(false);
  });
});
