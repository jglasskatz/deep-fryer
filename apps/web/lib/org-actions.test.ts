import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Self-serve start from a city's name and state/country alone (SPEC-v7 §4),
 * against real Postgres as the dev-mode identity: everything else the old
 * form asked for is defaulted, the trial starts as before, and the person
 * lands on step two of /start ("Build my doughnut").
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

/** Next's redirect() throws; its digest carries the destination. */
async function redirectOf(promise: Promise<unknown>): Promise<string> {
  const err = (await promise.then(
    (value) => {
      throw new Error(`expected a redirect, got ${JSON.stringify(value)}`);
    },
    (e: unknown) => e,
  )) as { digest?: string };
  const destination = err.digest?.split(';')[2];
  if (!destination) throw err;
  return destination;
}

describe.skipIf(!hasDb)('startTrial with only the city and its state/country', () => {
  const savedSecret = process.env.AUTH_SECRET;
  const cleanup: (() => Promise<unknown>)[] = [];
  beforeAll(() => {
    delete process.env.AUTH_SECRET;
  });
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
    if (savedSecret !== undefined) process.env.AUTH_SECRET = savedSecret;
  });

  async function created(slug: string) {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const db = m.getDb();
    const tenant = await m.tenantBySlug(db, slug);
    const org = await m.organizationBySlug(db, slug);
    cleanup.push(async () => {
      if (tenant) await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      if (org) await db.delete(m.organizations).where(eq(m.organizations.id, org.id));
    });
    const [region] = tenant
      ? await db
          .select({ value: m.tenantConfig.value })
          .from(m.tenantConfig)
          .where(and(eq(m.tenantConfig.tenantId, tenant.id), eq(m.tenantConfig.key, 'region')))
      : [];
    const sub = org ? await m.subscriptionFor(db, org.id) : null;
    return { tenant, org, region: region?.value as { name: string; definition: string } | undefined, sub };
  }

  it('creates the organization, its trial, and the portrait, then offers the build step', async () => {
    const { startTrial } = await import('./org-actions');
    const name = `Testville ${uniq()}`;
    const destination = await redirectOf(startTrial({ name, region: 'Texas, USA', slug: '', definition: '', population: undefined }));
    expect(destination).toMatch(/^\/start\?portrait=testville-/);
    const slug = decodeURIComponent(destination.split('=')[1]!);

    const { tenant, org, region, sub } = await created(slug);
    expect(tenant).toMatchObject({ name, region: 'Texas, USA' });
    expect(org).toMatchObject({ name: `City of ${name}`, billingEmail: 'dev@localhost' });
    expect(sub).toMatchObject({ plan: 'trial', status: 'trialing' });
    // The boundary defaults to the jurisdiction's own, and says what does not count.
    expect(region).toEqual({
      name,
      definition: `The legal boundary of ${name}, Texas, USA, as its own government defines it; figures for a larger surrounding area (county, metro area, or state) are not figures for ${name}.`,
    });
  });

  it('finds a free address when the name is taken, and keeps a name that already names a government', async () => {
    const { startTrial } = await import('./org-actions');
    const name = `Springfield County ${uniq()}`;
    const first = await redirectOf(startTrial({ name, region: 'Illinois, USA' }));
    const second = await redirectOf(startTrial({ name, region: 'Missouri, USA' }));
    const a = await created(decodeURIComponent(first.split('=')[1]!));
    const b = await created(decodeURIComponent(second.split('=')[1]!));
    expect(a.tenant!.slug).not.toBe(b.tenant!.slug);
    expect(b.tenant!.slug.endsWith('-missouri')).toBe(true);
    expect(a.org!.name).toBe(name);
  });

  it('still requires the city and its state/country, and checks an address chosen by hand', async () => {
    const { startTrial } = await import('./org-actions');
    expect(await startTrial({ name: 'X', region: 'NY, USA' })).toMatchObject({ ok: false, error: 'name: Name the city.' });
    expect(await startTrial({ name: 'Ithaca', region: '' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/state\/province and country/),
    });
    expect(await startTrial({ name: 'Ithaca', region: 'NY, USA', slug: 'login' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/reserved/),
    });
  });
});
