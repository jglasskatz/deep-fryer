import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { FREE_SETUP_LIMITS, type Role, type SubscriptionSnapshot } from '@deep-fryer/core';
import type { SeatsInEffect } from '@/lib/invitations';
import type { StageFacts } from '@/lib/portrait-stage';
import { DOUGHNUT_ROUTES, routeHref, routesWithoutResearch } from '@/components/onboarding/routes';
import { START_STEPS, WhatYouHave, WithoutResearch } from '@/components/onboarding/StartSteps';

/**
 * /start as a group sees it: four plain steps, in order, on both addresses
 * (before the place is named, and for a portrait just created), each state
 * of the last two steps said in words — research that cannot run yet points
 * to every way in that needs none, the seats left are the invitation form's
 * count, and someone who may not change the portrait is told who can. The
 * organization, its billing and the person are stubbed; the page, its steps
 * and the decisions it makes from them are real.
 */
vi.stubGlobal('React', React);

const now = Date.now();
const DAY = 86_400_000;
let subscription: (SubscriptionSnapshot & { organizationId: string; stripeSubscriptionId: string | null }) | null = null;
let role: Role | null = 'owner';
let runGoing = false;
let tenantName = 'City of Ithaca';
let seats: SeatsInEffect = { limit: 3, members: 1, pending: 0, left: 2 };
/** Where the portrait's doughnut stands, when a test sets it; otherwise it follows `runGoing`. */
let stageFacts: StageFacts | null = null;

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/components/onboarding/BuildDoughnut', () => ({
  BuildDoughnut: ({ blockedReason }: { blockedReason: string | null }) =>
    createElement('output', { 'data-blocked': blockedReason ?? '' }),
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAuth: vi.fn(async () => ({ userId: 'u-1', email: 'organizer@example.org', isStaff: false, devMode: false })),
  getRole: vi.fn(async () => role),
  getOrgRole: vi.fn(async () => (role === 'owner' ? 'owner' : null)),
}));
vi.mock('@/lib/db', () => ({ systemDb: () => ({}), userDb: async () => (runGoing ? [{ id: 'run-1' }] : []) }));
// Where the doughnut stands follows the stubbed run: a blank portrait, or research under way.
vi.mock('@/lib/portrait-stage', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/portrait-stage')>();
  return {
    ...real,
    portraitStageFacts: vi.fn(
      async () =>
        stageFacts ?? {
          ...real.BLANK_FACTS,
          runs: runGoing ? [{ id: 'run-1', status: 'running', appliedAt: new Date() }] : [],
        },
    ),
  };
});
vi.mock('@/lib/invitations', () => ({ seatsInEffect: vi.fn(async () => seats) }));
vi.mock('@deep-fryer/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@deep-fryer/db')>()),
  tenantBySlug: vi.fn(async (_db: unknown, slug: string) =>
    slug === 'ithaca' ? { id: 't-1', slug: 'ithaca', name: tenantName, region: 'NY, USA' } : null,
  ),
  organizationForTenant: vi.fn(async () => ({ id: 'o-1', slug: 'ithaca-org', name: 'Ithaca Doughnut Group' })),
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
        researchApplied: runGoing,
        firstDoughnutNote: null,
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
  supportEmail: () => 'help@example.org',
}));

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const render = (element: React.ReactNode) =>
  renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element));

/** Next's redirect() throws; its digest says where to. */
async function visit(search: { portrait?: string } = {}): Promise<{ html: string } | { redirect: string }> {
  const { default: StartPage } = await import('./page');
  try {
    return { html: render(await StartPage({ searchParams: Promise.resolve(search) })) };
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? '';
    if (digest.startsWith('NEXT_REDIRECT')) return { redirect: digest.split(';')[2]! };
    throw err;
  }
}
async function page(search: { portrait?: string } = {}): Promise<string> {
  const result = await visit(search);
  if (!('html' in result)) throw new Error(`expected a page, got a redirect to ${result.redirect}`);
  return result.html;
}

const headings = (html: string, level: 'h1' | 'h2' | 'h3') =>
  [...html.matchAll(new RegExp(`<${level}[^>]*>(.*?)</${level}>`, 'g'))].map((m) => m[1]!.replace(/<[^>]+>/g, ''));
const decode = (html: string) => html.replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&');
/** The markup of step `n` (1-based), from its list item up to the next step's. */
const step = (html: string, n: number) => {
  const section = html.indexOf(`<section aria-labelledby="step-${n}"`);
  if (section < 0) return '';
  const from = html.lastIndexOf('<li', section);
  const next = html.indexOf(`<section aria-labelledby="step-${n + 1}"`);
  const to = next < 0 ? html.lastIndexOf('</ol>') : html.lastIndexOf('<li', next);
  return decode(html.slice(from, to));
};

const cityPlan = (): typeof subscription => ({
  organizationId: 'o-1',
  stripeSubscriptionId: 'sub_1',
  plan: 'city',
  status: 'active',
  collection: 'card',
  currentPeriodStart: new Date(now - DAY),
  currentPeriodEnd: new Date(now + 364 * DAY),
  trialEndsAt: null,
  cancelAtPeriodEnd: false,
  firstInvoicePaidAt: null,
  researchSessionsOverride: null,
  portraitsOverride: null,
  seatsOverride: null,
});

beforeAll(async () => {
  // The first import compiles the page and everything it reaches; done once, outside any test's time limit.
  await import('./page');
}, 60_000);

beforeEach(() => {
  delete process.env.DF_DISABLED_FEATURES;
  delete process.env.DF_FIRST_DOUGHNUT;
  subscription = null;
  role = 'owner';
  runGoing = false;
  tenantName = 'City of Ithaca';
  seats = { limit: 3, members: 1, pending: 0, left: 2 };
  stageFacts = null;
});
afterEach(() => vi.clearAllMocks());

describe('/start before the place is named', () => {
  it('shows the four steps, in order, with the first to do now', async () => {
    const html = await page();
    expect(headings(html, 'h1')).toEqual(['Make a doughnut for where you live']);
    expect(headings(html, 'h2')).toEqual([...START_STEPS]);
    expect(START_STEPS).toEqual(['Name the place', 'What do you already have?', 'We make your doughnut', 'Look it over together']);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(step(html, 1)).toContain('aria-current="step"');
    expect(step(html, 1)).toContain('Step 1 of 4');
  });

  it('step one is the form: a place, where it is, and one button', async () => {
    const one = step(await page(), 1);
    expect(one).toContain('>Place</span>');
    expect(one).toContain('A city, town or county');
    expect(one).toContain('State / country');
    expect(one).toMatch(/<button[^>]*>Save and continue<\/button>/);
  });

  it('describes every way in without linking it, since none exists for the place yet', async () => {
    const two = step(await page(), 2);
    for (const route of DOUGHNUT_ROUTES) {
      expect(two).toContain(route.title);
      expect(two).toContain(route.description);
    }
    expect(two).not.toContain('href=');
    expect(two).toContain('You can choose once the place is named.');
  });

  it('says how many people a new group can invite, from the setup limit, and advertises no prices', async () => {
    const html = await page();
    expect(step(html, 4)).toContain(`Invite up to ${FREE_SETUP_LIMITS.seats - 1} people to check every number with you.`);
    expect(html).not.toContain('/pricing');
    expect(html).not.toMatch(/\$\d/);
  });
});

describe('/start for a portrait just created', () => {
  it('shows the same four steps, in order, with the first done', async () => {
    const html = await page({ portrait: 'ithaca' });
    expect(headings(html, 'h1')).toEqual(['Make a doughnut for City of Ithaca']);
    expect(headings(html, 'h2')).toEqual([...START_STEPS]);
    const one = step(html, 1);
    expect(one).toContain('Done');
    expect(one).toContain('City of Ithaca, NY, USA, is set up.');
    expect(one).toContain('href="/ithaca/admin/settings"');
    expect(step(html, 2)).toContain('aria-current="step"');
    // The payment section sits inside step three, below its heading.
    expect(step(html, 3)).toContain('How the research is paid for');
  });

  it('links every way in to its page for this portrait', async () => {
    const two = step(await page({ portrait: 'ithaca' }), 2);
    for (const route of DOUGHNUT_ROUTES) {
      expect(two).toContain(`href="${routeHref(route, 'ithaca')}"`);
      expect(two).toContain(`>${route.title}</a>`);
    }
    expect(two).not.toContain('You can choose once the place is named.');
  });

  it('without research: step three links every way in that needs none', async () => {
    const three = step(await page({ portrait: 'ithaca' }), 3);
    expect(three).toContain('You don\'t have to wait for research.');
    expect(routesWithoutResearch().length).toBeGreaterThan(0);
    for (const route of routesWithoutResearch()) {
      expect(three).toContain(`href="${routeHref(route, 'ithaca')}"`);
    }
  });

  it('with research ready to run, or under way: no such detour', async () => {
    subscription = cityPlan();
    expect(step(await page({ portrait: 'ithaca' }), 3)).not.toContain('have to wait for research');
    subscription = null;
    runGoing = true;
    const three = step(await page({ portrait: 'ithaca' }), 3);
    expect(three).toContain('Follow the run');
    expect(three).not.toContain('have to wait for research');
  });

  it('the last step opens the admin page, and the draft once research has been applied', async () => {
    let four = step(await page({ portrait: 'ithaca' }), 4);
    expect(four).toContain('href="/ithaca/admin?welcome=1"');
    expect(four).toContain('Open the admin page for City of Ithaca');
    expect(four).not.toContain('/ithaca/admin/draft');
    runGoing = true;
    four = step(await page({ portrait: 'ithaca' }), 4);
    expect(four).toContain('href="/ithaca/admin/draft"');
  });

  it('says how many more people can be invited, and where', async () => {
    let four = step(await page({ portrait: 'ithaca' }), 4);
    expect(four).toContain('You can invite 2 more people. Send the invitations from the');
    expect(four).toContain('href="/ithaca/admin/members"');

    seats = { limit: 3, members: 2, pending: 0, left: 1 };
    four = step(await page({ portrait: 'ithaca' }), 4);
    expect(four).toContain('You can invite 1 more person.');

    seats = { limit: 3, members: 2, pending: 1, left: 0 };
    four = step(await page({ portrait: 'ithaca' }), 4);
    expect(four).toContain('All 3 seats are taken, counting 1 invitation not yet accepted. To invite someone else, remove someone or cancel an invitation on the');
    expect(four).not.toContain('You can invite');
  });

  it('tells an editor, who cannot invite, that an owner can', async () => {
    role = 'editor';
    const html = await page({ portrait: 'ithaca' });
    expect(step(html, 4)).toContain('2 more people can join. An owner of City of Ithaca can invite them from the');
    // Only owners change the settings; the link is not offered to an editor.
    expect(step(html, 1)).not.toContain('/admin/settings');
    seats = { limit: 3, members: 3, pending: 0, left: 0 };
    expect(step(await page({ portrait: 'ithaca' }), 4)).toContain(
      'All 3 seats are taken. To invite someone else, an owner can remove someone or cancel an invitation',
    );
  });

  it('tells a viewer what they can do instead of showing steps they cannot take', async () => {
    role = 'viewer';
    const html = decode(await page({ portrait: 'ithaca' }));
    expect(headings(html, 'h1')).toEqual(['Make a doughnut for City of Ithaca']);
    expect(headings(html, 'h2')).toEqual([]);
    expect(html).toContain('only its editors and owners can add to its doughnut or start research');
    expect(html).toContain('href="/ithaca/admin"');
    expect(html).not.toContain('data-blocked');
  });

  it('sends anyone without a role, or an unknown address, to the plain start page', async () => {
    role = null;
    expect(await visit({ portrait: 'ithaca' })).toEqual({ redirect: '/start' });
    role = 'owner';
    expect(await visit({ portrait: 'nowhere' })).toEqual({ redirect: '/start' });
  });

  it('a very long name wraps instead of widening the page', async () => {
    tenantName = `Unified Government of ${'Athens-Clarke'.repeat(12)} County`;
    const html = await page({ portrait: 'ithaca' });
    expect(html).toMatch(/<h1 class="[^"]*break-words[^"]*">Make a doughnut for Unified Government/);
    // Every step's box may shrink below its content's width, and its text breaks.
    expect(html.match(/<li[^>]*class="min-w-0 /g)).toHaveLength(4);
    expect(html.match(/<div class="mt-2 break-words">/g)).toHaveLength(4);

    // Someone who may only look sees the name three times, all inside one box whose text breaks.
    for (const looker of ['viewer', 'moderator'] as const) {
      role = looker;
      const below = await page({ portrait: 'ithaca' });
      expect(below).toMatch(/<main[^>]*><div class="break-words"><h1[^>]*>Make a doughnut for Unified Government/);
      expect(below.match(/Unified Government/g)).toHaveLength(3);
      expect(below.endsWith('</div></main>')).toBe(true);
    }
  });
});

describe('/start for a portrait: where it stands, and the markers following it', () => {
  const box = (html: string) => {
    const from = html.indexOf('data-where-it-stands');
    return from < 0 ? '' : decode(html.slice(from, html.indexOf('</div>', from)));
  };
  const markers = (html: string) =>
    [1, 2, 3, 4].map((n) => {
      const s = step(html, n);
      return s.includes('aria-current="step"') ? 'current' : s.includes('Done') && s.indexOf('Done') < s.indexOf('<h2') ? 'done' : 'upcoming';
    });
  const run = (id: string, status: string) => ({ id, status, appliedAt: new Date() });
  const blank: StageFacts = { isPublic: false, runs: [], awaitingReview: 0, drafts: 0, addedByGroup: false };

  it('just created: Draft, next is step two, and step two is the one to do now', async () => {
    const html = await page({ portrait: 'ithaca' });
    expect(box(html)).toContain('<span class="font-medium">Where it stands:</span>');
    expect(box(html)).toMatch(/data-stage="draft">Draft<\/strong> Nothing has been added yet, and nothing is public\./);
    expect(box(html)).toContain('<strong>Next:</strong> <a class="underline" href="#step-2">Add what you already have, or start the research</a>');
    // The link lands on step two's heading.
    expect(html).toContain('<h2 id="step-2"');
    expect(markers(html)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    // Before the steps, and not a heading of its own: the page's headings stay its four steps.
    expect(html.indexOf('data-where-it-stands')).toBeLessThan(html.indexOf('aria-labelledby="step-1"'));
    expect(headings(html, 'h2')).toEqual([...START_STEPS]);
  });

  it('research under way: Being researched, and step three is the one under way', async () => {
    runGoing = true;
    const html = await page({ portrait: 'ithaca' });
    expect(box(html)).toMatch(/data-stage="researching">Being researched<\/strong> Research is under way\./);
    expect(box(html)).toContain('href="/ithaca/admin/research/run-1">Follow the research</a>');
    expect(markers(html)).toEqual(['done', 'done', 'current', 'upcoming']);
  });

  it('findings to review: Waiting for review, and looking it over is the step now', async () => {
    stageFacts = { ...blank, runs: [run('run-1', 'complete')], awaitingReview: 5 };
    const html = await page({ portrait: 'ithaca' });
    expect(box(html)).toMatch(/data-stage="review">Waiting for review<\/strong> Nothing is public yet\. 5 topics have research findings to review\./);
    expect(box(html)).toContain('href="/ithaca/admin/review">Review the research findings</a>');
    expect(markers(html)).toEqual(['done', 'done', 'done', 'current']);
  });

  it('public with a newer draft: Public, then review the newer draft, back on step four', async () => {
    stageFacts = { ...blank, isPublic: true, runs: [run('run-1', 'complete')], drafts: 1, addedByGroup: true };
    const html = await page({ portrait: 'ithaca' });
    expect(box(html)).toMatch(/data-stage="public">Public<\/strong> Anyone can see the published topics\./);
    expect(box(html)).toContain('href="/ithaca/admin/review">Review the newer draft and publish it</a>');
    expect(markers(html)).toEqual(['done', 'done', 'done', 'current']);
    // It no longer says the portrait is private.
    expect(html).not.toContain('Private until your group publishes it.');
  });

  it('public with nothing waiting: every step done, none to do now', async () => {
    stageFacts = { ...blank, isPublic: true, runs: [run('run-1', 'complete')], addedByGroup: true };
    const html = await page({ portrait: 'ithaca' });
    expect(box(html)).toContain('href="/ithaca">See the doughnut as visitors do</a>');
    expect(markers(html)).toEqual(['done', 'done', 'done', 'done']);
    expect(html).not.toContain('aria-current="step"');
  });

  it('a very long name: the box breaks its text too', async () => {
    tenantName = `Unified Government of ${'Athens-Clarke'.repeat(12)} County`;
    const html = await page({ portrait: 'ithaca' });
    expect(html).toMatch(/<div class="[^"]*break-words[^"]*" data-where-it-stands="">/);
  });
});

describe('the steps when there is nothing to list', () => {
  it('step two with no way in registered points to the next step, promising no research', () => {
    const html = decode(render(createElement(WhatYouHave, { routes: [], tenantSlug: 'ithaca' })));
    expect(html).toContain("You don't need anything to start. The next step says how the numbers for your doughnut are found.");
    // Research may not be able to run; step three says so and what to do instead.
    expect(html).not.toMatch(/look up|research/i);
    expect(html).not.toContain('<ul');
  });

  it('step three with no way in that needs no research points to the last step', () => {
    const html = decode(render(createElement(WithoutResearch, { routes: [], tenantSlug: 'ithaca' })));
    expect(html).toContain('Meanwhile you can invite your group and look the portrait over together, in the next step.');
    expect(html).not.toContain('<ul');
  });
});
