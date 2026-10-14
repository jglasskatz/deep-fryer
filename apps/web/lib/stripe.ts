import 'server-only';
import Stripe from 'stripe';
import { eq, isNull, and } from 'drizzle-orm';
import {
  PLANS,
  isPlanId,
  planForLookupKey,
  stripeEndpoint,
  type BillingInterval,
  type PlanId,
  type SubscriptionStatus,
} from '@deep-fryer/core';
import {
  organizationByStripeCustomer,
  organizations,
  subscriptions,
  type DbExecutor,
  type Organization,
} from '@deep-fryer/db';
import { UserError } from './action-result';
import { stripeConfigured } from './env';
import { systemDb } from './db';

/**
 * Stripe integration (SPEC-v4 §3). Stripe is the system of record for
 * *payment*; our subscriptions row is the system of record for
 * *entitlement*. Every Stripe change reaches us by re-retrieving the
 * subscription (never by trusting an event payload, which can arrive out of
 * order) and writing the facts into our row with syncSubscription().
 */

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!stripeConfigured()) {
    throw new UserError('Online billing is not enabled on this server — contact us to arrange a contract.');
  }
  const key = process.env.STRIPE_SECRET_KEY!;
  client ??= new Stripe(key, {
    appInfo: { name: 'deep-fryer' },
    maxNetworkRetries: 2,
    // stripe-mock in tests/CI only; production refuses STRIPE_API_BASE (env.ts).
    ...stripeEndpoint(process.env.STRIPE_API_BASE, key),
  });
  return client;
}

// ---- Prices (looked up by catalog lookup key; amounts live in Stripe) ----

const PRICE_TTL_MS = 10 * 60_000;
let priceCache: { at: number; byKey: Map<string, Stripe.Price> } | null = null;

export function catalogLookupKeys(): string[] {
  return Object.values(PLANS).flatMap((p) => Object.values(p.stripeLookupKeys));
}

/** Active Stripe prices for every catalog lookup key, cached briefly. Empty when Stripe is off. */
export async function catalogPrices(): Promise<Map<string, Stripe.Price>> {
  if (!stripeConfigured()) return new Map();
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.byKey;
  const keys = catalogLookupKeys();
  const byKey = new Map<string, Stripe.Price>();
  try {
    // lookup_keys accepts at most 10 per request.
    for (let i = 0; i < keys.length; i += 10) {
      const page = await stripe().prices.list({
        lookup_keys: keys.slice(i, i + 10),
        active: true,
        limit: 100,
      });
      for (const price of page.data) if (price.lookup_key) byKey.set(price.lookup_key, price);
    }
  } catch (err) {
    console.error('[stripe] price lookup failed', err);
    return priceCache?.byKey ?? new Map();
  }
  priceCache = { at: Date.now(), byKey };
  return byKey;
}

export async function priceFor(plan: PlanId, interval: BillingInterval): Promise<Stripe.Price> {
  const key = PLANS[plan].stripeLookupKeys[interval];
  if (!key) throw new UserError(`The ${PLANS[plan].name} plan is not sold ${interval === 'month' ? 'monthly' : 'annually'}.`);
  const price = (await catalogPrices()).get(key);
  if (!price) {
    throw new UserError(`The ${PLANS[plan].name} plan is not available for online purchase yet — contact us.`);
  }
  return price;
}

export function formatPrice(price: Stripe.Price): string {
  const amount = (price.unit_amount ?? 0) / 100;
  const money = amount.toLocaleString('en-US', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  });
  const per = price.recurring?.interval === 'month' ? '/month' : price.recurring?.interval === 'year' ? '/year' : '';
  return `${money}${per}`;
}

// ---- Customers ----

/**
 * The organization's Stripe customer, created on first need. The idempotency
 * key makes concurrent first purchases converge on one customer; the
 * conditional update keeps the first stored id.
 */
/**
 * The PO number printed on every invoice. Removing it must send '' — Stripe's
 * "unset" — because the SDK drops an empty array from the request, which
 * would leave the old PO printing on future invoices (found against
 * stripe-mock).
 */
export function customerInvoiceSettings(
  poNumber: string | null | undefined,
): Stripe.CustomerUpdateParams.InvoiceSettings {
  return { custom_fields: poNumber ? [{ name: 'PO Number', value: poNumber.slice(0, 30) }] : '' };
}

export async function ensureCustomer(
  org: Organization,
  details: { email: string | null; taxExempt?: boolean; poNumber?: string | null },
): Promise<string> {
  const s = stripe();
  const invoiceSettings = customerInvoiceSettings(details.poNumber);
  const taxExempt = (details.taxExempt ?? org.taxExempt) ? 'exempt' : 'none';
  if (org.stripeCustomerId) {
    await s.customers.update(org.stripeCustomerId, {
      email: details.email ?? undefined,
      tax_exempt: taxExempt,
      invoice_settings: invoiceSettings,
    });
    return org.stripeCustomerId;
  }
  const customer = await s.customers.create(
    {
      name: org.name,
      email: details.email ?? undefined,
      tax_exempt: taxExempt,
      invoice_settings: invoiceSettings,
      metadata: { organization_id: org.id, organization_slug: org.slug },
    },
    { idempotencyKey: `org-customer-${org.id}` },
  );
  const db = systemDb();
  await db
    .update(organizations)
    .set({ stripeCustomerId: customer.id })
    .where(and(eq(organizations.id, org.id), isNull(organizations.stripeCustomerId)));
  const [row] = await db.select().from(organizations).where(eq(organizations.id, org.id));
  return row?.stripeCustomerId ?? customer.id;
}

// ---- Subscription sync ----

const STATUSES: SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
];

export function planOfStripeSubscription(sub: Stripe.Subscription): PlanId | null {
  const price = sub.items.data[0]?.price;
  const fromKey = planForLookupKey(price?.lookup_key)?.plan;
  if (fromKey) return fromKey;
  // Custom-negotiated prices without a catalog lookup key carry the plan in metadata.
  const meta = sub.metadata?.plan ?? price?.metadata?.plan;
  return meta && isPlanId(meta) ? meta : null;
}

/**
 * Write a Stripe subscription's facts into our row. Stripe-owned fields
 * only — contract overrides staff set (quotas, seats) survive. A stale event
 * for a superseded subscription is ignored.
 */
export async function syncSubscription(db: DbExecutor, sub: Stripe.Subscription): Promise<string | null> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const orgId =
    sub.metadata?.organization_id ?? (await organizationByStripeCustomer(db, customerId))?.id;
  if (!orgId) {
    console.warn(`[stripe] subscription ${sub.id} has no organization; ignoring`);
    return null;
  }
  const plan = planOfStripeSubscription(sub);
  if (!plan) throw new Error(`subscription ${sub.id}: price has no catalog lookup key or plan metadata`);
  const item = sub.items.data[0];
  if (!item) throw new Error(`subscription ${sub.id} has no items`);

  const [current] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId));
  const terminal = sub.status === 'canceled' || sub.status === 'incomplete_expired';
  if (current?.stripeSubscriptionId && current.stripeSubscriptionId !== sub.id && terminal) {
    return orgId; // an old subscription ending after a replacement started
  }

  const status = (STATUSES as string[]).includes(sub.status) ? (sub.status as SubscriptionStatus) : 'incomplete';
  const values = {
    plan,
    status,
    collection: sub.collection_method === 'send_invoice' ? ('invoice' as const) : ('card' as const),
    stripeSubscriptionId: sub.id,
    stripePriceId: item.price.id,
    currentPeriodStart: new Date(item.current_period_start * 1000),
    currentPeriodEnd: new Date(item.current_period_end * 1000),
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    poNumber: sub.metadata?.po_number ?? current?.poNumber ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(subscriptions)
    .values({ organizationId: orgId, ...values })
    .onConflictDoUpdate({ target: subscriptions.organizationId, set: values });
  await db
    .update(organizations)
    .set({ stripeCustomerId: customerId })
    .where(and(eq(organizations.id, orgId), isNull(organizations.stripeCustomerId)));
  return orgId;
}

/** The subscription an event concerns, if any (checkout, subscription, or invoice events). */
export function subscriptionIdOf(event: Stripe.Event): string | null {
  const obj = event.data.object as unknown as Record<string, unknown>;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed': {
      const s = (obj as unknown as Stripe.Checkout.Session).subscription;
      return typeof s === 'string' ? s : (s?.id ?? null);
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
    case 'customer.subscription.trial_will_end':
      return (obj as unknown as Stripe.Subscription).id;
    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.payment_succeeded':
    case 'invoice.marked_uncollectible':
    case 'invoice.finalized': {
      const s = (obj as unknown as Stripe.Invoice).parent?.subscription_details?.subscription;
      return typeof s === 'string' ? s : (s?.id ?? null);
    }
    default:
      return null;
  }
}

