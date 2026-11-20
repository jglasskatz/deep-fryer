import type { GridRow } from './grid-data';

/*
 * The data table's columns, defined once: the table on the Data page shows
 * them, the CSV download writes them in this order under these headers, and
 * reading an edited file back maps its headers to them (columnForHeader).
 *
 * Two columns exist for the file only: `row_id` names the row as
 * `<dimension slug>/<indicator key>`, which stays the same when the
 * indicator is renamed, and `base_version` is the number of the dimension's
 * version the row was read from, so a file edited while someone else saved
 * that dimension can be told apart from a current one.
 */

export type GridColumnKey =
  | 'row_id'
  | 'base_version'
  | 'dimension'
  | 'indicator'
  | 'value'
  | 'unit'
  | 'year'
  | 'target'
  | 'status'
  | 'source'
  | 'source_url'
  | 'supporting_source_url'
  | 'geographic_scale'
  | 'confidence'
  | 'evidence';

/**
 * What a column holds: `id` names the row and must come back unchanged,
 * `data` is what a person may change, `derived` is worked out from the rest
 * (or attached another way) and is ignored when a file is read back.
 */
export type GridColumnKind = 'id' | 'data' | 'derived';

export interface GridColumn {
  key: GridColumnKey;
  /** The column's header in the table. */
  label: string;
  /** The column's header in a downloaded file. */
  csvHeader: string;
  kind: GridColumnKind;
  /** Shown as a column of the table (the id columns are only in the file). */
  inTable: boolean;
}

export const GRID_COLUMNS: readonly GridColumn[] = [
  { key: 'row_id', label: 'Row ID', csvHeader: 'Row ID (keep as is)', kind: 'id', inTable: false },
  { key: 'base_version', label: 'Version', csvHeader: 'Version (keep as is)', kind: 'id', inTable: false },
  { key: 'indicator', label: 'Indicator', csvHeader: 'Indicator', kind: 'data', inTable: true },
  { key: 'value', label: 'Value', csvHeader: 'Value', kind: 'data', inTable: true },
  { key: 'unit', label: 'Unit', csvHeader: 'Unit', kind: 'data', inTable: true },
  { key: 'year', label: 'Year', csvHeader: 'Year', kind: 'data', inTable: true },
  { key: 'target', label: 'Target', csvHeader: 'Target', kind: 'data', inTable: true },
  { key: 'status', label: 'Status', csvHeader: 'Status', kind: 'derived', inTable: true },
  { key: 'dimension', label: 'Dimension', csvHeader: 'Dimension', kind: 'derived', inTable: true },
  { key: 'source', label: 'Source', csvHeader: 'Source', kind: 'data', inTable: true },
  { key: 'source_url', label: 'Link', csvHeader: 'Source link', kind: 'data', inTable: true },
  {
    key: 'supporting_source_url',
    label: 'Supporting source',
    csvHeader: 'Supporting source link',
    kind: 'data',
    inTable: true,
  },
  { key: 'geographic_scale', label: 'Scale', csvHeader: 'Scale', kind: 'data', inTable: true },
  { key: 'confidence', label: 'Confidence', csvHeader: 'Confidence', kind: 'data', inTable: true },
  { key: 'evidence', label: 'Evidence', csvHeader: 'Evidence', kind: 'derived', inTable: true },
];

export const TABLE_COLUMNS: readonly GridColumn[] = GRID_COLUMNS.filter((c) => c.inTable);

const headerKey = (header: string) => header.trim().toLowerCase().replace(/\s+/g, ' ');

const COLUMN_BY_HEADER = new Map<string, GridColumn>(
  GRID_COLUMNS.flatMap((c) => [
    [headerKey(c.csvHeader), c],
    [headerKey(c.label), c],
    [headerKey(c.key), c],
  ]),
);

/**
 * The column a file's header names: its file header, its table label or its
 * key, ignoring case and repeated spaces, so a header someone retyped still
 * matches. Undefined for a header that is none of these.
 */
export function columnForHeader(header: string): GridColumn | undefined {
  return COLUMN_BY_HEADER.get(headerKey(header.replace(/^﻿/, '')));
}

/** How the file writer words the parts of a row that have no single stored value. */
export interface GridCsvContext {
  /** The status in words for a row's doughnut level (null when it has none). */
  statusWord: (vizLevel: number | null) => string;
  /** Turns a site path (an evidence file) into a full address; unchanged by default. */
  absoluteUrl?: (href: string) => string;
}

/** A row's text for one column of the file. Empty when it has none. */
export function csvValue(row: GridRow, key: GridColumnKey, ctx: GridCsvContext): string {
  const text = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  switch (key) {
    case 'row_id':
      return row.rowId;
    case 'base_version':
      return String(row.baseVersion);
    case 'dimension':
      return row.dimensionName;
    case 'indicator':
      return row.name;
    case 'value':
      return text(row.value);
    case 'unit':
      return row.unit;
    case 'year':
      return text(row.year);
    case 'target':
      return text(row.target);
    case 'status':
      return row.value === null ? '' : ctx.statusWord(row.vizLevel);
    case 'source':
      return row.source;
    case 'source_url':
      return row.sourceUrl;
    case 'supporting_source_url':
      return row.supportingSourceUrl;
    case 'geographic_scale':
      return row.geographicScale;
    case 'confidence':
      return row.confidence;
    case 'evidence': {
      if (!row.evidence) return '';
      const absolute = ctx.absoluteUrl ?? ((href: string) => href);
      return [row.evidence.href, row.evidence.pdfHref].filter(Boolean).map((h) => absolute(h as string)).join(' ');
    }
  }
}

// ---- CSV ----

/**
 * Text a spreadsheet reads as a number or plain text and never as a formula:
 * a plain number, a signed percentage ("-5%", "+3.4%"), or a lone sign
 * standing for "none" ("-").
 */
const PLAIN_NUMBER = /^([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?%?|[+-])$/;

/**
 * Text a spreadsheet program would run as a formula when the file is opened
 * (it starts with =, +, -, @, a tab or a carriage return), possibly behind
 * apostrophes this guard added before. Source names and links come from
 * research on the open web, so a downloaded file must not run them.
 */
const FORMULA_START = /^'*[=+\-@\t\r]/;

/**
 * The cell as written to the file: formula-like text gets one leading
 * apostrophe, which spreadsheet programs read as "this is text" (readCsvCell
 * takes it off again), and a plain number or percentage is left alone.
 */
export function guardCsvCell(value: string): string {
  return FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
}

/** The value of a cell read from a file: guardCsvCell undone. */
export function readCsvCell(cell: string): string {
  return FORMULA_START.test(cell) && cell.startsWith("'") ? cell.slice(1) : cell;
}

/** One field, quoted when it holds a comma, a quote or a line break (RFC 4180), quotes doubled. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Records joined with CRLF (RFC 4180), each field guarded and quoted. */
export function toCsv(records: readonly (readonly string[])[]): string {
  return records.map((r) => r.map((cell) => csvField(guardCsvCell(cell))).join(',')).join('\r\n') + '\r\n';
}

/**
 * Every row as a CSV file: a byte order mark, so Excel reads accented
 * letters and symbols (µg/m³) correctly, then the headers, then one line per
 * row in the order given.
 */
export function gridCsv(rows: readonly GridRow[], ctx: GridCsvContext): string {
  const header = GRID_COLUMNS.map((c) => c.csvHeader);
  const body = rows.map((row) => GRID_COLUMNS.map((c) => csvValue(row, c.key, ctx)));
  return `﻿${toCsv([header, ...body])}`;
}

/**
 * Read CSV text into records (RFC 4180): quoted fields may hold commas,
 * doubled quotes and line breaks; lines may end in CRLF, LF or CR; a leading
 * byte order mark and a final line break are dropped. Cells are returned as
 * written: readCsvCell undoes the formula guard.
 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
    } else if (ch === ',') {
      record.push(field);
      field = '';
      i++;
    } else if (ch === '\r' || ch === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/** A file name for the download: the portrait's slug and the day, e.g. santa-cruz-data-2026-11-20.csv. */
export function gridCsvFileName(tenantSlug: string, today: Date = new Date()): string {
  return `${tenantSlug}-data-${today.toISOString().slice(0, 10)}.csv`;
}
