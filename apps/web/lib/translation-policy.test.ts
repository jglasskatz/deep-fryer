import { afterAll, describe, expect, it } from 'vitest';
import {
  clearTranslationPolicyCache,
  translationOnFor,
  translationPolicyCacheSize,
  translationScope,
} from './translation-policy';

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

  /**
   * A portrait with its `translation` feature as given (null: never set).
   * Public unless `published` is false: marked as having published, in the
   * system context, as the database's publish trigger does (migration 0015).
   */
  async function portrait(translation: boolean | null, organizationId?: string, { published = true } = {}) {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Language City', organizationId });
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      if (!organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    });
    if (published) await db.update(m.tenants).set({ firstPublishedAt: new Date() }).where(eq(m.tenants.id, tenant.id));
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

  it('translates an organization’s pages only for its live portraits, as organizationFeatures decides', async () => {
    // An archived portrait kept from before translation was a feature (on)
    // must not keep the organization's pages translated once every live
    // portrait has it off.
    clearTranslationPolicyCache();
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const old = await portrait(true);
    await portrait(false, old.organizationId);
    await m.getDb().update(m.tenants).set({ archivedAt: new Date() }).where(eq(m.tenants.id, old.id));
    const [org] = await m.getDb().select().from(m.organizations).where(eq(m.organizations.id, old.organizationId));
    expect(await translationOnFor(`/o/${org!.slug}/progress`)).toBe(false);
    expect(await translationOnFor(`/${old.slug}`)).toBe(false);
  });

  it('answers for a portrait that has not published yet as for an unknown one, whatever its feature says', async () => {
    // Middleware cannot tell its members from anyone else, and a redirect or
    // an hreflang list must not reveal that a private portrait exists.
    clearTranslationPolicyCache();
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const hidden = await portrait(true, undefined, { published: false });
    const [org] = await m.getDb().select().from(m.organizations).where(eq(m.organizations.id, hidden.organizationId));
    expect(await translationOnFor(`/${hidden.slug}`)).toBe(false);
    expect(await translationOnFor(`/embed/${hidden.slug}`)).toBe(false);
    expect(await translationOnFor(`/o/${org!.slug}`)).toBe(false);
    // Once it is public it follows its feature (after the minute's cache).
    await m.getDb().update(m.tenants).set({ firstPublishedAt: new Date() }).where(eq(m.tenants.id, hidden.id));
    clearTranslationPolicyCache();
    expect(await translationOnFor(`/${hidden.slug}`)).toBe(true);
    expect(await translationOnFor(`/o/${org!.slug}`)).toBe(true);
  });

  it('keeps its cache bounded, and never spends a lookup or an entry on a segment that is not a slug', async () => {
    // Anyone can put anything in the path: before, each new one stayed cached
    // for the life of the process, so a loop of random paths grew the heap
    // until the process was killed.
    clearTranslationPolicyCache();
    for (const junk of [`/${'x'.repeat(8_000)}`, '/Not_A_Slug', '/o/-bad-', `/embed/${'é'.repeat(10)}`, '/%20']) {
      expect(await translationOnFor(junk)).toBe(false);
    }
    expect(translationPolicyCacheSize()).toBe(0);
    // Well-formed but unknown slugs are looked up once each and cached, up to the cap.
    for (let i = 0; i < 1_050; i++) await translationOnFor(`/made-up-${i}`);
    expect(translationPolicyCacheSize()).toBeLessThanOrEqual(1_000);
  }, 60_000);
});
