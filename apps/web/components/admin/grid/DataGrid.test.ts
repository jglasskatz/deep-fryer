import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { en } from '@/lib/i18n/messages/en';
import { gridRows, type GridRow } from '@/lib/grid-data';
import { DataGrid, type DataGridProps } from './DataGrid';
import { EMPTY_GRID_STATE, type DataGridState } from './grid-state';
import { santaCruzFixture } from './test-fixture';

/**
 * The data table as the server renders it, for a portrait the size of Santa
 * Cruz's: every row, in words a volunteer reads without help, one tab stop
 * for the whole table, sortable headers, and a plain message for each empty
 * case (no dimensions, no indicators, nothing matching the filters).
 */

// Vitest compiles JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const allRows = () => gridRows(santaCruzFixture(), { evidenceHref: (p) => `/files/santa-cruz/${p}` });

function render(props: Partial<DataGridProps> & { initial?: DataGridState } = {}): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(DataGrid, {
        tenantSlug: 'santa-cruz',
        rows: allRows(),
        emptyDimensions: [{ name: 'Ocean Acidification', gapReason: 'No local monitoring series.' }],
        dimensionCount: 21,
        canOpenDimension: false,
        ...props,
      }),
    ),
  );
}

/** The body rows' ids, in the order shown. */
const shownRowIds = (html: string) => [...html.matchAll(/<tr id="row-([^"]+)"/g)].map((m) => m[1]);

describe('DataGrid', () => {
  it('shows every row, each with an anchor a link can open the table at', () => {
    const html = render();
    const rows = allRows();
    expect(shownRowIds(html)).toEqual(rows.map((r) => r.rowId));
    expect(html).toContain('>80 rows</p>');
    expect(html).toContain('aria-rowcount="81"');
  });

  it('labels every column in plain words and makes each header a sort button', () => {
    const html = render();
    for (const label of ['Indicator', 'Value', 'Unit', 'Year', 'Target', 'Status', 'Dimension', 'Source', 'Link', 'Supporting source', 'Scale', 'Confidence', 'Evidence']) {
      expect(html).toMatch(new RegExp(`<th[^>]*aria-sort="none"[^>]*><button[^>]*>${label}<`));
    }
    expect(html).not.toContain('row_id');
    expect(html).not.toContain('Row ID</');
  });

  it('puts the table in the tab order once, at its first cell', () => {
    const html = render();
    const grid = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    expect(grid.match(/tabindex="0"/g)).toHaveLength(1);
    expect(grid).toMatch(/<th scope="row"[^>]*tabindex="0" data-cell="1:0"/);
    expect(html).toContain('role="grid"');
    expect(html).toMatch(/aria-describedby="[^"]+-keys"/);
    expect(html).toContain('the arrow keys move from cell to cell');
  });

  it('writes values, status, scale and confidence in words', () => {
    const html = render();
    expect(html).toContain('<bdi class="break-words">92,846</bdi>');
    expect(html).toContain(en.doughnut.level.severe);
    expect(html).toContain(en.doughnut.level.noProblem);
    expect(html).toContain('Not scored');
    expect(html).toMatch(/>County</);
    expect(html).toMatch(/>Low</);
    expect(html).toContain('v4 · draft');
    expect(html).toContain('v2 · published');
  });

  it('says what research could not find in place of a missing value', () => {
    const html = render();
    const row = html.slice(html.indexOf('id="row-peace-justice/hate-crimes-reported"'));
    expect(row.slice(0, row.indexOf('</tr>'))).toContain(`${en.doughnut.dataNeeded}</span>`);
    expect(row.slice(0, row.indexOf('</tr>'))).toContain('No usable figure found: Reported counts are too small to publish.');
  });

  it('links a source by its site’s name and shows an unsafe link as text', () => {
    const html = render();
    expect(html).toContain('href="https://data.census.gov/table/ACSST5Y2022.S2201"');
    expect(html).toMatch(/title="https:\/\/data\.census\.gov[^"]*"[^>]*><span class="break-all">data\.census\.gov<\/span>/);
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('<span class="break-all">javascript:alert(1)</span>');
  });

  it('links evidence, with the PDF and the day it was captured', () => {
    const html = render();
    expect(html).toMatch(/href="\/files\/santa-cruz\/evidence\/ghg\.png"[^>]*>Snapshot<\/a>/);
    expect(html).toMatch(/href="\/files\/santa-cruz\/evidence\/ghg\.pdf"[^>]*>PDF<\/a>/);
    expect(html).toContain('2026-09-01');
  });

  it('wraps a very long indicator name instead of stretching the table', () => {
    const html = render();
    expect(html).toContain('<span class="break-words font-medium">Affordable homes permitted as a share of the regional housing need allocation');
    expect(html).toMatch(/<th scope="row"[^>]*max-w-\[11rem\]/);
  });

  it('scrolls wide tables inside their own box, which clips the hidden "none" of empty cells', () => {
    // Without a positioned box, those hidden words are placed against the page and widen it on a phone.
    expect(render()).toMatch(/<div class="relative [^"]*overflow-auto[^"]*"><table/);
  });

  it('links each dimension to its editing page only for people who may edit', () => {
    expect(render({ canOpenDimension: false })).not.toContain('/santa-cruz/admin/dim/');
    expect(render({ canOpenDimension: true })).toContain('href="/santa-cruz/admin/dim/dim-housing"');
  });

  it('opens with the search, filters and sort from the page address', () => {
    const html = render({ initial: { ...EMPTY_GRID_STATE, show: 'no-source-link' } });
    const expected = allRows().filter((r: GridRow) => r.sourceUrl === '').map((r) => r.rowId);
    expect(shownRowIds(html)).toEqual(expected);
    expect(html).toContain(`Showing ${expected.length} of 80 rows`);
    expect(html).toContain('Clear search and filters');
    expect(html).toMatch(/<option value="no-source-link" selected="">Rows with no source link<\/option>/);

    const sorted = render({ initial: { ...EMPTY_GRID_STATE, dimension: 'food', sort: { key: 'value', direction: 'descending' } } });
    // Descending reverses ascending, where numbers come before text (as spreadsheet programs sort).
    expect(shownRowIds(sorted)).toEqual([
      'food/food-bank-monthly-clients',
      'food/students-eligible-for-free-or-reduced-price-meals',
      'food/food-insecurity-rate',
      'food/households-receiving-calfresh',
    ]);
    expect(sorted).toMatch(/aria-sort="descending"[^>]*><button[^>]*>Value<span aria-hidden="true"[^>]*>▼/);
  });

  it('says so when nothing matches, with a way back to every row', () => {
    const html = render({ initial: { ...EMPTY_GRID_STATE, search: 'no such indicator anywhere' } });
    expect(html).not.toContain('<table');
    expect(html).not.toContain('the arrow keys move');
    expect(html).toContain('No rows match.');
    expect(html).toContain('clear the search and filters');
    expect(html).toContain('Showing 0 of 80 rows');
  });

  it('offers the download of every row whatever the filters, and says what to keep', () => {
    const html = render({ initial: { ...EMPTY_GRID_STATE, show: 'no-value' } });
    expect(html).toContain('Download CSV');
    expect(html).toContain('The file has all 80 rows, whatever the search and filters');
    expect(html).toContain('Keep its Row ID and Version columns as they are.');
  });

  it('names the dimensions without rows: research’s reason where it found no usable figure, else "no indicators yet"', () => {
    const html = render({
      emptyDimensions: [
        { name: 'Ocean Acidification', gapReason: 'No local monitoring series.' },
        { name: 'Ozone Layer Depletion', gapReason: null },
        { name: 'Land Conversion', gapReason: null },
      ],
    });
    expect(html).toContain('No usable figure found for Ocean Acidification:</span> No local monitoring series.');
    expect(html).toContain('No indicators yet in:</span> Ozone Layer Depletion, Land Conversion.');
    expect(html).not.toMatch(/No indicators yet in:<\/span>[^<]*Ocean Acidification/);
    const empty = render({ emptyDimensions: [] });
    expect(empty).not.toContain('No indicators yet in');
    expect(empty).not.toContain('No usable figure found for');
  });

  it('shows every dimension when the address names one the table has no rows for', () => {
    const html = render({ initial: { ...EMPTY_GRID_STATE, dimension: 'no-such-dimension' } });
    expect(shownRowIds(html)).toHaveLength(80);
    expect(html).toMatch(/<option value="" selected="">All dimensions<\/option>/);
    expect(html).toContain('>80 rows</p>');
    expect(html).not.toContain('Clear search and filters');
    // A dimension the table does have rows for still narrows it.
    expect(new Set(shownRowIds(render({ initial: { ...EMPTY_GRID_STATE, dimension: 'food' } })).map((id) => id!.split('/')[0]))).toEqual(
      new Set(['food']),
    );
  });

  it('finds rows by the words and numbers the table shows', () => {
    const critical = render({ initial: { ...EMPTY_GRID_STATE, search: en.doughnut.level.critical } });
    const ids = shownRowIds(critical);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(80);
    for (const id of ids) {
      const row = critical.slice(critical.indexOf(`id="row-${id}"`));
      expect(row.slice(0, row.indexOf('</tr>'))).toContain(en.doughnut.level.critical);
    }
    expect(shownRowIds(render({ initial: { ...EMPTY_GRID_STATE, search: '1,240' } }))).toEqual(['health/primary-care-physicians']);
  });

  it('explains an empty portrait, and a portrait whose dimensions have no indicators', () => {
    const none = render({ rows: [], emptyDimensions: [], dimensionCount: 0 });
    expect(none).toContain('This portrait has no dimensions yet.');
    expect(none).not.toContain('Download CSV');

    const empty = render({
      rows: [],
      emptyDimensions: [
        { name: 'Food', gapReason: null },
        { name: 'Ocean Acidification', gapReason: 'No local monitoring series.' },
      ],
      dimensionCount: 21,
    });
    expect(empty).toContain('No indicators yet.');
    expect(empty).toContain('href="/santa-cruz/admin/review"');
    expect(empty).not.toContain('<table');
    // Research's reason for a dimension is still given; "no indicators yet" is not said twice.
    expect(empty).toContain('No usable figure found for Ocean Acidification:</span> No local monitoring series.');
    expect(empty).not.toContain('No indicators yet in');
  });

  it('uses no internal names in what it shows', () => {
    const html = render().replace(/<[^>]+>/g, ' ');
    for (const word of ['source_url', 'supporting_source_url', 'geographic_scale', 'base_version', 'level_pct', 'viz']) {
      expect(html).not.toContain(word);
    }
  });
});
