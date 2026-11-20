import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Indicator } from '@deep-fryer/core';
import { localeInfo } from '@/lib/i18n/locales';
import { ALL_CATALOGS } from '@/lib/i18n/messages';
import { en } from '@/lib/i18n/messages/en';
import { es } from '@/lib/i18n/messages/es';
import { localizeHref } from '@/lib/i18n/routing';
import type { PublishedPortrait } from '@/lib/portrait';

/**
 * A dimension page as a visitor gets it: each figure says how sure the
 * research is of it ("confidence: high"), and its source snapshot is a
 * thumbnail that enlarges in place, while staying a plain link to the image
 * for a reader without JavaScript. The page's data sources are stubbed; the
 * page itself is rendered as Next renders it on the server.
 */

vi.stubGlobal('React', React);

const indicator = (over: Partial<Indicator>): Indicator => ({
  name: 'Rent-burdened renter households',
  value: 61.2,
  unit: '%',
  year: 2023,
  target: 30,
  source: 'American Community Survey',
  source_url: 'https://data.census.gov/',
  confidence: 'high',
  geographic_scale: 'city',
  ...over,
});

const portrait: PublishedPortrait = {
  tenant: { slug: 'santacruz', name: 'City of Santa Cruz', region: 'CA, USA', population: 62000, description: null, branding: null },
  dimensions: [
    {
      slug: 'housing',
      ring: 'social',
      canonical_slug: null,
      display_order: 7,
      viz_level: 120,
      published_at: '2026-11-01T00:00:00Z',
      version_num: 3,
      data: {
        name: 'Housing',
        icon: '',
        description: '',
        context: '',
        actions: [],
        indicators: [
          indicator({ evidence: { snapshot_path: 'housing/acs.png', captured_at: '2026-09-30T14:02:00Z' } }),
          indicator({ name: 'Unhoused residents', value: 1800, unit: 'people', confidence: 'low' }),
          // A record from before confidence was required.
          indicator({ name: 'Overcrowded homes', confidence: undefined as never }),
        ],
      },
    },
  ],
};

let locale: 'en' | 'es' = 'en';
vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/lib/data', () => ({
  getPortrait: vi.fn(async () => portrait),
  evidenceUrl: (slug: string, path: string) => `/files/${slug}/${path}`,
  hasDatabase: () => false,
}));
vi.mock('@/lib/features', () => ({
  portraitFeatures: vi.fn(async () => ({ involvement: false, discussion: false })),
}));
vi.mock('@/lib/auth', () => ({
  getAuth: vi.fn(async () => ({ userId: null, devMode: false })),
  getRole: vi.fn(async () => null),
  roleAtLeast: () => false,
}));
vi.mock('@/lib/involvement', () => ({
  involvementView: vi.fn(async () => null),
  formDimensionOptions: () => [],
  isFrameworkDimension: () => true,
}));
vi.mock('@/lib/discussion', () => ({ dimensionForPublicSlug: vi.fn(), dimensionThread: vi.fn() }));
vi.mock('@/lib/form-token', () => ({ issueFormToken: () => 'token' }));
vi.mock('@/lib/sample-data', () => ({ portraitSampleData: vi.fn(async () => false) }));
vi.mock('@/lib/i18n/server', () => ({
  getI18n: vi.fn(async () => ({
    locale,
    info: localeInfo(locale),
    m: ALL_CATALOGS[locale],
    href: (path: string) => localizeHref(locale, path),
  })),
}));

async function dimensionPage(): Promise<string> {
  const { default: Page } = await import('./page');
  const element = await Page({
    params: Promise.resolve({ tenant: 'santacruz', slug: 'housing' }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(element);
}

/** Each indicator card's line under its value (year, target, scale, confidence). */
function metaLines(html: string): string[] {
  return [...html.matchAll(/<p class="mt-1 text-sm text-\[color:var\(--color-muted\)\]">([^<]*)<\/p>/g)]
    .map((m) => m[1]!)
    .filter((line) => line.includes('target'));
}

describe('a dimension page’s indicator details', () => {
  it('shows each indicator’s confidence after its year, target and scale', async () => {
    locale = 'en';
    const lines = metaLines(await dimensionPage());
    expect(lines).toEqual([
      '2023 · target: 30% · city data · confidence: high',
      '2023 · target: 30 people · city data · confidence: low',
      // No confidence on record: nothing is made up.
      '2023 · target: 30% · city data',
    ]);
  });

  it('says it in the reader’s language', async () => {
    locale = 'es';
    const html = await dimensionPage();
    expect(html).toContain(`${es.dimension.confidence.replace('{value}', es.dimension.confidenceLevels.high)}`);
    locale = 'en';
  });

  it('enlarges the source snapshot in place, and still links to it without JavaScript', async () => {
    locale = 'en';
    const html = await dimensionPage();
    const src = '/files/santacruz/housing/acs.png';
    const alt = 'Snapshot of the source for Rent-burdened renter households, captured 2026-09-30';
    // The thumbnail: a link to the image that announces it opens a dialog.
    expect(html).toMatch(
      new RegExp(`<a href="${src}" target="_blank" rel="noreferrer" aria-haspopup="dialog"[^>]*><img src="${src}" alt="${alt}"`),
    );
    // The enlarged view: a closed native dialog named after the snapshot, with a Close button first.
    const dialog = /<dialog[^>]*>[\s\S]*?<\/dialog>/.exec(html)?.[0] ?? '';
    expect(dialog).toContain(`aria-label="${alt}"`);
    expect(dialog).not.toMatch(/<dialog[^>]* open/);
    expect(dialog).toContain(`>${en.dimension.snapshotClose}</button>`);
    expect(dialog).toContain(`<img src="${src}" alt="${alt}" loading="lazy"`);
    // The caption and the original document link are unchanged.
    expect(html).toContain('Source snapshot captured 2026-09-30');
    // Only the indicator with evidence has one.
    expect(html.match(/<dialog/g)).toHaveLength(1);
  });

  it('the new words exist in all twelve catalogs', () => {
    for (const [code, m] of Object.entries(ALL_CATALOGS)) {
      expect(m.dimension.confidence, code).toContain('{value}');
      for (const level of ['high', 'medium', 'low'] as const) expect(m.dimension.confidenceLevels[level].trim(), code).not.toBe('');
      expect(m.dimension.snapshotClose.trim(), code).not.toBe('');
      expect(m.doughnut.shortcutsTheme, code).toContain('D');
      expect(m.doughnut.shortcutsPortraits, code).toContain('{list}');
      expect(m.doughnut.shortcutsPortrait, code).toMatch(/\{key\}[\s\S]*\{name\}|\{name\}[\s\S]*\{key\}/);
    }
    expect(Object.keys(ALL_CATALOGS)).toHaveLength(12);
  });
});
