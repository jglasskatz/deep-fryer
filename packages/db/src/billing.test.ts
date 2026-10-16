import { describe, expect, it } from 'vitest';
import { decideResearchSpend } from './billing.js';
import type { Subscription } from './schema.js';

/**
 * The research spend decision (SPEC-v7 §4), pure: an organization's own API
 * key waives the session allowance and nothing else. The locking wrapper,
 * gateResearchSpend, is exercised against Postgres through the actions that
 * use it (apps/web lib/research-actions.test.ts).
 */
const now = new Date('2026-10-16T12:00:00Z');
const DAY = 86_400_000;

function trial(overrides: Partial<Subscription> = {}): Subscription {
  return {
    organizationId: '00000000-0000-4000-8000-000000000001',
    plan: 'trial',
    status: 'trialing',
    collection: 'card',
    currentPeriodStart: new Date(now.getTime() - 5 * DAY),
    currentPeriodEnd: new Date(now.getTime() + 25 * DAY),
    trialEndsAt: new Date(now.getTime() + 25 * DAY),
    cancelAtPeriodEnd: false,
    researchSessionsOverride: null,
    portraitsOverride: null,
    seatsOverride: null,
    ...overrides,
  } as Subscription;
}

describe('decideResearchSpend', () => {
  it('checks the allowance when there is no key', () => {
    expect(decideResearchSpend(trial(), 0, false, 22, now)).toMatchObject({ funding: 'plan', check: { allowed: true } });
    const over = decideResearchSpend(trial(), 22, false, 22, now);
    expect(over.funding).toBe('plan');
    expect(over.check).toMatchObject({ allowed: false, remaining: 8 });
    expect(over.check.message).toMatch(/needs 22 research sessions; 8 of 30 remain/);
  });

  it('waives the allowance with a key on file, and reports the count as information', () => {
    const spent = decideResearchSpend(trial(), 30, true, 22, now);
    expect(spent).toEqual({
      funding: 'organization_key',
      check: { allowed: true, used: 30, limit: 30, remaining: 0, message: null },
    });
    // However large the run.
    expect(decideResearchSpend(trial({ researchSessionsOverride: 0 }), 0, true, 500, now).check.allowed).toBe(true);
  });

  it('still requires good standing with a key on file', () => {
    expect(decideResearchSpend(null, 0, true, 1, now)).toMatchObject({
      funding: 'organization_key',
      check: { allowed: false, message: expect.stringMatching(/no plan yet/) },
    });
    expect(decideResearchSpend(trial({ status: 'canceled' }), 0, true, 1, now).check).toMatchObject({
      allowed: false,
      message: expect.stringMatching(/canceled/),
    });
    const ended = trial({ trialEndsAt: new Date(now.getTime() - DAY), currentPeriodEnd: new Date(now.getTime() - DAY) });
    expect(decideResearchSpend(ended, 0, true, 1, now).check).toMatchObject({
      allowed: false,
      message: expect.stringMatching(/trial has ended/),
    });
  });
});
