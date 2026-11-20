import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { localeInfo } from '@/lib/i18n/locales';
import { en } from '@/lib/i18n/messages/en';
import { localizeHref } from '@/lib/i18n/routing';
import type { PublishedPortrait } from '@/lib/portrait';

/**
 * The public Get involved page, printed: the list stays, everything that is
 * only for using the page on screen (site header, the way back, the
 * dimension filter, the organization form) is left out, and each partner's
 * website is written out because a link cannot be followed on paper.
 */
vi.stubGlobal('React', React);

const portrait = {
  tenant: { slug: 'ithaca', name: 'City of Ithaca', region: null, population: null, description: null, branding: null },
  dimensions: [{ slug: 'energy', ring: 'social', canonical_slug: 'energy', display_order: 0, viz_level: 40, published_at: null, version_num: 1, data: { name: 'Energy', icon: '', description: '', context: '', indicators: [], actions: [] } }],
} as unknown as PublishedPortrait;
const listing = { id: 'l1', dimensionSlugs: ['energy'] };

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => createElement('header', null, 'SITE HEADER') }));
vi.mock('@/components/involvement/InvolvementForm', () => ({ InvolvementForm: () => createElement('form', null, 'ORG FORM') }));
vi.mock('@/components/involvement/InvolvementListings', () => ({
  InvolvementListings: () => createElement('ul', null, createElement('li', null, 'A LISTING')),
  InvolvementLanguageNote: () => null,
}));
vi.mock('@/lib/data', () => ({
  getPortrait: vi.fn(async () => portrait),
  publishedOutreachContacts: vi.fn(async () => [
    { org: 'Ithaca Energy Co-op', website: 'https://coop.example.org/join', why: 'Runs a community solar garden.', tags: ['energy'] },
    { org: 'No website group', website: 'javascript:alert(1)', why: '', tags: [] },
  ]),
}));
vi.mock('@/lib/features', () => ({ portraitFeatures: vi.fn(async () => ({ involvement: true })) }));
vi.mock('@/lib/form-token', () => ({ issueFormToken: () => 'token' }));
vi.mock('@/lib/involvement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/involvement')>()),
  involvementView: vi.fn(async () => ({ listings: [listing], timeZone: 'America/New_York' })),
  groupListingsByDimension: () => ({ dimensions: [{ slug: 'energy', listings: [listing] }], general: [] }),
}));
vi.mock('@/lib/i18n/server', () => ({
  getI18n: vi.fn(async () => ({ locale: 'en', info: localeInfo('en'), m: en, href: (p: string) => localizeHref('en', p) })),
}));

// Loaded once, outside any test's time limit: the page pulls in much of the app.
const { default: OutreachPage } = await import('./page');
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function outreachPage(): Promise<string> {
  const element = await OutreachPage({ params: Promise.resolve({ tenant: 'ithaca' }), searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element));
}

/** The class list of the nearest element opening before `marker`. */
function enclosingClasses(html: string, marker: string, tag: string): string {
  const at = html.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const open = html.lastIndexOf(`<${tag}`, at);
  return /class="([^"]*)"/.exec(html.slice(open, at))?.[1] ?? '';
}

describe('the public Get involved page in print', () => {
  it('leaves out the header, the way back, the filter and the form', async () => {
    const html = await outreachPage();
    expect(enclosingClasses(html, '<header>SITE HEADER', 'div')).toContain('print:hidden');
    expect(enclosingClasses(html, en.common.back.replace('{name}', 'City of Ithaca'), 'p')).toContain('print:hidden');
    expect(new RegExp(`<nav aria-label="${en.involvement.filterLabel}" class="([^"]*)"`).exec(html)?.[1]).toContain('print:hidden');
    expect(enclosingClasses(html, '<form>ORG FORM', 'section')).toContain('print:hidden');
  });

  it('names the portrait in the printed heading, since the header and the way back are left out', async () => {
    const html = await outreachPage();
    expect(html).toContain(`<h1 class="mt-2 text-3xl font-bold">${en.outreach.title}<span class="hidden print:inline"> · City of Ithaca</span></h1>`);
  });

  it('keeps every listing and partner in full, with each website written out', async () => {
    const html = await outreachPage();
    expect(html).toContain('A LISTING');
    expect(html).toContain('Ithaca Energy Co-op');
    expect(html).toContain('No website group');
    expect(html).not.toContain('<details');
    expect(html).toContain('<p class="hidden break-all text-sm print:block">https://coop.example.org/join</p>');
    expect(html).not.toContain('javascript:');
    for (const name of ['A LISTING', 'Ithaca Energy Co-op']) {
      expect(enclosingClasses(html, name, 'section')).not.toContain('print:hidden');
    }
  });
});
