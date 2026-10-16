import { afterAll, describe, expect, it } from 'vitest';
import { clearTranslationPolicyCache, translationOnFor, translationScope } from './translation-policy';

describe('translation scope', () => {
  it('maps a path to the portrait or organization it belongs to', () => {
    expect(translationScope('/nyc/dim/housing')).toEqual({ kind: 'tenant', slug: 'nyc' });
    expect(translationScope('/embed/brooklyn')).toEqual({ kind: 'tenant', slug: 'brooklyn' });
    expect(translationScope('/o/nyc/compare')).toEqual({ kind: 'org', slug: 'nyc' });
    // Not a portrait's page: the site's own pages stay multilingual.
    expect(translationScope('/')).toBeNull();
    expect(translationScope('/pricing')).toBeNull();
    expect(translationScope('/login')).toBeNull();
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `tp-${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!hasDb)('translation policy (Postgres)', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  async function portrait(translation: boolean | null) {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Language City' });
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    });
    if (translation !== null) {
      await db
        .update(m.tenantConfig)
        .set({ value: { translation } })
        .where(and(eq(m.tenantConfig.tenantId, tenant.id), eq(m.tenantConfig.key, 'features')));
    }
    return tenant;
  }

  it('follows the portrait’s feature, defaulting to off for a new portrait', async () => {
    clearTranslationPolicyCache();
    const on = await portrait(true);
    const fresh = await portrait(null);
    expect(await translationOnFor(`/${on.slug}/progress`)).toBe(true);
    expect(await translationOnFor(`/embed/${on.slug}`)).toBe(true);
    expect(await translationOnFor(`/${fresh.slug}`)).toBe(false);
    expect(await translationOnFor(`/${uniq()}`)).toBe(false);
    expect(await translationOnFor('/pricing')).toBe(true);
  });
});
