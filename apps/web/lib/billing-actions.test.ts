import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The billing actions' refusals, before anything reaches Stripe or the
 * database: a contract on the retired trial plan, a plan by an interval it is
 * not sold by, and a second checkout for an organization Stripe already
 * bills. The organization, the person, and Stripe are stubbed; what is under
 * test is which requests the actions let through.
 */
const state = vi.hoisted(() => ({
  isStaff: true,
  /** Our row: null until the checkout's webhook writes it. */
  subscription: null as null | { stripeSubscriptionId: string | null; status: string },
  /** What Stripe itself holds for the customer. */
  atStripe: [] as { status: string }[],
  checkouts: 0,
  orgLookups: 0,
}));
const org = {
  id: '00000000-0000-4000-8000-0000000000a1',
  slug: 'paying-town',
  name: 'Paying Town',
  billingEmail: 'ap@example.gov',
  taxExempt: true,
  stripeCustomerId: 'cus_paying' as string | null,
};
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./db', () => ({ systemDb: () => ({}) }));
vi.mock('./env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./env')>()),
  appUrl: () => 'https://app.example.gov',
}));
vi.mock('./auth', () => ({
  getAuth: vi.fn(async () => ({ userId: 'u-1', email: 'owner@example.gov', isStaff: state.isStaff, devMode: false })),
  requireOrgRole: vi.fn(async () => undefined),
}));
vi.mock('@deep-fryer/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@deep-fryer/db')>()),
  organizationBySlug: vi.fn(async () => {
    state.orgLookups += 1;
    return org;
  }),
  subscriptionFor: vi.fn(async () => state.subscription),
}));
vi.mock('./stripe', () => ({
  stripe: () => ({
    subscriptions: { list: vi.fn(async () => ({ data: state.atStripe })) },
    checkout: {
      sessions: {
        create: vi.fn(async () => {
          state.checkouts += 1;
          return { url: 'https://checkout.stripe.example/s' };
        }),
      },
    },
  }),
  priceFor: vi.fn(async () => ({ id: 'price_x' })),
  ensureCustomer: vi.fn(async () => 'cus_paying'),
  syncSubscription: vi.fn(async () => null),
}));

beforeEach(() => {
  Object.assign(state, { isStaff: true, subscription: null, atStripe: [], checkouts: 0, orgLookups: 0 });
});

describe('setContract', () => {
  const terms = {
    orgSlug: org.slug,
    periodStart: '2026-11-01',
    periodEnd: '2027-10-31',
    researchSessionsOverride: null,
    portraitsOverride: null,
    seatsOverride: null,
  };

  it('refuses the retired trial plan, even from staff posting the action directly, and reads nothing', async () => {
    const { setContract } = await import('./billing-actions');
    const res = await setContract({ ...terms, plan: 'trial' as never });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/^plan: /) });
    expect(state.orgLookups).toBe(0);
  });
});

describe('startCheckout', () => {
  it('does not sell Community by the month: six sessions a month never build a doughnut', async () => {
    const { startCheckout } = await import('./billing-actions');
    const res = await startCheckout({ orgSlug: org.slug, plan: 'community', interval: 'month' });
    expect(res).toEqual({
      ok: false,
      error: "The Community plan is sold annually: a month's research allowance is too small to build a doughnut.",
    });
    expect(state.checkouts).toBe(0);
  });

  it('refuses a second checkout while Stripe already bills the organization, before its webhook has written our row', async () => {
    const { startCheckout } = await import('./billing-actions');
    // Paid a moment ago: Stripe has the subscription, our row does not yet.
    state.atStripe = [{ status: 'active' }];
    const again = await startCheckout({ orgSlug: org.slug, plan: 'city', interval: 'year' });
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/already has a subscription/) });
    expect(state.checkouts).toBe(0);
    // Only ended ones at Stripe: a new checkout goes ahead.
    state.atStripe = [{ status: 'canceled' }, { status: 'incomplete_expired' }];
    expect(await startCheckout({ orgSlug: org.slug, plan: 'city', interval: 'year' })).toMatchObject({ ok: true });
    expect(state.checkouts).toBe(1);
  });
});
