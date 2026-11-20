import { describe, expect, it } from 'vitest';
import type { StandingReason } from '@deep-fryer/core';
import { howBuildingStarts, type BuildBlockedFacts } from './payment-options';

/**
 * The one sentence /start's build step shows while "Build my doughnut"
 * cannot run. It must stay one plain sentence with no amounts, and name
 * only ways that would actually let the research gate through.
 */
const facts = (over: Partial<BuildBlockedFacts> = {}): BuildBlockedFacts => ({
  reason: 'no_subscription',
  renewsOn: null,
  endsAtPeriodClose: false,
  sessionsPerPeriod: null,
  sessionsNeeded: 22,
  keyOnFile: false,
  keysStorable: true,
  researchKeyConfigured: true,
  firstOnOwnKey: false,
  ...over,
});

const REASONS: Exclude<StandingReason, 'ok'>[] = [
  'no_subscription',
  'trial_expired',
  'awaiting_payment',
  'period_ended',
  'billing_out_of_date',
  'canceled',
  'unpaid',
  'incomplete',
];

describe('howBuildingStarts', () => {
  it('a group with no plan: a plan or a contract', () => {
    expect(howBuildingStarts(facts())).toBe('Research can start once your organization has a plan or a contract.');
  });

  it('an invoice plan not paid yet: the invoice', () => {
    expect(howBuildingStarts(facts({ reason: 'awaiting_payment' }))).toBe(
      'Research can start once your plan’s first invoice is paid.',
    );
  });

  it('under the first-doughnut setting, with no key yet: the key as well, for the first doughnut only', () => {
    expect(howBuildingStarts(facts({ firstOnOwnKey: true }))).toBe(
      'Research can start once your organization has a plan or a contract, or, for your first doughnut, once an organization owner adds your own Anthropic API key under Billing.',
    );
    // A key already on file would have let the build through; it is never offered twice.
    expect(howBuildingStarts(facts({ firstOnOwnKey: true, keyOnFile: true }))).not.toContain('adds your own');
  });

  it('a plan in good standing whose sessions are used up: renewal, a larger plan, or the key', () => {
    const plan = { reason: 'ok' as const, sessionsPerPeriod: 200 };
    expect(howBuildingStarts(facts({ ...plan, renewsOn: new Date('2027-03-01T00:00:00Z') }))).toBe(
      'Research can start once your plan’s research sessions renew on 2027-03-01, or once your organization moves to a larger plan or contract, or once an organization owner adds your own Anthropic API key under Billing.',
    );
    expect(howBuildingStarts(facts({ ...plan, keysStorable: false }))).toBe(
      'Research can start once your plan’s research sessions renew, or once your organization moves to a larger plan or contract.',
    );
    // An allowance of exactly one build renews into enough.
    expect(howBuildingStarts(facts({ ...plan, sessionsPerPeriod: 22, keysStorable: false }))).toContain('renew');
  });

  it('a plan whose allowance for a whole period is less than one build: never a renewal, which would not be enough', () => {
    // A contract that allows 10 sessions a period, or a legacy monthly plan allowing 6, against a 22-session build.
    for (const sessionsPerPeriod of [10, 6, 21]) {
      const plan = { reason: 'ok' as const, sessionsPerPeriod, renewsOn: new Date('2027-11-19T00:00:00Z') };
      expect(howBuildingStarts(facts({ ...plan, keysStorable: false }))).toBe(
        'Research can start once your organization moves to a larger plan or contract.',
      );
      expect(howBuildingStarts(facts(plan))).toBe(
        'Research can start once your organization moves to a larger plan or contract, or once an organization owner adds your own Anthropic API key under Billing.',
      );
    }
  });

  it('a plan set to end at the close of its period: never a renewal, since it will not renew', () => {
    expect(
      howBuildingStarts(
        facts({ reason: 'ok', sessionsPerPeriod: 200, endsAtPeriodClose: true, renewsOn: new Date('2027-03-01T00:00:00Z'), keysStorable: false }),
      ),
    ).toBe('Research can start once your organization moves to a larger plan or contract.');
  });

  it('a server that cannot run research on a plan: whoever runs it, or the key where keys can be stored', () => {
    expect(howBuildingStarts(facts({ reason: 'ok', researchKeyConfigured: false, keysStorable: false }))).toBe(
      'Research can start once whoever runs this server sets it up.',
    );
    expect(howBuildingStarts(facts({ reason: 'ok', researchKeyConfigured: false }))).toBe(
      'Research can start once whoever runs this server sets it up, or once an organization owner adds your own Anthropic API key under Billing.',
    );
    expect(howBuildingStarts(facts({ researchKeyConfigured: false, keysStorable: false }))).toBe(
      'Research can start once your organization has a plan or a contract and whoever runs this server sets research up.',
    );
  });

  it('a key on file this server cannot read: remove it, or the server is set up for it', () => {
    expect(howBuildingStarts(facts({ reason: 'ok', keyOnFile: true, keysStorable: false }))).toBe(
      'Research can start once an organization owner removes the key on file under Billing, or once this server is set up to use it.',
    );
  });

  it('every standing, every server: one sentence, plain, with no amounts', () => {
    for (const reason of [...REASONS, 'ok' as const]) {
      for (const keyOnFile of [false, true]) {
        for (const keysStorable of [false, true]) {
          for (const researchKeyConfigured of [false, true]) {
            for (const firstOnOwnKey of [false, true]) {
              const sentence = howBuildingStarts({
                reason,
                renewsOn: new Date('2027-03-01T00:00:00Z'),
                endsAtPeriodClose: false,
                sessionsPerPeriod: reason === 'ok' ? 200 : null,
                sessionsNeeded: 22,
                keyOnFile,
                keysStorable,
                researchKeyConfigured,
                firstOnOwnKey,
              });
              expect(sentence).toMatch(/^Research can start once [^.]+\.$/);
              expect(sentence).not.toMatch(/\$|\d+ (research )?sessions|undefined/);
            }
          }
        }
      }
    }
  });
});
