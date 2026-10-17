import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { localeInfo } from '@/lib/i18n/locales';
import { en } from '@/lib/i18n/messages/en';
import { localizeHref } from '@/lib/i18n/routing';
import type { PublishedPortrait } from '@/lib/portrait';

/**
 * A portrait seeded with synthetic values (scripts/seed-demo-data.ts) says
 * so on its front page — "Sample data — not research", under its heading,
 * before any number — and a researched one carries no such notice. Which
 * portraits are marked is lib/sample-data.ts's question (tested against the
 * database there); here it is stubbed, with the portrait and the request.
 */

vi.stubGlobal('React', React);

let sample = false;
const portrait: PublishedPortrait = {
  tenant: { slug: 'ithaca', name: 'City of Ithaca', region: 'NY, USA', population: 32000, description: null, branding: null },
  dimensions: [],
};
vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/lib/data', () => ({
  getPortrait: vi.fn(async () => portrait),
  evidenceUrl: (slug: string, path: string) => `/evidence/${slug}/${path}`,
  hasDatabase: () => true,
}));
vi.mock('@/lib/features', () => ({
  portraitFeatures: vi.fn(async () => ({ involvement: false, discussion: false })),
}));
vi.mock('@/lib/involvement', () => ({ involvementView: vi.fn(async () => null) }));
vi.mock('@/lib/sample-data', () => ({ portraitSampleData: vi.fn(async () => sample) }));
vi.mock('@/lib/i18n/server', () => ({
  getI18n: vi.fn(async () => ({
    locale: 'en',
    info: localeInfo('en'),
    m: en,
    href: (path: string) => localizeHref('en', path),
  })),
}));

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function frontPage(): Promise<string> {
  const { default: TenantPage } = await import('./page');
  const element = await TenantPage({ params: Promise.resolve({ tenant: 'ithaca' }), searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams() }, element),
    ),
  );
}

describe('a portrait’s front page and sample data', () => {
  beforeEach(() => {
    sample = false;
  });

  it('says "Sample data — not research" under the heading of a seeded portrait', async () => {
    sample = true;
    const html = await frontPage();
    const notice = html.indexOf(en.sampleData.title);
    expect(notice).toBeGreaterThan(html.indexOf('City of Ithaca</h1>'));
    expect(html).toContain('role="note"');
    expect(html).toContain('The figures for City of Ithaca on this site were generated to demonstrate the software.');
  });

  it('carries no notice on a researched portrait', async () => {
    const html = await frontPage();
    expect(html).not.toContain(en.sampleData.title);
    expect(html).toContain('City of Ithaca</h1>');
  });
});
