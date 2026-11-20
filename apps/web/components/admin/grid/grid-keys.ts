/*
 * Moving around the data table from the keyboard, as in a spreadsheet: the
 * table is one stop in the tab order, and inside it the arrow keys move one
 * cell, Home and End go to the start or end of the row (with Ctrl or
 * Command, the first or last cell of the table), Page Up and Page Down move
 * a screenful of rows. Row 0 is the header row, whose cells sort the table.
 * Pure, so every key is tested without a browser.
 */

export interface CellPosition {
  row: number;
  col: number;
}

export interface GridSize {
  /** Rows including the header row. */
  rows: number;
  cols: number;
}

/** Rows moved by Page Up and Page Down. */
export const PAGE_ROWS = 10;

export interface GridKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));

/** A position kept inside the table, as rows come and go with a filter. */
export function clampCell(pos: CellPosition, size: GridSize): CellPosition {
  return { row: clamp(pos.row, size.rows - 1), col: clamp(pos.col, size.cols - 1) };
}

/**
 * Where a key press moves the focus, or null when the key is not one the
 * table handles (so the browser keeps its own meaning: Tab leaves the
 * table, Enter follows a link or presses a sort button, Alt+arrows go back
 * and forward).
 */
export function nextCell(pos: CellPosition, key: GridKey, size: GridSize): CellPosition | null {
  if (key.altKey || size.rows === 0 || size.cols === 0) return null;
  const lastRow = size.rows - 1;
  const lastCol = size.cols - 1;
  const toEdge = Boolean(key.ctrlKey || key.metaKey);
  switch (key.key) {
    case 'ArrowUp':
      return clampCell({ row: toEdge ? 0 : pos.row - 1, col: pos.col }, size);
    case 'ArrowDown':
      return clampCell({ row: toEdge ? lastRow : pos.row + 1, col: pos.col }, size);
    case 'ArrowLeft':
      return clampCell({ row: pos.row, col: toEdge ? 0 : pos.col - 1 }, size);
    case 'ArrowRight':
      return clampCell({ row: pos.row, col: toEdge ? lastCol : pos.col + 1 }, size);
    case 'Home':
      return toEdge ? { row: 0, col: 0 } : { row: pos.row, col: 0 };
    case 'End':
      return toEdge ? { row: lastRow, col: lastCol } : { row: pos.row, col: lastCol };
    case 'PageUp':
      return clampCell({ row: pos.row - PAGE_ROWS, col: pos.col }, size);
    case 'PageDown':
      return clampCell({ row: pos.row + PAGE_ROWS, col: pos.col }, size);
    default:
      return null;
  }
}

/** The attribute value a cell's focus target carries, so the table can find it to focus. */
export function cellAttr(pos: CellPosition): string {
  return `${pos.row}:${pos.col}`;
}

/** The position a cell's attribute names, or null when it names none. */
export function parseCellAttr(value: string | null | undefined): CellPosition | null {
  const m = /^(\d+):(\d+)$/.exec(value ?? '');
  return m ? { row: Number(m[1]), col: Number(m[2]) } : null;
}
