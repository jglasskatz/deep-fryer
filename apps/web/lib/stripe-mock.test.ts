import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Billing against Stripe's real API surface: stripe-mock (STRIPE_MOCK_URL,
 * a CI service) validates every request our code sends — parameters, types,
 * nesting — against Stripe's OpenAPI spec, so a malformed checkout, invoice
 * subscription, customer, or portal call fails here instead of in front of a
 * city's finance office. Runs when STRIPE_MOCK_URL and DATABASE_URL are set.
 *
 * stripe-mock keeps no state and answers with fixtures, so two things are
 * stubbed: priceFor (it cannot hold our catalog's lookup keys) and the
 * write inside syncSubscription (its fixture subscription carries no plan;
 * stripe.test.ts covers sync against realistic subscriptions). Every Stripe
 * request is the production code path, down to the HTTP call.
 */
const mockUrl = process.env.STRIPE_MOCK_URL;
const hasDb = Boolean(process.env.DATABASE_URL);

const synced: { id: string; collection_method: string }[] = [];
vi.mock('./stripe', async (importOriginal) => {
  const real = await importOriginal<typeof import('./stripe')>();
  return {
    ...real,
    priceFor: vi.fn(async () => ({ id: 'price_1PgafmB7WZ01zgkW6dKueIc5', object: 'price' })),
    syncSubscription: vi.fn(async (_db: unknown, sub: { id: string; collection_method: string }) => {
      synced.push(sub);
      return null;
    }),
  };
});
// Server actions revalidate pages; there is no Next request here.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const uniq = () => `sm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!mockUrl || !hasDb)('billing against stripe-mock', () => {
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
    process.env.STRIPE_API_BASE = mockUrl;
  });
  afterAll(() => {
    for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_API_BASE']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function newOrg() {
    const { getDb, provisionOrganization } = await import('@deep-fryer/db');
    const slug = uniq();
    return provisionOrganization(getDb(), { slug, name: `Stripe Mock ${slug}`, billingEmail: 'ap@example.gov' });
  }

  it('creates the organization’s customer (tax-exempt, PO field) and then updates it', async () => {
    const { ensureCustomer } = await import('./stripe');
    const { getDb, organizations } = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const org = await newOrg();
    const id = await ensureCustomer({ ...org, taxExempt: true }, { email: 'ap@example.gov', poNumber: 'PO-12345' });
    expect(id).toMatch(/^cus_/);
    const [row] = await getDb().select().from(organizations).where(eq(organizations.id, org.id));
    expect(row!.stripeCustomerId).toBe(id);
    expect(await ensureCustomer(row!, { email: 'ap2@example.gov', poNumber: null })).toBe(id);
  });

  it('starts card checkout with a valid Checkout Session request', async () => {
    const { startCheckout } = await import('./billing-actions');
    const org = await newOrg();
    // Annual: Community is not sold by the month (core sellsInterval).
    const res = await startCheckout({ orgSlug: org.slug, plan: 'community', interval: 'year' });
    expect(res).toMatchObject({ ok: true });
    expect((res as { ok: true; data: { url: string } }).data.url).toMatch(/^https:\/\//);
  });

  it('sets up annual invoice billing (send_invoice, net 30, PO metadata)', async () => {
    const { requestInvoiceBilling } = await import('./billing-actions');
    const org = await newOrg();
    const res = await requestInvoiceBilling({
      orgSlug: org.slug,
      plan: 'city',
      billingEmail: 'ap@example.gov',
      poNumber: 'PO-777',
      taxExempt: true,
    });
    expect(res).toMatchObject({ ok: true });
    // Stripe answered with a subscription, and it went straight to sync.
    expect(synced.at(-1)?.id).toMatch(/^sub_/);
  });

  it('opens the customer portal', async () => {
    const { ensureCustomer } = await import('./stripe');
    const { openBillingPortal } = await import('./billing-actions');
    const org = await newOrg();
    await ensureCustomer(org, { email: 'ap@example.gov' });
    const res = await openBillingPortal({ orgSlug: org.slug });
    expect(res).toMatchObject({ ok: true });
    expect((res as { ok: true; data: { url: string } }).data.url).toMatch(/^https:\/\//);
  });

  it('lists catalog prices and invoices with valid requests', async () => {
    const { catalogPrices, stripe } = await import('./stripe');
    const prices = await catalogPrices();
    expect(prices).toBeInstanceOf(Map);
    const invoices = await stripe().invoices.list({ customer: 'cus_123', limit: 12 });
    expect(Array.isArray(invoices.data)).toBe(true);
  });
});
