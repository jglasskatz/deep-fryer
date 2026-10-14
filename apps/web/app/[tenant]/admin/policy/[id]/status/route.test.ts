import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The status endpoint the result page polls: `{ status }` and nothing else
 * (never the brief), uncached, and 404 for anything that is not an analysis
 * of this portrait. Runs as the dev-mode identity (no AUTH_SECRET) against
 * real Postgres.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('GET /{tenant}/admin/policy/{id}/status', () => {
  const savedSecret = process.env.AUTH_SECRET;
  const cleanup: (() => Promise<unknown>)[] = [];
  beforeAll(() => {
    delete process.env.AUTH_SECRET;
  });
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
    if (savedSecret !== undefined) process.env.AUTH_SECRET = savedSecret;
  });

  async function portrait() {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Status City' });
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    });
    const [analysis] = await db
      .insert(m.policyAnalyses)
      .values({ tenantId: tenant.id, title: 'Heat plan', brief: 'A brief that must never be in the poll.', status: 'running' })
      .returning();
    return { tenant, analysis: analysis! };
  }

  const get = async (tenant: string, id: string) => {
    const { GET } = await import('./route');
    return GET(new Request(`http://localhost/${tenant}/admin/policy/${id}/status`), {
      params: Promise.resolve({ tenant, id }),
    });
  };

  it('answers with the status alone, uncached', async () => {
    const { tenant, analysis } = await portrait();
    const res = await get(tenant.slug, analysis.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'running' });
  });

  it('is a 404 for another portrait’s analysis, a malformed id, or an unknown portrait', async () => {
    const { analysis } = await portrait();
    const { tenant: other } = await portrait();
    expect((await get(other.slug, analysis.id)).status).toBe(404);
    expect((await get(other.slug, 'not-a-uuid')).status).toBe(404);
    expect((await get(uniq(), analysis.id)).status).toBe(404);
  });
});
