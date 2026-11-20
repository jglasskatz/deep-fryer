import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { Role } from '@deep-fryer/core';
import type { StageFacts } from '@/lib/portrait-stage';

/**
 * The admin home's "Where your doughnut stands": always shown, above the
 * getting-started checklist, with the stage in words and the next thing to
 * do — a link for editors and owners, and for anyone below, who does it.
 * The portrait, its data and the person are stubbed; the stage and its
 * words come from the real portraitStage.
 */
vi.stubGlobal('React', React);

let role: Role = 'editor';
let tenantName = 'City of Ithaca';
let facts: StageFacts;
let welcome: string | undefined;

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/lib/admin-guard', () => ({
  requireAdminPage: vi.fn(async () => ({
    tenant: { id: 't-1', slug: 'ithaca', name: tenantName, organizationId: 'o-1', embedOrigins: [] },
    role,
    devMode: false,
  })),
}));
vi.mock('@/lib/admin-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-data')>()),
  tenantDimensions: vi.fn(async () => []),
  tenantConfigMap: vi.fn(async () => ({})),
  tenantRuns: vi.fn(async () => []),
  recentAudit: vi.fn(async () => []),
  commentCounts: vi.fn(async () => new Map()),
  stalenessOverview: vi.fn(() => []),
}));
vi.mock('@/lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features')>()),
  portraitFeaturesById: vi.fn(async () => ({})),
}));
vi.mock('@/lib/discussion', () => ({ countHeldComments: vi.fn(async () => 0) }));
vi.mock('@/lib/involvement-admin', () => ({ countNewSubmissions: vi.fn(async () => 0) }));
vi.mock('@/lib/member-data', () => ({
  tenantMembersList: vi.fn(async () => []),
  organizationMembersList: vi.fn(async () => []),
}));
vi.mock('@/lib/portrait-stage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/portrait-stage')>()),
  portraitStageFacts: vi.fn(async () => facts),
}));
vi.mock('@/lib/billing', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/billing')>();
  const { standing } = await import('@deep-fryer/core');
  return {
    ...real,
    billingSummary: vi.fn(async () => ({
      subscription: null,
      plan: null,
      standing: standing(null),
      blockedMessage: null,
      limits: null,
      usage: { researchSessions: 0, researchSessionsOnKey: 0, portraits: 1, seats: 1 },
      apiKey: null,
      researchApplied: false,
      firstDoughnutNote: null,
    })),
  };
});

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const decode = (html: string) => html.replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&');

async function adminHome(): Promise<string> {
  const { default: Page } = await import('./page');
  const element = await Page({ params: Promise.resolve({ tenant: 'ithaca' }), searchParams: Promise.resolve({ welcome }) });
  return decode(renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element)));
}
/** The "Where your doughnut stands" section's markup. */
const standing = (html: string) => {
  const from = html.indexOf('<section class="mt-6 rounded-lg border border-black/15 p-4" aria-labelledby="where-it-stands">');
  return from < 0 ? '' : html.slice(from, html.indexOf('</section>', from));
};
const run = (id: string, status: string) => ({ id, status, appliedAt: new Date() });

beforeAll(async () => {
  // The first import compiles the page and everything it reaches; done once, outside any test's time limit.
  await import('./page');
}, 60_000);

beforeEach(async () => {
  const { BLANK_FACTS } = await import('@/lib/portrait-stage');
  facts = BLANK_FACTS;
  role = 'editor';
  tenantName = 'City of Ithaca';
  welcome = undefined;
  delete process.env.DF_DISABLED_FEATURES;
  const { resetDeploymentDisabledForTests } = await import('@/lib/features');
  resetDeploymentDisabledForTests();
});

describe('the admin home: where the doughnut stands', () => {
  it('a blank portrait: Draft, and where to add what the group has, above the checklist', async () => {
    const html = await adminHome();
    const box = standing(html);
    expect(box).toContain('<h2 id="where-it-stands" class="text-base font-semibold">Where your doughnut stands</h2>');
    expect(box).toContain('<span class="sr-only">Stage: </span>');
    expect(box).toMatch(/data-stage="draft">Draft<\/strong> Nothing has been added yet, and nothing is public\./);
    expect(box).toContain('<strong>Next:</strong> <a class="underline" href="/start?portrait=ithaca">Add what you already have, or start the research</a>');
    // Above the getting-started checklist.
    expect(html.indexOf('where-it-stands')).toBeLessThan(html.indexOf('getting-started'));
  });

  it('research under way: Being researched, and a link to follow it', async () => {
    facts = { ...facts, runs: [run('r-1', 'running')] };
    const box = standing(await adminHome());
    expect(box).toMatch(/data-stage="researching">Being researched<\/strong> Research is under way\./);
    expect(box).toContain('href="/ithaca/admin/research/r-1">Follow the research</a>');
  });

  it('findings waiting: Waiting for review, with how many topics, and the review queue', async () => {
    facts = { ...facts, runs: [run('r-1', 'complete')], awaitingReview: 21 };
    const box = standing(await adminHome());
    expect(box).toMatch(/data-stage="review">Waiting for review<\/strong> Nothing is public yet\. 21 topics have research findings to review\./);
    expect(box).toContain('href="/ithaca/admin/review">Review the research findings</a>');
  });

  it('a published portrait with a newer draft reads Public, then review the newer draft', async () => {
    facts = { ...facts, isPublic: true, runs: [run('r-1', 'complete')], drafts: 1, addedByGroup: true };
    const box = standing(await adminHome());
    expect(box).toMatch(/data-stage="public">Public<\/strong> Anyone can see the published topics\./);
    expect(box).toContain('href="/ithaca/admin/review">Review the newer draft and publish it</a>');
  });

  it('stays once the checklist has gone', async () => {
    facts = { ...facts, isPublic: true, runs: [run('r-1', 'complete')] };
    const html = await adminHome();
    expect(standing(html)).toContain('href="/ithaca">See the doughnut as visitors do</a>');
  });

  it('tells a viewer who does the next step, with no link to a page they cannot open', async () => {
    role = 'viewer';
    facts = { ...facts, runs: [run('r-1', 'complete')], awaitingReview: 3 };
    const box = standing(await adminHome());
    expect(box).toContain('data-stage="review">Waiting for review</strong>');
    expect(box).toContain('<strong>Next:</strong> Its editors and owners review the research findings.');
    expect(box).not.toContain('<a ');
  });

  it('without a self-serve start, a blank portrait begins on the research page', async () => {
    process.env.DF_DISABLED_FEATURES = 'self_serve';
    const { resetDeploymentDisabledForTests } = await import('@/lib/features');
    resetDeploymentDisabledForTests();
    const box = standing(await adminHome());
    expect(box).toContain('href="/ithaca/admin/research">Plan the first research</a>');
    expect(box).not.toContain('/start');
  });
});
