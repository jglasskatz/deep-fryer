import { describe, expect, it } from 'vitest';
import {
  PLANS,
  checkResearchQuota,
  effectiveLimits,
  planForLookupKey,
  standing,
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

  it('gives a 30-day trial one full refresh plus re-runs', () => {
    const trial = sub({
      plan: 'trial',
      status: 'trialing',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * day),
    });
    expect(effectiveLimits(trial).researchSessions).toBe(30);
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

  it('pauses on unpaid and canceled', () => {
    expect(standing(sub({ status: 'unpaid' }), now).active).toBe(false);
    expect(standing(sub({ status: 'canceled' }), now).reason).toBe('canceled');
  });

  it('expires trials at trial end and warns in the last week', () => {
    const ending = sub({ status: 'trialing', trialEndsAt: new Date(now.getTime() + 3 * day) });
    expect(standing(ending, now)).toMatchObject({ active: true, warning: 'trial_ending' });
    const ended = sub({ status: 'trialing', trialEndsAt: new Date(now.getTime() - day) });
    expect(standing(ended, now)).toMatchObject({ active: false, reason: 'trial_expired' });
  });

  it('lapses a manual contract at its period end (no renewal webhook exists)', () => {
    const lapsed = sub({ collection: 'contract', currentPeriodEnd: new Date(now.getTime() - day) });
    expect(standing(lapsed, now)).toMatchObject({ active: false, reason: 'period_ended' });
    // A Stripe-managed subscription renews by webhook; its end date alone is not a lapse.
    const stripe = sub({ collection: 'card', currentPeriodEnd: new Date(now.getTime() - day) });
    expect(standing(stripe, now).active).toBe(true);
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
