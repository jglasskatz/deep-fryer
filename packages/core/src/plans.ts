/**
 * The plan catalog and entitlement rules (SPEC-v4 §3). Pure: no database, no
 * Stripe. The web app, the billing webhook, and the research gate all ask
 * these functions the same questions, so "can this organization run research
 * right now?" has exactly one answer.
 *
 * Domain rules that shape the catalog:
 * - Municipal budgets are appropriations with not-to-exceed amounts, so plans
 *   carry hard research quotas, never metered overage. When a quota runs out,
 *   research pauses until the next period, an upgrade, or a contract
 *   amendment (staff sets an override) — the bill never surprises anyone.
 * - The public plane is never gated. A lapsed subscription pauses research
 *   and growth (new portraits, invitations); it never takes a published
 *   portrait offline. Civic data does not disappear over an unpaid invoice.
 * - Prices are not in this file. Stripe prices are found by lookup key
 *   (`stripeLookupKeys`) and their amounts are whatever the owner set in
 *   Stripe, so the price shown on /pricing is always the price charged.
 */

export type PlanId = 'trial' | 'community' | 'city' | 'metro' | 'enterprise';
export type BillingInterval = 'month' | 'year';
export type CollectionMethod = 'card' | 'invoice' | 'contract';
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Who it is for, in one line — rendered on /pricing. */
  audience: string;
  /** Portraits (tenants) the organization may hold. */
  portraits: number;
  /** Distinct people with any role across the organization. */
  seats: number;
  /** Research sessions per year; a 21-dimension refresh is 22 sessions. */
  researchSessionsPerYear: number;
  /** Highlights for /pricing; limits above are the enforced part. */
  highlights: string[];
  /** Stripe price lookup keys per interval; absent = not sold that way. */
  stripeLookupKeys: Partial<Record<BillingInterval, string>>;
  /** Purchasable from /billing without talking to anyone. */
  selfServe: boolean;
}

/** Trial length for self-serve signups. */
export const TRIAL_DAYS = 30;

/** Sessions in one full refresh of a framework portrait: region context + 21 dimensions. */
export const SESSIONS_PER_FULL_REFRESH = 22;

export const PLANS: Record<PlanId, PlanDefinition> = {
  trial: {
    id: 'trial',
    name: 'Trial',
    audience: 'Evaluate deep-fryer on your own jurisdiction for 30 days.',
    portraits: 1,
    seats: 3,
    // Prorates to 30 sessions over a 30-day trial: one full research pass
    // (22 sessions) plus a few targeted re-runs.
    researchSessionsPerYear: 365,
    highlights: ['One portrait', 'One full research pass', 'Review queue and publishing'],
    stripeLookupKeys: {},
    selfServe: false,
  },
  community: {
    id: 'community',
    name: 'Community',
    audience: 'Towns, small cities, and counties maintaining one portrait.',
    portraits: 1,
    seats: 5,
    researchSessionsPerYear: 66,
    highlights: [
      'One portrait with embed widget and discussion board',
      'Three full research refreshes a year',
      'Progress tracking against adopted targets',
    ],
    stripeLookupKeys: { month: 'deep_fryer_community_monthly', year: 'deep_fryer_community_annual' },
    selfServe: true,
  },
  city: {
    id: 'city',
    name: 'City',
    audience: 'Cities tracking a portrait plus districts or neighborhoods.',
    portraits: 3,
    seats: 15,
    researchSessionsPerYear: 200,
    highlights: [
      'Up to three portraits with side-by-side comparison',
      'Quarterly refreshes across every portrait',
      'Session transcripts for records requests',
    ],
    stripeLookupKeys: { year: 'deep_fryer_city_annual' },
    selfServe: true,
  },
  metro: {
    id: 'metro',
    name: 'Metro',
    audience: 'Large cities with a portrait per borough or district — the NYC shape.',
    portraits: 10,
    seats: 50,
    researchSessionsPerYear: 600,
    highlights: [
      'Up to ten portraits: a city plus its boroughs',
      'Family compare and insights views',
      'Quarterly refreshes across the whole family',
    ],
    stripeLookupKeys: { year: 'deep_fryer_metro_annual' },
    selfServe: false,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    audience: 'States, regions, and contracts with custom terms.',
    portraits: 25,
    seats: 200,
    researchSessionsPerYear: 1500,
    highlights: ['Custom limits by contract', 'Invoice and purchase-order billing', 'Named support'],
    stripeLookupKeys: {},
    selfServe: false,
  },
};

export const PURCHASABLE_PLANS: PlanId[] = ['community', 'city', 'metro'];

/**
 * Stripe events the billing webhook consumes. Shared by the webhook route
 * (which handles them) and scripts/stripe-setup.ts (which registers them).
 */
export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.marked_uncollectible',
  'invoice.finalized',
] as const;

export function isPlanId(value: string): value is PlanId {
  return Object.prototype.hasOwnProperty.call(PLANS, value);
}

/** The plan a Stripe price lookup key sells, or null for an unknown key. */
export function planForLookupKey(
  lookupKey: string | null | undefined,
): { plan: PlanId; interval: BillingInterval } | null {
  if (!lookupKey) return null;
  for (const plan of Object.values(PLANS)) {
    for (const [interval, key] of Object.entries(plan.stripeLookupKeys)) {
      if (key === lookupKey) return { plan: plan.id, interval: interval as BillingInterval };
    }
  }
  return null;
}

/** The subscription facts entitlement decisions need — a projection of the DB row. */
export interface SubscriptionSnapshot {
  plan: string;
  status: SubscriptionStatus;
  collection: CollectionMethod;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  /** Stripe: the subscription ends at period close instead of renewing. */
  cancelAtPeriodEnd?: boolean;
  researchSessionsOverride: number | null;
  portraitsOverride: number | null;
  seatsOverride: number | null;
}

export interface Limits {
  portraits: number;
  seats: number;
  /** Research sessions allowed in the current period. */
  researchSessions: number;
}

const DAY_MS = 86_400_000;

/**
 * Effective limits for the current period. Contract overrides win over the
 * catalog. The yearly research allowance is prorated to the period length so
 * monthly and annual subscribers get the same yearly total.
 */
export function effectiveLimits(sub: SubscriptionSnapshot): Limits {
  const plan = isPlanId(sub.plan) ? PLANS[sub.plan] : PLANS.trial;
  const periodDays = Math.max(
    1,
    Math.round((sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime()) / DAY_MS),
  );
  const prorated = Math.ceil((plan.researchSessionsPerYear * Math.min(periodDays, 366)) / 365);
  return {
    portraits: sub.portraitsOverride ?? plan.portraits,
    seats: sub.seatsOverride ?? plan.seats,
    researchSessions: sub.researchSessionsOverride ?? prorated,
  };
}

export type StandingReason =
  | 'ok'
  | 'no_subscription'
  | 'trial_expired'
  | 'period_ended'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';

export interface Standing {
  /** Research, new portraits, and invitations are allowed. */
  active: boolean;
  /** Something the billing contact should act on, even while active. */
  warning: 'past_due' | 'trial_ending' | 'cancel_scheduled' | null;
  reason: StandingReason;
}

/**
 * Whether an organization is in good standing at `now`.
 *
 * past_due stays active on purpose: government accounts-payable routinely
 * runs past net-30, and pausing a city's research over a slow check run
 * would punish the customer for its own procurement process. Stripe's dunning
 * moves a truly unpaid invoice to `unpaid`, which does pause.
 */
export function standing(sub: SubscriptionSnapshot | null, now: Date = new Date()): Standing {
  if (!sub) return { active: false, warning: null, reason: 'no_subscription' };
  switch (sub.status) {
    case 'canceled':
    case 'incomplete_expired':
      return { active: false, warning: null, reason: 'canceled' };
    case 'unpaid':
    case 'paused':
      return { active: false, warning: null, reason: 'unpaid' };
    case 'incomplete':
      return { active: false, warning: null, reason: 'incomplete' };
    case 'trialing': {
      const end = sub.trialEndsAt ?? sub.currentPeriodEnd;
      if (now >= end) return { active: false, warning: null, reason: 'trial_expired' };
      const endingSoon = end.getTime() - now.getTime() < 7 * DAY_MS;
      return { active: true, warning: endingSoon ? 'trial_ending' : null, reason: 'ok' };
    }
    case 'past_due':
      return { active: true, warning: 'past_due', reason: 'ok' };
    case 'active': {
      // Contracts have no renewal webhook: a lapsed period end is the signal.
      if (sub.collection === 'contract' && now >= sub.currentPeriodEnd) {
        return { active: false, warning: null, reason: 'period_ended' };
      }
      return { active: true, warning: sub.cancelAtPeriodEnd ? 'cancel_scheduled' : null, reason: 'ok' };
    }
  }
}

export interface ResearchQuotaCheck {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  /** Human-readable reason when not allowed. */
  message: string | null;
}

/**
 * Can `requested` more research sessions start now? Planning is free; this
 * gate sits at apply, where the spend happens.
 */
export function checkResearchQuota(
  sub: SubscriptionSnapshot | null,
  used: number,
  requested: number,
  now: Date = new Date(),
): ResearchQuotaCheck {
  const s = standing(sub, now);
  if (!sub || !s.active) {
    return {
      allowed: false,
      used,
      limit: 0,
      remaining: 0,
      message: standingMessage(s.reason),
    };
  }
  const limit = effectiveLimits(sub).researchSessions;
  const remaining = Math.max(0, limit - used);
  if (requested > remaining) {
    return {
      allowed: false,
      used,
      limit,
      remaining,
      message: `This run needs ${requested} research sessions; ${remaining} of ${limit} remain this billing period. Narrow the run, wait for the period to renew on ${sub.currentPeriodEnd.toISOString().slice(0, 10)}, or upgrade the plan.`,
    };
  }
  return { allowed: true, used, limit, remaining, message: null };
}

export function standingMessage(reason: StandingReason): string | null {
  switch (reason) {
    case 'ok':
      return null;
    case 'no_subscription':
      return 'This organization has no plan yet. Choose one under Billing to run research.';
    case 'trial_expired':
      return 'The trial has ended. Choose a plan under Billing to keep researching — published portraits stay online.';
    case 'period_ended':
      return 'The contract period has ended. Contact us to renew — published portraits stay online.';
    case 'canceled':
      return 'The subscription is canceled. Published portraits stay online; choose a plan under Billing to resume research.';
    case 'unpaid':
      return 'Research is paused for an unpaid invoice. Published portraits stay online; settle the invoice under Billing to resume.';
    case 'incomplete':
      return 'The subscription setup did not finish. Complete payment under Billing.';
  }
}
