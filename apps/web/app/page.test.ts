import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { PublicPortraitSummary } from '@/lib/data';

/**
 * The landing page never links to a page that would 404 for a signed-out
 * visitor: its showcase (DF_SHOWCASE_ORG) appears only when that
 * organization has a public portrait and is built from public portraits
 * only; the directory lists the deployment's public portraits; the
 * "build your city's doughnut" call to action is there only while the
 * self_serve feature is on; and nothing offers a trial.
 *
 * What is public is stubbed (lib/data.ts publicPortraits is tested against
 * the database in lib/data.test.ts); the header is the product header's
 * own concern (SiteHeader.test.ts).
 */

vi.stubGlobal('React', React);

const ORG = (slug: string, name: string) => ({ slug, name });
let portraits: PublicPortraitSummary[] = [];
let database = true;
let disabled = new Set<string>();
let compareOn = new Set<string>();

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/lib/data', () => ({
  hasDatabase: () => database,
  publicPortraits: vi.fn(async (org?: string) =>
    org === undefined ? portraits : portraits.filter((p) => p.organization.slug === org),
  ),
}));
vi.mock('@/lib/features', () => ({
  deploymentFeatureOn: (feature: string) => !disabled.has(feature),
  portraitFeatures: vi.fn(async (slug: string) => ({ family_compare: compareOn.has(slug) })),
}));

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function landing(): Promise<{ html: string; hrefs: string[] }> {
  const { default: HomePage } = await import('./page');
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, await HomePage()));
  return { html, hrefs: [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!) };
}

const NYC = ORG('nyc', 'New York City');
const ITHACA = ORG('ithaca', 'City of Ithaca');
const portrait = (slug: string, name: string, organization: { slug: string; name: string }): PublicPortraitSummary => ({
  slug,
  name,
  region: 'NY, USA',
  organization,
});

describe('the landing page', () => {
  const saved = process.env.DF_SHOWCASE_ORG;
  beforeEach(() => {
    portraits = [];
    database = true;
    disabled = new Set();
    compareOn = new Set();
    delete process.env.DF_SHOWCASE_ORG;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DF_SHOWCASE_ORG;
    else process.env.DF_SHOWCASE_ORG = saved;
  });

  /** Every link goes to a page a signed-out visitor can open, given what is public. */
  function expectOnlyLiveLinks(hrefs: string[], live: string[]) {
    for (const href of hrefs) expect(live, `link to ${href}`).toContain(href);
  }

  it('without a showcase, lists the public portraits and links nothing else that could 404', async () => {
    portraits = [portrait('ithaca', 'Ithaca', ITHACA), portrait('manhattan', 'Manhattan', NYC)];
    const { html, hrefs } = await landing();
    expect(html).toContain('Portraits on this site');
    expectOnlyLiveLinks(hrefs, ['/start', '/pricing', '/ithaca', '/manhattan']);
    expect(hrefs).toEqual(expect.arrayContaining(['/ithaca', '/manhattan']));
    expect(html).not.toContain('See ');
    expect(hrefs).not.toContain('/santacruz');
  });

  it('shows no showcase for an organization with nothing public, and never falls back to a demo link', async () => {
    process.env.DF_SHOWCASE_ORG = 'nyc';
    portraits = [portrait('ithaca', 'Ithaca', ITHACA)];
    const { html, hrefs } = await landing();
    expect(html).not.toContain('See New York City');
    expectOnlyLiveLinks(hrefs, ['/start', '/pricing', '/ithaca']);
  });

  it('opens the showcase on the family compare only when two public portraits have it on', async () => {
    process.env.DF_SHOWCASE_ORG = 'nyc';
    portraits = [portrait('nyc', 'New York City', NYC), portrait('bronx', 'The Bronx', NYC), portrait('ithaca', 'Ithaca', ITHACA)];
    compareOn = new Set(['bronx']);
    let page = await landing();
    expect(page.html).toContain('See New York City');
    expect(page.hrefs).toContain('/o/nyc/compare');
    expectOnlyLiveLinks(page.hrefs, ['/start', '/pricing', '/o/nyc/compare', '/o/nyc/progress', '/nyc', '/bronx', '/ithaca']);
    // The rest of the deployment is still findable.
    expect(page.html).toContain('More portraits on this site');

    // Compare off: the whole-jurisdiction portrait, never a compare page that would 404.
    compareOn = new Set();
    page = await landing();
    expect(page.hrefs).not.toContain('/o/nyc/compare');
    expectOnlyLiveLinks(page.hrefs, ['/start', '/pricing', '/o/nyc/progress', '/nyc', '/bronx', '/ithaca']);
  });

  it('says so plainly when nothing is published yet', async () => {
    const { html, hrefs } = await landing();
    expect(html).toContain('No portraits have been published on this site yet.');
    expectOnlyLiveLinks(hrefs, ['/start', '/pricing']);
  });

  it('links the bundled demo portrait only when there is no database, which is when it exists', async () => {
    database = false;
    const { hrefs } = await landing();
    expect(hrefs).toContain('/santacruz');
  });

  it('invites visitors to build a doughnut only while self-serve start is on, and never offers a trial', async () => {
    portraits = [portrait('ithaca', 'Ithaca', ITHACA)];
    let page = await landing();
    expect(page.html).toContain('Build your city&#x27;s doughnut');
    expect(page.hrefs).toContain('/start');
    expect(page.html).not.toMatch(/trial/i);

    disabled = new Set(['self_serve']);
    page = await landing();
    expect(page.hrefs).not.toContain('/start');
    expect(page.html).not.toContain('Build your city');
    expect(page.html).not.toMatch(/trial/i);
  });
});
