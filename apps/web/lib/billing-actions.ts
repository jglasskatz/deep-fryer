'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  CONTRACT_PLANS,
  PLANS,
  PURCHASABLE_PLANS,
  isPlanId,
  sellsInterval,
  type BillingInterval,
  type PlanId,
} from '@deep-fryer/core';
import {
  organizationBySlug,
  organizations,
  subscriptionFor,
  subscriptions,
  type Organization,
} from '@deep-fryer/db';
import { getAuth, requireOrgRole } from './auth';
import { action, UserError } from './action-result';
import { appUrl } from './env';
import { ensureCustomer, priceFor, stripe, syncSubscription } from './stripe';
import { systemDb } from './db';

async function orgForBilling(orgSlug: string): Promise<Organization> {
  const org = await organizationBySlug(systemDb(), orgSlug);
  if (!org) throw new UserError('Unknown organization.');
  await requireOrgRole(org.id, ['owner', 'billing']);
  return org;
}

function purchasable(plan: string): PlanId {
  if (!isPlanId(plan) || !PURCHASABLE_PLANS.includes(plan)) throw new UserError('Choose a listed plan.');
  return plan;
}

/**
 * Refuse an interval the plan is not sold by (core sellsInterval): one with
 * no Stripe price, or whose period's research allowance could not build a
 * doughnut — Community by the month — which the billing page no longer
 * offers, but a page opened before, or a forged request, still could ask for.
 */
function sold(plan: PlanId, interval: BillingInterval): void {
  if (!sellsInterval(PLANS[plan], interval)) {
    throw new UserError(
      interval === 'month'
        ? `The ${PLANS[plan].name} plan is sold annually: a month's research allowance is too small to build a doughnut.`
        : `The ${PLANS[plan].name} plan is not sold annually — contact us.`,
    );
  }
}

/** Stripe statuses of a subscription that is still live: one the customer pays, or is being asked to. */
const LIVE_STRIPE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']);

/**
 * One live Stripe subscription per organization; changes go through the
 * portal. Checked on our row and on Stripe itself: right after a checkout,
 * the subscription exists at Stripe before its webhook writes our row, and a
 * page opened before the payment (or the post-checkout wait, when the
 * webhook is slow) still offers "Pay by card" — a second checkout then would
 * charge the customer twice for one organization.
 */
async function refuseIfStripeManaged(org: Organization) {
  const refusal = 'This organization already has a subscription — change plans from "Manage billing".';
  const sub = await subscriptionFor(systemDb(), org.id);
  if (sub?.stripeSubscriptionId && !['canceled', 'incomplete_expired'].includes(sub.status)) {
    throw new UserError(refusal);
  }
  if (org.stripeCustomerId) {
    const atStripe = await stripe().subscriptions.list({ customer: org.stripeCustomerId, status: 'all', limit: 20 });
    if (atStripe.data.some((s) => LIVE_STRIPE_STATUSES.has(s.status))) throw new UserError(refusal);
  }
}

/** Card checkout (Stripe Checkout) for self-serve plans. Returns the URL to send the browser to. */
export const startCheckout = action(
  async (input: { orgSlug: string; plan: string; interval: BillingInterval }) => {
    const org = await orgForBilling(input.orgSlug);
    const plan = purchasable(input.plan);
    if (!PLANS[plan].selfServe) {
      throw new UserError(`${PLANS[plan].name} is billed by invoice — use "Request an invoice".`);
    }
    sold(plan, input.interval);
    await refuseIfStripeManaged(org);
    const price = await priceFor(plan, input.interval);
    const ctx = await getAuth();
    const customer = await ensureCustomer(org, { email: org.billingEmail ?? ctx.email });
    const base = `${appUrl()}/o/${org.slug}/billing`;
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: org.id,
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: { metadata: { organization_id: org.id, plan } },
      metadata: { organization_id: org.id, plan },
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
      allow_promotion_codes: true,
      success_url: `${base}?checkout=success`,
      cancel_url: `${base}?checkout=canceled`,
    });
    if (!session.url) throw new Error('checkout session has no url');
    return { url: session.url };
  },
);

const invoiceSchema = z.object({
  billingEmail: z.string().trim().email('Enter the email invoices should go to.'),
  poNumber: z.string().trim().max(30, 'PO numbers are limited to 30 characters.').optional(),
  taxExempt: z.boolean(),
});

/**
 * Invoice billing — how most governments buy: an annual subscription whose
 * invoices are emailed to accounts payable with net-30 terms, the PO number
 * printed on every invoice, and tax-exempt status on the customer. Stripe
 * collects by card, ACH, or check per the account's invoice settings.
 *
 * Stripe makes the subscription active at once, but research is never
 * free: the organization has no standing — no research, no growth past the
 * free setup limits — until the first invoice is paid (core standing
 * 'awaiting_payment'; syncSubscription records the payment when Stripe
 * reports it). After that Stripe's dunning (past_due → unpaid) governs
 * lapses, with research continuing while a later invoice is past due.
 */
export const requestInvoiceBilling = action(
  async (input: {
    orgSlug: string;
    plan: string;
    billingEmail: string;
    poNumber?: string;
    taxExempt: boolean;
  }) => {
    const org = await orgForBilling(input.orgSlug);
    const plan = purchasable(input.plan);
    const details = invoiceSchema.parse(input);
    sold(plan, 'year');
    await refuseIfStripeManaged(org);
    const price = await priceFor(plan, 'year');

    const db = systemDb();
    await db
      .update(organizations)
      .set({ billingEmail: details.billingEmail, taxExempt: details.taxExempt })
      .where(eq(organizations.id, org.id));
    const customer = await ensureCustomer(
      { ...org, taxExempt: details.taxExempt },
      { email: details.billingEmail, taxExempt: details.taxExempt, poNumber: details.poNumber ?? null },
    );
    const sub = await stripe().subscriptions.create(
      {
        customer,
        items: [{ price: price.id }],
        collection_method: 'send_invoice',
        days_until_due: 30,
        metadata: { organization_id: org.id, plan, po_number: details.poNumber ?? '' },
      },
      { idempotencyKey: `invoice-sub-${org.id}-${plan}-${new Date().toISOString().slice(0, 10)}` },
    );
    await syncSubscription(db, sub);
    revalidatePath(`/o/${org.slug}/billing`);
    return { status: sub.status };
  },
);

/** Stripe's hosted portal: payment methods, invoices, plan changes, cancellation. */
export const openBillingPortal = action(async (input: { orgSlug: string }) => {
  const org = await orgForBilling(input.orgSlug);
  if (!org.stripeCustomerId) throw new UserError('There is no billing account yet — choose a plan first.');
  const session = await stripe().billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${appUrl()}/o/${org.slug}/billing`,
  });
  return { url: session.url };
});

const contractSchema = z.object({
  // The contract plans only (core CONTRACT_PLANS, which the form offers too): never the retired trial.
  plan: z.enum(CONTRACT_PLANS),
  /** Contract term; research usage is counted within it, so a renewal starts a fresh allowance. */
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  poNumber: z.string().trim().max(30).optional(),
  researchSessionsOverride: z.number().int().positive().nullable(),
  portraitsOverride: z.number().int().positive().nullable(),
  seatsOverride: z.number().int().positive().nullable(),
});

/**
 * Staff only: record a negotiated contract (the NYC shape — an annual
 * agreement invoiced outside Stripe, with custom limits). Never touches a
 * Stripe-managed subscription.
 */
export const setContract = action(
  async (input: z.input<typeof contractSchema> & { orgSlug: string }) => {
    const ctx = await getAuth();
    if (!ctx.isStaff) throw new UserError('Only deep-fryer staff can set contract terms.');
    // Validated before anything is read, so a request naming a plan no contract may have changes nothing.
    const c = contractSchema.parse(input);
    const org = await organizationBySlug(systemDb(), input.orgSlug);
    if (!org) throw new UserError('Unknown organization.');
    const db = systemDb();
    const existing = await subscriptionFor(db, org.id);
    if (existing?.stripeSubscriptionId && !['canceled', 'incomplete_expired'].includes(existing.status)) {
      throw new UserError('This organization pays through Stripe; change its plan there.');
    }
    const start = new Date(`${c.periodStart}T00:00:00Z`);
    const end = new Date(`${c.periodEnd}T23:59:59Z`);
    if (end <= new Date()) throw new UserError('The contract end must be in the future.');
    if (start >= end) throw new UserError('The contract must start before it ends.');
    const values = {
      plan: c.plan,
      status: 'active' as const,
      collection: 'contract' as const,
      stripeSubscriptionId: null,
      stripePriceId: null,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      poNumber: c.poNumber || null,
      researchSessionsOverride: c.researchSessionsOverride,
      portraitsOverride: c.portraitsOverride,
      seatsOverride: c.seatsOverride,
      updatedAt: new Date(),
    };
    await db
      .insert(subscriptions)
      .values({ organizationId: org.id, ...values })
      .onConflictDoUpdate({ target: subscriptions.organizationId, set: values });
    revalidatePath(`/o/${org.slug}/billing`);
  },
);
