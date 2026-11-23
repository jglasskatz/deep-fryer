import type { GridColumn } from '@/lib/grid-columns';
import type { GridRow } from '@/lib/grid-data';
import {
  cellNote,
  cellProblem,
  columnChoices,
  columnLabel,
  isEditableColumn,
  normalizeCellText,
  readValueText,
  sameAsSaved,
  savedCellText,
  type CellWrite,
  type EditableColumnKey,
} from '@/lib/spreadsheet-import';

/*
 * Edit mode's changes, kept in the browser until the editor finishes: each
 * staged cell (a row's column and its new text), and the steps taken to get
 * there, so every typing, paste, clearing and upload can be undone and
 * redone as one step. Plain functions over plain values: nothing here talks
 * to the server, and the table renders whatever these return.
 */

/** A cell whose text differs from what its row stores. */
export interface StagedCell {
  rowId: string;
  column: EditableColumnKey;
  text: string;
}

/** One step: what each cell it touched was staged as before and after (null for "as saved"). */
export interface EditStep {
  /** What the step did, for the Undo and Redo buttons ("paste of 12 cells"). */
  label: string;
  changes: { key: string; before: StagedCell | null; after: StagedCell | null }[];
}

export interface EditSession {
  /** Staged cells by cellKey. */
  cells: Readonly<Record<string, StagedCell>>;
  /** Steps that can be undone, newest last. */
  undo: readonly EditStep[];
  /** Steps undone that can be redone, newest last. */
  redo: readonly EditStep[];
}

export const EMPTY_SESSION: EditSession = { cells: {}, undo: [], redo: [] };

/** Steps kept for undoing; the oldest go first. */
export const MAX_UNDO_STEPS = 200;

export function cellKey(rowId: string, column: EditableColumnKey): string {
  return `${rowId}\u0000${column}`;
}

/** How many cells are staged. */
export function changeCount(session: EditSession): number {
  return Object.keys(session.cells).length;
}

/**
 * The session after writing these cells, as one step. A write that says
 * what the row already stores unstages the cell; a write that changes
 * nothing is no step at all, so the session is returned as it was.
 */
export function stageCells(
  session: EditSession,
  rowsById: ReadonlyMap<string, GridRow>,
  writes: readonly CellWrite[],
  label: string,
): EditSession {
  const cells: Record<string, StagedCell> = { ...session.cells };
  const changes = new Map<string, EditStep['changes'][number]>();
  for (const write of writes) {
    const row = rowsById.get(write.rowId);
    if (!row || !isEditableColumn(write.column)) continue;
    const key = cellKey(write.rowId, write.column);
    const text = normalizeCellText(write.text);
    const before = cells[key] ?? null;
    const after = sameAsSaved(row, write.column, text) ? null : { rowId: write.rowId, column: write.column, text };
    if (before?.text === after?.text) continue;
    if (after) cells[key] = after;
    else delete cells[key];
    // Two writes to one cell in a step (a file naming a row twice) keep the first "before".
    const earlier = changes.get(key);
    changes.set(key, { key, before: earlier ? earlier.before : before, after });
  }
  const touched = [...changes.values()].filter((c) => c.before?.text !== c.after?.text);
  if (touched.length === 0) return session;
  return {
    cells,
    undo: [...session.undo, { label, changes: touched }].slice(-MAX_UNDO_STEPS),
    redo: [],
  };
}

function applyStep(cells: Readonly<Record<string, StagedCell>>, step: EditStep, direction: 'undo' | 'redo') {
  const next: Record<string, StagedCell> = { ...cells };
  for (const change of step.changes) {
    const value = direction === 'undo' ? change.before : change.after;
    if (value) next[change.key] = value;
    else delete next[change.key];
  }
  return next;
}

/** The session with its newest step undone (unchanged when there is none). */
export function undoStep(session: EditSession): EditSession {
  const step = session.undo[session.undo.length - 1];
  if (!step) return session;
  return { cells: applyStep(session.cells, step, 'undo'), undo: session.undo.slice(0, -1), redo: [...session.redo, step] };
}

/** The session with its newest undone step done again (unchanged when there is none). */
export function redoStep(session: EditSession): EditSession {
  const step = session.redo[session.redo.length - 1];
  if (!step) return session;
  return { cells: applyStep(session.cells, step, 'redo'), undo: [...session.undo, step], redo: session.redo.slice(0, -1) };
}

/** A cell's text in edit mode: its staged text, else what the row stores. */
export function cellText(session: EditSession, row: GridRow, column: EditableColumnKey): string {
  return session.cells[cellKey(row.rowId, column)]?.text ?? savedCellText(row, column);
}

export function isStaged(session: EditSession, rowId: string, column: EditableColumnKey): boolean {
  return cellKey(rowId, column) in session.cells;
}

/**
 * The text a cell's box opens with: the cell's text, or, when a key was
 * typed to start, that key. A column of choices can only show one of them,
 * so a typed letter picks the first choice it begins ("r" is Regional, "h"
 * is High) and any other key keeps the cell's choice: the box never holds
 * text its menu cannot show.
 */
export function editorStartText(session: EditSession, row: GridRow, column: EditableColumnKey, typed?: string): string {
  const current = cellText(session, row, column);
  if (typed === undefined) return current;
  const choices = columnChoices(column);
  if (!choices) return typed;
  const letter = typed.toLowerCase();
  return choices.find((c) => c.label.toLowerCase().startsWith(letter))?.value ?? current;
}

// ---- Pasting a range ----

export interface PasteResult {
  session: EditSession;
  /** Cells the paste wrote text into (whether or not the text differs from the row). */
  filled: number;
  /** Cells that landed on a column worked out by the app (Status, Dimension, Evidence) and were skipped. */
  skippedReadOnly: number;
  /** Cells that fell past the last row or column and were dropped. */
  outside: number;
}

/**
 * A pasted range laid over the table from one cell, as a spreadsheet lays
 * it: its first cell on `anchor` and the rest to the right and below,
 * following the rows in the order they are shown (with the search, filter
 * and sort applied) and the table's columns. One undo step.
 */
export function pasteBlock(
  session: EditSession,
  view: { rows: readonly GridRow[]; columns: readonly GridColumn[]; rowsById: ReadonlyMap<string, GridRow> },
  anchor: { row: number; col: number },
  block: readonly (readonly string[])[],
): PasteResult {
  const writes: CellWrite[] = [];
  let skippedReadOnly = 0;
  let outside = 0;
  block.forEach((cells, r) => {
    cells.forEach((text, c) => {
      const row = view.rows[anchor.row + r];
      const column = view.columns[anchor.col + c];
      if (!row || !column) outside++;
      else if (!isEditableColumn(column.key)) skippedReadOnly++;
      else writes.push({ rowId: row.rowId, column: column.key, text });
    });
  });
  const label = `paste of ${writes.length} ${writes.length === 1 ? 'cell' : 'cells'}`;
  return { session: stageCells(session, view.rowsById, writes, label), filled: writes.length, skippedReadOnly, outside };
}

/** What a paste did, in a sentence or two for the person who pasted. */
export function pasteNotice(result: Omit<PasteResult, 'session'>): string {
  const parts: string[] = [];
  if (result.filled > 0) parts.push(`Pasted ${result.filled} ${result.filled === 1 ? 'cell' : 'cells'}.`);
  else parts.push('Nothing was pasted.');
  if (result.skippedReadOnly > 0) {
    parts.push(
      `${result.skippedReadOnly} ${result.skippedReadOnly === 1 ? 'cell fell' : 'cells fell'} on Status, Dimension or Evidence, which cannot be typed in, and ${result.skippedReadOnly === 1 ? 'was' : 'were'} skipped.`,
    );
  }
  if (result.outside > 0) {
    parts.push(
      `${result.outside} ${result.outside === 1 ? 'cell' : 'cells'} went past the edge of the table and ${result.outside === 1 ? 'was' : 'were'} left out.`,
    );
  }
  return parts.join(' ');
}

// ---- What the editor has changed, and what needs fixing ----

/** One staged cell, worded for the person reviewing it. */
export interface StagedChange {
  rowId: string;
  dimensionId: string;
  dimensionName: string;
  /** The dimension version the row was read from: a save checks nobody saved it since. */
  baseVersion: number;
  indicatorName: string;
  column: EditableColumnKey;
  columnLabel: string;
  /** What the row stores now, as text. */
  before: string;
  /** The staged text. */
  after: string;
  /** The value was emptied: saving records the indicator as missing data (a gap). */
  clearsValue: boolean;
  /** Something worth a second look that does not stop the save (cellNote), or null. */
  note: string | null;
}

/** Every staged cell, in the table's row order and then column order. */
export function stagedChanges(
  session: EditSession,
  rows: readonly GridRow[],
  columns: readonly GridColumn[],
): StagedChange[] {
  const out: StagedChange[] = [];
  for (const row of rows) {
    for (const col of columns) {
      if (!isEditableColumn(col.key)) continue;
      const staged = session.cells[cellKey(row.rowId, col.key)];
      if (!staged) continue;
      out.push({
        rowId: row.rowId,
        dimensionId: row.dimensionId,
        dimensionName: row.dimensionName,
        baseVersion: row.baseVersion,
        indicatorName: row.name,
        column: col.key,
        columnLabel: columnLabel(col.key),
        before: savedCellText(row, col.key),
        after: staged.text,
        clearsValue: col.key === 'value' && readValueText(staged.text) === null,
        note: cellNote(col.key, staged.text),
      });
    }
  }
  return out;
}

/** The message for a changed value with no supporting link. */
export const NEEDS_SUPPORTING_LINK = 'A new value needs a link to where this number came from.';

/**
 * The cells that stop Done, by cellKey, with why. Only two things do: a
 * staged cell the stored indicator cannot hold (a year that is not a whole
 * number, a scale or confidence that is none of its choices), and the
 * supporting source of a row whose value was changed to a new figure
 * without one (saving refuses that, as the dimension editor does). A
 * cleared value needs no link: it records missing data. Anything else worth
 * a second look is a note (sessionNotes), which does not stop Done.
 */
export function sessionProblems(session: EditSession, rowsById: ReadonlyMap<string, GridRow>): Map<string, string> {
  const problems = new Map<string, string>();
  for (const [key, staged] of Object.entries(session.cells)) {
    const problem = cellProblem(staged.column, staged.text);
    if (problem) problems.set(key, problem);
  }
  for (const staged of Object.values(session.cells)) {
    if (staged.column !== 'value' || readValueText(staged.text) === null) continue;
    const row = rowsById.get(staged.rowId);
    if (!row) continue;
    const key = cellKey(row.rowId, 'supporting_source_url');
    if (problems.has(key)) continue;
    if (!cellText(session, row, 'supporting_source_url').trim()) problems.set(key, NEEDS_SUPPORTING_LINK);
  }
  return problems;
}

/** Staged cells that can be saved but are worth a second look, by cellKey, with why (cellNote). */
export function sessionNotes(session: EditSession): Map<string, string> {
  const notes = new Map<string, string>();
  for (const [key, staged] of Object.entries(session.cells)) {
    const note = cellNote(staged.column, staged.text);
    if (note) notes.set(key, note);
  }
  return notes;
}
