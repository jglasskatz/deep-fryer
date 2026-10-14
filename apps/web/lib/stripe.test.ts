import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function fakeSubscription(overrides: Partial<Stripe.Subscription> & { lookupKey?: string; orgId?: string } = {}) {
  const { lookupKey = 'deep_fryer_city_annual', orgId, ...rest } = overrides;
  return {
    id: `sub_${uniq()}`,
    object: 'subscription',
    customer: `cus_${uniq()}`,
    status: 'active',
    collection_method: 'send_invoice',
    cancel_at_period_end: false,
    trial_end: null,
    metadata: orgId ? { organization_id: orgId, po_number: 'PO-77' } : {},
    items: {
      object: 'list',
      data: [
        {
          id: 'si_1',
          current_period_start: 1_790_000_000,
          current_period_end: 1_821_536_000,
          price: { id: 'price_1', lookup_key: lookupKey, metadata: {} },
        },
      ],
    },
    ...rest,
  } as unknown as Stripe.Subscription;
}

describe('stripe helpers (pure)', () => {
  it('finds the subscription an event concerns', async () => {
    const { subscriptionIdOf } = await import('./stripe');
    const ev = (type: string, object: unknown) => ({ type, data: { object } }) as unknown as Stripe.Event;
    expect(subscriptionIdOf(ev('checkout.session.completed', { subscription: 'sub_a' }))).toBe('sub_a');
    expect(subscriptionIdOf(ev('customer.subscription.updated', { id: 'sub_b' }))).toBe('sub_b');
    expect(
      subscriptionIdOf(ev('invoice.payment_failed', { parent: { subscription_details: { subscription: 'sub_c' } } })),
    ).toBe('sub_c');
    expect(subscriptionIdOf(ev('invoice.paid', { parent: null }))).toBeNull();
    expect(subscriptionIdOf(ev('customer.created', { id: 'cus_1' }))).toBeNull();
  });

  it('clears a removed PO number on the customer instead of silently keeping it', async () => {
    const { customerInvoiceSettings } = await import('./stripe');
    expect(customerInvoiceSettings('PO-12345')).toEqual({ custom_fields: [{ name: 'PO Number', value: 'PO-12345' }] });
    expect(customerInvoiceSettings(null)).toEqual({ custom_fields: '' });
    expect(customerInvoiceSettings('X'.repeat(40)).custom_fields).toEqual([{ name: 'PO Number', value: 'X'.repeat(30) }]);
  });

  it('maps prices to plans by lookup key, falling back to metadata', async () => {
    const { planOfStripeSubscription } = await import('./stripe');
    expect(planOfStripeSubscription(fakeSubscription({ lookupKey: 'deep_fryer_metro_annual' }))).toBe('metro');
    const custom = fakeSubscription({ lookupKey: 'negotiated', metadata: { plan: 'enterprise' } });
    expect(planOfStripeSubscription(custom)).toBe('enterprise');
    expect(planOfStripeSubscription(fakeSubscription({ lookupKey: 'unknown' }))).toBeNull();
  });
});

describe.skipIf(!hasDb)('syncSubscription (Postgres)', () => {
  it('writes Stripe facts, keeps contract overrides, and ignores stale terminal events', async () => {
    const { syncSubscription } = await import('./stripe');
    const { getDb, provisionOrganization, subscriptions, organizations } = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const org = await provisionOrganization(db, { slug: uniq(), name: 'Sync City', startTrial: true });
    await db.update(subscriptions).set({ researchSessionsOverride: 999 }).where(eq(subscriptions.organizationId, org.id));

    const live = fakeSubscription({ orgId: org.id });
    expect(await syncSubscription(db, live)).toBe(org.id);
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, org.id));
    expect(row).toMatchObject({
      plan: 'city',
      status: 'active',
      collection: 'invoice',
      stripeSubscriptionId: live.id,
      poNumber: 'PO-77',
      researchSessionsOverride: 999,
    });
    expect(row!.currentPeriodEnd.getTime()).toBe(1_821_536_000 * 1000);
    const [o] = await db.select().from(organizations).where(eq(organizations.id, org.id));
    expect(o!.stripeCustomerId).toBe(live.customer);

    // A different, older subscription ending later must not cancel the live one.
    await syncSubscription(db, fakeSubscription({ orgId: org.id, status: 'canceled' }));
    const [still] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, org.id));
    expect(still!.status).toBe('active');
    expect(still!.stripeSubscriptionId).toBe(live.id);

    // The live one being canceled does land.
    await syncSubscription(db, { ...live, status: 'canceled' } as Stripe.Subscription);
    const [ended] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, org.id));
    expect(ended!.status).toBe('canceled');

    await db.delete(organizations).where(eq(organizations.id, org.id));
  });
});

describe.skipIf(!hasDb)('POST /api/billing/webhook', () => {
  it('rejects bad signatures and records each event exactly once', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
    const StripeCtor = (await import('stripe')).default;
    const { POST } = await import('../app/api/billing/webhook/route');
    const { getDb, billingEvents } = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');

    const id = `evt_${uniq()}`;
    const payload = JSON.stringify({ id, object: 'event', type: 'customer.created', data: { object: { id: 'cus_x' } } });
    const header = new StripeCtor('sk_test_dummy').webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_test_secret',
    });
    const req = (sig: string) =>
      new Request('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': sig },
        body: payload,
      });

    expect((await POST(req('t=1,v1=forged'))).status).toBe(400);
    const first = await (await POST(req(header))).json();
    expect(first.outcome).toBe('ignored');
    const second = await (await POST(req(header))).json();
    expect(second.outcome).toBe('duplicate');

    const rows = await getDb().select().from(billingEvents).where(eq(billingEvents.id, id));
    expect(rows).toHaveLength(1);
    await getDb().delete(billingEvents).where(eq(billingEvents.id, id));
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });
});
