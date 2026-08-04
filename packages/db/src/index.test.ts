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
});

describe.skipIf(hasDb)('db integration (skipped)', () => {
  it('needs DATABASE_URL', () => {
    expect(hasDb).toBe(false);
  });
});
