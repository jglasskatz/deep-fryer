import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatIndicatorValue, type DimensionData } from '@deep-fryer/core';
import { setPortraitFeatures } from './test-features';

/**
 * The Energy deep-dive template against the database: it is filled from the
 * published Energy version, never from a newer draft, and what an editor
 * saves from it is exactly what the template gave them.
 */
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
let signedIn: string | null = null;
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)) }));
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const energy = (value: number, reason: string): DimensionData => ({
  name: 'Energy',
  icon: 'zap',
  description: 'Affordable, reliable, clean energy access.',
  context: '',
  indicators: [
    { name: 'Median energy burden of low-income households', value, unit: '% of household income', year: 2024, target: 6, source: 'DOE LEAD Tool', source_url: 'https://www.energy.gov/scep/lead-tool', confidence: 'medium', geographic_scale: 'county' },
    { name: 'Renewable share of electricity', value: null, unit: '%', year: null, target: 100, source: '', source_url: '', confidence: 'low', geographic_scale: 'city' },
  ],
  gaps: [{ indicator: 'Renewable share of electricity', reason, scales_tried: ['city'], searched_at: '2026-09-01T00:00:00Z' }],
  actions: [],
});

describe.skipIf(!hasDb)('the Energy deep-dive template from the published portrait', () => {
  const savedSecret = process.env.AUTH_SECRET;
  const cleanup = { tenantIds: [] as string[], organizationIds: [] as string[], userIds: [] as string[] };
  let tenantSlug = '';
  let editor = '';
  let viewer = '';

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'custom-page-template-test';
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant, dimensions } = await m.provisionTenant(db, { slug: uniq(), name: 'Template Town' });
    tenantSlug = tenant.slug;
    cleanup.tenantIds.push(tenant.id);
    cleanup.organizationIds.push(tenant.organizationId);
    await setPortraitFeatures(tenant.id, { custom_pages: true });
    for (const role of ['editor', 'viewer'] as const) {
      const [person] = await db.insert(m.users).values({ email: `${uniq()}@example.gov` }).returning();
      cleanup.userIds.push(person!.id);
      await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: person!.id, role });
      if (role === 'editor') editor = person!.id; else viewer = person!.id;
    }
    const dimensionId = dimensions.find((d) => d.slug === 'energy')!.dimensionId;
    // Published: 8.25 %, then a newer draft (12 %) that nobody has published.
    const published = await m.appendDimensionVersion(db, { dimensionId, status: 'published', data: energy(8.25, 'No city-level series is published.'), origin: 'human', changeNote: 'Test figures', publishedAt: new Date('2026-10-01T12:00:00Z') });
    await db.update(m.dimensions).set({ publishedVersionId: published.id }).where(eq(m.dimensions.id, dimensionId));
    await m.appendDimensionVersion(db, { dimensionId, status: 'draft', data: energy(12, 'Draft reason that is not public.'), origin: 'human', changeNote: 'Newer draft' });
  });

  afterAll(async () => {
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const db = m.getDb();
    if (cleanup.tenantIds.length) {
      await db.update(m.dimensions).set({ publishedVersionId: null }).where(inArray(m.dimensions.tenantId, cleanup.tenantIds));
      await db.delete(m.tenants).where(inArray(m.tenants.id, cleanup.tenantIds));
    }
    if (cleanup.organizationIds.length) await db.delete(m.organizations).where(inArray(m.organizations.id, cleanup.organizationIds));
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
    if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
    signedIn = null;
  });

  it('writes the published figures and gap reason, not the newer draft, and saves as given', async () => {
    const { customPageTemplates } = await import('./custom-page-templates');
    const { saveCustomPage } = await import('./custom-page-actions');
    const { listCustomPagesForAdmin } = await import('./custom-pages');
    const { getPortrait } = await import('./data');
    signedIn = editor;
    const result = await customPageTemplates({ tenantSlug });
    if (!result.ok) throw new Error(result.error);
    const template = result.data.find((t) => t.id === 'energy-deep-dive')!;

    const portrait = await getPortrait(tenantSlug);
    const publishedEnergy = portrait!.dimensions.find((d) => d.slug === 'energy')!;
    expect(publishedEnergy.data.indicators[0]!.value).toBe(8.25);
    for (const ind of publishedEnergy.data.indicators.filter((i) => i.value !== null)) {
      expect(template.body).toContain(`${ind.name}: ${formatIndicatorValue(ind.value, ind.unit)} (${ind.year}, county data)`);
    }
    expect(template.body).toContain('- Renewable share of electricity: no data yet. No city-level series is published.');
    expect(template.body).toContain('on October 1, 2026');
    expect(template.body).not.toContain(formatIndicatorValue(12, '% of household income'));
    expect(template.body).not.toContain('Draft reason');

    const saved = await saveCustomPage({ tenantSlug, slug: template.slug, title: template.title, body: template.body });
    if (!saved.ok) throw new Error(saved.error);
    const pages = await listCustomPagesForAdmin(cleanup.tenantIds[0]!);
    const page = pages.find((p) => p.slug === 'energy-deep-dive')!;
    expect(page.publishedVersionId).toBeNull();
    expect(page.versions[0]).toMatchObject({ title: 'Energy deep-dive', mdxBody: template.body, status: 'draft' });
  });

  it('is refused to a viewer and when custom pages are off', async () => {
    const { customPageTemplates } = await import('./custom-page-templates');
    signedIn = viewer;
    expect(await customPageTemplates({ tenantSlug })).toMatchObject({ ok: false, error: 'This needs the editor role on this portrait.' });
    await setPortraitFeatures(cleanup.tenantIds[0]!, { custom_pages: false });
    try {
      signedIn = editor;
      expect(await customPageTemplates({ tenantSlug })).toMatchObject({ ok: false, error: expect.stringContaining('turned off') });
    } finally {
      await setPortraitFeatures(cleanup.tenantIds[0]!, { custom_pages: true });
    }
  });
});
