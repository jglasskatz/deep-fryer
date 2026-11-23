import { describe, expect, it } from 'vitest';
import { TABLE_COLUMNS } from '@/lib/grid-columns';
import { gridRows } from '@/lib/grid-data';
import { EMPTY_SESSION, stageCells, stagedChanges } from './edit-session';
import { buildSaveReview } from './save-warnings';
import { santaCruzFixture } from './test-fixture';

const rows = gridRows(santaCruzFixture(), { evidenceHref: (p) => `/files/santa-cruz/${p}` });
const rowsById = new Map(rows.map((r) => [r.rowId, r]));

function reviewFor(writes: { rowId: string; column: string; text: string }[]) {
  const session = stageCells(EMPTY_SESSION, rowsById, writes as never, 'test');
  const changes = stagedChanges(session, rows, TABLE_COLUMNS);
  return buildSaveReview(changes, rows);
}

describe('buildSaveReview', () => {
  it('returns zero counts for empty changes', () => {
    expect(buildSaveReview([], rows)).toEqual({
      dimensionCount: 0,
      indicatorCount: 0,
      changeCount: 0,
      publishedDimensionCount: 0,
      warningCount: 0,
      dimensions: [],
    });
  });

  it('warns when clearing a previously populated numeric value into missing data', () => {
    const review = reviewFor([{ rowId: 'health/uninsured-rate', column: 'value', text: '' }]);
    expect(review.dimensionCount).toBe(1);
    expect(review.indicatorCount).toBe(1);
    expect(review.changeCount).toBe(1);

    const ind = review.dimensions[0]!.indicators[0]!;
    expect(ind.warnings).toContainEqual({
      kind: 'cleared-value',
      message: expect.stringContaining('Clears the numeric value 5.1'),
    });
    expect(ind.warnings.some((w) => w.kind === 'cleared-value' && w.message.includes('missing data'))).toBe(true);
    // Clearing a value into missing data should not complain about missing source.
    expect(ind.warnings.some((w) => w.kind === 'missing-source')).toBe(false);
  });

  it('warns on published dimensions that edits save as a new draft and never auto-publish', () => {
    // Food is published (v2); Housing is already a draft (v4).
    const review = reviewFor([
      { rowId: 'food/food-insecurity-rate', column: 'source', text: 'Updated DataShare SCC' },
      { rowId: 'housing/cost-burdened-renters', column: 'source', text: 'Updated ACS' },
    ]);
    expect(review.dimensionCount).toBe(2);
    expect(review.publishedDimensionCount).toBe(1);

    const food = review.dimensions.find((d) => d.dimensionId === 'dim-food')!;
    expect(food.published).toBe(true);
    expect(food.dimensionWarnings).toEqual([
      {
        kind: 'published-dimension',
        message: expect.stringMatching(/Food is currently published \(v2\).*new draft \(v3\).*not publish automatically/i),
      },
    ]);

    const housing = review.dimensions.find((d) => d.dimensionId === 'dim-housing')!;
    expect(housing.published).toBe(false);
    expect(housing.dimensionWarnings).toEqual([]);
  });

  it('warns when value, unit, or target changes without a source name or source URL', () => {
    // water-sanitation/sewer-overflows has empty source and empty sourceUrl.
    const bothMissing = reviewFor([
      { rowId: 'water-sanitation/sewer-overflows', column: 'value', text: '3' },
      { rowId: 'water-sanitation/sewer-overflows', column: 'supporting_source_url', text: 'https://water.example.gov/report' },
    ]);
    expect(bothMissing.dimensions[0]!.indicators[0]!.warnings).toContainEqual({
      kind: 'missing-source',
      message: 'Changed Value without a source name or source link.',
    });

    // food/food-bank-monthly-clients has source name but empty sourceUrl.
    const missingUrl = reviewFor([
      { rowId: 'food/food-bank-monthly-clients', column: 'unit', text: 'households per month' },
      { rowId: 'food/food-bank-monthly-clients', column: 'target', text: '0' },
    ]);
    expect(missingUrl.dimensions[0]!.indicators[0]!.warnings).toContainEqual({
      kind: 'missing-source',
      message: 'Changed Unit and Target without a source link.',
    });

    // Providing source and source_url in the same edit session clears the warning.
    const supplied = reviewFor([
      { rowId: 'water-sanitation/sewer-overflows', column: 'value', text: '3' },
      { rowId: 'water-sanitation/sewer-overflows', column: 'source', text: 'City Water Report' },
      { rowId: 'water-sanitation/sewer-overflows', column: 'source_url', text: 'https://water.example.gov/' },
      { rowId: 'water-sanitation/sewer-overflows', column: 'supporting_source_url', text: 'https://water.example.gov/report' },
    ]);
    expect(supplied.dimensions[0]!.indicators[0]!.warnings.some((w) => w.kind === 'missing-source')).toBe(false);

    // Clearing source name on a row whose target changed triggers missing source name.
    const clearedName = reviewFor([
      { rowId: 'food/food-insecurity-rate', column: 'target', text: '8' },
      { rowId: 'food/food-insecurity-rate', column: 'source', text: '' },
    ]);
    expect(clearedName.dimensions[0]!.indicators[0]!.warnings).toContainEqual({
      kind: 'missing-source',
      message: 'Changed Target without a source name.',
    });
  });

  it('flags >50% numeric swings and sign changes, but not <=50% changes or 0-to-nonzero without sign flip', () => {
    // food/food-insecurity-rate is 12.4.
    // +100% increase -> flagged.
    const bigUp = reviewFor([
      { rowId: 'food/food-insecurity-rate', column: 'value', text: '24.8' },
      { rowId: 'food/food-insecurity-rate', column: 'supporting_source_url', text: 'https://example.org/data' },
    ]);
    expect(bigUp.dimensions[0]!.indicators[0]!.warnings).toContainEqual({
      kind: 'large-numeric-change',
      message: expect.stringContaining('12.4 to 24.8 (100% increase)'),
    });

    // -60% decrease -> flagged.
    const bigDown = reviewFor([
      { rowId: 'food/food-insecurity-rate', column: 'value', text: '4.96' },
      { rowId: 'food/food-insecurity-rate', column: 'supporting_source_url', text: 'https://example.org/data' },
    ]);
    expect(bigDown.dimensions[0]!.indicators[0]!.warnings).toContainEqual({
      kind: 'large-numeric-change',
      message: expect.stringContaining('12.4 to 4.96 (60% decrease)'),
    });

    // Sign flip -> flagged specifically as sign change.
    const signFlip = reviewFor([
      { rowId: 'food/food-insecurity-rate', column: 'value', text: '-2' },
      { rowId: 'food/food-insecurity-rate', column: 'supporting_source_url', text: 'https://example.org/data' },
    ]);
    expect(signFlip.dimensions[0]!.indicators[0]!.warnings).toContainEqual({
      kind: 'large-numeric-change',
      message: expect.stringContaining('Sign changed from 12.4 to -2'),
    });

    // Exact 50% change (12.4 -> 18.6) -> NOT flagged.
    const exact50 = reviewFor([
      { rowId: 'food/food-insecurity-rate', column: 'value', text: '18.6' },
      { rowId: 'food/food-insecurity-rate', column: 'supporting_source_url', text: 'https://example.org/data' },
    ]);
    expect(exact50.dimensions[0]!.indicators[0]!.warnings.some((w) => w.kind === 'large-numeric-change')).toBe(false);

    // 0 -> 2 (water-sanitation/lead-service-lines-remaining is 0) -> no Infinity% warning.
    const fromZero = reviewFor([
      { rowId: 'water-sanitation/lead-service-lines-remaining', column: 'value', text: '2' },
      { rowId: 'water-sanitation/lead-service-lines-remaining', column: 'supporting_source_url', text: 'https://example.org/data' },
    ]);
    expect(fromZero.dimensions[0]!.indicators[0]!.warnings.some((w) => w.message.includes('Infinity'))).toBe(false);
  });

  it('carries forward non-blocking cell notes and totals all warnings accurately', () => {
    const review = reviewFor([
      { rowId: 'housing/cost-burdened-renters', column: 'year', text: '24' },
      { rowId: 'housing/cost-burdened-renters', column: 'source_url', text: 'see PDF' },
      { rowId: 'food/food-insecurity-rate', column: 'value', text: '' },
    ]);
    // 1 published-dimension warning (Food) + 1 cleared-value warning (Food) + 2 cell-note warnings (Housing) = 4
    expect(review.dimensionCount).toBe(2);
    expect(review.indicatorCount).toBe(2);
    expect(review.changeCount).toBe(3);
    expect(review.warningCount).toBe(4);
    const housingNotes = review.dimensions.find((d) => d.dimensionId === 'dim-housing')!.indicators[0]!.warnings;
    expect(housingNotes.map((w) => w.kind)).toEqual(['cell-note', 'cell-note']);
  });
});
