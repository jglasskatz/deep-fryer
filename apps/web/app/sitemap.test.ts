import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * /sitemap.xml against the dev database: the product's pages, and every
 * public portrait with its published dimension pages — never a portrait
 * that has not published yet (migration 0015) — with language versions
 * listed only for a portrait whose translation is on.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `sm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const BASE = 'https://doughnut.example.gov';

describe.skipIf(!hasDb)('the sitemap', () => {
  const saved = process.env.APP_URL;
  const ids = { tenants: [] as string[], organizations: [] as string[] };
  let live = { slug: '', dimension: '' };
  let english = { slug: '', dimension: '' };
  let draft = '';

  beforeAll(async () => {
    process.env.APP_URL = BASE;
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const db = m.getDb();
    const org = await m.provisionOrganization(db, { slug: uniq(), name: 'Sm Family' });
    ids.organizations.push(org.id);
    const [a, b, c] = await Promise.all(
      ['Translated Ward', 'English Ward', 'Draft Ward'].map((name) =>
        m.provisionTenant(db, { slug: uniq(), name, organizationId: org.id }),
      ),
    );
    ids.tenants.push(a!.tenant.id, b!.tenant.id, c!.tenant.id);
    draft = c!.tenant.slug;
    // Publish one dimension of each of the first two, as lib/publish.ts does; the database makes them public.
    const publishFirst = async (t: typeof a) => {
      const dim = t!.dimensions[0]!;
      const v = (await m.latestVersion(db, dim.dimensionId))!;
      await db.update(m.dimensionVersions).set({ status: 'published', publishedAt: new Date() }).where(eq(m.dimensionVersions.id, v.id));
      await db.update(m.dimensions).set({ publishedVersionId: v.id }).where(eq(m.dimensions.id, dim.dimensionId));
      return { slug: t!.tenant.slug, dimension: dim.slug };
    };
    live = await publishFirst(a);
    english = await publishFirst(b);
    await db
      .update(m.tenantConfig)
      .set({ value: { translation: true } })
      .where(and(eq(m.tenantConfig.tenantId, a!.tenant.id), eq(m.tenantConfig.key, 'features')));
  });

  afterAll(async () => {
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const db = m.getDb();
    await db.update(m.dimensions).set({ publishedVersionId: null }).where(inArray(m.dimensions.tenantId, ids.tenants));
    await db.delete(m.tenants).where(inArray(m.tenants.id, ids.tenants));
    await db.delete(m.organizations).where(inArray(m.organizations.id, ids.organizations));
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  });

  it('lists the product pages and each public portrait with its published dimension pages', async () => {
    const { default: sitemap } = await import('./sitemap');
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        `${BASE}/`,
        `${BASE}/pricing`,
        `${BASE}/accessibility`,
        `${BASE}/privacy`,
        `${BASE}/${live.slug}`,
        `${BASE}/${live.slug}/dim/${live.dimension}`,
        `${BASE}/${english.slug}`,
      ]),
    );
    // Only what the public page shows: the one published dimension, not the other twenty.
    expect(urls.filter((u) => u.startsWith(`${BASE}/${live.slug}/dim/`))).toHaveLength(1);
  });

  it('never lists a portrait that has not published yet', async () => {
    const { default: sitemap } = await import('./sitemap');
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.includes(draft))).toBe(false);
  });

  it('lists language versions for a translated portrait only', async () => {
    const { default: sitemap } = await import('./sitemap');
    const entries = await sitemap();
    const translated = entries.find((e) => e.url === `${BASE}/${live.slug}`)!;
    expect(translated.alternates?.languages).toMatchObject({
      'x-default': `${BASE}/${live.slug}`,
      es: `${BASE}/es/${live.slug}`,
    });
    expect(translated.lastModified).toBeTruthy();
    const englishOnly = entries.find((e) => e.url === `${BASE}/${english.slug}`)!;
    expect(englishOnly.alternates).toBeUndefined();
  });
});
