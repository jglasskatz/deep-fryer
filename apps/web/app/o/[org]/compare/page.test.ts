import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Indicator } from '@deep-fryer/core';
import type { Family } from '@/lib/family';
import type { PublishedPortrait } from '@/lib/portrait';
import { en } from '@/lib/i18n/messages/en';

vi.stubGlobal('React', React);
vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/components/doughnut/PortraitDoughnut', () => ({ PortraitDoughnut: () => null }));
vi.mock('@/lib/features', () => ({ requireOrganizationFeature: vi.fn() }));
vi.mock('@/lib/sample-data', () => ({ anySampleData: vi.fn(async () => false) }));
vi.mock('@/lib/i18n/server', () => ({ getI18n: vi.fn(async () => ({ m: en, href: (p: string) => p })) }));
vi.mock('@/lib/family', () => ({ familyByOrgSlug: vi.fn(async () => family) }));
vi.mock('@/lib/data', () => ({ getPortrait: vi.fn(async (slug: string) => portraits[slug] ?? null) }));

let family: Family;
let portraits: Record<string, PublishedPortrait>;

function indicator(value: number, overrides: Partial<Indicator> = {}): Indicator {
  return {
    name: 'Tree canopy', value, unit: '%', year: 2025, target: 30,
    scoring: { function: 'higher_is_better', threshold_ref: 'land.canopy', inputs: { target: 30 }, worked_math: 'fixture' },
    source: 'Fixture', source_url: 'https://example.gov', confidence: 'high', geographic_scale: 'city',
    ...overrides,
  };
}

function setMembers(indicators: Indicator[][], whole: string | null = null) {
  family = {
    organization: { id: 'fixture', slug: 'fixture', name: 'Fixture family', languageHelp: null },
    members: indicators.map((_, index) => ({ slug: `member-${index}`, name: `Member ${index}`, short: `M${index}` })),
    whole, noun: 'portrait',
  };
  portraits = Object.fromEntries(indicators.map((rows, index) => [`member-${index}`, {
    tenant: { slug: `member-${index}`, name: `Member ${index}`, region: null, population: null, description: null, branding: null },
    dimensions: [{
      slug: 'land', ring: 'ecological', canonical_slug: 'land', display_order: 1,
      viz_level: 0, published_at: null, version_num: 1,
      data: { name: 'Land', icon: '', description: '', context: '', actions: [], indicators: rows },
    }],
  }])) as Record<string, PublishedPortrait>;
}

async function page(): Promise<string> {
  const { default: ComparePage } = await import('./page');
  return renderToStaticMarkup(await ComparePage({ params: Promise.resolve({ org: 'fixture' }) }));
}

async function table(): Promise<string> {
  const html = await page();
  return html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
}

function cells(html: string): string[] {
  return [...html.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/g)].map((m) => m[0]);
}

describe('family comparison table', () => {
  beforeEach(() => setMembers([[indicator(10)], [indicator(20)], [indicator(30)]]));

  it('shows a comparison for a two-portrait family', async () => {
    setMembers([[indicator(10)], [indicator(20)]]);
    expect(await table()).toContain('Tree canopy');
  });

  it('colors higher-is-better values in the documented direction', async () => {
    const row = cells(await table());
    expect(row[1]).toContain('text-red-700');
    expect(row[3]).toContain('text-green-700');
  });

  it('keeps lower-is-better colors in the opposite direction', async () => {
    const scoring = { function: 'lower_is_better' as const, threshold_ref: 'housing.burden', inputs: {}, worked_math: 'fixture' };
    setMembers([10, 20, 30].map((v) => [indicator(v, { scoring })]));
    const row = cells(await table());
    expect(row[1]).toContain('text-green-700');
    expect(row[3]).toContain('text-red-700');
  });

  it('does not assign good or bad colors without a shared monotonic scoring direction', async () => {
    const scoringCases: Indicator['scoring'][] = [
      undefined,
      { function: 'lower_is_better' as const, threshold_ref: 'other', inputs: {}, worked_math: 'fixture' },
      { function: 'band' as const, threshold_ref: 'other', inputs: { low: 10, high: 30 }, worked_math: 'fixture' },
    ];
    for (const scoring of scoringCases) {
      setMembers([[indicator(10)], [indicator(20, { scoring })], [indicator(30)]]);
      const html = await table();
      expect(html).toContain('Tree canopy');
      expect(html).not.toMatch(/text-(?:red|green)-700/);
    }
  });

  it('does not mix units or years with the same indicator name', async () => {
    for (const overrides of [{ unit: 'hectares' }, { year: 2024 }]) {
      setMembers([[indicator(10)], [indicator(20)], [indicator(999, overrides)]]);
      const html = await table();
      expect(html).toContain('Tree canopy');
      expect(html).toContain('2025');
      expect(html).not.toContain('999');
      expect(cells(html)[3]).toContain('—');
    }
  });

  it('renders separate rows when both unit/year groups have at least two members', async () => {
    setMembers([
      [indicator(10)], [indicator(20)],
      [indicator(200, { unit: 'hectares', year: 2024 })], [indicator(400, { unit: 'hectares', year: 2024 })],
    ]);
    const html = await table();
    expect(html.match(/Tree canopy/g)).toHaveLength(2);
    expect(html).toContain('2024');
    expect(html).toContain('2025');
    expect(html).toContain('hectares');
  });

  it('does not merge different dimensions or rings', async () => {
    setMembers([[indicator(10)], [indicator(20)]]);
    portraits['member-1']!.dimensions[0]!.slug = 'other-land';
    expect(await table()).not.toContain('Tree canopy');
    portraits['member-1']!.dimensions[0]!.slug = 'land';
    portraits['member-1']!.dimensions[0]!.ring = 'social';
    expect(await table()).not.toContain('Tree canopy');
  });

  it('explains empty comparisons instead of leaving a blank table', async () => {
    for (const whole of [null, 'member-0']) {
      setMembers([[indicator(10)], [indicator(20, { year: whole ? 2025 : 2024 })]], whole);
      const html = await page();
      expect(html).toContain(en.compare.empty);
      expect(html).toContain('colSpan="4"');
      expect(await table()).not.toContain('Tree canopy');
    }
  });

  it('does not copy a whole-jurisdiction value into a row with different units or year', async () => {
    setMembers([[indicator(999, { year: 2024 })], [indicator(10)], [indicator(20)]], 'member-0');
    const row = cells(await table());
    expect(row[1]).toContain('—');
    expect(row[2]).toContain('text-red-700');
    expect(row[3]).toContain('text-green-700');
  });

  it('does not infer comparability for unknown years, blank units, or non-finite values', async () => {
    for (const overrides of [{ year: null }, { unit: '' }, { value: NaN }, { value: Infinity }]) {
      setMembers([10, 20, 30].map((v) => [indicator(v, overrides)]));
      expect(await table()).not.toContain('Tree canopy');
    }
  });

  it('keeps the whole jurisdiction as context, including with only two peers', async () => {
    setMembers([[indicator(100)], [indicator(10)], [indicator(20)]], 'member-0');
    const row = cells(await table());
    expect(row[1]).toContain('100');
    expect(row[1]).not.toMatch(/text-(?:red|green)-700/);
    expect(row[2]).toContain('text-red-700');
    expect(row[3]).toContain('text-green-700');
    expect(row[4]).toContain('100%');
  });

  it('colors all tied extremes consistently and omits identical rows', async () => {
    setMembers([10, 10, 20, 20].map((v) => [indicator(v)]));
    const row = cells(await table());
    expect(row[1]).toContain('text-red-700');
    expect(row[2]).toContain('text-red-700');
    expect(row[3]).toContain('text-green-700');
    expect(row[4]).toContain('text-green-700');
    setMembers([10, 10, 10].map((v) => [indicator(v)]));
    expect(await table()).not.toContain('Tree canopy');
  });

  it('preserves Gini precision and nonzero tiny measurements in cells and spreads', async () => {
    setMembers([0.4764, 0.5014].map((v) => [indicator(v, { name: 'Gini', unit: 'index' })]));
    let row = cells(await table());
    expect(row[1]).toContain('>0.4764</span>');
    expect(row[2]).toContain('>0.5014</span>');
    expect(row[3]).toContain('Δ 0.025');
    setMembers([1e-8, 2e-8].map((v) => [indicator(v)]));
    row = cells(await table());
    expect(row[1]).toContain('>1E-8</span>');
    expect(row[2]).toContain('>2E-8</span>');
    expect(row[3]).toContain('Δ 1E-8');
  });

  it('does not expose binary subtraction noise in the derived spread', async () => {
    setMembers([0.2, 0.3].map((v) => [indicator(v)]));
    expect(cells(await table())[3]).toMatch(/>Δ 0\.1<\/td>$/);
  });
});
