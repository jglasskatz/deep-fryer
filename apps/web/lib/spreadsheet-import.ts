import type { Confidence, GeographicScale } from '@deep-fryer/core';
import { isParseableUrl } from '@deep-fryer/core';
import {
  GRID_COLUMNS,
  columnForHeader,
  csvValue,
  readCsvCell,
  type GridColumn,
  type GridColumnKey,
  type GridCsvContext,
} from './grid-columns';
import type { GridRow } from './grid-data';
import { safeHref } from './safe-url';

/*
 * Reading what people bring back to the data table: text typed into a cell,
 * a range pasted from a spreadsheet program, or a downloaded file edited and
 * uploaded again. Pure, so the table, the first-import pages and their tests
 * all read a cell the same way.
 *
 * Nothing here saves anything. A cell's new text is "staged": it is compared
 * with the row as it was read, and only text that differs becomes an edit.
 * Whether a staged cell can be stored at all is answered by cellProblem
 * (only what the stored indicator refuses); what is worth a second look but
 * can be stored is answered by cellNote. Saving is someone else's job.
 */

// ---- Columns a person may change ----

/** The table columns a person may type into: the `data` columns of grid-columns. */
export type EditableColumnKey = Extract<
  GridColumnKey,
  | 'indicator'
  | 'value'
  | 'unit'
  | 'year'
  | 'target'
  | 'source'
  | 'source_url'
  | 'supporting_source_url'
  | 'geographic_scale'
  | 'confidence'
>;

export const EDITABLE_COLUMNS: readonly GridColumn[] = GRID_COLUMNS.filter((c) => c.kind === 'data');

export function isEditableColumn(key: GridColumnKey): key is EditableColumnKey {
  return EDITABLE_COLUMNS.some((c) => c.key === key);
}

/** The table's name for a column ("Link" for source_url). */
export function columnLabel(key: GridColumnKey): string {
  return GRID_COLUMNS.find((c) => c.key === key)?.label ?? key;
}

/** The choices for the two columns that take one of a fixed list, in the order they are offered. */
export const SCALE_CHOICES: readonly { value: GeographicScale; label: string }[] = [
  { value: 'city', label: 'City' },
  { value: 'county', label: 'County' },
  { value: 'regional', label: 'Regional' },
  { value: 'state', label: 'State' },
  { value: 'national', label: 'National' },
  { value: 'global', label: 'Global' },
];

export const CONFIDENCE_CHOICES: readonly { value: Confidence; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

/** The choices a column takes, or null for a column of free text. */
export function columnChoices(key: EditableColumnKey): readonly { value: string; label: string }[] | null {
  if (key === 'geographic_scale') return SCALE_CHOICES;
  if (key === 'confidence') return CONFIDENCE_CHOICES;
  return null;
}

// ---- One cell ----

/** Cell text as it is kept: line endings made plain, spaces around it dropped. */
export function normalizeCellText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/**
 * A number as people write it in a cell: digits with an optional sign and
 * decimals, thousands optionally grouped with commas ("1,240"), the decimal
 * point leading or trailing (".5", "12."). Anything else ("12.4%",
 * "70,000+ a month", "1e3") stays text, as research keeps it.
 */
const NUMBER_TEXT = /^[+-]?((\d+|\d{1,3}(,\d{3})+)(\.\d*)?|\.\d+)$/;

/** A value or target as stored: empty is no value, a plain number is a number, the rest is text. */
export function readValueText(text: string): number | string | null {
  const t = normalizeCellText(text);
  if (t === '') return null;
  return NUMBER_TEXT.test(t) ? Number(t.replace(/,/g, '')) : t;
}

/** One of a fixed list, from its stored word or the word the table shows, in any capitals. */
function readChoice<T extends string>(text: string, choices: readonly { value: T; label: string }[]): T | null {
  const t = normalizeCellText(text).toLowerCase();
  return choices.find((c) => c.value === t || c.label.toLowerCase() === t)?.value ?? null;
}

/**
 * A cell's text as the stored type, or why it cannot be stored as written.
 * A readable cell may carry a note: something worth a second look that does
 * not stop the change being saved.
 */
export type CellReading =
  | { ok: true; value: string | number | null; note?: string }
  | { ok: false; problem: string };

/** A whole number as a year is stored: digits with an optional sign, and ".0" as a spreadsheet may add. */
const WHOLE_NUMBER = /^[+-]?\d+(\.0+)?$/;
const FOUR_DIGITS = /^\d{4}$/;

export const NO_NAME_NOTE = 'This indicator has no name, so people reading the portrait will not know what the figure is.';
export const NOT_A_YEAR_NOTE = 'This does not look like a year. Years are usually written with four digits, like 2024.';
export const NOT_A_LINK_NOTE = 'This is not a full web address starting with https://, so it will show as text, not as a link.';

/**
 * A cell's text read as what the indicator stores. Only what the stored
 * indicator cannot hold is a problem: a year that is not a whole number, a
 * scale or confidence that is none of its choices. A value or target may be
 * any text (empty is "no value": a gap). A nameless indicator, a year that
 * is not four digits and a link that is not a full web address can all be
 * stored, so they carry a note instead. Problems and notes are worded for
 * the person who typed the cell.
 */
export function readCell(key: EditableColumnKey, text: string): CellReading {
  const t = normalizeCellText(text);
  switch (key) {
    case 'indicator':
      return t ? { ok: true, value: t } : { ok: true, value: '', note: NO_NAME_NOTE };
    case 'value':
    case 'target':
      return { ok: true, value: readValueText(t) };
    case 'year': {
      if (t === '') return { ok: true, value: null };
      const year = Number(t);
      if (!WHOLE_NUMBER.test(t) || !Number.isSafeInteger(year)) {
        return { ok: false, problem: 'Write the year as a whole number, like 2024.' };
      }
      return FOUR_DIGITS.test(String(year)) ? { ok: true, value: year } : { ok: true, value: year, note: NOT_A_YEAR_NOTE };
    }
    case 'geographic_scale': {
      const scale = readChoice(t, SCALE_CHOICES);
      return scale
        ? { ok: true, value: scale }
        : { ok: false, problem: `Choose one of: ${SCALE_CHOICES.map((c) => c.label).join(', ')}.` };
    }
    case 'confidence': {
      const confidence = readChoice(t, CONFIDENCE_CHOICES);
      return confidence ? { ok: true, value: confidence } : { ok: false, problem: 'Choose High, Medium or Low.' };
    }
    case 'source_url':
    case 'supporting_source_url':
      if (t === '') return { ok: true, value: '' };
      return safeHref(t) && isParseableUrl(t) && !/\s/.test(t) ? { ok: true, value: t } : { ok: true, value: t, note: NOT_A_LINK_NOTE };
    case 'unit':
    case 'source':
      return { ok: true, value: t };
  }
}

/** Why a cell's text cannot be stored as written, or null when it can. */
export function cellProblem(key: EditableColumnKey, text: string): string | null {
  const reading = readCell(key, text);
  return reading.ok ? null : reading.problem;
}

/** Something worth a second look about a cell that can be stored as written, or null. */
export function cellNote(key: EditableColumnKey, text: string): string | null {
  const reading = readCell(key, text);
  return reading.ok ? (reading.note ?? null) : null;
}

/** The text an editor starts from for a row's cell: what it stores, as the download writes it. */
export function savedCellText(row: GridRow, key: EditableColumnKey): string {
  return csvValue(row, key, { statusWord: () => '' });
}

/** One canonical spelling of a stored value, so "1,240" and 1240, or "County" and "county", compare equal. */
function canonical(key: EditableColumnKey, text: string): string {
  const reading = readCell(key, text);
  if (!reading.ok) return `\u0000${normalizeCellText(text)}`;
  const v = reading.value;
  return v === null ? '' : String(v);
}

/** Whether text written into a row's cell says what the row already stores (so it is no edit). */
export function sameAsSaved(row: GridRow, key: EditableColumnKey, text: string): boolean {
  return canonical(key, text) === canonical(key, savedCellText(row, key));
}

// ---- Pasted text ----

/**
 * The cells of text copied from a spreadsheet program (Excel, LibreOffice,
 * Google Sheets, Numbers): rows on lines, cells split by tabs. A cell holding
 * a tab, a line break or a quote comes wrapped in quotes with its quotes
 * doubled; a cell that merely starts with a quote is read as written. The
 * line break these programs add after the last row is dropped.
 */
export function parseClipboard(text: string): string[][] {
  if (text === '') return [];
  const src = text.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  let fieldStart = true;
  let field = '';
  while (i <= src.length) {
    if (fieldStart && src[i] === '"') {
      // A quoted cell, when the closing quote is followed by a tab, a line break or the end.
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = j + 1 === src.length || src[j + 1] === '\t' || src[j + 1] === '\n';
          break;
        }
        value += src[j];
        j++;
      }
      if (closed) {
        field = value;
        i = j + 1;
        fieldStart = false;
        continue;
      }
    }
    fieldStart = false;
    const ch = src[i];
    if (ch === undefined || ch === '\n' || ch === '\t') {
      row.push(field);
      field = '';
      fieldStart = true;
      if (ch !== '\t') {
        rows.push(row);
        row = [];
      }
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // The final line break leaves one empty row behind it.
  const last = rows[rows.length - 1];
  if (rows.length > 1 && last && last.length === 1 && last[0] === '' && src.endsWith('\n')) rows.pop();
  return rows.map((r) => r.map(readCsvCell));
}

// ---- An uploaded file ----

/** A cell to stage: the row it belongs to, its column and its new text. */
export interface CellWrite {
  rowId: string;
  column: EditableColumnKey;
  text: string;
}

/** A row of the table, named for a person: its indicator and dimension. */
export interface NamedRow {
  rowId: string;
  name: string;
  dimensionName: string;
}

export interface SpreadsheetImport {
  /**
   * Why nothing in the file could be read (no header, no Row ID or Version
   * column), or null. When set, `edits` is empty.
   */
  problem: string | null;
  /** One write per cell whose text differs from the table, in file order. */
  edits: CellWrite[];
  /** How many lines were matched to a row of the table and read. */
  readRows: number;
  /** Rows of the table the file does not have. Nothing changes for them. */
  missingRows: NamedRow[];
  /**
   * Rows whose Dimension, Status or Evidence cell in the file differs from
   * the table, with those columns' names. A file cannot change them, so
   * these differences were not read (the row's other cells were).
   */
  ignoredChanges: (NamedRow & { columns: string[] })[];
  /** Lines naming a Row ID the table does not have. Not read. */
  unmatchedRows: { line: number; rowId: string }[];
  /** Lines with data but no Row ID. Not read. */
  rowsWithoutId: number[];
  /** Lines naming a row an earlier line already named. Not read. */
  repeatedRows: { line: number; rowId: string }[];
  /**
   * Rows saved again since the file was downloaded (its Version is not the
   * table's). Not read, so a newer save is never undone by an older file.
   */
  staleRows: (NamedRow & { fileVersion: string; currentVersion: number })[];
  /** Headers that name no column of the table, as written. Not read. */
  unknownColumns: string[];
  /** Headers that name a column an earlier header already named. Not read. */
  repeatedColumns: string[];
}

const ID_HELP = 'Download the table again and keep its Row ID and Version columns as they are.';

const isBlankRecord = (record: readonly string[]) => record.every((cell) => cell.trim() === '');

/** Cell separators other than commas that spreadsheet programs save "CSV" files with, in words. */
const OTHER_SEPARATORS: readonly { char: string; words: string }[] = [
  { char: ';', words: 'semicolons' },
  { char: '\t', words: 'tabs' },
];

/**
 * When a header line read as one cell holds the Row ID and Version headers
 * once split on another separator, the words for that separator. Excel set
 * to many languages saves "CSV" with semicolons; numbers in such a file are
 * often written with a decimal comma (12,4), which cannot be told apart from
 * a thousands comma, so the file is refused rather than guessed at.
 */
function otherSeparator(header: readonly string[]): string | null {
  const cells = header.filter((h) => h.trim() !== '');
  if (cells.length !== 1) return null;
  for (const { char, words } of OTHER_SEPARATORS) {
    const keys = cells[0]!.split(char).map((h) => columnForHeader(h.trim().replace(/^"|"$/g, ''))?.key);
    if (keys.includes('row_id') && keys.includes('base_version')) return words;
  }
  return null;
}

/** The columns the app works out (or attaches another way) that a file can still carry, in the table's order. */
const DERIVED_IN_FILE: readonly GridColumnKey[] = GRID_COLUMNS.filter((c) => c.kind === 'derived').map((c) => c.key);

/** Cell text compared loosely: spaces collapsed and trimmed, as a spreadsheet program may change them. */
const loose = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Whether a file's cell for a worked-out column says what the download
 * wrote for the row. Status and Evidence are compared only when the
 * download's wording is given; Evidence matches as a full address or a path.
 */
function derivedMatches(row: GridRow, key: GridColumnKey, text: string, download: GridCsvContext | undefined): boolean {
  if (key === 'dimension') return loose(text) === loose(row.dimensionName);
  if (!download) return true;
  if (key === 'status') return loose(text) === loose(csvValue(row, 'status', download));
  return [csvValue(row, 'evidence', download), csvValue(row, 'evidence', { statusWord: download.statusWord })].some(
    (written) => loose(written) === loose(text),
  );
}

/**
 * What an edited copy of the table's download would change: its records
 * (from parseCsv, or any reader giving rows of cells, the first being the
 * headers) against the table's rows.
 *
 * Columns are found by header, in any order. The Status, Dimension and
 * Evidence columns are worked out by the app and never staged; a row where
 * the file changed them is reported (Status and Evidence only when
 * `download`, the wording the download was written with, is given). A cell is
 * staged only when its text differs from the row; a column left out of the
 * file, or a line too short to reach it, changes nothing; an emptied Value
 * stages a gap. Rows are matched by Row ID, and a row whose Version is not
 * the table's is reported, not read.
 */
export function parseSpreadsheet(
  records: readonly (readonly string[])[],
  rows: readonly GridRow[],
  download?: GridCsvContext,
): SpreadsheetImport {
  const result: SpreadsheetImport = {
    problem: null,
    edits: [],
    readRows: 0,
    missingRows: [],
    ignoredChanges: [],
    unmatchedRows: [],
    rowsWithoutId: [],
    repeatedRows: [],
    staleRows: [],
    unknownColumns: [],
    repeatedColumns: [],
  };
  const headerIndex = records.findIndex((r) => !isBlankRecord(r));
  if (headerIndex === -1) return { ...result, problem: 'The file is empty.' };
  const header = records[headerIndex]!;

  const columns = new Map<GridColumnKey, number>();
  header.forEach((raw, index) => {
    const text = raw.trim();
    if (!text) return;
    const column = columnForHeader(text);
    if (!column) result.unknownColumns.push(text);
    else if (columns.has(column.key)) result.repeatedColumns.push(text);
    else columns.set(column.key, index);
  });
  const idAt = columns.get('row_id');
  const versionAt = columns.get('base_version');
  if (idAt === undefined || versionAt === undefined) {
    const separator = otherSeparator(header);
    if (separator) {
      return {
        ...result,
        problem: `The cells in this file are separated by ${separator}, not commas. In your spreadsheet program choose Save As and pick “CSV UTF-8 (Comma delimited)”, then upload that file.`,
      };
    }
    const missing = idAt === undefined && versionAt === undefined ? 'Row ID and Version columns' : idAt === undefined ? 'Row ID column' : 'Version column';
    return {
      ...result,
      problem: `The file has no ${missing}, so its lines cannot be matched to the table. ${ID_HELP}`,
    };
  }

  const byId = new Map(rows.map((r) => [r.rowId, r]));
  const seen = new Set<string>();
  const editable = EDITABLE_COLUMNS.filter((c) => columns.has(c.key));
  records.forEach((record, index) => {
    if (index <= headerIndex || isBlankRecord(record)) return;
    const line = index + 1;
    const cell = (at: number) => readCsvCell(record[at] ?? '');
    const rowId = cell(idAt).trim();
    if (!rowId) {
      result.rowsWithoutId.push(line);
      return;
    }
    const row = byId.get(rowId);
    if (!row) {
      result.unmatchedRows.push({ line, rowId });
      return;
    }
    if (seen.has(rowId)) {
      result.repeatedRows.push({ line, rowId });
      return;
    }
    seen.add(rowId);
    const fileVersion = cell(versionAt).trim();
    if (fileVersion !== String(row.baseVersion)) {
      result.staleRows.push({ ...namedRow(row), fileVersion, currentVersion: row.baseVersion });
      return;
    }
    result.readRows++;
    for (const column of editable) {
      const at = columns.get(column.key)!;
      if (at >= record.length) continue;
      const text = normalizeCellText(cell(at));
      const key = column.key as EditableColumnKey;
      if (!sameAsSaved(row, key, text)) result.edits.push({ rowId, column: key, text });
    }
    const changedDerived = DERIVED_IN_FILE.filter((key) => {
      const at = columns.get(key);
      return at !== undefined && at < record.length && !derivedMatches(row, key, cell(at), download);
    });
    if (changedDerived.length > 0) result.ignoredChanges.push({ ...namedRow(row), columns: changedDerived.map(columnLabel) });
  });
  result.missingRows = rows.filter((r) => !seen.has(r.rowId) && !result.staleRows.some((s) => s.rowId === r.rowId)).map(namedRow);
  return result;
}

function namedRow(row: GridRow): NamedRow {
  return { rowId: row.rowId, name: row.name, dimensionName: row.dimensionName };
}

/** Why a file could not be read as text, for the person who chose it. */
export const NOT_UTF8 =
  'This file was not saved as “CSV UTF-8”, so letters and symbols such as é, µ or ³ in it would come out wrong. In your spreadsheet program choose Save As and pick “CSV UTF-8”, then upload that file.';

/**
 * A chosen file's text, read as UTF-8 (what the download is, and what "CSV
 * UTF-8" saves). A file in another encoding, such as Excel's plain "CSV
 * (Comma delimited)", is refused rather than read with its accented letters
 * and symbols turned into replacement marks that would then be staged as
 * changes. A file of plain letters and digits reads the same either way.
 */
export function decodeSpreadsheetBytes(bytes: Uint8Array): { text: string; problem: null } | { text: null; problem: string } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), problem: null };
  } catch {
    return { text: null, problem: NOT_UTF8 };
  }
}

/** The largest file the table reads: its own download is a few hundred kilobytes at most. */
export const MAX_SPREADSHEET_BYTES = 5 * 1024 * 1024;

/**
 * Why a chosen file cannot be read as the table's CSV, or null when it can
 * be tried: a workbook saved by Excel or another program (it begins as a zip
 * archive does), a file too large, or one of another kind. `head` is the
 * file's first bytes.
 */
export function spreadsheetFileProblem(file: { name: string; size: number }, head: Uint8Array): string | null {
  const name = file.name.toLowerCase();
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (isZip || /\.(xlsx|xlsm|xls|ods|numbers)$/.test(name)) {
    return 'This is a workbook, not a CSV file. In your spreadsheet program, choose Save As (or Download) and pick “CSV UTF-8”, then upload that file.';
  }
  if (file.size > MAX_SPREADSHEET_BYTES) return 'This file is too large to be the table’s download (the most it can be is 5 MB).';
  if (file.size === 0) return 'The file is empty.';
  if (!/\.(csv|txt)$/.test(name)) return 'Upload a CSV file: the table’s download, edited and saved as CSV.';
  return null;
}
