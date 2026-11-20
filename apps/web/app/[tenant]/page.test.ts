import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { localeInfo } from '@/lib/i18n/locales';
import { en } from '@/lib/i18n/messages/en';
import { localizeHref } from '@/lib/i18n/routing';
import type { Family } from '@/lib/family';
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
let family: Family | null = null;
vi.mock('@/lib/family', () => ({ familyForTenant: vi.fn(async () => family) }));
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

describe('a portrait’s front page: summary chips and shortcut keys', () => {
  beforeEach(() => {
    sample = false;
    family = null;
    portrait.dimensions = [];
  });

  it('shows the chips above the doughnut, counted from its dimensions', async () => {
    const dim = (slug: string, viz_level: number | null, order: number) => ({
      slug,
      ring: 'social' as const,
      canonical_slug: null,
      display_order: order,
      viz_level,
      data: { name: slug, icon: '', description: '', context: '', indicators: [], actions: [] },
      published_at: null,
      version_num: 1,
    });
    portrait.dimensions = [dim('food', -40, 0), dim('health', 20, 1), dim('housing', 130, 2), dim('energy', 35, 3)];
    const html = await frontPage();
    const chips = html.slice(html.indexOf('aria-label="At a glance"'), html.indexOf('<canvas'));
    expect(chips).toContain('1 thriving');
    expect(chips).toContain('2 need attention');
    expect(chips).toContain('1 critical');
    expect(chips).not.toContain('without data');
  });

  it('gives the doughnut number keys for each portrait of its family, and only "d" to one that stands alone', async () => {
    const alone = /<canvas[^>]*>/.exec(await frontPage())?.[0] ?? '';
    expect(alone).toContain('tabindex="0"');
    expect(alone).toContain('aria-keyshortcuts="D"');

    family = {
      organization: { id: 'o1', slug: 'santa-cruz', name: 'Santa Cruz Doughnut', languageHelp: null },
      members: [
        { slug: 'ithaca', name: 'City of Ithaca', short: 'ITH' },
        { slug: 'tompkins', name: 'Tompkins County', short: 'TC' },
      ],
      whole: null,
      noun: 'portrait',
    };
    const html = await frontPage();
    expect(/<canvas[^>]*>/.exec(html)?.[0]).toContain('aria-keyshortcuts="D 2"');
    expect(html).toContain(
      'Press D to switch between light and dark. Press a number to open another portrait: 2 for Tompkins County.',
    );
  });
});
