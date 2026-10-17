import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { localeInfo } from '@/lib/i18n/locales';
import { en } from '@/lib/i18n/messages/en';
import { localizeHref } from '@/lib/i18n/routing';
import type { ProgressRow, TenantProgress } from '@/lib/progress';

/**
 * A portrait's public progress page, and its CSV twin, for a portrait seeded
 * with synthetic values (scripts/seed-demo-data.ts publishes three years of
 * them so every status shows): the page says "Sample data — not research"
 * under its heading, before any count, and every CSV row carries the mark,
 * since a CSV travels without the page. A researched portrait carries
 * neither. Which portraits are marked is lib/sample-data.ts's question
 * (tested against the database there); here it is stubbed.
 */
vi.stubGlobal('React', React);

let sample = false;
const row = {
  dimensionSlug: 'housing',
  dimensionName: 'Housing',
  ring: 'social',
  displayOrder: 1,
  indicator: 'Rent-burdened households',
  unit: '%',
  thresholdRef: null,
  rationale: null,
  source: 'ACS',
  sourceUrl: 'https://data.census.gov',
  geographicScale: 'city',
  series: [
    { year: 2023, value: 40 },
    { year: 2026, value: 46 },
  ],
  baseline: { year: 2023, value: 40 },
  baselineIsFallback: false,
  current: { year: 2026, value: 46 },
  target: 30,
  targetYear: 2030,
  direction: 'lower_is_better',
  changeSinceBaseline: 6,
  expectedNow: 34,
  requiredAnnualChange: -4,
  status: 'worsening',
} as unknown as ProgressRow;
const progress = {
  tenant: { slug: 'ithaca', name: 'City of Ithaca' },
  config: { baseline_year: 2023, baseline_label: '2023' },
  rows: [row],
  gaps: [],
} as unknown as TenantProgress;

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/components/progress/ProgressTable', () => ({ ProgressTable: () => null }));
// An async server component (it reads the request's catalog itself), which a static render cannot await.
vi.mock('@/components/progress/StatusChip', () => ({ StatusChip: ({ status }: { status: string }) => status }));
vi.mock('@/lib/progress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/progress')>()),
  tenantProgress: vi.fn(async () => progress),
}));
vi.mock('@/lib/sample-data', () => ({ portraitSampleData: vi.fn(async () => sample) }));
vi.mock('@/lib/i18n/server', () => ({
  getI18n: vi.fn(async () => ({ locale: 'en', info: localeInfo('en'), m: en, href: (p: string) => localizeHref('en', p) })),
}));

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function progressPage(): Promise<string> {
  const { default: ProgressPage } = await import('./page');
  const element = await ProgressPage({ params: Promise.resolve({ tenant: 'ithaca' }) });
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element));
}

describe('a portrait’s progress page and sample data', () => {
  beforeEach(() => {
    sample = false;
  });

  it('says "Sample data — not research" under the heading of a seeded portrait, before any status count', async () => {
    sample = true;
    const html = await progressPage();
    const notice = html.indexOf(en.sampleData.title);
    expect(notice).toBeGreaterThan(html.indexOf('</h1>'));
    expect(notice).toBeLessThan(html.indexOf(`aria-label="${en.progress.summary}"`));
    expect(html).toContain('The figures for City of Ithaca on this site were generated to demonstrate the software.');
  });

  it('carries no notice on a researched portrait', async () => {
    expect(await progressPage()).not.toContain(en.sampleData.title);
  });

  it('marks every CSV row of a seeded portrait, and none of a researched one', async () => {
    const { progressCsv } = await import('@/lib/progress');
    const [header, ...rows] = progressCsv(progress, { sampleData: true }).trim().split(/\r?\n/);
    expect(header!.split(',').at(-1)).toBe('sample_data');
    expect(rows).toHaveLength(1);
    expect(rows.every((r) => r.endsWith(',true'))).toBe(true);
    expect(progressCsv(progress).trim().split(/\r?\n/)[1]).toMatch(/,false$/);
  });
});
