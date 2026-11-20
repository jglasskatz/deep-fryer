import { describe, expect, it } from 'vitest';
import { santaCruzFixture } from '@/components/admin/grid/test-fixture';
import { GRID_COLUMNS, gridCsv, parseCsv, readCsvCell, toCsv, type GridCsvContext } from './grid-columns';
import { gridRows, type GridRow } from './grid-data';
import {
  EDITABLE_COLUMNS,
  MAX_SPREADSHEET_BYTES,
  NOT_A_LINK_NOTE,
  NOT_A_YEAR_NOTE,
  NOT_UTF8,
  NO_NAME_NOTE,
  cellNote,
  cellProblem,
  decodeSpreadsheetBytes,
  parseClipboard,
  parseSpreadsheet,
  readCell,
  readValueText,
  sameAsSaved,
  savedCellText,
  spreadsheetFileProblem,
} from './spreadsheet-import';

/**
 * Reading what people bring back to the data table: a cell's text, a range
 * copied from a spreadsheet program, and an edited copy of the download.
 * Only what differs from the table is staged, and everything in a file that
 * is not read is reported.
 */

const ctx: GridCsvContext = { statusWord: (level) => (level === null ? 'Not scored' : `level ${level}`) };
const allRows = () => gridRows(santaCruzFixture(), { evidenceHref: (p) => `/files/santa-cruz/${p}` });
const download = (rows: GridRow[]) => parseCsv(gridCsv(rows, ctx));
const col = (key: string) => GRID_COLUMNS.findIndex((c) => c.key === key);
const byId = (rows: GridRow[], id: string) => rows.find((r) => r.rowId === id)!;

describe('reading one cell', () => {
  it('reads a value or target as a number when it is one, as text otherwise, and empty as no value', () => {
    expect(readValueText('12.4')).toBe(12.4);
    expect(readValueText(' 1,240 ')).toBe(1240);
    expect(readValueText('-3')).toBe(-3);
    expect(readValueText('92846')).toBe(92846);
    expect(readValueText('12.4%')).toBe('12.4%');
    expect(readValueText('70,000+ a month')).toBe('70,000+ a month');
    expect(readValueText('1e3')).toBe('1e3');
    expect(readValueText('12,34')).toBe('12,34');
    // A decimal point leading or trailing still makes a number.
    expect(readValueText('.5')).toBe(0.5);
    expect(readValueText('-.25')).toBe(-0.25);
    expect(readValueText('12.')).toBe(12);
    expect(readValueText('.')).toBe('.');
    expect(readValueText('   ')).toBeNull();
  });

  it('stops only what the stored indicator cannot hold, saying why in plain words', () => {
    for (const year of ['2024.5', 'last year', '2024 (est.)', '99999999999999999999']) {
      expect(cellProblem('year', year), year).toBe('Write the year as a whole number, like 2024.');
    }
    expect(cellProblem('year', '')).toBeNull();
    expect(readCell('year', ' 2023 ')).toEqual({ ok: true, value: 2023 });
    expect(readCell('year', '2024.0')).toEqual({ ok: true, value: 2024 });
    expect(cellProblem('confidence', 'very')).toBe('Choose High, Medium or Low.');
    expect(cellProblem('confidence', '')).toBe('Choose High, Medium or Low.');
    expect(readCell('confidence', 'MEDIUM')).toEqual({ ok: true, value: 'medium' });
    expect(cellProblem('geographic_scale', 'town')).toBe('Choose one of: City, County, Regional, State, National, Global.');
    expect(readCell('geographic_scale', 'County')).toEqual({ ok: true, value: 'county' });
    expect(cellProblem('supporting_source_url', 'https://data.census.gov/table/S1701')).toBeNull();
    expect(cellProblem('source_url', '')).toBeNull();
    expect(cellProblem('value', 'anything at all')).toBeNull();
    expect(cellProblem('unit', '')).toBeNull();
  });

  it('lets through what the stored indicator can hold but is worth a second look, with a note', () => {
    // A nameless indicator, a year that is not four digits and a link that is not a web address can all be stored.
    expect(cellProblem('indicator', '  ')).toBeNull();
    expect(cellNote('indicator', '  ')).toBe(NO_NAME_NOTE);
    for (const year of ['24', '-5', '20245']) {
      expect(cellProblem('year', year), year).toBeNull();
      expect(cellNote('year', year), year).toBe(NOT_A_YEAR_NOTE);
    }
    expect(readCell('year', '24')).toEqual({ ok: true, value: 24, note: NOT_A_YEAR_NOTE });
    for (const link of ['www.census.gov', 'javascript:alert(1)', 'https://exa mple.org', 'see the PDF']) {
      expect(cellProblem('source_url', link), link).toBeNull();
      expect(cellNote('source_url', link), link).toBe(NOT_A_LINK_NOTE);
      expect(cellNote('supporting_source_url', link), link).toBe(NOT_A_LINK_NOTE);
    }
    expect(readCell('source_url', ' see the PDF ')).toEqual({ ok: true, value: 'see the PDF', note: NOT_A_LINK_NOTE });
    for (const [key, text] of [['indicator', 'Food'], ['year', '2024'], ['source_url', 'https://data.census.gov/'], ['source_url', ''], ['value', 'x']] as const) {
      expect(cellNote(key, text), `${key} ${text}`).toBeNull();
    }
  });

  it('treats text that says what the row stores as no change, however it is spelled', () => {
    const rows = allRows();
    const income = byId(rows, 'income-work/median-household-income');
    expect(sameAsSaved(income, 'value', '92,846')).toBe(true);
    expect(sameAsSaved(income, 'value', '92846.0')).toBe(true);
    expect(sameAsSaved(income, 'value', '92847')).toBe(false);
    expect(sameAsSaved(income, 'geographic_scale', 'City')).toBe(true);
    expect(sameAsSaved(income, 'confidence', ' high ')).toBe(true);
    expect(sameAsSaved(income, 'source', 'US Census ACS 5-year ')).toBe(true);
    const clients = byId(rows, 'food/food-bank-monthly-clients');
    expect(sameAsSaved(clients, 'value', '70,000+ a month, "surging" to 100,000\r\nduring federal cuts')).toBe(true);
    // A link the row already has stays as it is, even one that would not be accepted if typed.
    const unsafe = rows.find((r) => r.sourceUrl === 'javascript:alert(1)')!;
    expect(sameAsSaved(unsafe, 'source_url', 'javascript:alert(1)')).toBe(true);
  });
});

describe('parseClipboard', () => {
  it('reads cells copied from a spreadsheet program: tabs between cells, a line per row, the last line break dropped', () => {
    expect(parseClipboard('12\t%\t2023\r\n14\t%\t2024\r\n')).toEqual([
      ['12', '%', '2023'],
      ['14', '%', '2024'],
    ]);
    expect(parseClipboard('one cell')).toEqual([['one cell']]);
    expect(parseClipboard('a\t\tc\n')).toEqual([['a', '', 'c']]);
    expect(parseClipboard('\n')).toEqual([['']]);
    expect(parseClipboard('')).toEqual([]);
  });

  it('reads a quoted cell holding a line break, a tab or quotes, and leaves a cell that only starts with a quote as written', () => {
    expect(parseClipboard('"two\nlines"\tnext\n"say ""hi"""\t"a\tb"\n')).toEqual([
      ['two\nlines', 'next'],
      ['say "hi"', 'a\tb'],
    ]);
    expect(parseClipboard('"surging" to 100,000\tx')).toEqual([['"surging" to 100,000', 'x']]);
    expect(parseClipboard('"unclosed\tx')).toEqual([['"unclosed', 'x']]);
  });

  it('takes off the mark the download puts before text that looks like a formula', () => {
    expect(parseClipboard(`'=HYPERLINK("x")\t'-5 apples`)).toEqual([['=HYPERLINK("x")', '-5 apples']]);
  });
});

describe('parseSpreadsheet', () => {
  it('stages nothing for the download read back unchanged, and finds every row', () => {
    const rows = allRows();
    const result = parseSpreadsheet(download(rows), rows);
    expect(result).toEqual({
      problem: null,
      edits: [],
      readRows: 80,
      missingRows: [],
      ignoredChanges: [],
      unmatchedRows: [],
      rowsWithoutId: [],
      repeatedRows: [],
      staleRows: [],
      unknownColumns: [],
      repeatedColumns: [],
    });
  });

  it('stages two edits from a file with two values changed and one row deleted, and reports the missing row', () => {
    const rows = allRows();
    const records = download(rows);
    const at = (id: string) => records.findIndex((r) => r[0] === id);
    records[at('food/food-insecurity-rate')]![col('value')] = '13.1';
    records[at('housing/homelessness-rate')]![col('value')] = '79';
    records.splice(at('energy/energy-burden'), 1);

    // Written out again as a spreadsheet program saves it: the cells as it shows them, quoted where needed.
    const result = parseSpreadsheet(parseCsv(toCsv(records.map((r) => r.map(readCsvCell)))), rows);
    expect(result.problem).toBeNull();
    expect(result.edits).toEqual([
      { rowId: 'food/food-insecurity-rate', column: 'value', text: '13.1' },
      { rowId: 'housing/homelessness-rate', column: 'value', text: '79' },
    ]);
    expect(result.missingRows).toEqual([{ rowId: 'energy/energy-burden', name: 'Energy burden', dimensionName: 'Energy' }]);
  });

  it('stages an emptied value as a gap, and reads columns in any order and any capitals', () => {
    const rows = allRows();
    const [header, ...body] = download(rows);
    const order = [col('value'), col('row_id'), col('unit'), col('base_version')];
    const records = [order.map((i) => header![i]!.toUpperCase()), ...body.map((r) => order.map((i) => r[i]!))];
    const line = records.findIndex((r) => r[1] === 'health/uninsured-rate');
    records[line]![0] = '';
    records[line]![2] = '% of all residents';
    expect(parseSpreadsheet(records, rows).edits).toEqual([
      { rowId: 'health/uninsured-rate', column: 'value', text: '' },
      { rowId: 'health/uninsured-rate', column: 'unit', text: '% of all residents' },
    ]);
  });

  it('changes nothing for a column left out of the file, or a line too short to reach it', () => {
    const rows = allRows();
    const records = download(rows).map((r) => r.filter((_, i) => i !== col('unit')));
    const short = records.findIndex((r) => r[0] === 'food/food-insecurity-rate');
    records[short] = records[short]!.slice(0, 3);
    const result = parseSpreadsheet(records, rows);
    expect(result.edits).toEqual([]);
    expect(result.missingRows).toEqual([]);
  });

  it('never stages the columns the app works out (Status, Dimension, Evidence), and names the rows where the file changed them', () => {
    const rows = allRows();
    const records = download(rows);
    const at = (id: string) => records.findIndex((r) => r[0] === id);
    for (const key of ['status', 'dimension', 'evidence']) records[at('climate-change/ghg-per-capita')]![col(key)] = 'changed by hand';
    records[at('food/food-insecurity-rate')]![col('dimension')] = 'Health';
    records[at('housing/homelessness-rate')]![col('status')] = 'Thriving';
    records[at('housing/homelessness-rate')]![col('value')] = '79';
    const result = parseSpreadsheet(records, rows, ctx);
    // The rest of a row is still read.
    expect(result.edits).toEqual([{ rowId: 'housing/homelessness-rate', column: 'value', text: '79' }]);
    expect(result.ignoredChanges).toEqual([
      { rowId: 'food/food-insecurity-rate', name: 'Food insecurity rate', dimensionName: 'Food', columns: ['Dimension'] },
      { rowId: 'housing/homelessness-rate', name: 'Residents experiencing homelessness', dimensionName: 'Housing', columns: ['Status'] },
      {
        rowId: 'climate-change/ghg-per-capita',
        name: byId(rows, 'climate-change/ghg-per-capita').name,
        dimensionName: byId(rows, 'climate-change/ghg-per-capita').dimensionName,
        columns: ['Status', 'Dimension', 'Evidence'],
      },
    ].sort((a, b) => at(a.rowId) - at(b.rowId)));
    // Without the download's wording only the Dimension can be compared.
    expect(parseSpreadsheet(records, rows).ignoredChanges.map((r) => r.columns)).toEqual(
      result.ignoredChanges.map((r) => r.columns.filter((c) => c === 'Dimension')).filter((c) => c.length > 0),
    );
  });

  it('reads back evidence written as a full address, and spaces a spreadsheet program changed, as no change', () => {
    const rows = allRows();
    const full: GridCsvContext = { ...ctx, absoluteUrl: (href) => `https://doughnut.example.org${href}` };
    const records = parseCsv(gridCsv(rows, full));
    const line = records.findIndex((r) => r[0] === 'food/food-insecurity-rate');
    records[line]![col('dimension')] = '  Food ';
    expect(parseSpreadsheet(records, rows, full).ignoredChanges).toEqual([]);
    expect(parseSpreadsheet(download(rows), rows, full).ignoredChanges).toEqual([]);
  });

  it('reads a value with commas, quotes and a line break, and a source that looks like a formula, back unchanged', () => {
    const rows = allRows();
    const records = parseCsv(gridCsv(rows, ctx));
    expect(records.some((r) => r.includes(`'=HYPERLINK("https://example.org","City Clerk")`))).toBe(true);
    expect(parseSpreadsheet(records, rows).edits).toEqual([]);
  });

  it('does not read a row saved again since the file was downloaded, and says so', () => {
    const rows = allRows();
    const records = download(rows);
    const line = records.findIndex((r) => r[0] === 'housing/homelessness-rate');
    records[line]![col('base_version')] = '3';
    records[line]![col('value')] = '79';
    const result = parseSpreadsheet(records, rows);
    expect(result.edits).toEqual([]);
    expect(result.staleRows).toEqual([
      { rowId: 'housing/homelessness-rate', name: 'Residents experiencing homelessness', dimensionName: 'Housing', fileVersion: '3', currentVersion: 4 },
    ]);
    expect(result.missingRows).toEqual([]);
  });

  it('reports lines it cannot match, repeated rows and columns, and columns that are not the table’s', () => {
    const rows = allRows();
    const records = download(rows);
    records[0] = [...records[0]!, 'Notes', 'Value'];
    const first = records[1]!;
    records.push(['food/no-such-indicator', '2', 'Made up', '1']);
    records.push(['', '', 'A new indicator', '5']);
    records.push([...first]);
    records.push(['', '', '', '']);
    const result = parseSpreadsheet(records, rows);
    expect(result.unknownColumns).toEqual(['Notes']);
    expect(result.repeatedColumns).toEqual(['Value']);
    expect(result.unmatchedRows).toEqual([{ line: records.length - 3, rowId: 'food/no-such-indicator' }]);
    expect(result.rowsWithoutId).toEqual([records.length - 2]);
    expect(result.repeatedRows).toEqual([{ line: records.length - 1, rowId: first[0] }]);
    expect(result.edits).toEqual([]);
  });

  it('reads nothing from a file without the Row ID or Version column, or an empty one', () => {
    const rows = allRows();
    const noId = download(rows).map((r) => r.slice(1));
    expect(parseSpreadsheet(noId, rows).problem).toMatch(/^The file has no Row ID column, so its lines cannot be matched/);
    expect(parseSpreadsheet(noId, rows).edits).toEqual([]);
    const noVersion = download(rows).map((r) => r.filter((_, i) => i !== col('base_version')));
    expect(parseSpreadsheet(noVersion, rows).problem).toMatch(/^The file has no Version column/);
    expect(parseSpreadsheet([['Indicator', 'Value']], rows).problem).toMatch(/^The file has no Row ID and Version columns/);
    expect(parseSpreadsheet([], rows).problem).toBe('The file is empty.');
    expect(parseSpreadsheet([[''], ['', '']], rows).problem).toBe('The file is empty.');
  });

  it('says a file separated by semicolons or tabs needs saving with commas, instead of asking for columns it has', () => {
    const rows = allRows();
    const lines = toCsv(download(rows)).split('\r\n');
    const semicolons = parseCsv(lines.map((l) => l.replace(/,/g, ';')).join('\r\n'));
    const result = parseSpreadsheet(semicolons, rows);
    expect(result.problem).toBe(
      'The cells in this file are separated by semicolons, not commas. In your spreadsheet program choose Save As and pick “CSV UTF-8 (Comma delimited)”, then upload that file.',
    );
    expect(result.problem).not.toContain('Row ID');
    expect(result.edits).toEqual([]);
    const tabs = parseCsv(download(rows).map((r) => r.join('\t')).join('\r\n'));
    expect(parseSpreadsheet(tabs, rows).problem).toMatch(/^The cells in this file are separated by tabs, not commas\./);
    // One header cell that merely holds a semicolon is still a file with no Row ID.
    expect(parseSpreadsheet([['Indicator; Value']], rows).problem).toMatch(/^The file has no Row ID and Version columns/);
  });

  it('skips blank lines at the top before the headers', () => {
    const rows = allRows();
    expect(parseSpreadsheet([[''], ...download(rows)], rows).edits).toEqual([]);
  });

  it('can stage every column a person may change', () => {
    const rows = allRows();
    const records = download(rows);
    const line = records.findIndex((r) => r[0] === 'food/food-insecurity-rate');
    const next: Record<string, string> = {
      indicator: 'Food insecurity', value: '13', unit: '% of people', year: '2024', target: '9', source: 'Feeding America',
      source_url: 'https://map.feedingamerica.org/', supporting_source_url: 'https://map.feedingamerica.org/county',
      geographic_scale: 'City', confidence: 'High',
    };
    for (const [key, text] of Object.entries(next)) records[line]![col(key)] = text;
    const edits = parseSpreadsheet(records, rows).edits;
    expect(edits.map((e) => e.column)).toEqual(EDITABLE_COLUMNS.map((c) => c.key));
    expect(edits.every((e) => e.text === next[e.column])).toBe(true);
    expect(savedCellText(byId(rows, 'food/food-insecurity-rate'), 'value')).toBe('12.4');
  });
});

describe('decodeSpreadsheetBytes', () => {
  it('reads a CSV UTF-8 file, with or without its byte order mark', () => {
    const text = 'Unit\r\nµg/m³\r\n';
    expect(decodeSpreadsheetBytes(new TextEncoder().encode(text))).toEqual({ text, problem: null });
    expect(decodeSpreadsheetBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)])).text).toBe(text);
  });

  it('refuses a file saved in another encoding, with what to do instead, rather than staging damaged text', () => {
    // "Unit / µg/m³" as Excel's plain "CSV (Comma delimited)" saves it on Windows (Windows-1252, Latin-1 here): µ is 0xB5, ³ is 0xB3.
    const latin1 = new Uint8Array([...'Unit\r\n'].map((c) => c.charCodeAt(0)).concat([0xb5, 0x67, 0x2f, 0x6d, 0xb3, 0x0d, 0x0a]));
    expect(decodeSpreadsheetBytes(latin1)).toEqual({ text: null, problem: NOT_UTF8 });
    expect(NOT_UTF8).toMatch(/Save As and pick “CSV UTF-8”/);
    // UTF-16, as "Unicode Text" saves, is refused the same way.
    expect(decodeSpreadsheetBytes(new Uint8Array([0xff, 0xfe, 0x52, 0x00])).problem).toBe(NOT_UTF8);
    // Plain letters and digits read the same in any of these encodings.
    expect(decodeSpreadsheetBytes(new Uint8Array([0x52, 0x6f, 0x77])).text).toBe('Row');
  });
});

describe('spreadsheetFileProblem', () => {
  const csv = new TextEncoder().encode('Row');
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  it('turns away a workbook with what to do instead, and a file too large or of another kind', () => {
    expect(spreadsheetFileProblem({ name: 'data.xlsx', size: 1000 }, zip)).toMatch(/This is a workbook, not a CSV file\. .*CSV UTF-8/);
    expect(spreadsheetFileProblem({ name: 'data.csv', size: 1000 }, zip)).toMatch(/This is a workbook/);
    expect(spreadsheetFileProblem({ name: 'data.ods', size: 1000 }, csv)).toMatch(/This is a workbook/);
    expect(spreadsheetFileProblem({ name: 'data.csv', size: MAX_SPREADSHEET_BYTES + 1 }, csv)).toMatch(/too large/);
    expect(spreadsheetFileProblem({ name: 'data.csv', size: 0 }, new Uint8Array())).toBe('The file is empty.');
    expect(spreadsheetFileProblem({ name: 'photo.png', size: 1000 }, csv)).toMatch(/^Upload a CSV file/);
    expect(spreadsheetFileProblem({ name: 'Santa Cruz data.CSV', size: 1000 }, csv)).toBeNull();
  });
});
