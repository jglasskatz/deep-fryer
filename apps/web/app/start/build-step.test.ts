import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
/** Whether this server can store organizations' own keys, and whether one is on file. */
let keysStorable = false;
let keyOnFile = false;
/** Research has been applied for one of the organization's portraits, and a run of this portrait is going. */
let researchApplied = false;
let runGoing = false;

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
// Shows why the button is disabled, when it is.
vi.mock('@/components/onboarding/BuildDoughnut', () => ({
  BuildDoughnut: ({ blockedReason }: { blockedReason: string | null }) =>
    createElement('output', { 'data-blocked': blockedReason ?? '' }),
}));
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
vi.mock('@/lib/db', () => ({ systemDb: () => ({}), userDb: async () => (runGoing ? [{ id: 'run-1' }] : []) }));
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
        apiKey: keyOnFile
          ? { provider: 'anthropic', keyHint: 'Ab12', createdBy: null, createdAt: new Date(now), validatedAt: new Date(now) }
          : null,
        researchApplied,
        firstDoughnutNote: null,
      };
    }),
  };
});
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  hasDatabase: () => true,
  stripeConfigured: () => true,
  bringYourOwnKeyAvailable: () => keysStorable,
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

/** The button's disabled reason as rendered, or '' when it is enabled. */
const blocked = (html: string) => html.match(/<output data-blocked="([^"]*)"/)?.[1] ?? null;

describe('/start’s build step and the deployment’s first-doughnut choice', () => {
  const before = process.env.DF_FIRST_DOUGHNUT;
  beforeEach(() => {
    delete process.env.DF_DISABLED_FEATURES;
    subscription = null;
    keysStorable = true;
    keyOnFile = false;
  });
  afterEach(() => {
    keysStorable = false;
    keyOnFile = false;
    researchApplied = false;
    runGoing = false;
    if (before === undefined) delete process.env.DF_FIRST_DOUGHNUT;
    else process.env.DF_FIRST_DOUGHNUT = before;
  });

  it('unset: a plan is needed, the own key spares its allowance only, and the button says to choose a plan', async () => {
    delete process.env.DF_FIRST_DOUGHNUT;
    const html = await buildStep();
    expect(html).toContain('No plan yet.</strong> Setting up the portrait is free; building it needs a plan in good standing or a contract.');
    expect(html).toContain('A plan is still needed: your key pays for the model usage, not for hosting, review, and support.');
    expect(blocked(html)).toMatch(/^Choose a plan to build your doughnut/);
  });

  it('own, no key yet: says the first doughnut needs no plan on the group’s key, and the button says how', async () => {
    process.env.DF_FIRST_DOUGHNUT = 'own';
    const html = await buildStep();
    expect(html).toContain('your first doughnut can be built on your organization’s own Anthropic API key with no plan');
    expect(html).toContain('Use your own Anthropic API key.</strong> Your first doughnut then runs on your key, with no plan needed');
    expect(html).toContain('Add your key on the billing page');
    expect(html).not.toContain('A plan is still needed');
    // A plan and a contract stay on offer.
    expect(html).toContain('Choose a plan on the billing page');
    expect(html).toContain('Arrange a contract.');
    expect(blocked(html)).toContain('an organization owner adds the key under Billing');
    // The estimate describes the way the step recommends, the key, not a plan this group does not have.
    expect(html).toContain('on your key');
    expect(html).toContain('billed to you by Anthropic.');
    expect(html).not.toContain('covered by the plan’s research sessions');
  });

  it('own, first doughnut under way on the key: says it will finish, and offers no way to pay beside it', async () => {
    process.env.DF_FIRST_DOUGHNUT = 'own';
    keyOnFile = true;
    researchApplied = true;
    runGoing = true;
    const html = await buildStep();
    expect(html).toContain('No plan yet.</strong> The research under way will finish; more research after it needs a plan or a contract.');
    expect(html).toContain('Research for City of Ithaca is under way.');
    expect(html).toContain('Follow the run');
    expect(html).not.toContain('Setting up the portrait is free');
    expect(html).not.toContain('Choose a plan on the billing page');
    expect(html).not.toContain('Arrange a contract.');
  });

  it('own, first doughnut done: a rebuild needs a plan, with the ways to get one', async () => {
    process.env.DF_FIRST_DOUGHNUT = 'own';
    keyOnFile = true;
    researchApplied = true;
    const html = await buildStep();
    expect(html).toContain('No plan yet.</strong> Setting up the portrait is free; building it needs a plan in good standing or a contract.');
    expect(html).toContain('Choose a plan on the billing page');
    expect(html).not.toContain('pays for your first doughnut');
    expect(blocked(html)).toMatch(/^Choose a plan to build your doughnut/);
  });

  it('own, an invoice plan not paid yet and no key: pay it, or build the first doughnut on the key meanwhile', async () => {
    process.env.DF_FIRST_DOUGHNUT = 'own';
    subscription = cityPlan({ collection: 'invoice', firstInvoicePaidAt: null });
    const html = await buildStep();
    expect(html).toContain('Your City plan starts once its first invoice is paid.');
    expect(html).toContain('Until it is paid, your first doughnut can be built on your organization’s own Anthropic API key instead, with no plan.');
    expect(html).not.toContain('Building the doughnut needs a plan that has been paid for');
    expect(html).toContain('Pay the first invoice.');
    expect(html).toContain('Add your key on the billing page');
    expect(blocked(html)).toMatch(/^Research starts once the first invoice is paid\..* Your first doughnut can also be built/);
  });

  it('own, a card checkout that did not finish, with a key on file: the key pays for the first doughnut', async () => {
    process.env.DF_FIRST_DOUGHNUT = 'own';
    subscription = cityPlan({ status: 'incomplete' });
    keyOnFile = true;
    const html = await buildStep();
    expect(html).toContain('pays for your first doughnut, with no plan needed');
    expect(html).not.toContain('Choose a plan on the billing page');
    expect(blocked(html)).toBe('');
  });

  it('own, key on file: the key pays for the first doughnut, nothing is left to choose, and the button is enabled', async () => {
    process.env.DF_FIRST_DOUGHNUT = 'own';
    keyOnFile = true;
    const html = await buildStep();
    expect(html).toContain('sk-ant-…Ab12');
    expect(html).toContain('pays for your first doughnut, with no plan needed');
    expect(html).not.toContain('No plan yet.');
    expect(html).not.toContain('Choose a plan on the billing page');
    expect(blocked(html)).toBe('');
  });

  it('own on a server that cannot store keys: today’s rule, word for word', async () => {
    process.env.DF_FIRST_DOUGHNUT = 'own';
    keysStorable = false;
    const html = await buildStep();
    expect(html).toContain('building it needs a plan in good standing or a contract.');
    expect(html).not.toContain('first doughnut');
    expect(blocked(html)).toMatch(/^Choose a plan to build your doughnut/);
  });

  it('own, for an organization that has a plan: the plan pays, as before', async () => {
    process.env.DF_FIRST_DOUGHNUT = 'own';
    subscription = cityPlan();
    const html = await buildStep();
    expect(html).not.toContain('first doughnut');
    expect(html).toContain('Your City plan</strong> — this uses 22 of the');
    expect(blocked(html)).toBe('');
  });
});
