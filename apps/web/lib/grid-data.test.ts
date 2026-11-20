import { describe, expect, it } from 'vitest';
import { framework } from '@deep-fryer/contract';
import { FIXTURE_ROW_COUNT, santaCruzFixture } from '@/components/admin/grid/test-fixture';
import {
  dimensionsWithoutRows,
  filterRows,
  gridRows,
  parseRowId,
  searchText,
  sortRows,
  type GridDimensionInput,
  type GridRow,
} from './grid-data';

/**
 * The Data page's rows: one per indicator of each dimension's latest
 * version, keyed the way the next save keys them, and the search, "Show"
 * filter and sort the table offers over them.
 */

const evidenceHref = (path: string) => `/files/santa-cruz/${path}`;
const rows = () => gridRows(santaCruzFixture(), { evidenceHref });
const byId = (all: GridRow[], id: string) => {
  const row = all.find((r) => r.rowId === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
};

describe('gridRows', () => {
  it('has one row per indicator, in dimension order and then the version’s own order', () => {
    const all = rows();
    expect(all).toHaveLength(FIXTURE_ROW_COUNT);
    expect(FIXTURE_ROW_COUNT).toBe(80);
    const order = framework.dimensions.map((d) => d.slug).filter((s) => all.some((r) => r.dimensionSlug === s));
    expect([...new Set(all.map((r) => r.dimensionSlug))]).toEqual(order);
    expect(all.filter((r) => r.dimensionSlug === 'food').map((r) => r.name)).toEqual([
      'Food insecurity rate',
      'Households receiving CalFresh',
      'Students eligible for free or reduced-price meals',
      'Food bank monthly clients',
    ]);
    expect(new Set(all.map((r) => r.rowId)).size).toBe(all.length);
  });

  it('names a framework row by its framework slug, even in a version saved before rows had keys', () => {
    const all = rows();
    const renters = framework.dimensions.find((d) => d.slug === 'housing')!.indicators[0]!;
    expect(byId(all, `housing/${renters.slug}`).name).toBe(renters.name);
    expect(byId(all, 'housing/homelessness-rate').value).toBe(85);
    expect(byId(all, 'health/uninsured-rate').key).toBe('uninsured-rate');
    expect(byId(all, 'health/life-expectancy').year).toBe(2021);
  });

  it('gives a custom row a key from its name', () => {
    expect(byId(rows(), 'food/households-receiving-calfresh').source).toBe('US Census ACS 5-year');
  });

  it('carries the version it was read from and whether the public sees it', () => {
    const all = rows();
    expect(byId(all, 'food/food-insecurity-rate')).toMatchObject({ baseVersion: 2, published: true });
    expect(byId(all, 'housing/cost-burdened-renters')).toMatchObject({ baseVersion: 4, published: false });
  });

  it('adds a row for a gap the version records without listing the indicator, with the reason', () => {
    const all = rows();
    expect(byId(all, 'peace-justice/hate-crimes-reported')).toMatchObject({
      name: 'Hate crimes reported',
      value: null,
      gapReason: 'Reported counts are too small to publish.',
      sourceUrl: '',
    });
    expect(byId(all, 'peace-justice/residents-who-trust-the-police').gapReason).toBe('No survey since 2018.');
  });

  it('gives a whole-dimension gap with no indicators no row, and lists it by name with research’s reason', () => {
    const dims = santaCruzFixture();
    const all = gridRows(dims);
    expect(all.some((r) => r.dimensionSlug === 'ocean-acidification')).toBe(false);
    expect(all.some((r) => r.key === 'all')).toBe(false);
    expect(dimensionsWithoutRows(dims, all)).toEqual([
      { name: 'Ocean Acidification', gapReason: 'No local monitoring series.' },
    ]);
  });

  it('gives each emptied row of a whole-dimension gap the gap’s reason, unless the row records its own', () => {
    const dims = santaCruzFixture();
    const food = dims.find((d) => d.dimension.slug === 'food')!;
    const data = food.latest!.data;
    const secondKey = gridRows(dims).filter((r) => r.dimensionSlug === 'food')[1]!.key;
    data.indicators = data.indicators.map((ind, i) => (i < 2 ? { ...ind, value: null, level_pct: undefined } : ind));
    data.gaps = [
      { indicator: secondKey, reason: 'Survey paused.', scales_tried: [], searched_at: '2026-09-01T00:00:00Z' },
      { indicator: 'all', reason: 'No usable county series.', scales_tried: [], searched_at: '2026-09-01T00:00:00Z' },
    ];
    const foodRows = gridRows(dims).filter((r) => r.dimensionSlug === 'food');
    expect(foodRows.map((r) => r.gapReason)).toEqual([
      'No usable county series.',
      'Survey paused.',
      ...foodRows.slice(2).map(() => null),
    ]);
  });

  it('lists a dimension with no version yet as without rows, by the framework’s name for it', () => {
    const dims: GridDimensionInput[] = [
      { dimension: { id: 'd1', slug: 'income-work', canonicalSlug: 'income-work', ring: 'social', publishedVersionId: null }, latest: null },
      { dimension: { id: 'd2', slug: 'our-own-dimension', canonicalSlug: null, ring: 'social', publishedVersionId: null }, latest: null },
    ];
    expect(gridRows(dims)).toEqual([]);
    const names = dimensionsWithoutRows(dims, []).map((d) => d.name);
    expect(names[0]).toBe(framework.dimensions.find((d) => d.slug === 'income-work')!.name);
    expect(names[0]).not.toBe('income-work');
    // A dimension of the group's own that was never saved has nothing but its address name.
    expect(names[1]).toBe('our-own-dimension');
  });

  it('links evidence through the given address, with the PDF when there is one', () => {
    const all = rows();
    expect(byId(all, 'climate-change/ghg-per-capita').evidence).toEqual({
      href: '/files/santa-cruz/evidence/ghg.png',
      pdfHref: '/files/santa-cruz/evidence/ghg.pdf',
      capturedOn: '2026-09-01',
    });
    expect(byId(all, 'air-pollution/pm25-annual').evidence).toEqual({
      href: '/files/santa-cruz/evidence/pm25.png',
      capturedOn: '2026-08-14',
    });
  });

  it('reads a score as the doughnut’s level, and has none for a row without a value', () => {
    const all = rows();
    expect(byId(all, 'housing/cost-burdened-renters').vizLevel).toBe(150);
    expect(byId(all, 'water-sanitation/safe-drinking-water').vizLevel).toBe(-100);
    expect(byId(all, 'food/households-receiving-calfresh').vizLevel).toBeNull();
  });

  it('treats blank text as no value', () => {
    const dims = santaCruzFixture();
    const food = dims.find((d) => d.dimension.slug === 'food')!;
    food.latest!.data.indicators[0]!.value = '   ';
    expect(byId(gridRows(dims), 'food/food-insecurity-rate').value).toBeNull();
  });
});

describe('parseRowId', () => {
  it('splits a row ID into dimension and key, and refuses anything else', () => {
    expect(parseRowId('housing/homelessness-rate')).toEqual({ dimensionSlug: 'housing', key: 'homelessness-rate' });
    expect(parseRowId('housing')).toBeNull();
    expect(parseRowId('/homelessness-rate')).toBeNull();
    expect(parseRowId('housing/Homelessness Rate')).toBeNull();
    expect(parseRowId('housing/a/b')).toBeNull();
  });
});

describe('filterRows', () => {
  it('"Rows with no source link" shows exactly the rows with an empty source link', () => {
    const all = rows();
    const shown = filterRows(all, { show: 'no-source-link' });
    const expected = all.filter((r) => r.sourceUrl.trim() === '');
    expect(shown.map((r) => r.rowId)).toEqual(expected.map((r) => r.rowId));
    expect(shown.length).toBeGreaterThan(3);
    expect(shown.length).toBeLessThan(all.length);
    // A link that is there but not a web address still counts as a link.
    expect(shown.map((r) => r.rowId)).not.toContain('social-equity/racial-dissimilarity-index');
  });

  it('shows rows with no value, low confidence, or not yet published', () => {
    const all = rows();
    expect(filterRows(all, { show: 'no-value' }).every((r) => r.value === null)).toBe(true);
    expect(filterRows(all, { show: 'no-value' }).map((r) => r.rowId)).toContain('peace-justice/hate-crimes-reported');
    expect(filterRows(all, { show: 'low-confidence' }).every((r) => r.confidence === 'low')).toBe(true);
    expect(new Set(filterRows(all, { show: 'not-published' }).map((r) => r.dimensionSlug))).toEqual(
      new Set(['housing', 'climate-change']),
    );
  });

  it('finds every word of a search, in any column, ignoring case, accents and superscripts', () => {
    const all = rows();
    expect(filterRows(all, { search: 'census RENT' }).map((r) => r.rowId)).toEqual(['housing/cost-burdened-renters']);
    expect(filterRows(all, { search: 'datasharescc.org' }).map((r) => r.rowId)).toEqual([
      'food/food-insecurity-rate',
      'air-pollution/pm25-annual',
    ]);
    expect(filterRows(all, { search: 'µG/M3' }).map((r) => r.rowId)).toEqual(['air-pollution/pm25-annual']);
    expect(searchText('Años de VIDA')).toBe('anos de vida');
    expect(filterRows(all, { search: '   ' })).toHaveLength(all.length);
    expect(filterRows(all, { search: 'nothing-like-this' })).toEqual([]);
  });

  it('finds a row by what the table shows: a formatted number, the status, confidence and version in words', () => {
    const all = rows();
    const statusWord = (level: number | null) => (level === null ? 'Not scored' : level > 100 ? 'Severe' : level > 50 ? 'Critical' : 'Fine');
    expect(filterRows(all, { search: '1,240' }).map((r) => r.rowId)).toEqual(['health/primary-care-physicians']);
    expect(filterRows(all, { search: '1240' }).map((r) => r.rowId)).toEqual(['health/primary-care-physicians']);
    const severe = filterRows(all, { search: 'severe', statusWord });
    expect(severe.length).toBeGreaterThan(0);
    expect(severe.every((r) => r.value !== null && r.vizLevel !== null && r.vizLevel > 100)).toBe(true);
    // Without the table's words for a level, a search cannot match a status.
    expect(filterRows(all, { search: 'severe' })).toEqual([]);
    expect(filterRows(all, { search: 'low' }).map((r) => r.rowId)).toEqual(
      expect.arrayContaining(all.filter((r) => r.confidence === 'low').map((r) => r.rowId)),
    );
    const drafts = filterRows(all, { search: 'draft' });
    expect(drafts.map((r) => r.rowId)).toEqual(expect.arrayContaining(all.filter((r) => !r.published).map((r) => r.rowId)));
    // Beyond the draft versions' rows, only rows that say "draft" themselves ("Groundwater basin overdraft").
    expect(drafts.every((r) => !r.published || r.name.toLowerCase().includes('draft'))).toBe(true);
    expect(filterRows(all, { search: 'data needed' }).every((r) => r.value === null)).toBe(true);
    expect(filterRows(all, { search: 'too small to publish' }).map((r) => r.rowId)).toEqual(['peace-justice/hate-crimes-reported']);
    expect(filterRows(all, { search: 'snapshot 2026-09-01' }).map((r) => r.rowId)).toContain('climate-change/ghg-per-capita');
  });

  it('narrows to one dimension, together with the other filters', () => {
    const all = rows();
    const water = filterRows(all, { dimension: 'freshwater-withdrawals', show: 'no-source-link' });
    expect(water.map((r) => r.rowId)).toEqual(['freshwater-withdrawals/groundwater-basin-overdraft']);
  });
});

describe('sortRows', () => {
  it('sorts numbers as numbers, text after them, and empty cells last in either direction', () => {
    const all = filterRows(rows(), { dimension: 'food' });
    const up = sortRows(all, { key: 'value', direction: 'ascending' }).map((r) => r.value);
    expect(up).toEqual([9.8, 12.4, 41, '70,000+ a month, "surging" to 100,000\nduring federal cuts']);
    const housing = filterRows(rows(), { dimension: 'peace-justice' });
    const down = sortRows(housing, { key: 'value', direction: 'descending' }).map((r) => r.value);
    expect(down).toEqual([210, 48, 6.8, null, null]);
    expect(sortRows(housing, { key: 'value', direction: 'ascending' }).map((r) => r.value)).toEqual([6.8, 48, 210, null, null]);
  });

  it('keeps tied rows in table order, and the table order without a sort', () => {
    const all = rows();
    const byYear = sortRows(all, { key: 'year', direction: 'ascending' });
    const in2019 = byYear.filter((r) => r.year === 2019).map((r) => r.rowId);
    expect(in2019).toEqual(all.filter((r) => r.year === 2019).map((r) => r.rowId));
    expect(sortRows(all, null).map((r) => r.rowId)).toEqual(all.map((r) => r.rowId));
  });

  it('sorts status by level, confidence from low to high, and text by its words', () => {
    const all = rows();
    const status = sortRows(all, { key: 'status', direction: 'descending' });
    expect(status[0]!.vizLevel).toBe(150);
    expect(status.at(-1)!.vizLevel).toBeNull();
    const confidence = sortRows(all, { key: 'confidence', direction: 'ascending' }).map((r) => r.confidence);
    expect(confidence.indexOf('medium')).toBeGreaterThan(confidence.lastIndexOf('low'));
    expect(confidence.indexOf('high')).toBeGreaterThan(confidence.lastIndexOf('medium'));
    const names = sortRows(all, { key: 'indicator', direction: 'ascending' }).map((r) => r.name);
    expect(names[0]).toBe('Adults reporting frequent mental distress');
  });
});
