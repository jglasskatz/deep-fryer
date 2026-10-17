import { describe, expect, it } from 'vitest';
import * as plans from './plans.js';
import {
  CONTRACT_PLANS,
  FREE_SETUP_LIMITS,
  PLANS,
  PURCHASABLE_PLANS,
  SESSIONS_PER_FULL_REFRESH,
  STRIPE_SYNC_GRACE_MS,
  checkResearchQuota,
  effectiveLimits,
  limitsInEffect,
  periodResearchSessions,
  planForLookupKey,
  sellsInterval,
  standing,
  standingMessage,
  type BillingInterval,
  type SubscriptionSnapshot,
} from './plans.js';

const day = 86_400_000;
const now = new Date('2026-10-14T12:00:00Z');

function sub(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    plan: 'city',
    status: 'active',
    collection: 'invoice',
    currentPeriodStart: new Date(now.getTime() - 100 * day),
    currentPeriodEnd: new Date(now.getTime() + 265 * day),
    trialEndsAt: null,
    // An invoice subscription whose first invoice has been paid: in good standing.
    firstInvoicePaidAt: new Date(now.getTime() - 90 * day),
    researchSessionsOverride: null,
    portraitsOverride: null,
    seatsOverride: null,
    ...overrides,
  };
}

describe('effectiveLimits', () => {
  it('gives an annual period the full yearly research allowance', () => {
    expect(effectiveLimits(sub()).researchSessions).toBe(PLANS.city.researchSessionsPerYear);
  });

  it('prorates monthly periods so twelve months sum to the yearly allowance', () => {
    const monthly = sub({
      plan: 'community',
      currentPeriodStart: new Date('2026-10-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-10-31T00:00:00Z'),
    });
    // 66/yr over a 30-day period → ceil(66 × 30 / 365) = 6
    expect(effectiveLimits(monthly).researchSessions).toBe(6);
  });

  it('lets contract overrides win over the catalog', () => {
    const l = effectiveLimits(sub({ researchSessionsOverride: 999, portraitsOverride: 7 }));
    expect(l.researchSessions).toBe(999);
    expect(l.portraits).toBe(7);
    expect(l.seats).toBe(PLANS.city.seats);
  });

  it('gives a plan id the catalog does not know the smallest paid plan’s limits, never more', () => {
    expect(effectiveLimits(sub({ plan: 'hand-edited' }))).toEqual(effectiveLimits(sub({ plan: 'community' })));
  });
});

describe('no free research ("No free trials for making donuts, but free to view")', () => {
  it('offers no trial: nothing sells it, and there is no trial length to start one with', () => {
    expect(PURCHASABLE_PLANS).not.toContain('trial');
    expect(PLANS.trial.selfServe).toBe(false);
    expect(PLANS.trial.stripeLookupKeys).toEqual({});
    expect(PLANS.trial.highlights).toEqual([]);
    expect('TRIAL_DAYS' in plans).toBe(false);
  });

  it('refuses every research session to an organization without a plan, saying how to get one', () => {
    const r = checkResearchQuota(null, 0, 1, now);
    expect(r).toMatchObject({ allowed: false, limit: 0, remaining: 0 });
    expect(r.message).toBe(standingMessage('no_subscription'));
    expect(r.message).toMatch(/^Choose a plan to build your doughnut: on your organization’s page, open Billing/);
    expect(r.message).not.toMatch(/trial/i);
  });

  it('gives a trial started before trials were retired nothing, from the day trials ended', () => {
    // Five days into a 30-day trial, with 25 days and 30 sessions it was once promised still to come.
    const started = sub({
      plan: 'trial',
      status: 'trialing',
      collection: 'card',
      currentPeriodStart: new Date(now.getTime() - 5 * day),
      currentPeriodEnd: new Date(now.getTime() + 25 * day),
      trialEndsAt: new Date(now.getTime() + 25 * day),
    });
    expect(standing(started, now)).toEqual({ active: false, warning: null, reason: 'trial_expired' });
    const build = checkResearchQuota(started, 0, SESSIONS_PER_FULL_REFRESH, now);
    expect(build).toMatchObject({ allowed: false, limit: 0, remaining: 0 });
    expect(build.message).toBe(standingMessage('trial_expired'));
    // Back to the free setup limits, like any organization without a plan.
    expect(limitsInEffect(started, now)).toEqual(FREE_SETUP_LIMITS);
    // Nor does any other row on the trial plan (a contract once written on it), or any Stripe trial.
    expect(standing(sub({ plan: 'trial', collection: 'contract' }), now).active).toBe(false);
    expect(standing(sub({ status: 'trialing', trialEndsAt: new Date(now.getTime() + 20 * day) }), now).active).toBe(false);
  });

  it('gives an invoice subscription no research until its first invoice is paid', () => {
    // Exactly what a self-serve "Request an annual invoice" for Metro writes on day 0: Stripe calls it active.
    const requested = sub({
      plan: 'metro',
      collection: 'invoice',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 365 * day),
      firstInvoicePaidAt: null,
    });
    expect(standing(requested, now)).toEqual({ active: false, warning: null, reason: 'awaiting_payment' });
    expect(checkResearchQuota(requested, 0, SESSIONS_PER_FULL_REFRESH, now)).toMatchObject({ allowed: false, limit: 0 });
    expect(standingMessage('awaiting_payment')).toMatch(/^Research starts once the first invoice is paid/);
    // Nor once the unpaid first invoice is past due: the past-due grace is for customers who have paid before.
    expect(standing({ ...requested, status: 'past_due' }, new Date(now.getTime() + 45 * day)).active).toBe(false);
    expect(limitsInEffect(requested, now)).toEqual(FREE_SETUP_LIMITS);
    // Paid: the plan's allowance, and the past-due grace after that.
    const paid = { ...requested, firstInvoicePaidAt: new Date(now.getTime() + 20 * day) };
    const later = new Date(now.getTime() + 21 * day);
    expect(checkResearchQuota(paid, 0, SESSIONS_PER_FULL_REFRESH, later)).toMatchObject({ allowed: true, limit: 600 });
    expect(standing({ ...paid, status: 'past_due' }, later)).toMatchObject({ active: true, warning: 'past_due' });
    // Card and contract rows never wait for an invoice: Stripe charges a card before activating, and staff set contracts.
    expect(standing(sub({ collection: 'card', firstInvoicePaidAt: null }), now).active).toBe(true);
    expect(standing(sub({ collection: 'contract', firstInvoicePaidAt: null }), now).active).toBe(true);
  });

  it('lets an organization without a plan set up one portrait with a few people, and research nothing', () => {
    expect(limitsInEffect(null, now)).toEqual({ portraits: 1, seats: 3, researchSessions: 0 });
    expect(limitsInEffect(null, now)).toEqual(FREE_SETUP_LIMITS);
    // A lapsed plan falls back to the same setup limits; one in good standing has its own.
    expect(limitsInEffect(sub({ status: 'canceled' }), now)).toEqual(FREE_SETUP_LIMITS);
    expect(limitsInEffect(sub({ seatsOverride: 40 }), now)).toEqual(effectiveLimits(sub({ seatsOverride: 40 })));
    // Callers get a copy: the shared constant cannot be changed through it.
    limitsInEffect(null, now).seats = 99;
    expect(FREE_SETUP_LIMITS.seats).toBe(3);
  });
});

describe('standing', () => {
  it('has no standing without a subscription', () => {
    expect(standing(null, now)).toMatchObject({ active: false, reason: 'no_subscription' });
  });

  it('keeps past_due active with a warning (government AP runs past net-30)', () => {
    expect(standing(sub({ status: 'past_due' }), now)).toEqual({
      active: true,
      warning: 'past_due',
      reason: 'ok',
    });
  });

  it('warns when a subscription is set to end at period close', () => {
    expect(standing(sub({ cancelAtPeriodEnd: true }), now)).toMatchObject({
      active: true,
      warning: 'cancel_scheduled',
    });
  });

  it('pauses on unpaid and canceled', () => {
    expect(standing(sub({ status: 'unpaid' }), now).active).toBe(false);
    expect(standing(sub({ status: 'canceled' }), now).reason).toBe('canceled');
  });

  it('lapses a manual contract at its period end (no renewal webhook exists)', () => {
    const lapsed = sub({ collection: 'contract', currentPeriodEnd: new Date(now.getTime() - day) });
    expect(standing(lapsed, now)).toMatchObject({ active: false, reason: 'period_ended' });
    // A Stripe-managed subscription renews by webhook; its end date alone is not a lapse while the webhook may still come.
    const stripe = sub({ collection: 'card', currentPeriodEnd: new Date(now.getTime() - day) });
    expect(standing(stripe, now).active).toBe(true);
  });

  it('fails closed on a Stripe-managed row that stopped hearing from Stripe after its period ended', () => {
    // Canceled at period end 90 days ago, and the webhook that would have said so never arrived.
    for (const collection of ['card', 'invoice'] as const) {
      for (const status of ['active', 'past_due'] as const) {
        const stale = sub({
          collection,
          status,
          cancelAtPeriodEnd: true,
          currentPeriodStart: new Date(now.getTime() - 120 * day),
          currentPeriodEnd: new Date(now.getTime() - 90 * day),
        });
        expect(standing(stale, now)).toEqual({ active: false, warning: null, reason: 'billing_out_of_date' });
        expect(checkResearchQuota(stale, 0, 1, now)).toMatchObject({ allowed: false, limit: 0, remaining: 0 });
      }
    }
    // Within the grace a late renewal webhook can still land; at its end the row stops.
    const end = new Date(now.getTime() - STRIPE_SYNC_GRACE_MS + 60_000);
    expect(standing(sub({ collection: 'card', currentPeriodEnd: end }), now).active).toBe(true);
    expect(standing(sub({ collection: 'card', currentPeriodEnd: new Date(end.getTime() - 60_000) }), now).active).toBe(false);
    expect(standingMessage('billing_out_of_date')).toMatch(/has not been updated since its billing period ended/);
  });
});

describe('what is sold, and by which interval', () => {
  it('sells every plan only by an interval whose period can pay for a whole doughnut', () => {
    for (const id of PURCHASABLE_PLANS) {
      const intervals = (['month', 'year'] as BillingInterval[]).filter((i) => sellsInterval(PLANS[id], i));
      // Every purchasable plan can be bought somehow…
      expect(intervals.length).toBeGreaterThan(0);
      // …and whatever is sold builds the doughnut in its first period, with no trial to pay for it.
      for (const i of intervals) expect(periodResearchSessions(PLANS[id], i)).toBeGreaterThanOrEqual(SESSIONS_PER_FULL_REFRESH);
    }
  });

  it('does not sell Community by the month, whose 6 sessions a month never reach a 22-session build', () => {
    expect(periodResearchSessions(PLANS.community, 'month')).toBe(6);
    expect(sellsInterval(PLANS.community, 'month')).toBe(false);
    expect(sellsInterval(PLANS.community, 'year')).toBe(true);
    // A subscription already on the monthly price still maps to its plan, and keeps its allowance.
    expect(planForLookupKey('deep_fryer_community_monthly')).toEqual({ plan: 'community', interval: 'month' });
    // Nothing is sold where there is no price.
    expect(sellsInterval(PLANS.city, 'month')).toBe(false);
    expect(sellsInterval(PLANS.enterprise, 'year')).toBe(false);
  });

  it('offers contracts on every real plan and never on the retired trial', () => {
    expect([...CONTRACT_PLANS]).toEqual(['community', 'city', 'metro', 'enterprise']);
    expect(CONTRACT_PLANS).not.toContain('trial');
  });
});

describe('checkResearchQuota', () => {
  it('allows a run inside the remaining allowance', () => {
    const r = checkResearchQuota(sub(), 100, 22, now);
    expect(r).toMatchObject({ allowed: true, remaining: 100, limit: 200 });
  });

  it('refuses a run that would exceed the allowance — hard cap, no overage', () => {
    const r = checkResearchQuota(sub(), 190, 22, now);
    expect(r.allowed).toBe(false);
    expect(r.message).toMatch(/needs 22 research sessions; 10 of 200 remain/);
  });

  it('refuses when the organization is not in good standing', () => {
    const r = checkResearchQuota(sub({ status: 'unpaid' }), 0, 1, now);
    expect(r.allowed).toBe(false);
    expect(r.message).toMatch(/unpaid invoice/);
  });
});

describe('planForLookupKey', () => {
  it('maps Stripe lookup keys back to plan + interval', () => {
    expect(planForLookupKey('deep_fryer_metro_annual')).toEqual({ plan: 'metro', interval: 'year' });
    expect(planForLookupKey('deep_fryer_community_monthly')).toEqual({
      plan: 'community',
      interval: 'month',
    });
    expect(planForLookupKey('something_else')).toBeNull();
    expect(planForLookupKey(null)).toBeNull();
  });
});
