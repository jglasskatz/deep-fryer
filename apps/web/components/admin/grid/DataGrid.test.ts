import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { en } from '@/lib/i18n/messages/en';
import { gridRows, type GridRow } from '@/lib/grid-data';
import { DataGrid, type DataGridProps } from './DataGrid';
import { EMPTY_GRID_STATE, type DataGridState } from './grid-state';
import { santaCruzFixture } from './test-fixture';
import { uploadReportLines } from './UploadReport';
import { NOT_A_LINK_NOTE, NOT_A_YEAR_NOTE, parseSpreadsheet } from '@/lib/spreadsheet-import';
import { CellEditor } from './CellEditor';
import { EMPTY_SESSION, editorStartText } from './edit-session';
import { GRID_COLUMNS, gridCsv, parseCsv } from '@/lib/grid-columns';

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
    // A cell scrolled into view stops clear of the sticky first column at its widest (11rem, or 18rem, plus 1.5rem of padding).
    expect(render()).toMatch(/<div class="relative [^"]*scroll-pl-\[12\.5rem\][^"]*sm:scroll-pl-\[19\.5rem\]/);
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

  it('is read only, with no Edit button, unless the page offers editing', () => {
    const html = render();
    expect(html).not.toMatch(/<button[^>]*>Edit<\/button>/);
    expect(html).toContain('aria-readonly="true"');
    expect(render({ onDone: () => {} })).toMatch(/<button[^>]*>Edit<\/button>/);
  });
});

describe('a cell’s box', () => {
  const box = (column: 'geographic_scale' | 'confidence' | 'value', initialText: string) =>
    renderToStaticMarkup(
      createElement(CellEditor, { column, initialText, label: 'Scale of Food insecurity rate', onCommit() {}, onCancel() {}, onPasteBlock() {} }),
    );

  it('opens a Scale menu on the choice a typed letter begins, never on "Choose…"', () => {
    const food = allRows().find((r) => r.rowId === 'food/food-insecurity-rate')!;
    const html = box('geographic_scale', editorStartText(EMPTY_SESSION, food, 'geographic_scale', 'r'));
    expect(html).toMatch(/<select[^>]*aria-label="Scale of Food insecurity rate"/);
    expect(html).toContain('<option value="regional" selected="">Regional</option>');
    expect(html).not.toMatch(/<option value="" disabled="" selected=""/);
    expect(box('confidence', editorStartText(EMPTY_SESSION, food, 'confidence', 'h'))).toContain('<option value="high" selected="">High</option>');
  });

  it('opens a text box with what the cell holds', () => {
    expect(box('value', '12.4')).toMatch(/<textarea[^>]*>12\.4<\/textarea>/);
  });
});

describe('DataGrid in edit mode', () => {
  const editing = (writes: { rowId: string; column: string; text: string }[], props: Partial<DataGridProps> = {}) =>
    render({ onDone: () => {}, startEditing: { writes: writes as never, label: 'test changes' }, ...props });
  /** The opening tag and content of one body cell, by row ID and column label. */
  const cellOf = (html: string, rowId: string, label: string) => {
    const rowHtml = html.slice(html.indexOf(`id="row-${rowId}"`));
    const cells = rowHtml.slice(0, rowHtml.indexOf('</tr>')).split(/(?=<t[hd] )/).slice(1);
    const labels = ['Indicator', 'Value', 'Unit', 'Year', 'Target', 'Status', 'Dimension', 'Source', 'Link', 'Supporting source', 'Scale', 'Confidence', 'Evidence'];
    return cells[labels.indexOf(label)] ?? '';
  };
  const highlighted = (html: string) => (html.match(/<t[hd] [^>]*class="(?:[^"]* )?bg-amber-100[ "]/g) ?? []).length;

  it('says nothing is saved until Done, and offers Undo, Redo, Upload CSV, Cancel and Done', () => {
    const html = editing([]);
    expect(html).toContain('Editing</h2>');
    expect(html).toContain('Nothing is saved until you press Done.');
    for (const label of ['Upload CSV', 'Cancel', 'Done']) expect(html).toMatch(new RegExp(`<button[^>]*>${label}</button>`));
    expect(html).toMatch(/<button[^>]*aria-label="Undo"[^>]*disabled=""[^>]*>Undo<\/button>/);
    expect(html).toContain('No changes yet.');
    expect(html).not.toMatch(/<table[^>]*aria-readonly/);
    expect(html).toContain('Type to replace what is in a cell');
    // Where a browser sends no paste to a picked cell, the box it opens into takes one.
    expect(html).toContain('if nothing is pasted, click the cell again so its box opens, then paste');
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept=".csv,text\/csv"/);
    // The question asked before leaving is in the page, closed until it is needed.
    expect(html).toMatch(/<dialog(?![^>]* open)[^>]*>[\s\S]*Leave without saving\?/);
  });

  it('highlights a typed cell, with what it was, and makes every cell that can be typed in a stop for the keyboard', () => {
    const html = editing([{ rowId: 'food/food-insecurity-rate', column: 'value', text: '13.1' }]);
    const value = cellOf(html, 'food/food-insecurity-rate', 'Value');
    expect(value).toMatch(/class="(?:[^"]* )?bg-amber-100[ "]/);
    expect(value).toContain('<span class="sr-only">Changed: </span><bdi class="break-words">13.1</bdi>');
    expect(value).toContain('Was: 12.4');
    expect(html).toContain('1 change, not saved yet.');
    expect(html).toMatch(/aria-label="Undo test changes"/);
    // Links show their full address while editing, so a click picks the cell instead of opening the page.
    const link = cellOf(html, 'food/food-insecurity-rate', 'Link');
    expect(link).toContain('data-cell=');
    expect(link).not.toContain('<a ');
    expect(link).toContain('https://www.datasharescc.org/indicators/index/view?indicatorId=2107');
    // Columns worked out by the app say they cannot be typed in.
    expect(cellOf(html, 'food/food-insecurity-rate', 'Status')).toContain('aria-readonly="true"');
  });

  it('highlights exactly the 12 cells of a pasted 3-by-4 range', () => {
    const rows = allRows().slice(0, 3);
    const block = [['13.1', '% of people', '2024', '9'], ['10.2', '% of homes', '2023', '8'], ['44', '% of pupils', '2025', '30']];
    const writes = rows.flatMap((r, i) => (['value', 'unit', 'year', 'target'] as const).map((column, j) => ({ rowId: r.rowId, column, text: block[i]![j]! })));
    const html = editing(writes);
    expect(highlighted(html)).toBe(12);
    expect(html).toContain('12 changes, not saved yet.');
    expect(cellOf(html, rows[2]!.rowId, 'Unit')).toContain('% of pupils');
  });

  it('marks a cell that cannot be saved as written, says why, and counts it', () => {
    const html = editing([
      { rowId: 'food/food-insecurity-rate', column: 'year', text: 'last year' },
      { rowId: 'food/households-receiving-calfresh', column: 'value', text: '11' },
    ]);
    const year = cellOf(html, 'food/food-insecurity-rate', 'Year');
    expect(year).toMatch(/class="[^"]*bg-red-50[^"]*outline-red-700/);
    expect(year).toContain('Write the year as a whole number, like 2024.');
    const supporting = cellOf(html, 'food/households-receiving-calfresh', 'Supporting source');
    expect(supporting).toMatch(/class="[^"]*bg-red-50/);
    expect(supporting).toContain('A new value needs a link to where this number came from.');
    expect(html).toContain('2 cells need fixing.');
  });

  it('notes what can be saved but is worth a second look, without counting it as needing fixing', () => {
    const html = editing([
      { rowId: 'food/food-insecurity-rate', column: 'year', text: '24' },
      { rowId: 'food/food-insecurity-rate', column: 'source_url', text: 'see the PDF' },
    ]);
    const year = cellOf(html, 'food/food-insecurity-rate', 'Year');
    expect(year).toMatch(/class="(?:[^"]* )?bg-amber-100[ "]/);
    expect(year).not.toContain('bg-red-50');
    expect(year).toContain(`Check: ${NOT_A_YEAR_NOTE}`);
    expect(cellOf(html, 'food/food-insecurity-rate', 'Link')).toContain(`Check: ${NOT_A_LINK_NOTE}`);
    expect(html).not.toContain('need fixing');
    expect(html).not.toContain('needs fixing');
    expect(html).toContain('2 cells have a note to check; they do not stop you finishing.');
  });

  it('shows an emptied value as missing data, to be saved as such', () => {
    const html = editing([{ rowId: 'health/uninsured-rate', column: 'value', text: '' }]);
    const value = cellOf(html, 'health/uninsured-rate', 'Value');
    expect(value).toContain(`${en.doughnut.dataNeeded}</span>`);
    expect(value).toContain('Will be saved as missing data.');
    expect(value).toContain('Was: 5.1');
    // Missing data needs no supporting link.
    expect(html).not.toContain('cells need fixing');
  });

  it('shows a choice by its word, and a very long typed name wrapped in its column', () => {
    const long = 'A very long indicator name '.repeat(8).trim();
    const html = editing([
      { rowId: 'food/food-insecurity-rate', column: 'geographic_scale', text: 'regional' },
      { rowId: 'food/food-insecurity-rate', column: 'indicator', text: long },
    ]);
    expect(cellOf(html, 'food/food-insecurity-rate', 'Scale')).toContain('<span class="sr-only">Changed: </span>Regional');
    const name = cellOf(html, 'food/food-insecurity-rate', 'Indicator');
    expect(name).toContain(`<span class="whitespace-pre-line break-words">${long}</span>`);
    expect(name).toMatch(/max-w-\[11rem\]/);
    // The sticky first column keeps an opaque highlight of its own.
    expect(name).toMatch(/class="[^"]*sticky[^"]* bg-amber-100[ "]/);
    expect(name).not.toContain('bg-[color:var(--color-bg)]');
  });

  it('ignores staged changes when the page offers no editing', () => {
    const html = render({ startEditing: { writes: [{ rowId: 'food/food-insecurity-rate', column: 'value', text: '13.1' }], label: 'x' } });
    expect(html).not.toContain('Editing</h2>');
    expect(highlighted(html)).toBe(0);
  });

  it('reports what an uploaded file changed and what it left out, in plain words', () => {
    const rows = allRows();
    const records = parseCsv(gridCsv(rows, { statusWord: () => '' }));
    const valueAt = GRID_COLUMNS.findIndex((c) => c.key === 'value');
    records[1]![valueAt] = '13.1';
    records[2]![valueAt] = '10';
    records.splice(records.findIndex((r) => r[0] === 'energy/energy-burden'), 1);
    records.push(['', '', 'A new indicator']);
    const report = parseSpreadsheet(records, rows);
    const lines = uploadReportLines({ fileName: 'santa-cruz-data.csv', staged: report.edits.length, report });
    expect(lines.outcome).toBe('2 changes from santa-cruz-data.csv are now in the table, highlighted. Nothing is saved until you press Done.');
    expect(lines.notes).toEqual([
      '1 row of the table is not in the file. Nothing changes for it: Energy: Energy burden.',
      `Line ${records.length} has no Row ID, so it could not be matched to an indicator and was not read.`,
    ]);
    const nothing = uploadReportLines({ fileName: 'a.csv', staged: 0, report: parseSpreadsheet(parseCsv(gridCsv(rows, { statusWord: () => '' })), rows) });
    expect(nothing).toEqual({ outcome: 'a.csv has nothing different from the table, so nothing changed.', notes: [] });

    // Dimension or Status changed in the file: not read, and said so.
    const moved = parseCsv(gridCsv(rows, { statusWord: () => '' }));
    const dimensionAt = GRID_COLUMNS.findIndex((c) => c.key === 'dimension');
    const statusAt = GRID_COLUMNS.findIndex((c) => c.key === 'status');
    moved[moved.findIndex((r) => r[0] === 'food/food-insecurity-rate')]![dimensionAt] = 'Health';
    moved[moved.findIndex((r) => r[0] === 'energy/energy-burden')]![statusAt] = 'Thriving';
    const ignored = uploadReportLines({ fileName: 'f.csv', staged: 0, report: parseSpreadsheet(moved, rows, { statusWord: () => '' }) });
    expect(ignored.outcome).toBe('Nothing in the table changed. Parts of f.csv were not read; they are listed below.');
    expect(ignored.notes).toEqual([
      '2 rows have a different Dimension, Status or Evidence in the file. These columns cannot be changed from a file, so those cells were not read: Food: Food insecurity rate (Dimension); Energy: Energy burden (Status). Status is worked out from the value and the target.',
    ]);

    // Another portrait's file: no line matches.
    const other = parseCsv(gridCsv(rows, { statusWord: () => '' })).map((r, i) => (i === 0 ? r : [`elsewhere/${r[0]}`, ...r.slice(1)]));
    const stranger = uploadReportLines({ fileName: 'other.csv', staged: 0, report: parseSpreadsheet(other, rows) });
    expect(stranger.outcome).toBe('None of the rows in other.csv are in this table, so nothing changed. Is it the download of another portrait?');
    const failed = uploadReportLines({ fileName: 'b.csv', staged: 0, report: parseSpreadsheet([['Indicator']], rows) });
    expect(failed.outcome).toMatch(/^Nothing was read from b\.csv\. The file has no Row ID and Version columns/);
  });
});

