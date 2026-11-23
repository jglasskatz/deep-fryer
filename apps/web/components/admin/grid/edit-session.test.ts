import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TABLE_COLUMNS } from '@/lib/grid-columns';
import { gridRows, type GridRow } from '@/lib/grid-data';
import { NOT_A_LINK_NOTE, NOT_A_YEAR_NOTE, NO_NAME_NOTE, parseClipboard } from '@/lib/spreadsheet-import';
import {
  EMPTY_SESSION,
  NEEDS_SUPPORTING_LINK,
  cellKey,
  cellText,
  changeCount,
  editorStartText,
  pasteBlock,
  pasteNotice,
  redoStep,
  sessionNotes,
  sessionProblems,
  stageCells,
  stagedChanges,
  undoStep,
} from './edit-session';
import { santaCruzFixture } from './test-fixture';

/**
 * Edit mode's staged changes: typing, pasting a range and clearing a cell
 * stage exactly the cells they touch, each as one step that can be undone
 * and redone, and nothing leaves the browser until Done.
 */

const rows = gridRows(santaCruzFixture(), { evidenceHref: (p) => `/files/santa-cruz/${p}` });
const rowsById = new Map(rows.map((r) => [r.rowId, r]));
const view = { rows, columns: TABLE_COLUMNS, rowsById };
const colOf = (key: string) => TABLE_COLUMNS.findIndex((c) => c.key === key);
const row = (id: string) => rowsById.get(id) as GridRow;

describe('pasting a range', () => {
  it('fills exactly the 12 cells a 3-by-4 block covers, and leaves every other cell as saved', () => {
    // Value, Unit, Year and Target of the first three rows, as Excel puts them on the clipboard.
    const clipboard = '13.1\t% of people\t2024\t9\r\n10.2\t% of homes\t2023\t8\r\n44\t% of pupils\t2025\t30\r\n';
    const result = pasteBlock(EMPTY_SESSION, view, { row: 0, col: colOf('value') }, parseClipboard(clipboard));
    expect(result.filled).toBe(12);
    expect(result.skippedReadOnly).toBe(0);
    expect(result.outside).toBe(0);
    expect(changeCount(result.session)).toBe(12);

    const expected = [
      ['13.1', '% of people', '2024', '9'],
      ['10.2', '% of homes', '2023', '8'],
      ['44', '% of pupils', '2025', '30'],
    ];
    const columns = ['value', 'unit', 'year', 'target'] as const;
    rows.slice(0, 3).forEach((r, i) => {
      columns.forEach((c, j) => expect(cellText(result.session, r, c)).toBe(expected[i]![j]));
    });
    const staged = new Set(Object.keys(result.session.cells));
    for (const r of rows) {
      for (const c of ['indicator', 'value', 'unit', 'year', 'target', 'source', 'source_url', 'geographic_scale', 'confidence'] as const) {
        const inBlock = rows.indexOf(r) < 3 && (columns as readonly string[]).includes(c);
        expect(staged.has(cellKey(r.rowId, c)), `${r.rowId} ${c}`).toBe(inBlock);
      }
    }

    // One step: Undo takes all twelve back, Redo puts them again.
    expect(result.session.undo).toHaveLength(1);
    expect(result.session.undo[0]!.label).toBe('paste of 12 cells');
    const undone = undoStep(result.session);
    expect(changeCount(undone)).toBe(0);
    expect(changeCount(redoStep(undone))).toBe(12);
    expect(pasteNotice(result)).toBe('Pasted 12 cells.');
  });

  it('follows the rows as shown, skips the columns worked out by the app, and leaves out what falls past the table', () => {
    const shown = [...rows].reverse();
    // Target, Status, Dimension, Source from the last row shown: two cells written, two skipped; a second row is past the end.
    const block = [['5', 'Severe', 'Food', 'My count'], ['6', '', '', 'x']];
    const result = pasteBlock(EMPTY_SESSION, { ...view, rows: shown }, { row: shown.length - 1, col: colOf('target') }, block);
    expect(result.filled).toBe(2);
    expect(result.skippedReadOnly).toBe(2);
    expect(result.outside).toBe(4);
    const first = shown[shown.length - 1]!;
    expect(Object.values(result.session.cells)).toEqual([
      { rowId: first.rowId, column: 'target', text: '5' },
      { rowId: first.rowId, column: 'source', text: 'My count' },
    ]);
    expect(pasteNotice(result)).toBe(
      'Pasted 2 cells. 2 cells fell on Status, Dimension or Evidence, which cannot be typed in, and were skipped. 4 cells went past the edge of the table and were left out.',
    );
    const edge = pasteBlock(EMPTY_SESSION, view, { row: 0, col: TABLE_COLUMNS.length - 1 }, [['a', 'b']]);
    expect(pasteNotice(edge)).toBe(
      'Nothing was pasted. 1 cell fell on Status, Dimension or Evidence, which cannot be typed in, and was skipped. 1 cell went past the edge of the table and was left out.',
    );
  });
});

describe('staging cells', () => {
  it('stages only text that differs from the row, and unstages a cell typed back to what is saved', () => {
    const id = 'food/food-insecurity-rate';
    const same = stageCells(EMPTY_SESSION, rowsById, [{ rowId: id, column: 'value', text: '12.4' }], 'typing');
    expect(same).toBe(EMPTY_SESSION);

    const typed = stageCells(EMPTY_SESSION, rowsById, [{ rowId: id, column: 'value', text: ' 13 ' }], 'typing in Value');
    expect(typed.cells[cellKey(id, 'value')]).toEqual({ rowId: id, column: 'value', text: '13' });
    const back = stageCells(typed, rowsById, [{ rowId: id, column: 'value', text: '12.40' }], 'typing in Value');
    expect(changeCount(back)).toBe(0);
    expect(back.undo).toHaveLength(2);
    // Undoing the second step brings the first one's text back.
    expect(cellText(undoStep(back), row(id), 'value')).toBe('13');
  });

  it('ignores cells of rows the table does not have, and columns that cannot be typed in', () => {
    const next = stageCells(
      EMPTY_SESSION,
      rowsById,
      [
        { rowId: 'food/no-such-row', column: 'value', text: '1' },
        { rowId: 'food/food-insecurity-rate', column: 'status' as never, text: 'Fine' },
      ],
      'upload',
    );
    expect(next).toBe(EMPTY_SESSION);
  });

  it('clears the redo steps when something new is done', () => {
    const id = 'food/food-insecurity-rate';
    const one = stageCells(EMPTY_SESSION, rowsById, [{ rowId: id, column: 'unit', text: 'a' }], 'one');
    const undone = undoStep(one);
    expect(undone.redo).toHaveLength(1);
    expect(stageCells(undone, rowsById, [{ rowId: id, column: 'unit', text: 'b' }], 'two').redo).toEqual([]);
    expect(undoStep(EMPTY_SESSION)).toBe(EMPTY_SESSION);
    expect(redoStep(EMPTY_SESSION)).toBe(EMPTY_SESSION);
  });
});

describe('what needs fixing, and the changes Done hands on', () => {
  it('marks a cell that cannot be stored as written, and a new value with no supporting link', () => {
    const session = stageCells(
      EMPTY_SESSION,
      rowsById,
      [
        { rowId: 'food/food-insecurity-rate', column: 'year', text: 'last year' },
        { rowId: 'food/food-insecurity-rate', column: 'value', text: '13' },
        { rowId: 'health/uninsured-rate', column: 'value', text: '' },
        { rowId: 'freshwater-withdrawals/residential-water-use', column: 'value', text: '41' },
      ],
      'paste of 4 cells',
    );
    const problems = sessionProblems(session, rowsById);
    expect([...problems]).toEqual([
      [cellKey('food/food-insecurity-rate', 'year'), 'Write the year as a whole number, like 2024.'],
      [cellKey('food/food-insecurity-rate', 'supporting_source_url'), NEEDS_SUPPORTING_LINK],
    ]);
    // A supporting link typed in clears the second.
    const linked = stageCells(
      session,
      rowsById,
      [{ rowId: 'food/food-insecurity-rate', column: 'supporting_source_url', text: 'https://map.feedingamerica.org/' }],
      'typing',
    );
    expect([...sessionProblems(linked, rowsById).keys()]).toEqual([cellKey('food/food-insecurity-rate', 'year')]);
  });

  it('does not stop Done for what can be stored: a nameless indicator, a short year, a link that is not a web address', () => {
    const session = stageCells(
      EMPTY_SESSION,
      rowsById,
      [
        { rowId: 'health/uninsured-rate', column: 'indicator', text: '' },
        { rowId: 'health/uninsured-rate', column: 'year', text: '24' },
        { rowId: 'health/uninsured-rate', column: 'source_url', text: 'see the PDF' },
        // A supporting source written as words is still a supporting source for a new value.
        { rowId: 'food/food-insecurity-rate', column: 'value', text: '13' },
        { rowId: 'food/food-insecurity-rate', column: 'supporting_source_url', text: 'County report, page 4' },
      ],
      'paste',
    );
    expect(sessionProblems(session, rowsById).size).toBe(0);
    expect([...sessionNotes(session)].sort()).toEqual(
      [
        [cellKey('health/uninsured-rate', 'indicator'), NO_NAME_NOTE],
        [cellKey('health/uninsured-rate', 'year'), NOT_A_YEAR_NOTE],
        [cellKey('health/uninsured-rate', 'source_url'), NOT_A_LINK_NOTE],
        [cellKey('food/food-insecurity-rate', 'supporting_source_url'), NOT_A_LINK_NOTE],
      ].sort(),
    );
    // Done hands each note on with its change.
    const year = stagedChanges(session, rows, TABLE_COLUMNS).find((c) => c.column === 'year');
    expect(year?.note).toBe(NOT_A_YEAR_NOTE);
  });

  it('lists every staged cell in table order, with what it was, and an emptied value as missing data', () => {
    const session = stageCells(
      EMPTY_SESSION,
      rowsById,
      [
        { rowId: 'health/uninsured-rate', column: 'value', text: '' },
        { rowId: 'food/food-insecurity-rate', column: 'source', text: 'Feeding America' },
        { rowId: 'food/food-insecurity-rate', column: 'value', text: '13' },
      ],
      'paste',
    );
    expect(stagedChanges(session, rows, TABLE_COLUMNS)).toEqual([
      {
        rowId: 'food/food-insecurity-rate', dimensionId: 'dim-food', dimensionName: 'Food', baseVersion: 2,
        indicatorName: 'Food insecurity rate', column: 'value', columnLabel: 'Value', before: '12.4', after: '13', clearsValue: false, note: null,
      },
      {
        rowId: 'food/food-insecurity-rate', dimensionId: 'dim-food', dimensionName: 'Food', baseVersion: 2,
        indicatorName: 'Food insecurity rate', column: 'source', columnLabel: 'Source', before: 'DataShare SCC', after: 'Feeding America', clearsValue: false, note: null,
      },
      {
        rowId: 'health/uninsured-rate', dimensionId: 'dim-health', dimensionName: 'Health', baseVersion: 2,
        indicatorName: 'Residents without health insurance', column: 'value', columnLabel: 'Value', before: '5.1', after: '', clearsValue: true, note: null,
      },
    ]);
  });
});

describe('the box a cell opens into', () => {
  it('starts from the cell’s text, or the key typed', () => {
    const food = row('food/food-insecurity-rate');
    expect(editorStartText(EMPTY_SESSION, food, 'value')).toBe('12.4');
    expect(editorStartText(EMPTY_SESSION, food, 'value', '7')).toBe('7');
  });

  it('turns a letter typed on Scale or Confidence into the choice it begins, never into text the menu cannot show', () => {
    const food = row('food/food-insecurity-rate');
    expect(editorStartText(EMPTY_SESSION, food, 'geographic_scale', 'r')).toBe('regional');
    expect(editorStartText(EMPTY_SESSION, food, 'geographic_scale', 'N')).toBe('national');
    expect(editorStartText(EMPTY_SESSION, food, 'confidence', 'h')).toBe('high');
    // A key no choice begins keeps the cell's own choice.
    expect(editorStartText(EMPTY_SESSION, food, 'geographic_scale', 'x')).toBe(food.geographicScale);
    expect(editorStartText(EMPTY_SESSION, food, 'confidence', '5')).toBe(food.confidence);
    // A staged choice is the one kept.
    const staged = stageCells(EMPTY_SESSION, rowsById, [{ rowId: food.rowId, column: 'confidence', text: 'low' }], 'typing');
    expect(editorStartText(staged, food, 'confidence', 'q')).toBe('low');
  });
});

describe('nothing reaches the server before Done', () => {
  // The table's code in this folder (tests aside) may call no server action and fetch nothing:
  // the only way staged changes leave it is the onDone the page gives it.
  const dir = path.resolve(import.meta.dirname);
  const sources = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) && f !== 'test-fixture.ts');

  it('imports no server action and makes no request', () => {
    expect(sources).toEqual(expect.arrayContaining(['DataGrid.tsx', 'CellEditor.tsx', 'edit-session.ts', 'leave-guard.ts']));
    for (const file of sources) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      expect(text, file).not.toMatch(/['"]use server['"]/);
      expect(text, file).not.toMatch(/from '@\/lib\/[a-z-]*actions'/);
      expect(text, file).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|navigator\.sendBeacon/);
      expect(text, file).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });

  it('hands the staged changes on only from Done', () => {
    const grid = readFileSync(path.join(dir, 'DataGrid.tsx'), 'utf8');
    const calls = grid.match(/onDone\?\.\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const done = grid.slice(grid.indexOf('const done = () =>'), grid.indexOf('const chooseFile'));
    expect(done).toContain('onDone?.(stagedChanges(session, rows, TABLE_COLUMNS))');
  });
});
