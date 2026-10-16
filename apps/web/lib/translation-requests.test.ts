import { afterAll, describe, expect, it } from 'vitest';

/**
 * "Request a translation" (SPEC-v7 §3.5) against the dev database: only for
 * a portrait whose translation is off, only supported languages and the
 * portrait's own pages, and a per-address hourly limit.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `tr-${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!hasDb)('translation requests', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  async function portrait(translation: boolean) {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Request City' });
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    });
    await db
      .update(m.tenantConfig)
      .set({ value: { translation } })
      .where(and(eq(m.tenantConfig.tenantId, tenant.id), eq(m.tenantConfig.key, 'features')));
    return tenant;
  }

  async function count(tenantId: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    return (await m.getDb().select().from(m.translationRequests).where(eq(m.translationRequests.tenantId, tenantId))).length;
  }

  it('records a language request for an English-only portrait, keeping only the page path', async () => {
    const { recordTranslationRequest } = await import('./translation-requests');
    const tenant = await portrait(false);
    const res = await recordTranslationRequest({ tenantSlug: tenant.slug, locale: 'es', path: `/${tenant.slug}/dim/housing?utm=x`, address: '203.0.113.7' });
    expect(res).toEqual({ status: 'sent' });
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await m.getDb().select().from(m.translationRequests).where(eq(m.translationRequests.tenantId, tenant.id));
    expect(row).toMatchObject({ locale: 'es', path: `/${tenant.slug}/dim/housing` });
    expect(row!.ipHash).not.toContain('203.0.113.7');
  });

  it('has nothing to record for a translated portrait', async () => {
    const { recordTranslationRequest } = await import('./translation-requests');
    const tenant = await portrait(true);
    expect(await recordTranslationRequest({ tenantSlug: tenant.slug, locale: 'ko', path: `/${tenant.slug}`, address: '203.0.113.8' })).toEqual({ status: 'not_needed' });
    expect(await count(tenant.id)).toBe(0);
  });

  it('refuses English, unknown languages, and pages of another portrait', async () => {
    const { recordTranslationRequest } = await import('./translation-requests');
    const tenant = await portrait(false);
    const base = { tenantSlug: tenant.slug, path: `/${tenant.slug}`, address: '203.0.113.9' };
    await expect(recordTranslationRequest({ ...base, locale: 'en' })).rejects.toThrow(/not available/);
    await expect(recordTranslationRequest({ ...base, locale: 'xx' })).rejects.toThrow(/not available/);
    await expect(recordTranslationRequest({ ...base, locale: 'es', path: '/elsewhere' })).rejects.toThrow(/not part of this portrait/);
    await expect(recordTranslationRequest({ ...base, locale: 'es', path: '/pricing' })).rejects.toThrow(/not part of this portrait/);
    expect(await count(tenant.id)).toBe(0);
  });

  it('counts requests per language for the owner over the last 90 days, most-asked first', async () => {
    const { translationRequestCounts, TRANSLATION_REQUEST_WINDOW_DAYS } = await import('./translation-requests');
    const m = await import('@deep-fryer/db');
    const tenant = await portrait(false);
    const now = new Date('2026-10-16T12:00:00Z');
    const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
    const row = (locale: string, createdAt: Date) => ({ tenantId: tenant.id, locale, path: `/${tenant.slug}`, ipHash: 'x', createdAt });
    await m.getDb().insert(m.translationRequests).values([
      row('es', daysAgo(1)),
      row('es', daysAgo(30)),
      row('bn', daysAgo(TRANSLATION_REQUEST_WINDOW_DAYS - 1)),
      // Older than the window: a burst from long ago does not look current.
      row('zh-Hant', daysAgo(TRANSLATION_REQUEST_WINDOW_DAYS + 1)),
      row('zh-Hant', daysAgo(200)),
      row('zh-Hant', daysAgo(400)),
    ]);
    expect(await translationRequestCounts(tenant.id, now)).toEqual([
      { language: 'Spanish', count: 2 },
      { language: 'Bengali', count: 1 },
    ]);
  });

  it('limits one address to ten requests an hour per portrait', async () => {
    const { recordTranslationRequest } = await import('./translation-requests');
    const tenant = await portrait(false);
    const send = (address: string) => recordTranslationRequest({ tenantSlug: tenant.slug, locale: 'bn', path: `/${tenant.slug}`, address });
    for (let i = 0; i < 10; i++) expect(await send('198.51.100.1')).toEqual({ status: 'sent' });
    expect(await send('198.51.100.1')).toEqual({ status: 'limited' });
    expect(await send('198.51.100.2')).toEqual({ status: 'sent' });
    expect(await count(tenant.id)).toBe(11);
  });
});
