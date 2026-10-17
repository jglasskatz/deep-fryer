import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { localeInfo, type Locale } from '@/lib/i18n/locales';
import { messagesFor } from '@/lib/i18n/messages';
import { localizeHref } from '@/lib/i18n/routing';
import type { PublishedPortrait } from '@/lib/portrait';

/**
 * The embed (an iframe on a city's own site): never indexed, canonical to
 * the portrait in the embed's language, carrying the Doughnut's credit (it
 * has no site footer), and the "Sample data" notice when the portrait is
 * seeded. The request, the portrait and its mark are stubbed.
 */

vi.stubGlobal('React', React);

let locale: Locale = 'en';
let sample = false;
const portrait: PublishedPortrait = {
  tenant: { slug: 'ithaca', name: 'City of Ithaca', region: 'NY, USA', population: 32000, description: null, branding: null },
  dimensions: [],
};
vi.mock('@/lib/i18n/server', () => ({
  getI18n: vi.fn(async () => ({
    locale,
    info: localeInfo(locale),
    m: messagesFor('en'),
    href: (path: string) => localizeHref(locale, path),
  })),
}));
vi.mock('@/lib/data', () => ({ getPortrait: vi.fn(async (slug: string) => (slug === 'ithaca' ? portrait : null)) }));
vi.mock('@/lib/embed-policy', () => ({ embedOriginsFor: vi.fn(async () => []) }));
vi.mock('@/lib/sample-data', () => ({ portraitSampleData: vi.fn(async () => sample) }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  appUrl: () => 'https://doughnut.example.gov',
}));

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const params = Promise.resolve({ tenant: 'ithaca' });

async function embed(): Promise<string> {
  const { default: EmbedPage } = await import('./page');
  const element = await EmbedPage({ params, searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element));
}

describe('the embed page', () => {
  beforeEach(() => {
    locale = 'en';
    sample = false;
  });

  it('is never indexed, and names the portrait — in the embed’s language — as canonical', async () => {
    const { generateMetadata } = await import('./page');
    let metadata = await generateMetadata({ params });
    expect(metadata.robots).toMatchObject({ index: false });
    expect(metadata.alternates).toEqual({ canonical: 'https://doughnut.example.gov/ithaca' });
    locale = 'es';
    metadata = await generateMetadata({ params });
    expect(metadata.alternates).toEqual({ canonical: 'https://doughnut.example.gov/es/ithaca' });
  });

  it('carries the Doughnut credit itself, opening its link in a new tab', async () => {
    const html = await embed();
    expect(html).toContain('Kate Raworth and Christian Guthier');
    expect(html).toMatch(/<a[^>]*href="https:\/\/creativecommons.org\/licenses\/by-sa\/4.0\/"[^>]*target="_blank"/);
    expect(html).toContain('not affiliated with or endorsed by Doughnut Economics Action Lab');
  });

  it('labels a seeded portrait as sample data, and only a seeded one', async () => {
    expect(await embed()).not.toContain(messagesFor('en').sampleData.title);
    sample = true;
    const html = await embed();
    expect(html).toContain(messagesFor('en').sampleData.title);
    expect(html).toContain('The figures for City of Ithaca on this site were generated');
  });
});
