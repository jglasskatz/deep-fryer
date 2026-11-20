import { describe, expect, it } from 'vitest';
import { assignIndicatorKeys, frameworkIndicatorKeys } from '@deep-fryer/core';
import { santaCruzFixture } from '@/components/admin/grid/test-fixture';
import {
  GRID_COLUMNS,
  TABLE_COLUMNS,
  columnForHeader,
  csvValue,
  gridCsv,
  gridCsvFileName,
  guardCsvCell,
  parseCsv,
  readCsvCell,
  toCsv,
  type GridCsvContext,
} from './grid-columns';
import { gridRows, isGridSortKey, parseRowId } from './grid-data';

/**
 * The table's columns, defined once, and the CSV download built from them:
 * one line per row under plain headers, every row named by an ID that
 * resolves to its indicator, and every value back exactly as it was when
 * the file is read again.
 */

const ctx: GridCsvContext = {
  statusWord: (level) => (level === null ? 'Not scored' : `level ${level}`),
  absoluteUrl: (href) => new URL(href, 'https://doughnut.example.org').href,
};

const fixture = () => {
  const dims = santaCruzFixture();
  return { dims, rows: gridRows(dims, { evidenceHref: (p) => `/files/santa-cruz/${p}` }) };
};

describe('GRID_COLUMNS', () => {
  it('defines each column once, with the row ID and version first and only in the file', () => {
    const keys = GRID_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.slice(0, 2)).toEqual(['row_id', 'base_version']);
    expect(TABLE_COLUMNS.map((c) => c.key)).not.toContain('row_id');
    expect(TABLE_COLUMNS.map((c) => c.key)).not.toContain('base_version');
    expect(TABLE_COLUMNS.map((c) => c.label)).toEqual([
      'Indicator', 'Value', 'Unit', 'Year', 'Target', 'Status', 'Dimension', 'Source', 'Link',
      'Supporting source', 'Scale', 'Confidence', 'Evidence',
    ]);
  });

  it('lets the table sort by every column it shows', () => {
    expect(TABLE_COLUMNS.filter((c) => !isGridSortKey(c.key))).toEqual([]);
  });

  it('finds a column by its file header, its table label or its key, however it is capitalised', () => {
    expect(columnForHeader('Row ID (keep as is)')?.key).toBe('row_id');
    expect(columnForHeader('﻿row id (KEEP  as is)')?.key).toBe('row_id');
    expect(columnForHeader('Source link')?.key).toBe('source_url');
    expect(columnForHeader('link')?.key).toBe('source_url');
    expect(columnForHeader('supporting_source_url')?.key).toBe('supporting_source_url');
    expect(columnForHeader('Notes')).toBeUndefined();
  });
});

describe('the CSV download', () => {
  it('has one line per indicator under the headers, and every row ID resolves to its indicator', () => {
    const { dims, rows } = fixture();
    const records = parseCsv(gridCsv(rows, ctx));
    const [header, ...body] = records;
    expect(header).toEqual(GRID_COLUMNS.map((c) => c.csvHeader));
    expect(body).toHaveLength(80);
    expect(body.every((r) => r.length === GRID_COLUMNS.length)).toBe(true);

    const ids = body.map((r) => r[0]!);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [id, version, name] of body) {
      const parsed = parseRowId(id!);
      expect(parsed, id).not.toBeNull();
      const dim = dims.find((d) => d.dimension.slug === parsed!.dimensionSlug);
      expect(dim, id).toBeDefined();
      expect(version).toBe(String(dim!.latest!.versionNum));
      // The key the next save gives this indicator is the one in the file.
      const keyed = assignIndicatorKeys(
        dim!.latest!.data.indicators,
        [],
        frameworkIndicatorKeys(dim!.dimension.slug, dim!.dimension.canonicalSlug),
      );
      const indicator = keyed.find((i) => i.key === parsed!.key);
      const gap = dim!.latest!.data.gaps?.find((g) => g.indicator === parsed!.key);
      expect(indicator ?? gap, id).toBeDefined();
      if (indicator) expect(name).toBe(indicator.name);
    }
  });

  it('gives back every value exactly, including commas, quotes and a line break', () => {
    const { rows } = fixture();
    const body = parseCsv(gridCsv(rows, ctx)).slice(1);
    const tricky = rows.findIndex((r) => r.rowId === 'food/food-bank-monthly-clients');
    expect(rows[tricky]!.value).toBe('70,000+ a month, "surging" to 100,000\nduring federal cuts');
    expect(readCsvCell(body[tricky]![GRID_COLUMNS.findIndex((c) => c.key === 'value')]!)).toBe(rows[tricky]!.value);
    rows.forEach((row, i) => {
      GRID_COLUMNS.forEach((col, c) => {
        expect(readCsvCell(body[i]![c]!), `${row.rowId} ${col.key}`).toBe(csvValue(row, col.key, ctx));
      });
    });
  });

  it('keeps a formula-like source from running in a spreadsheet, and gives it back unchanged', () => {
    const { rows } = fixture();
    const csv = gridCsv(rows, ctx);
    expect(csv).toContain(`"'=HYPERLINK(""https://example.org"",""City Clerk"")"`);
    const row = rows.find((r) => r.source.startsWith('='))!;
    const body = parseCsv(csv).slice(1);
    const cell = body[rows.indexOf(row)]![GRID_COLUMNS.findIndex((c) => c.key === 'source')]!;
    expect(readCsvCell(cell)).toBe(row.source);
  });

  it('starts with a byte order mark and ends lines with CRLF', () => {
    const { rows } = fixture();
    const csv = gridCsv(rows.slice(0, 2), ctx);
    expect(csv.startsWith('﻿Row ID (keep as is),Version (keep as is),Indicator,')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(4);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('writes the status in words, evidence as full addresses, and nothing for what a row lacks', () => {
    const { rows } = fixture();
    const ghg = rows.find((r) => r.rowId === 'climate-change/ghg-per-capita')!;
    expect(csvValue(ghg, 'evidence', ctx)).toBe(
      'https://doughnut.example.org/files/santa-cruz/evidence/ghg.png https://doughnut.example.org/files/santa-cruz/evidence/ghg.pdf',
    );
    expect(csvValue(ghg, 'status', ctx)).toMatch(/^level /);
    const unscored = rows.find((r) => r.rowId === 'food/households-receiving-calfresh')!;
    expect(csvValue(unscored, 'status', ctx)).toBe('Not scored');
    const gap = rows.find((r) => r.rowId === 'peace-justice/hate-crimes-reported')!;
    expect(['value', 'status', 'year', 'source_url', 'evidence'].map((k) => csvValue(gap, k as never, ctx))).toEqual([
      '', '', '', '', '',
    ]);
  });

  it('names the file after the portrait and the day', () => {
    expect(gridCsvFileName('santa-cruz', new Date('2026-11-20T12:00:00Z'))).toBe('santa-cruz-data-2026-11-20.csv');
  });
});

describe('guardCsvCell and readCsvCell', () => {
  it.each([
    '=1+1',
    '+44 20',
    '-x',
    '@SUM(A1)',
    '\tTabbed',
    "'=already",
    "''=twice",
    "'plain",
    'plain',
    '-5%',
    "'-5%",
    '-',
    '-5%+1',
  ])('%j survives the round trip', (value) => {
    expect(readCsvCell(guardCsvCell(value))).toBe(value);
  });

  it('leaves plain numbers alone, negative ones included', () => {
    expect(guardCsvCell('-3.5')).toBe('-3.5');
    expect(guardCsvCell('+2e3')).toBe('+2e3');
    expect(guardCsvCell('=1')).toBe("'=1");
  });

  it('leaves signed percentages and a lone dash alone, and still guards anything after them', () => {
    expect(guardCsvCell('-5%')).toBe('-5%');
    expect(guardCsvCell('+3.4%')).toBe('+3.4%');
    expect(guardCsvCell('-')).toBe('-');
    expect(guardCsvCell('-5%+1')).toBe("'-5%+1");
    expect(guardCsvCell('-5%%')).toBe("'-5%%");
    expect(guardCsvCell('--')).toBe("'--");
    // A file written before percentages were left alone still reads back as written.
    expect(readCsvCell("'-5%")).toBe('-5%');
  });
});

describe('parseCsv', () => {
  it('reads quoted commas, doubled quotes, line breaks and any line ending', () => {
    expect(parseCsv('a,"b,c","say ""hi""","two\r\nlines"\nx,y,,z\r\n')).toEqual([
      ['a', 'b,c', 'say "hi"', 'two\r\nlines'],
      ['x', 'y', '', 'z'],
    ]);
    expect(parseCsv('one\rtwo')).toEqual([['one'], ['two']]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,\n')).toEqual([['a', '']]);
  });

  it('reads back what toCsv writes', () => {
    const records = [['a', 'b, "c"'], ['line\nbreak', '']];
    expect(parseCsv(toCsv(records))).toEqual(records);
  });
});
