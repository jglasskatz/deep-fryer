import { afterAll, describe, expect, it } from 'vitest';
import { embedOriginsFor, embedPolicyCacheSize } from './embed-policy';

/**
 * The embed allowlist middleware reads for /embed/{slug} (CSP
 * frame-ancestors), against the dev database: a portrait's own origins, and a
 * cache that cannot be grown without bound by made-up slugs.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `ep-${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!hasDb)('embed policy (Postgres)', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  it('lists a portrait’s embed origins, dropping anything that is not an origin', async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Embed City' });
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    });
    await db
      .update(m.tenants)
      .set({ embedOrigins: ['https://www.example.gov', 'javascript:alert(1)'] })
      .where(eq(m.tenants.id, tenant.id));
    expect(await embedOriginsFor(tenant.slug)).toEqual(['https://www.example.gov']);
    expect(await embedOriginsFor(uniq())).toEqual([]);
  });

  it('keeps its cache bounded, and never spends a lookup or an entry on a segment that is not a slug', async () => {
    const before = embedPolicyCacheSize();
    for (const junk of ['x'.repeat(8_000), 'Not_A_Slug', '-bad-', 'é'.repeat(10), ' ']) {
      expect(await embedOriginsFor(junk)).toEqual([]);
    }
    expect(embedPolicyCacheSize()).toBe(before);
    for (let i = 0; i < 1_050; i++) await embedOriginsFor(`made-up-${i}`);
    expect(embedPolicyCacheSize()).toBeLessThanOrEqual(1_000);
  }, 60_000);
});
