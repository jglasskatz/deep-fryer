import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';

/**
 * The admin home and the research page, where the deployment lets a
 * group's own key pay for its first doughnut (DF_FIRST_DOUGHNUT=own): what
 * they say about it, in place of the plan's standing, and whether it is said
 * as an alert. The portrait, its data and the person are stubbed; the
 * billing summary's words come from the real firstDoughnutRoute.
 */
vi.stubGlobal('React', React);

/** The organization's state: a key on file, research applied once already. */
let keyOnFile = false;
let researchApplied = false;
/** The deployment's choice, as firstDoughnutRoute reads it. */
let choice: 'paid' | 'own' = 'own';

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/components/admin/NewRunForm', () => ({ NewRunForm: () => null }));
vi.mock('@/components/admin/AutoRefresh', () => ({ AutoRefresh: () => null }));
vi.mock('@/lib/admin-guard', () => ({
  requireAdminPage: vi.fn(async () => ({
    tenant: { id: 't-1', slug: 'ithaca', name: 'City of Ithaca', organizationId: 'o-1', embedOrigins: [] },
    role: 'editor',
    devMode: false,
  })),
}));
vi.mock('@/lib/admin-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-data')>()),
  tenantDimensions: vi.fn(async () => []),
  tenantConfigMap: vi.fn(async () => ({})),
  tenantRuns: vi.fn(async () => []),
  tenantRunSessionIds: vi.fn(async () => new Map()),
  recentAudit: vi.fn(async () => []),
  commentCounts: vi.fn(async () => new Map()),
  stalenessOverview: vi.fn(() => []),
}));
vi.mock('@/lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features')>()),
  portraitFeaturesById: vi.fn(async () => ({})),
}));
vi.mock('@/lib/discussion', () => ({ countHeldComments: vi.fn(async () => 0) }));
// Where the doughnut stands reads the database; a blank portrait here.
vi.mock('@/lib/portrait-stage', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/portrait-stage')>();
  return { ...real, portraitStageFacts: vi.fn(async () => real.BLANK_FACTS) };
});
vi.mock('@/lib/involvement-admin', () => ({ countNewSubmissions: vi.fn(async () => 0) }));
vi.mock('@/lib/member-data', () => ({
  tenantMembersList: vi.fn(async () => []),
  organizationMembersList: vi.fn(async () => []),
}));
vi.mock('@/lib/billing', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/billing')>();
  const { standing, standingMessage } = await import('@deep-fryer/core');
  return {
    ...real,
    billingSummary: vi.fn(async () => {
      const s = standing(null);
      const route = real.firstDoughnutRoute({ subscription: null, researchApplied, keyOnFile }, choice);
      return {
        subscription: null,
        plan: null,
        standing: s,
        blockedMessage: standingMessage(s.reason),
        limits: null,
        usage: { researchSessions: 0, researchSessionsOnKey: 0, portraits: 1, seats: 1 },
        apiKey: keyOnFile
          ? { provider: 'anthropic', keyHint: 'Ab12', createdBy: null, createdAt: new Date(), validatedAt: new Date() }
          : null,
        researchApplied,
        firstDoughnutNote: route.note,
      };
    }),
  };
});

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const render = (element: React.ReactElement) =>
  renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element));

async function adminHome(): Promise<string> {
  const { default: Page } = await import('./page');
  return render(await Page({ params: Promise.resolve({ tenant: 'ithaca' }), searchParams: Promise.resolve({}) }));
}
async function researchPage(): Promise<string> {
  const { default: Page } = await import('./research/page');
  return render(await Page({ params: Promise.resolve({ tenant: 'ithaca' }) }));
}

/** The text of every role="alert" paragraph on the page. */
const alerts = (html: string) => [...html.matchAll(/<p role="alert"[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]);

const CHOOSE = /Choose a plan to build your doughnut/;

describe('the first-doughnut note on the admin pages', () => {
  beforeEach(() => {
    keyOnFile = false;
    researchApplied = false;
    choice = 'own';
  });

  for (const [name, page] of [
    ['admin home', adminHome],
    ['research page', researchPage],
  ] as const) {
    describe(name, () => {
      it('under paid: the plan’s standing, as an alert, as before', async () => {
        choice = 'paid';
        keyOnFile = true;
        const html = await page();
        expect(alerts(html)).toEqual([expect.stringMatching(CHOOSE)]);
        expect(html).not.toContain('first doughnut');
      });

      it('under own, no key yet: what to do first, as an alert', async () => {
        const html = await page();
        expect(alerts(html)).toEqual([expect.stringMatching(/^Your first doughnut can be built on your organization’s own Anthropic API key, with no plan: an organization owner adds the key under Billing/)]);
        expect(html).not.toMatch(CHOOSE);
      });

      it('under own, key on file: the first doughnut can be built, said as information, not an alert', async () => {
        keyOnFile = true;
        const html = await page();
        expect(alerts(html)).toEqual([]);
        expect(html).toContain('Your first doughnut can be built on your organization’s own Anthropic API key, with no plan, as one full build');
        expect(html).not.toMatch(CHOOSE);
      });

      it('under own, first doughnut started: says so as information, never “choose a plan to build”', async () => {
        keyOnFile = true;
        researchApplied = true;
        const html = await page();
        expect(alerts(html)).toEqual([]);
        expect(html).toContain('Your first doughnut has been started. More research after it needs a plan or a contract');
        expect(html).not.toMatch(CHOOSE);
      });
    });
  }
});
