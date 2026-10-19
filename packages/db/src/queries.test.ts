import { describe, expect, it } from 'vitest';

/**
 * The public-plane rule for system-context reads (queries.ts tenantIsPublic,
 * publicTenantBySlug): a portrait is found only while it is live and has
 * published at least once — the same answer row-level security gives an
 * anonymous reader — while published_doughnut, run in the system context,
 * still reads any portrait (the worker's policy analysis, local dev mode).
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('public portrait lookups', () => {
  it('finds a portrait only between its first publish and its archiving', async () => {
    const m = await import('./index.js');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant, dimensions } = await m.provisionTenant(db, { slug: uniq(), name: 'Lookup Town' });
    try {
      expect(await m.publicTenantBySlug(db, tenant.slug)).toBeNull();
      // The system context still reads the private portrait through the public function.
      expect(await m.publishedDoughnut<{ tenant: { name: string }; dimensions: unknown[] }>(db, tenant.slug)).toEqual(
        expect.objectContaining({ tenant: expect.objectContaining({ name: 'Lookup Town' }), dimensions: [] }),
      );
      // …and an anonymous reader does not.
      expect(await m.withAuthContext(db, null, (tx) => m.publishedDoughnut(tx, tenant.slug))).toBeNull();

      // Publishing a version inserted already published (as scripts/import-santa-cruz.ts does) counts too.
      const dimId = dimensions[0]!.dimensionId;
      const draft = (await m.latestVersion(db, dimId))!;
      const v = await m.appendDimensionVersion(db, {
        dimensionId: dimId, status: 'published', data: draft.data, origin: 'import', publishedAt: new Date(),
      });
      await db.update(m.dimensions).set({ publishedVersionId: v.id }).where(eq(m.dimensions.id, dimId));
      expect((await m.publicTenantBySlug(db, tenant.slug))?.firstPublishedAt).toEqual(v.publishedAt);
      expect(
        await m.withAuthContext(db, null, (tx) => m.publishedDoughnut<{ dimensions: unknown[] }>(tx, tenant.slug)),
      ).toEqual(expect.objectContaining({ dimensions: [expect.objectContaining({ version_num: v.versionNum })] }));

      await db.update(m.tenants).set({ archivedAt: new Date() }).where(eq(m.tenants.id, tenant.id));
      expect(await m.publicTenantBySlug(db, tenant.slug)).toBeNull();
    } finally {
      await db.update(m.dimensions).set({ publishedVersionId: null }).where(eq(m.dimensions.tenantId, tenant.id));
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    }
  });
});
