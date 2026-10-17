import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { standing, type SubscriptionSnapshot } from '@deep-fryer/core';

/**
 * /start's build step (`/start?portrait=…`) as a customer sees it, around
 * paying: right after a card checkout, while Stripe's confirmation is on its
 * way, the page must offer no way to pay again (a second checkout would
 * charge twice) and must keep one live region whose words change, so "your
 * plan is active" is announced; an invoice plan waiting for its first
 * payment is asked to pay it, not to choose a plan; and the cost estimate
 * says the plan's sessions cover the dollars it quotes. The organization,
 * its billing summary and the person are stubbed; the page and the
 * decisions it makes from them (previewResearchSpend, waysToPay) are real.
 */
vi.stubGlobal('React', React);

const now = Date.now();
const DAY = 86_400_000;
let subscription: (SubscriptionSnapshot & { organizationId: string; stripeSubscriptionId: string | null }) | null = null;

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/components/onboarding/BuildDoughnut', () => ({ BuildDoughnut: () => null }));
vi.mock('@/components/onboarding/PortraitForm', () => ({ PortraitForm: () => null }));
// Shows whether it is polling, and where it sits next to the status.
vi.mock('@/components/admin/AutoRefresh', () => ({
  AutoRefresh: ({ active }: { active: boolean }) => createElement('i', { 'data-auto-refresh': String(active) }),
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAuth: vi.fn(async () => ({ userId: 'u-1', email: 'clerk@example.gov', isStaff: false, devMode: false })),
  getRole: vi.fn(async () => 'owner'),
  getOrgRole: vi.fn(async () => 'owner'),
}));
vi.mock('@/lib/db', () => ({ systemDb: () => ({}), userDb: async () => [] }));
vi.mock('@deep-fryer/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@deep-fryer/db')>()),
  tenantBySlug: vi.fn(async () => ({ id: 't-1', slug: 'ithaca', name: 'City of Ithaca' })),
  organizationForTenant: vi.fn(async () => ({ id: 'o-1', slug: 'ithaca-org', name: 'City of Ithaca' })),
}));
vi.mock('@/lib/billing', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/billing')>();
  const { PLANS, effectiveLimits, standing: standingOf, standingMessage, isPlanId } = await import('@deep-fryer/core');
  return {
    ...real,
    billingSummary: vi.fn(async () => {
      const s = standingOf(subscription);
      return {
        subscription,
        plan: subscription && isPlanId(subscription.plan) ? PLANS[subscription.plan] : null,
        standing: s,
        blockedMessage: standingMessage(s.reason),
        limits: subscription ? effectiveLimits(subscription) : null,
        usage: { researchSessions: 0, researchSessionsOnKey: 0, portraits: 1, seats: 1 },
        apiKey: null,
      };
    }),
  };
});
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  hasDatabase: () => true,
  stripeConfigured: () => true,
  bringYourOwnKeyAvailable: () => false,
  deploymentResearchKeyConfigured: () => true,
  supportEmail: () => 'help@example.gov',
}));

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function buildStep(search: { checkout?: string; at?: string } = {}): Promise<string> {
  const { default: StartPage } = await import('./page');
  const element = await StartPage({ searchParams: Promise.resolve({ portrait: 'ithaca', ...search }) });
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element));
}

const cityPlan = (over: Partial<SubscriptionSnapshot> = {}) => ({
  organizationId: 'o-1',
  stripeSubscriptionId: 'sub_1',
  plan: 'city',
  status: 'active' as const,
  collection: 'card' as const,
  currentPeriodStart: new Date(now - DAY),
  currentPeriodEnd: new Date(now + 364 * DAY),
  trialEndsAt: null,
  cancelAtPeriodEnd: false,
  firstInvoicePaidAt: null,
  researchSessionsOverride: null,
  portraitsOverride: null,
  seatsOverride: null,
  ...over,
});

const statuses = (html: string) => html.match(/role="status"/g)?.length ?? 0;
/** The polling switch and the one status region, side by side, as in every state after checkout. */
const SLOT = /<i data-auto-refresh="(true|false)"><\/i><p role="status"/;

describe('/start’s build step after a card checkout', () => {
  beforeEach(() => {
    delete process.env.DF_DISABLED_FEATURES;
    subscription = null;
  });

  it('while Stripe confirms: one status, polling, and no way to pay again', async () => {
    const html = await buildStep({ checkout: 'success', at: String(now) });
    expect(statuses(html)).toBe(1);
    expect(html.match(SLOT)?.[1]).toBe('true');
    expect(html).toContain('Your plan becomes active within a few seconds');
    expect(html).toContain('Your card payment is being confirmed.');
    // Nothing that sends the person to buy again, and no "No plan yet" contradicting the payment.
    expect(html).not.toContain('No plan yet');
    expect(html).not.toContain('Choose a plan on the billing page');
    expect(html).not.toContain('#choose');
    expect(html).toContain('href="mailto:help@example.gov');
  });

  it('when the plan lands: the same status region says so, and polling stops', async () => {
    subscription = cityPlan();
    expect(standing(subscription).active).toBe(true);
    const html = await buildStep({ checkout: 'success', at: String(now) });
    expect(statuses(html)).toBe(1);
    expect(html.match(SLOT)?.[1]).toBe('false');
    expect(html).toContain('Payment received — thank you. Your City plan is active.');
  });

  it('when the confirmation is late: the same region turns to what to do, and still no way to pay again', async () => {
    const html = await buildStep({ checkout: 'success', at: String(now - 10 * 60_000) });
    expect(statuses(html)).toBe(1);
    expect(html.match(SLOT)?.[1]).toBe('false');
    expect(html).toContain('the plan has not reached this organization yet');
    expect(html).not.toContain('Choose a plan on the billing page');
  });
});

describe('/start’s build step before paying', () => {
  beforeEach(() => {
    delete process.env.DF_DISABLED_FEATURES;
    subscription = null;
  });

  it('without a plan: the ways to pay, and an estimate that says the plan covers it', async () => {
    const html = await buildStep();
    expect(statuses(html)).toBe(0);
    expect(html).toContain('No plan yet.');
    expect(html).toContain('Choose a plan on the billing page');
    expect(html).toContain('research then starts once the invoice is paid');
    expect(html).toContain('covered by the plan’s research sessions — never charged on top of the plan.');
  });

  it('with an invoice plan awaiting its first payment: pay it, not choose a plan again', async () => {
    subscription = cityPlan({ collection: 'invoice', firstInvoicePaidAt: null });
    const html = await buildStep();
    expect(html).toContain('Your City plan starts once its first invoice is paid.');
    expect(html).toContain('Pay the first invoice.');
    expect(html).not.toContain('Choose a plan on the billing page');
  });
});
