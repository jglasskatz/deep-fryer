import { describe, expect, it } from 'vitest';
import { cellAttr, clampCell, nextCell, PAGE_ROWS, parseCellAttr } from './grid-keys';
import { EMPTY_GRID_STATE, gridStateFromParams, gridStateQuery, nextSort } from './grid-state';

/**
 * The data table from the keyboard: arrows move one cell and stop at the
 * edges, Home and End go along the row (to the table's corners with Ctrl or
 * Command), Page Up and Page Down move ten rows, and every other key is
 * left to the browser.
 */

const size = { rows: 81, cols: 13 };
const at = (row: number, col: number) => ({ row, col });

describe('nextCell', () => {
  it('moves one cell with the arrows and stops at the edges', () => {
    expect(nextCell(at(5, 5), { key: 'ArrowUp' }, size)).toEqual(at(4, 5));
    expect(nextCell(at(5, 5), { key: 'ArrowDown' }, size)).toEqual(at(6, 5));
    expect(nextCell(at(5, 5), { key: 'ArrowLeft' }, size)).toEqual(at(5, 4));
    expect(nextCell(at(5, 5), { key: 'ArrowRight' }, size)).toEqual(at(5, 6));
    expect(nextCell(at(0, 0), { key: 'ArrowUp' }, size)).toEqual(at(0, 0));
    expect(nextCell(at(0, 0), { key: 'ArrowLeft' }, size)).toEqual(at(0, 0));
    expect(nextCell(at(80, 12), { key: 'ArrowDown' }, size)).toEqual(at(80, 12));
    expect(nextCell(at(80, 12), { key: 'ArrowRight' }, size)).toEqual(at(80, 12));
  });

  it('goes along the row with Home and End, and to the corners with Ctrl or Command', () => {
    expect(nextCell(at(7, 6), { key: 'Home' }, size)).toEqual(at(7, 0));
    expect(nextCell(at(7, 6), { key: 'End' }, size)).toEqual(at(7, 12));
    expect(nextCell(at(7, 6), { key: 'Home', ctrlKey: true }, size)).toEqual(at(0, 0));
    expect(nextCell(at(7, 6), { key: 'End', metaKey: true }, size)).toEqual(at(80, 12));
    expect(nextCell(at(7, 6), { key: 'ArrowDown', ctrlKey: true }, size)).toEqual(at(80, 6));
    expect(nextCell(at(7, 6), { key: 'ArrowLeft', metaKey: true }, size)).toEqual(at(7, 0));
  });

  it('moves a page of rows with Page Up and Page Down', () => {
    expect(nextCell(at(1, 3), { key: 'PageDown' }, size)).toEqual(at(1 + PAGE_ROWS, 3));
    expect(nextCell(at(75, 3), { key: 'PageDown' }, size)).toEqual(at(80, 3));
    expect(nextCell(at(4, 3), { key: 'PageUp' }, size)).toEqual(at(0, 3));
  });

  it('leaves Tab, Enter, letters and Alt+arrows to the browser', () => {
    for (const key of ['Tab', 'Enter', ' ', 'a', 'Escape']) expect(nextCell(at(3, 3), { key }, size)).toBeNull();
    expect(nextCell(at(3, 3), { key: 'ArrowLeft', altKey: true }, size)).toBeNull();
  });

  it('does nothing in an empty table', () => {
    expect(nextCell(at(0, 0), { key: 'ArrowDown' }, { rows: 0, cols: 13 })).toBeNull();
  });
});

describe('clampCell and the cell attribute', () => {
  it('keeps the focus inside the table when a filter removes rows', () => {
    expect(clampCell(at(60, 4), { rows: 6, cols: 13 })).toEqual(at(5, 4));
    expect(clampCell(at(-1, 20), size)).toEqual(at(0, 12));
  });

  it('writes and reads a position', () => {
    expect(cellAttr(at(12, 3))).toBe('12:3');
    expect(parseCellAttr('12:3')).toEqual(at(12, 3));
    expect(parseCellAttr('x')).toBeNull();
    expect(parseCellAttr(undefined)).toBeNull();
  });
});

describe('the view in the page address', () => {
  it('reads search, filters and sort, and falls back to the defaults for anything unknown', () => {
    expect(gridStateFromParams({})).toEqual(EMPTY_GRID_STATE);
    expect(gridStateFromParams({ q: 'rent', show: 'no-source-link', dim: 'housing', sort: 'value', order: 'desc' })).toEqual({
      search: 'rent',
      show: 'no-source-link',
      dimension: 'housing',
      sort: { key: 'value', direction: 'descending' },
    });
    expect(gridStateFromParams({ show: 'everything', dim: '../x', sort: 'password' })).toEqual(EMPTY_GRID_STATE);
    expect(gridStateFromParams({ q: ['a', 'b'] }).search).toBe('a');
    expect(gridStateFromParams({ q: 'x'.repeat(500) }).search).toHaveLength(200);
  });

  it('writes only what differs from the defaults, and reads back what it wrote', () => {
    expect(gridStateQuery(EMPTY_GRID_STATE)).toBe('');
    const state = { search: 'µg & more', show: 'low-confidence' as const, dimension: 'air-pollution', sort: { key: 'year' as const, direction: 'ascending' as const } };
    const query = gridStateQuery(state);
    expect(query).toBe('?q=%C2%B5g+%26+more&show=low-confidence&dim=air-pollution&sort=year');
    expect(gridStateFromParams(Object.fromEntries(new URLSearchParams(query)))).toEqual(state);
  });

  it('sorts a column ascending, then descending, then back to the table order', () => {
    const first = nextSort(null, 'value');
    expect(first).toEqual({ key: 'value', direction: 'ascending' });
    const second = nextSort(first, 'value');
    expect(second).toEqual({ key: 'value', direction: 'descending' });
    expect(nextSort(second, 'value')).toBeNull();
    expect(nextSort(second, 'year')).toEqual({ key: 'year', direction: 'ascending' });
  });
});
