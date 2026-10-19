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
 * - Viewing is free; building is not (the owner's rule: "No free trials for
 *   making donuts, but free to view"). The public plane is never gated, and a
 *   lapsed subscription never takes a published portrait offline — civic data
 *   does not disappear over an unpaid invoice. Research is never free: every
 *   session needs an organization in good standing, a paid plan or a staff
 *   contract. Nothing creates a trial any more (the 'trial' id stays only for
 *   organizations that started one before), so an organization that has not
 *   chosen a plan has no subscription row at all.
 * - Setting up is free. Without a plan in good standing — none yet, or one
 *   that lapsed — an organization keeps FREE_SETUP_LIMITS: one portrait
 *   (private until its first publish) and a few people to set it up, invite,
 *   configure and review, but no research (limitsInEffect).
 * - Good standing means paid, or contracted by staff. A Stripe subscription
 *   collected by invoice is active the moment it is created, before anything
 *   is paid, so it researches nothing until its first invoice is paid
 *   (`firstInvoicePaidAt`); a retired trial confers nothing at all; and a
 *   Stripe-managed row whose period ended without word from Stripe fails
 *   closed (standing).
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

/** Sessions in one full refresh of a framework portrait: region context + 21 dimensions. */
export const SESSIONS_PER_FULL_REFRESH = 22;

export const PLANS: Record<PlanId, PlanDefinition> = {
  // Retired: no code path creates a trial, and a row still on it — from
  // before trials were retired — has no standing (standing() refuses it), so
  // it researches nothing. The entry stays so those rows still name a plan;
  // it is not purchasable, not offered for contracts, and nothing public
  // lists it.
  trial: {
    id: 'trial',
    name: 'Trial',
    audience: 'A retired evaluation plan, kept for organizations that started one before; no longer offered.',
    portraits: 1,
    seats: 3,
    // What those subscriptions were once given, prorated over 30 days; no longer granted (standing).
    researchSessionsPerYear: 365,
    highlights: [],
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
 * The plans staff may put on a contract (apps/web lib/billing-actions.ts
 * setContract, which validates against this list, and the staff ContractForm,
 * which offers it). Never 'trial': trials are retired, and a row that still
 * says 'trial' is moved onto a real plan rather than renewed.
 */
export const CONTRACT_PLANS = ['community', 'city', 'metro', 'enterprise'] as const satisfies readonly PlanId[];
export type ContractPlanId = (typeof CONTRACT_PLANS)[number];

/** The shortest billing period of each interval, in days (a February month, a 365-day year). */
const SHORTEST_PERIOD_DAYS: Record<BillingInterval, number> = { month: 28, year: 365 };

/**
 * Research sessions the shortest billing period of `interval` grants on
 * `plan`, prorated as effectiveLimits prorates a real period.
 */
export function periodResearchSessions(plan: PlanDefinition, interval: BillingInterval): number {
  return Math.ceil((plan.researchSessionsPerYear * SHORTEST_PERIOD_DAYS[interval]) / 365);
}

/**
 * Whether `plan` is sold by `interval` — on the pricing and billing pages,
 * and by checkout or invoice: it has a Stripe price for that interval, and
 * one period's research allowance builds a whole doughnut
 * (SESSIONS_PER_FULL_REFRESH). With no trial, a plan's first period pays for
 * the first build, so a price whose period cannot cover one would sell a
 * customer a plan that can never do what /start sells it for: Community by
 * the month (6 sessions a month against 22 for the build) is not sold. A
 * subscription already on such a price keeps its allowance and keeps
 * syncing (planForLookupKey still knows its key).
 */
export function sellsInterval(plan: PlanDefinition, interval: BillingInterval): boolean {
  return Boolean(plan.stripeLookupKeys[interval]) && periodResearchSessions(plan, interval) >= SESSIONS_PER_FULL_REFRESH;
}

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
  /**
   * Stripe invoice collection only: when a paid invoice of this subscription
   * was first seen (apps/web lib/stripe.ts syncSubscription). Stripe makes a
   * `send_invoice` subscription active as soon as it is created, before
   * anything is paid; until this is set it has no standing
   * ('awaiting_payment'). Null on card and contract rows, which do not use it.
   */
  firstInvoicePaidAt: Date | null;
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
 * What an organization may hold without a plan in good standing: setting up
 * is free, building is not. One portrait — the one /start creates, private
 * until its first publish — and enough people to set it up and review it
 * (seats count everyone with any role, the owner included), but no research
 * sessions at all. Applies equally before a first plan and after one lapses:
 * a lapsed organization keeps everything it has, and grows again once it is
 * in good standing.
 */
export const FREE_SETUP_LIMITS: Readonly<Limits> = Object.freeze({ portraits: 1, seats: 3, researchSessions: 0 });

/**
 * Effective limits for the current period. Contract overrides win over the
 * catalog. The yearly research allowance is prorated to the period length so
 * monthly and annual subscribers get the same yearly total. A plan id the
 * catalog does not know (a hand-edited row) gets the smallest paid plan's
 * limits, never more.
 */
export function effectiveLimits(sub: SubscriptionSnapshot): Limits {
  const plan = isPlanId(sub.plan) ? PLANS[sub.plan] : PLANS.community;
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
  | 'awaiting_payment'
  | 'period_ended'
  | 'billing_out_of_date'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';

export interface Standing {
  /**
   * Research is allowed, and growth past FREE_SETUP_LIMITS (more portraits,
   * more seats) up to the plan's limits (limitsInEffect).
   */
  active: boolean;
  /** Something the billing contact should act on, even while active. */
  warning: 'past_due' | 'cancel_scheduled' | null;
  reason: StandingReason;
}

/**
 * How long past its period end a Stripe-managed subscription keeps its
 * standing while the renewal (or the cancellation) has not reached us.
 * Stripe renews at the period boundary and the webhook usually lands within
 * seconds, retrying for days when it fails; three days covers a slow
 * delivery or a short outage. Past it the row has stopped hearing from
 * Stripe — a sync that keeps failing, a rotated webhook secret — and nothing
 * shows whether anyone is still paying, so it fails closed.
 */
export const STRIPE_SYNC_GRACE_MS = 3 * DAY_MS;

/**
 * Whether an organization is in good standing at `now`: paid, or under a
 * staff contract — never free.
 *
 * - A retired trial has no standing, whatever its dates: research is never
 *   free, so a trial started before trials were retired ends now, not when
 *   its period does (reason 'trial_expired'). So does any 'trialing' row: we
 *   never start a Stripe trial (no-free-research.test.ts).
 * - A Stripe invoice subscription has none until its first invoice is paid
 *   ('awaiting_payment'): Stripe activates it at creation, and net-30 terms
 *   must not mean thirty days of research nobody has paid for.
 * - past_due stays active on purpose, once something has been paid: a
 *   government's accounts-payable routinely runs past net-30, and pausing a
 *   city's research over a slow check run would punish the customer for its
 *   own procurement process. Stripe's dunning moves a truly unpaid invoice
 *   to `unpaid`, which does pause.
 * - A contract has no renewal webhook: its period end is the signal
 *   ('period_ended'). A Stripe-managed row renews by webhook, so its period
 *   end alone is not a lapse — until STRIPE_SYNC_GRACE_MS past it with no
 *   update ('billing_out_of_date'), when it fails closed rather than keep
 *   researching on a subscription nobody may be paying for.
 */
export function standing(sub: SubscriptionSnapshot | null, now: Date = new Date()): Standing {
  if (!sub) return { active: false, warning: null, reason: 'no_subscription' };
  if (sub.plan === 'trial' || sub.status === 'trialing') {
    return { active: false, warning: null, reason: 'trial_expired' };
  }
  switch (sub.status) {
    case 'canceled':
    case 'incomplete_expired':
      return { active: false, warning: null, reason: 'canceled' };
    case 'unpaid':
    case 'paused':
      return { active: false, warning: null, reason: 'unpaid' };
    case 'incomplete':
      return { active: false, warning: null, reason: 'incomplete' };
    case 'past_due':
    case 'active': {
      if (sub.collection === 'contract') {
        if (now >= sub.currentPeriodEnd) return { active: false, warning: null, reason: 'period_ended' };
      } else {
        if (sub.collection === 'invoice' && !sub.firstInvoicePaidAt) {
          return { active: false, warning: null, reason: 'awaiting_payment' };
        }
        if (now.getTime() >= sub.currentPeriodEnd.getTime() + STRIPE_SYNC_GRACE_MS) {
          return { active: false, warning: null, reason: 'billing_out_of_date' };
        }
      }
      if (sub.status === 'past_due') return { active: true, warning: 'past_due', reason: 'ok' };
      return { active: true, warning: sub.cancelAtPeriodEnd ? 'cancel_scheduled' : null, reason: 'ok' };
    }
  }
}

/**
 * The limits that apply to an organization right now: its plan's (with any
 * contract overrides) while it is in good standing, FREE_SETUP_LIMITS
 * otherwise — no subscription yet, or one that lapsed. Adding a portrait and
 * inviting someone check their counts against this, so an organization with
 * no plan can still own its portrait and bring in the people who set it up;
 * research is checked by checkResearchQuota, which refuses without standing.
 */
export function limitsInEffect(sub: SubscriptionSnapshot | null, now: Date = new Date()): Limits {
  if (sub && standing(sub, now).active) return effectiveLimits(sub);
  return { ...FREE_SETUP_LIMITS };
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
    // The usual case for a portrait just set up at /start: say what to do and
    // where, and that what they did so far stays free.
    case 'no_subscription':
      return 'Choose a plan to build your doughnut: on your organization’s page, open Billing and choose a plan, or ask us for a contract. Setting up the portrait and inviting your team need no plan.';
    // Only organizations that started a trial before trials were retired.
    case 'trial_expired':
      return 'The evaluation period has ended. Choose a plan under Billing to keep researching — published portraits stay online.';
    // A plan billed by invoice: chosen, but not paid for yet.
    case 'awaiting_payment':
      return 'Research starts once the first invoice is paid. Pay it from the invoice email or under Billing — published portraits stay online.';
    case 'period_ended':
      return 'The contract period has ended. Contact us to renew — published portraits stay online.';
    case 'billing_out_of_date':
      return 'Research is paused: this subscription has not been updated since its billing period ended. Check it under Billing, or contact us — published portraits stay online.';
    case 'canceled':
      return 'The subscription is canceled. Published portraits stay online; choose a plan under Billing to resume research.';
    case 'unpaid':
      return 'Research is paused for an unpaid invoice. Published portraits stay online; settle the invoice under Billing to resume.';
    case 'incomplete':
      return 'The subscription setup did not finish. Complete payment under Billing.';
  }
}
