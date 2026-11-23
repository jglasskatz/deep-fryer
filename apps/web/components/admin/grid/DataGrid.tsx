'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { formatIndicatorValue } from '@deep-fryer/core';
import { statusLabel } from '@/components/doughnut/Doughnut';
import { statusDotClass } from '@/components/portrait/status';
import { TABLE_COLUMNS, gridCsv, gridCsvFileName, parseCsv, type GridColumnKey, type GridCsvContext } from '@/lib/grid-columns';
import {
  GRID_SHOW_OPTIONS,
  filterRows,
  isGridShow,
  sortRows,
  type DimensionWithoutRows,
  type GridRow,
  type GridSortKey,
} from '@/lib/grid-data';
import { en } from '@/lib/i18n/messages/en';
import { safeHref } from '@/lib/safe-url';
import {
  columnChoices,
  columnLabel,
  decodeSpreadsheetBytes,
  isEditableColumn,
  parseClipboard,
  parseSpreadsheet,
  readValueText,
  savedCellText,
  spreadsheetFileProblem,
  type CellWrite,
  type EditableColumnKey,
} from '@/lib/spreadsheet-import';
import { CellEditor, type CommitMove } from './CellEditor';
import { ConfirmDialog } from './ConfirmDialog';
import {
  EMPTY_SESSION,
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
  type EditSession,
  type StagedChange,
} from './edit-session';
import { cellAttr, clampCell, nextCell, parseCellAttr, type CellPosition } from './grid-keys';
import { EMPTY_GRID_STATE, gridStateQuery, nextSort, rowAnchor, type DataGridState } from './grid-state';
import { useLeaveGuard } from './leave-guard';
import { UploadReport, type UploadOutcome } from './UploadReport';

/*
 * The Data page's table: every indicator of the portrait, one row each, with
 * a search box, a "Show" filter, a dimension filter, sorting by any column,
 * and a CSV download of every row. The search, filters and sort live in the
 * page address, so a filtered view can be reloaded or sent to someone.
 *
 * Edit mode (offered when the page gives `onDone`): cells are typed into,
 * pasted over from a spreadsheet program, or filled from an uploaded copy
 * of the download. Every change is staged in the browser, highlighted and
 * undoable, and nothing is sent anywhere until Done hands the staged
 * changes to `onDone`. While changes are staged, leaving the page asks
 * first. The search, filters and sort read the saved values, so a row does
 * not jump or vanish while it is being typed into.
 */

/** The status in words for a doughnut level, as the doughnut words it; "Not scored" without one. */
export function rowStatusWord(vizLevel: number | null): string {
  return vizLevel === null ? 'Not scored' : statusLabel(vizLevel, en.doughnut.level);
}

const CONFIDENCE_WORD: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/** How the download words a row, and how an uploaded copy of it is read back the same way. */
function downloadContext(): GridCsvContext {
  return { statusWord: rowStatusWord, absoluteUrl: (href) => new URL(href, window.location.origin).href };
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** A link's site for its text (the full address is the link itself); the text as given when it cannot be read. */
function linkHost(href: string): string {
  try {
    return new URL(href).host.replace(/^www\./, '');
  } catch {
    return href;
  }
}

/** Shown in a cell with nothing in it; read out as "none". */
function Empty() {
  return (
    <>
      <span aria-hidden="true" className="text-[color:var(--color-muted)]">
        —
      </span>
      <span className="sr-only">none</span>
    </>
  );
}

/** Column widths: wide enough to read, narrow enough that long text wraps instead of stretching the table. */
const COLUMN_CLASS: Partial<Record<GridColumnKey, string>> = {
  indicator: 'min-w-[9rem] max-w-[11rem] sm:min-w-[14rem] sm:max-w-[18rem]',
  dimension: 'min-w-[8rem] max-w-[12rem]',
  value: 'min-w-[6rem] max-w-[16rem]',
  unit: 'min-w-[6rem] max-w-[12rem]',
  target: 'min-w-[6rem] max-w-[12rem]',
  status: 'min-w-[8rem]',
  source: 'min-w-[10rem] max-w-[16rem]',
  source_url: 'min-w-[8rem] max-w-[14rem]',
  supporting_source_url: 'min-w-[8rem] max-w-[14rem]',
  evidence: 'min-w-[7rem]',
};

/** The first column stays in view while the table scrolls sideways; it takes the row's highlight when a link opened the table at that row. */
const STICKY = 'sticky left-0 z-10 bg-[color:var(--color-bg)] shadow-[1px_0_0_rgb(0_0_0/0.15)]';
const STICKY_ROW_CELL = `${STICKY} group-target:bg-amber-50`;
/** The first column of a row in edit mode, when the cell carries a highlight of its own (which must stay opaque). */
const STICKY_PLAIN = 'sticky left-0 z-10 shadow-[1px_0_0_rgb(0_0_0/0.15)]';

/** A staged cell's highlight, and a cell that cannot be saved as it stands. */
const STAGED_CELL = 'bg-amber-100';
const PROBLEM_CELL = 'bg-red-50 outline outline-2 outline-offset-[-2px] outline-red-700';

/** Why a column cannot be typed into, for the person who tried. */
const READ_ONLY_NOTICE: Partial<Record<GridColumnKey, string>> = {
  status: 'Status is worked out from the value and the target, so it cannot be typed in.',
  dimension: 'An indicator’s dimension cannot be changed here.',
  evidence: 'Evidence cannot be typed in.',
};

/** A staged cell's text as the table shows it: the word for a choice, a number with its thousands marked, a dash for nothing. */
function StagedText({ column, text }: { column: EditableColumnKey; text: string }) {
  const t = text.trim();
  if (column === 'value' || column === 'target') {
    const value = readValueText(t);
    if (value === null) {
      return column === 'value' ? (
        <>
          <span className="text-[color:var(--color-muted)]">{en.doughnut.dataNeeded}</span>
          <span className="mt-0.5 block text-xs">Will be saved as missing data.</span>
        </>
      ) : (
        <Empty />
      );
    }
    return <bdi className="break-words">{formatIndicatorValue(value, '')}</bdi>;
  }
  if (!t) return <Empty />;
  const choice = columnChoices(column)?.find((c) => c.value === t.toLowerCase() || c.label.toLowerCase() === t.toLowerCase());
  if (choice) return <>{choice.label}</>;
  if (column === 'source_url' || column === 'supporting_source_url') return <span className="break-all">{t}</span>;
  return <span className="whitespace-pre-line break-words">{t}</span>;
}

/** What a changed cell held before, in a few words: "Was: 12.4", "Was empty". */
function wasText(row: GridRow, column: EditableColumnKey): string {
  const saved = savedCellText(row, column).trim();
  if (!saved) return 'Was empty';
  const choice = columnChoices(column)?.find((c) => c.value === saved);
  if (choice) return `Was: ${choice.label}`;
  if (column === 'value' || column === 'target') return `Was: ${formatIndicatorValue(readValueText(saved), '')}`;
  return `Was: ${saved}`;
}

/** The keys edit mode adds, for the help line under the table. */
const EDIT_KEYS_HELP =
  'Arrow keys move from cell to cell. Type to replace what is in a cell, or press Enter or F2 to change part of it; ' +
  'then Enter keeps the change and moves down, Tab moves right, and Escape puts the cell back. Delete empties a cell. ' +
  'Ctrl+V (⌘V on a Mac) pastes cells copied from a spreadsheet, starting at the cell you are on; if nothing is pasted, ' +
  'click the cell again so its box opens, then paste. Ctrl+Z undoes and Ctrl+Y redoes.';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--color-accent)]';

interface CellLinkProps {
  href: string;
  children: ReactNode;
  focus: { tabIndex: number; 'data-cell'?: string };
  external?: boolean;
  title?: string;
}

function CellLink({ href, children, focus, external, title }: CellLinkProps) {
  const className = `underline ${FOCUS_RING}`;
  return external ? (
    <a className={className} href={href} target="_blank" rel="noreferrer" title={title} {...focus}>
      {children}
    </a>
  ) : (
    <Link className={className} href={href} title={title} {...focus}>
      {children}
    </Link>
  );
}

/** A source address: its host as a link when it is a web address, else the text as written. */
function UrlCell({ url, focus }: { url: string; focus: CellLinkProps['focus'] }): ReactNode {
  if (!url.trim()) return null;
  const href = safeHref(url);
  if (!href) return <span className="break-all">{url}</span>;
  return (
    <CellLink href={href} focus={focus} external title={href}>
      <span className="break-all">{linkHost(href)}</span>
    </CellLink>
  );
}

/**
 * Under the table: the dimensions with no rows. Those research looked at and
 * found no usable figure for are named with its reason, in the words a
 * missing value uses; the rest have no indicators yet.
 */
function EmptyDimensions({ dimensions }: { dimensions: readonly DimensionWithoutRows[] }) {
  const notFound = dimensions.filter((d) => d.gapReason);
  const notYet = dimensions.filter((d) => !d.gapReason).map((d) => d.name);
  if (dimensions.length === 0) return null;
  return (
    <div className="mt-4 space-y-1 text-sm">
      {notFound.map((d, i) => (
        <p key={`${i}-${d.name}`} className="break-words">
          <span className="font-medium">No usable figure found for {d.name}:</span> {d.gapReason}
        </p>
      ))}
      {notYet.length > 0 ? (
        <p className="break-words">
          <span className="font-medium">No indicators yet in:</span> {notYet.join(', ')}.
        </p>
      ) : null}
    </div>
  );
}

export interface DataGridProps {
  tenantSlug: string;
  rows: GridRow[];
  /** Dimensions with no rows, listed under the table (with research's reason when it found no usable figure). */
  emptyDimensions: DimensionWithoutRows[];
  /** How many dimensions the portrait has, archived ones aside. */
  dimensionCount: number;
  /** Whether the viewer may open a dimension's editing page (editors and owners). */
  canOpenDimension: boolean;
  /**
   * The view the page address names. Read once, when the table first shows:
   * the page gives the table a new key when the address's view changes, so
   * a link to another view of this page starts the table afresh.
   */
  initial?: DataGridState;
  /**
   * Where Done hands the staged changes. When given, the table offers Edit;
   * without it the table is read only.
   */
  onDone?: (changes: StagedChange[]) => void;
  /** Opens the table in edit mode with these cells already staged (a file brought in on another page), as one undoable step. */
  startEditing?: { writes: CellWrite[]; label: string };
  /**
   * Incremented by the page after `onDone` saves successfully: clears the
   * staged edit session, leaves edit mode, and announces `message`.
   */
  savedSignal?: { seq: number; message: string };
}

type Confirming = { kind: 'discard' } | { kind: 'leave'; href: string | null };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The dimensions the table can be narrowed to: those with rows, in table order. */
function rowDimensions(rows: readonly GridRow[]): { slug: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) if (!seen.has(r.dimensionSlug)) seen.set(r.dimensionSlug, r.dimensionName);
  return [...seen].map(([slug, name]) => ({ slug, name }));
}

export function DataGrid({
  tenantSlug,
  rows,
  emptyDimensions,
  dimensionCount,
  canOpenDimension,
  initial = EMPTY_GRID_STATE,
  onDone,
  startEditing,
  savedSignal,
}: DataGridProps) {
  const ids = useId();
  const dimensions = useMemo(() => rowDimensions(rows), [rows]);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.rowId, r])), [rows]);
  const canEdit = Boolean(onDone);
  const [editing, setEditing] = useState(() => canEdit && Boolean(startEditing));
  const [session, setSession] = useState<EditSession>(() =>
    canEdit && startEditing
      ? stageCells(EMPTY_SESSION, new Map(rows.map((r) => [r.rowId, r])), startEditing.writes, startEditing.label)
      : EMPTY_SESSION,
  );
  /** The cell being typed into, by row and column, with the text its box starts from. */
  const [editor, setEditor] = useState<{ rowId: string; column: EditableColumnKey; text: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [upload, setUpload] = useState<UploadOutcome | null>(null);
  const [reading, setReading] = useState(false);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  /** Edit mode just closed: the focus goes back to Edit, as the button that had it is gone. */
  const focusEditPending = useRef(false);
  /** Whether the cell pressed was already the active one: a click on it then opens its box. */
  const pressedActive = useRef(false);

  const changes = changeCount(session);
  const dirty = editing && changes > 0;
  const problems = useMemo(
    () => (editing ? sessionProblems(session, rowsById) : new Map<string, string>()),
    [editing, session, rowsById],
  );
  const notes = useMemo(() => (editing ? sessionNotes(session) : new Map<string, string>()), [editing, session]);
  const guard = useLeaveGuard(
    dirty,
    (href) => setConfirming({ kind: 'leave', href }),
    // The guard's extra history entry is gone: write the view into the address it skipped.
    () => syncAddress(),
    // Leaving by Back was chosen, but this is the tab's first page: do what was chosen, and say why the page stayed.
    () => stopEditing('Your changes were discarded. There is no earlier page in this tab to go back to.'),
  );
  // A dimension the address names but the table has no rows for (an old link, a dimension since archived)
  // would filter every row out while the menu reads "All dimensions"; show every dimension instead.
  const [state, setState] = useState<DataGridState>(() =>
    initial.dimension && !dimensions.some((d) => d.slug === initial.dimension) ? { ...initial, dimension: '' } : initial,
  );
  const [active, setActive] = useState<CellPosition>({ row: 1, col: 0 });
  const tableRef = useRef<HTMLTableElement>(null);
  const focusPending = useRef(false);

  const shown = useMemo(
    () =>
      sortRows(
        filterRows(rows, { search: state.search, show: state.show, dimension: state.dimension, statusWord: rowStatusWord }),
        state.sort,
      ),
    [rows, state],
  );

  const filtered = Boolean(state.search.trim()) || state.show !== 'all' || Boolean(state.dimension);
  const size = { rows: shown.length + 1, cols: TABLE_COLUMNS.length };
  const current = clampCell(active, size);

  // Keep the address in step with the view, without a reload or a history entry per keystroke.
  // Not while changes are staged: Back must land on an address equal to this one (leave-guard),
  // or the page would be drawn afresh and the changes lost before anyone is asked.
  const stateRef = useRef(state);
  stateRef.current = state;
  const syncAddress = () => {
    const url = `${window.location.pathname}${gridStateQuery(stateRef.current)}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', url);
    }
  };
  useEffect(() => {
    if (!dirty) syncAddress();
  }, [state, dirty]);

  // Move the browser's focus after a key press moved the table's.
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    const target = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${cellAttr(current)}"]`);
    if (!target) return;
    // Scroll only as far as needed, inside the table's box first, so the cell is not left under the sticky header.
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  useEffect(() => {
    if (!focusEditPending.current || !editButtonRef.current) return;
    focusEditPending.current = false;
    editButtonRef.current.focus();
  });

  const update = (patch: Partial<DataGridState>) => setState((s) => ({ ...s, ...patch }));

  const moveTo = (pos: CellPosition) => {
    focusPending.current = true;
    setActive(clampCell(pos, size));
  };

  // ---- Edit mode ----

  /** The row and column at a table position, when it is a body cell. */
  const cellAt = (pos: CellPosition) => {
    const row = pos.row > 0 ? shown[pos.row - 1] : undefined;
    const column = TABLE_COLUMNS[pos.col];
    return row && column ? { row, column: column.key } : null;
  };

  const positionOf = (rowId: string, column: GridColumnKey): CellPosition | null => {
    const r = shown.findIndex((row) => row.rowId === rowId);
    const c = TABLE_COLUMNS.findIndex((col) => col.key === column);
    return r === -1 || c === -1 ? null : { row: r + 1, col: c };
  };

  const stage = (writes: CellWrite[], label: string) => setSession((s) => stageCells(s, rowsById, writes, label));

  const openEditor = (row: GridRow, column: EditableColumnKey, text: string) => {
    setEditor({ rowId: row.rowId, column, text });
    const pos = positionOf(row.rowId, column);
    if (pos) setActive(pos);
  };

  const commitEditor = (text: string, move: CommitMove) => {
    if (!editor) return;
    const row = rowsById.get(editor.rowId);
    if (row) stage([{ rowId: editor.rowId, column: editor.column, text }], `typing in ${columnLabel(editor.column)} of ${row.name}`);
    const pos = positionOf(editor.rowId, editor.column);
    setEditor(null);
    // Leaving the box by clicking elsewhere keeps the focus where the click put it.
    if (!pos || move === 'stay') return;
    moveTo(
      move === 'down' ? { row: pos.row + 1, col: pos.col } : move === 'right' ? { row: pos.row, col: pos.col + 1 } : { row: pos.row, col: pos.col - 1 },
    );
  };

  const cancelEditor = () => {
    if (!editor) return;
    const pos = positionOf(editor.rowId, editor.column);
    setEditor(null);
    if (pos) moveTo(pos);
  };

  const pasteAt = (pos: CellPosition, block: string[][]) => {
    if (block.length === 0) {
      setNotice('There was nothing to paste. Copy cells in your spreadsheet program first, then paste.');
      return;
    }
    const result = pasteBlock(session, { rows: shown, columns: TABLE_COLUMNS, rowsById }, { row: pos.row - 1, col: pos.col }, block);
    setSession(result.session);
    setNotice(pasteNotice(result));
  };

  const undo = () => {
    const step = session.undo[session.undo.length - 1];
    if (!step) return;
    setEditor(null);
    setSession(undoStep(session));
    setNotice(`Undid ${step.label}.`);
  };

  const redo = () => {
    const step = session.redo[session.redo.length - 1];
    if (!step) return;
    setEditor(null);
    setSession(redoStep(session));
    setNotice(`Redid ${step.label}.`);
  };

  const startEdit = () => {
    setEditing(true);
    setNotice('');
    setUpload(null);
    // Straight to the table, so typing can begin.
    moveTo(current.row === 0 ? { row: 1, col: 0 } : current);
  };

  const stopEditing = (message: string) => {
    focusEditPending.current = true;
    setEditing(false);
    setEditor(null);
    setSession(EMPTY_SESSION);
    setUpload(null);
    setConfirming(null);
    setNotice(message);
  };

  const lastSavedSeq = useRef(savedSignal?.seq ?? 0);
  useEffect(() => {
    if (!savedSignal || savedSignal.seq === lastSavedSeq.current) return;
    lastSavedSeq.current = savedSignal.seq;
    stopEditing(savedSignal.message);
  }, [savedSignal]);

  const cancel = () => {
    if (changes > 0) setConfirming({ kind: 'discard' });
    else stopEditing('');
  };

  const done = () => {
    setEditor(null);
    if (problems.size > 0) {
      const firstShown = shown.flatMap((row) =>
        TABLE_COLUMNS.filter((c) => isEditableColumn(c.key) && problems.has(cellKey(row.rowId, c.key as EditableColumnKey))).map(
          (c) => ({ row, column: c.key }),
        ),
      )[0];
      const fix = `${plural(problems.size, 'cell needs', 'cells need')} fixing before you finish; ${problems.size === 1 ? 'it is' : 'they are'} marked in red.`;
      setNotice(firstShown ? fix : `${fix} Clear the search and filters to see ${problems.size === 1 ? 'it' : 'them'}.`);
      if (firstShown) {
        const pos = positionOf(firstShown.row.rowId, firstShown.column);
        if (pos) moveTo(pos);
      }
      return;
    }
    if (changes === 0) {
      stopEditing('No changes were made.');
      return;
    }
    onDone?.(stagedChanges(session, rows, TABLE_COLUMNS));
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // The same file can be chosen again after it is fixed.
    input.value = '';
    if (!file) return;
    setEditor(null);
    setReading(true);
    setUpload(null);
    setNotice(`Reading ${file.name}…`);
    try {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const refused = spreadsheetFileProblem(file, head);
      // Read as UTF-8 only: a file in another encoding is turned away rather than staged with damaged letters.
      const decoded = refused ? null : decodeSpreadsheetBytes(new Uint8Array(await file.arrayBuffer()));
      const report =
        decoded?.text != null
          ? parseSpreadsheet(parseCsv(decoded.text), rows, downloadContext())
          : { ...parseSpreadsheet([], rows), problem: refused ?? decoded?.problem ?? 'The file could not be read. Try saving it again as CSV.' };
      const next = report.problem ? session : stageCells(session, rowsById, report.edits, `upload of ${file.name}`);
      // Cells the file changes that were already staged the same way are not counted again.
      const staged = next === session ? 0 : (next.undo[next.undo.length - 1]?.changes.length ?? 0);
      setSession(next);
      setUpload({ fileName: file.name, staged, report: { ...report, missingRows: report.problem ? [] : report.missingRows } });
      setNotice('');
    } catch {
      setUpload({ fileName: file.name, staged: 0, report: { ...parseSpreadsheet([], rows), problem: 'The file could not be read. Try saving it again as CSV.' } });
      setNotice('');
    } finally {
      setReading(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    const from = parseCellAttr(target?.dataset.cell) ?? current;
    if (editing && !event.nativeEvent.isComposing) {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && !event.altKey && (key === 'z' || key === 'y')) {
        event.preventDefault();
        if (key === 'y' || event.shiftKey) redo();
        else undo();
        return;
      }
      const at = cellAt(from);
      if (at) {
        const editable = isEditableColumn(at.column);
        const typed = event.key.length === 1 && !mod && !event.altKey;
        if (event.key === 'Enter' || event.key === 'F2' || event.key === 'Delete' || event.key === 'Backspace' || typed) {
          if (!editable) {
            // Enter still follows a link (a dimension's page); anything else says why nothing happened.
            if (event.key !== 'Enter' || !target?.closest('a')) setNotice(READ_ONLY_NOTICE[at.column] ?? '');
            return;
          }
          event.preventDefault();
          const column = at.column as EditableColumnKey;
          if (event.key === 'Delete' || event.key === 'Backspace') {
            stage([{ rowId: at.row.rowId, column, text: '' }], `emptying ${columnLabel(column)} of ${at.row.name}`);
          } else {
            openEditor(at.row, column, editorStartText(session, at.row, column, typed ? event.key : undefined));
          }
          return;
        }
      }
    }
    const to = nextCell(from, event, size);
    if (!to) return;
    event.preventDefault();
    focusPending.current = true;
    setActive(to);
  };

  const onFocus = (event: FocusEvent<HTMLTableElement>) => {
    const pos = parseCellAttr((event.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell);
    if (pos && (pos.row !== current.row || pos.col !== current.col)) setActive(pos);
  };

  const onMouseDown = (event: MouseEvent<HTMLTableElement>) => {
    const pos = parseCellAttr((event.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell);
    pressedActive.current = Boolean(pos && pos.row === current.row && pos.col === current.col);
  };

  const onClick = (event: MouseEvent<HTMLTableElement>) => {
    if (!editing || editor || !pressedActive.current) return;
    const pos = parseCellAttr((event.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell);
    const at = pos ? cellAt(pos) : null;
    if (!at || !isEditableColumn(at.column)) return;
    openEditor(at.row, at.column, cellText(session, at.row, at.column));
  };

  const onPaste = (event: ClipboardEvent<HTMLTableElement>) => {
    // The box being typed into handles its own pastes.
    if (!editing || editor) return;
    const pos = parseCellAttr((event.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell) ?? current;
    event.preventDefault();
    if (pos.row === 0) {
      setNotice('Choose a cell in the table first, then paste.');
      return;
    }
    pasteAt(pos, parseClipboard(event.clipboardData.getData('text/plain')));
  };

  const onCopy = (event: ClipboardEvent<HTMLTableElement>) => {
    if (!editing || editor) return;
    // Text the person selected is copied as the browser copies it.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const pos = parseCellAttr((event.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell) ?? current;
    const at = cellAt(pos);
    if (!at) return;
    const text = isEditableColumn(at.column)
      ? cellText(session, at.row, at.column)
      : ((event.target as HTMLElement).closest<HTMLElement>('td,th')?.innerText ?? '');
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
  };

  /** The props that put a cell's focus target in the roving tab order. */
  const focusProps = (row: number, col: number, primary = true) => {
    const isActive = current.row === row && current.col === col;
    return { tabIndex: isActive ? 0 : -1, ...(primary ? { 'data-cell': cellAttr({ row, col }) } : {}) };
  };

  const download = () => {
    const csv = gridCsv(rows, downloadContext());
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = gridCsvFileName(tenantSlug);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  if (dimensionCount === 0) {
    return (
      <div className="mt-6 rounded border border-black/15 p-4 text-sm">
        <p className="font-medium">This portrait has no dimensions yet.</p>
        <p className="mt-1 text-[color:var(--color-muted)]">
          Its dimensions and their indicators appear here once the portrait is set up.
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <>
        <div className="mt-6 rounded border border-black/15 p-4 text-sm">
          <p className="font-medium">No indicators yet.</p>
          <p className="mt-1 text-[color:var(--color-muted)]">
            Indicators appear here once research results are approved on the{' '}
            <Link className="underline" href={`/${tenantSlug}/admin/review`}>
              Review
            </Link>{' '}
            page, or once an editor adds them to a dimension.
          </p>
        </div>
        <EmptyDimensions dimensions={emptyDimensions.filter((d) => d.gapReason)} />
      </>
    );
  }

  const cell = (row: GridRow, key: GridColumnKey, r: number, c: number): { content: ReactNode; focusOnCell: boolean } => {
    const focus = focusProps(r, c);
    const none = { content: <Empty />, focusOnCell: true };
    switch (key) {
      case 'indicator':
        return { content: <span className="break-words font-medium">{row.name}</span>, focusOnCell: true };
      case 'dimension': {
        const version = (
          <span className="mt-0.5 block text-xs text-[color:var(--color-muted)]">
            v{row.baseVersion} · {row.published ? 'published' : 'draft'}
          </span>
        );
        return canOpenDimension
          ? {
              content: (
                <>
                  <CellLink href={`/${tenantSlug}/admin/dim/${row.dimensionId}`} focus={focus}>
                    <span className="break-words">{row.dimensionName}</span>
                  </CellLink>
                  {version}
                </>
              ),
              focusOnCell: false,
            }
          : { content: <><span className="break-words">{row.dimensionName}</span>{version}</>, focusOnCell: true };
      }
      case 'value':
        return {
          content:
            row.value === null ? (
              <>
                <span className="text-[color:var(--color-muted)]">{en.doughnut.dataNeeded}</span>
                {row.gapReason ? (
                  <span className="mt-0.5 block break-words text-xs text-[color:var(--color-muted)]">
                    No usable figure found: {row.gapReason}
                  </span>
                ) : null}
              </>
            ) : (
              <bdi className="break-words">{formatIndicatorValue(row.value, '')}</bdi>
            ),
          focusOnCell: true,
        };
      case 'unit':
        return row.unit.trim() ? { content: <span className="break-words">{row.unit}</span>, focusOnCell: true } : none;
      case 'year':
        return row.year === null ? none : { content: row.year, focusOnCell: true };
      case 'target':
        return row.target === null
          ? none
          : { content: <bdi className="break-words">{formatIndicatorValue(row.target, '')}</bdi>, focusOnCell: true };
      case 'status':
        return row.value === null
          ? none
          : {
              content: (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(row.vizLevel)}`} />
                  {rowStatusWord(row.vizLevel)}
                </span>
              ),
              focusOnCell: true,
            };
      case 'source':
        return row.source.trim() ? { content: <span className="break-words">{row.source}</span>, focusOnCell: true } : none;
      case 'source_url':
      case 'supporting_source_url': {
        const url = key === 'source_url' ? row.sourceUrl : row.supportingSourceUrl;
        if (!url.trim()) return none;
        const linked = Boolean(safeHref(url));
        return { content: <UrlCell url={url} focus={focus} />, focusOnCell: !linked };
      }
      case 'geographic_scale':
        return row.geographicScale
          ? { content: capitalize(en.scales[row.geographicScale] ?? row.geographicScale), focusOnCell: true }
          : none;
      case 'confidence':
        return row.confidence ? { content: CONFIDENCE_WORD[row.confidence] ?? row.confidence, focusOnCell: true } : none;
      case 'evidence':
        if (!row.evidence) return none;
        return {
          content: (
            <>
              <CellLink href={row.evidence.href} focus={focus} external>
                Snapshot
              </CellLink>
              {row.evidence.pdfHref ? (
                <>
                  {' · '}
                  <CellLink href={row.evidence.pdfHref} focus={focusProps(r, c, false)} external>
                    PDF
                  </CellLink>
                </>
              ) : null}
              <span className="mt-0.5 block text-xs text-[color:var(--color-muted)]">{row.evidence.capturedOn}</span>
            </>
          ),
          focusOnCell: false,
        };
      default:
        return none;
    }
  };

  /**
   * A cell a person may type into, in edit mode: its box while being typed
   * into; else its staged text, highlighted, with what it was; else its
   * saved text (a link as its full address, so a click picks the cell
   * rather than opening the page). A cell that cannot be saved as it stands
   * says why. The cell itself takes the focus, so Enter edits it.
   */
  const editableCell = (row: GridRow, column: EditableColumnKey, r: number, c: number): { content: ReactNode; className: string } => {
    const key = cellKey(row.rowId, column);
    const staged = session.cells[key];
    const problem = problems.get(key);
    const note = problem ? undefined : notes.get(key);
    const problemId = `${ids}-problem-${r}-${c}`;
    const noteText = note ? (
      <span id={problemId} className="mt-1 block break-words text-xs font-medium">
        Check: {note}
      </span>
    ) : null;
    if (editor && editor.rowId === row.rowId && editor.column === column) {
      return {
        content: (
          <>
            <CellEditor
              column={column}
              initialText={editor.text}
              label={`${columnLabel(column)} of ${row.name}`}
              describedBy={problem || note ? problemId : undefined}
              onCommit={commitEditor}
              onCancel={cancelEditor}
              onPasteBlock={(block) => {
                const pos = positionOf(row.rowId, column);
                setEditor(null);
                if (pos) {
                  pasteAt(pos, block);
                  moveTo(pos);
                }
              }}
            />
            {problem ? (
              <span id={problemId} className="mt-1 block text-xs font-medium text-red-700">
                {problem}
              </span>
            ) : null}
            {noteText}
          </>
        ),
        className: problem ? PROBLEM_CELL : staged ? STAGED_CELL : '',
      };
    }
    const saved =
      column === 'source_url' || column === 'supporting_source_url' ? (
        <StagedText column={column} text={savedCellText(row, column)} />
      ) : (
        cell(row, column, r, c).content
      );
    return {
      content: (
        <>
          {staged ? <span className="sr-only">Changed: </span> : null}
          {staged ? <StagedText column={column} text={staged.text} /> : saved}
          {staged ? (
            <span className="mt-1 line-clamp-2 block break-words text-xs text-[color:var(--color-muted)]">{wasText(row, column)}</span>
          ) : null}
          {problem ? (
            <span id={problemId} className="mt-1 block text-xs font-medium text-red-700">
              {problem}
            </span>
          ) : null}
          {noteText}
        </>
      ),
      className: problem ? PROBLEM_CELL : staged ? STAGED_CELL : '',
    };
  };

  const undoLabel = session.undo.length > 0 ? `Undo ${session.undo[session.undo.length - 1]!.label}` : 'Undo';
  const redoLabel = session.redo.length > 0 ? `Redo ${session.redo[session.redo.length - 1]!.label}` : 'Redo';
  const confirmText =
    confirming?.kind === 'discard'
      ? {
          title: 'Discard your changes?',
          body: `The ${plural(changes, 'change', 'changes')} you made here ${changes === 1 ? 'is' : 'are'} not saved, and will be lost.`,
          stay: 'Keep editing',
          leave: 'Discard changes',
        }
      : {
          title: 'Leave without saving?',
          body: `You have ${plural(changes, 'change', 'changes')} that ${changes === 1 ? 'is' : 'are'} not saved yet. If you leave this page, ${
            changes === 1 ? 'it is' : 'they are'
          } lost.`,
          stay: 'Stay on this page',
          leave: 'Leave without saving',
        };

  const countText = filtered || shown.length !== rows.length
    ? `Showing ${shown.length} of ${rows.length} rows`
    : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;

  return (
    <div className="mt-6">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
        <label className="block min-w-0 text-sm">
          <span className="font-medium">Search</span>
          <input
            type="search"
            className="mt-1 block min-h-11 w-full min-w-0 rounded border border-field-border bg-white px-3 text-base sm:text-sm"
            value={state.search}
            maxLength={200}
            placeholder="Indicator, source, value or link"
            onChange={(e) => update({ search: e.target.value })}
          />
        </label>
        <label className="block min-w-0 text-sm">
          <span className="font-medium">Show</span>
          <select
            className="mt-1 block min-h-11 w-full min-w-0 rounded border border-field-border bg-white px-2 text-base sm:text-sm"
            value={state.show}
            onChange={(e) => update({ show: isGridShow(e.target.value) ? e.target.value : 'all' })}
          >
            {GRID_SHOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 text-sm">
          <span className="font-medium">Dimension</span>
          <select
            className="mt-1 block min-h-11 w-full min-w-0 rounded border border-field-border bg-white px-2 text-base sm:text-sm"
            value={state.dimension}
            onChange={(e) => update({ dimension: e.target.value })}
          >
            <option value="">All dimensions</option>
            {dimensions.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <p role="status" className="font-medium">
          {countText}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {filtered ? (
            <button
              type="button"
              className="min-h-11 rounded border border-black/20 px-3"
              onClick={() => update({ search: '', show: 'all', dimension: '' })}
            >
              Clear search and filters
            </button>
          ) : null}
          <button
            type="button"
            className={`min-h-11 rounded px-3 font-medium ${editing ? 'border border-black/20' : 'bg-black text-white'}`}
            aria-describedby={`${ids}-download-about`}
            onClick={download}
          >
            Download CSV
          </button>
          {canEdit && !editing ? (
            <button
              ref={editButtonRef}
              type="button"
              className="min-h-11 rounded border border-black/20 px-3 font-medium"
              onClick={startEdit}
            >
              Edit
            </button>
          ) : null}
        </div>
      </div>
      <p id={`${ids}-download-about`} className="mt-1 text-xs text-[color:var(--color-muted)]">
        The file has all {rows.length} rows, whatever the search and filters, and opens in any spreadsheet program.
        Keep its Row ID and Version columns as they are.
        {editing ? ' It has the saved values, not the changes you have not saved yet.' : null}
      </p>

      {editing ? (
        <section aria-labelledby={`${ids}-editing`} className="mt-4 rounded border-2 border-[color:var(--color-accent)] p-3 text-sm">
          <h2 id={`${ids}-editing`} className="text-base font-semibold">
            Editing
          </h2>
          <p className="mt-1">
            Nothing is saved until you press Done. Click a cell and type, or paste cells copied from a spreadsheet; click
            it again to change part of its text. Emptying a value records it as missing data. Changed cells are
            highlighted, and Undo takes back one step at a time.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="min-h-11 rounded border border-black/20 px-3 disabled:opacity-50"
              aria-label={undoLabel}
              title={undoLabel}
              disabled={session.undo.length === 0}
              onClick={undo}
            >
              Undo
            </button>
            <button
              type="button"
              className="min-h-11 rounded border border-black/20 px-3 disabled:opacity-50"
              aria-label={redoLabel}
              title={redoLabel}
              disabled={session.redo.length === 0}
              onClick={redo}
            >
              Redo
            </button>
            <button
              type="button"
              className="min-h-11 rounded border border-black/20 px-3 disabled:opacity-50"
              aria-describedby={`${ids}-upload-about`}
              disabled={reading}
              onClick={() => fileRef.current?.click()}
            >
              {reading ? 'Reading the file…' : 'Upload CSV'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={chooseFile}
            />
            <span className="ms-auto flex flex-wrap gap-2">
              <button type="button" className="min-h-11 rounded border border-black/20 px-3" onClick={cancel}>
                Cancel
              </button>
              <button type="button" className="min-h-11 rounded bg-black px-4 font-medium text-white" onClick={done}>
                Done
              </button>
            </span>
          </div>
          <p id={`${ids}-upload-about`} className="mt-2 text-xs text-[color:var(--color-muted)]">
            Upload CSV reads a copy of the download you edited in a spreadsheet program, and puts its changes in the table
            for you to check.
          </p>
          <p className="mt-2 font-medium">
            {changes === 0 ? 'No changes yet.' : `${plural(changes, 'change', 'changes')}, not saved yet.`}
            {problems.size > 0 ? (
              <span className="text-red-700"> {plural(problems.size, 'cell needs', 'cells need')} fixing.</span>
            ) : null}
            {notes.size > 0 ? (
              <span>
                {' '}
                {plural(notes.size, 'cell has', 'cells have')} a note to check; {notes.size === 1 ? 'it does' : 'they do'} not stop you finishing.
              </span>
            ) : null}
          </p>
          {upload ? <UploadReport outcome={upload} onClose={() => setUpload(null)} /> : null}
        </section>
      ) : null}
      <p role="status" className={notice ? 'mt-2 text-sm' : 'sr-only'}>
        {notice}
      </p>
      {canEdit ? (
        <ConfirmDialog
          open={confirming !== null}
          title={confirmText.title}
          body={confirmText.body}
          stayLabel={confirmText.stay}
          leaveLabel={confirmText.leave}
          onStay={() => {
            if (confirming?.kind === 'leave' && confirming.href === null) guard.stay();
            setConfirming(null);
          }}
          onLeave={() => {
            const answer = confirming;
            setConfirming(null);
            if (answer?.kind === 'leave') guard.leave(answer.href);
            else stopEditing('Your changes were discarded. The table shows what is saved.');
          }}
        />
      ) : null}

      {shown.length === 0 ? (
        <div className="mt-4 rounded border border-black/15 p-4 text-sm">
          <p className="font-medium">No rows match.</p>
          <p className="mt-1 text-[color:var(--color-muted)]">
            Try other words, or{' '}
            <button
              type="button"
              className="underline"
              onClick={() => update({ search: '', show: 'all', dimension: '' })}
            >
              clear the search and filters
            </button>
            .
          </p>
        </div>
      ) : (
        <>
          {/* Positioned, so the visually hidden "none" in empty cells is clipped by it instead of widening the page;
              its scroll padding keeps a cell scrolled into view clear of the sticky header row and of the first column
              at its widest, padding included. */}
          <div className="relative mt-4 max-h-[75vh] scroll-pt-12 scroll-pl-[12.5rem] overflow-auto rounded border border-black/15 sm:scroll-pl-[19.5rem]">
            <table
              ref={tableRef}
              role="grid"
              aria-label="Indicators"
              aria-describedby={`${ids}-keys`}
              aria-readonly={editing ? undefined : 'true'}
              aria-rowcount={shown.length + 1}
              aria-colcount={TABLE_COLUMNS.length}
              className="w-max min-w-full border-separate border-spacing-0 text-left text-sm"
              onKeyDown={onKeyDown}
              onFocus={onFocus}
              onMouseDown={onMouseDown}
              onClick={onClick}
              onPaste={onPaste}
              onCopy={onCopy}
            >
              <thead>
                <tr aria-rowindex={1}>
                  {TABLE_COLUMNS.map((col, c) => {
                    const sorted = state.sort?.key === col.key ? state.sort.direction : undefined;
                    const sortKey = col.key as GridSortKey;
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        aria-colindex={c + 1}
                        aria-sort={sorted ?? 'none'}
                        className={`sticky top-0 border-b border-black/15 bg-[color:var(--color-bg)] p-0 font-semibold ${
                          c === 0 ? `${STICKY} z-20` : 'z-10'
                        }`}
                      >
                        <button
                          type="button"
                          className={`flex min-h-11 w-full items-center gap-1 whitespace-nowrap px-3 text-left ${FOCUS_RING}`}
                          onClick={() => update({ sort: nextSort(state.sort, sortKey) })}
                          {...focusProps(0, c)}
                        >
                          {col.label}
                          <span aria-hidden="true" className="text-xs text-[color:var(--color-muted)]">
                            {sorted === 'ascending' ? '▲' : sorted === 'descending' ? '▼' : '↕'}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, i) => {
                  const r = i + 1;
                  return (
                    <tr key={row.rowId} id={rowAnchor(row.rowId)} aria-rowindex={r + 1} className="group target:bg-amber-50">
                      {TABLE_COLUMNS.map((col, c) => {
                        const Tag = c === 0 ? 'th' : 'td';
                        const base = `border-b border-black/10 px-3 py-2 align-top font-normal ${COLUMN_CLASS[col.key] ?? ''}`;
                        if (editing && isEditableColumn(col.key)) {
                          const { content, className } = editableCell(row, col.key, r, c);
                          const sticky = c === 0 ? (className ? STICKY_PLAIN : STICKY_ROW_CELL) : '';
                          return (
                            <Tag
                              key={col.key}
                              {...(c === 0 ? { scope: 'row' } : {})}
                              aria-colindex={c + 1}
                              className={`${base} ${sticky} ${className} ${FOCUS_RING} cursor-cell`}
                              {...focusProps(r, c)}
                            >
                              {content}
                            </Tag>
                          );
                        }
                        const { content, focusOnCell } = cell(row, col.key, r, c);
                        return (
                          <Tag
                            key={col.key}
                            {...(c === 0 ? { scope: 'row' } : {})}
                            aria-colindex={c + 1}
                            {...(editing ? { 'aria-readonly': true } : {})}
                            className={`${base} ${c === 0 ? STICKY_ROW_CELL : ''} ${FOCUS_RING}`}
                            {...(focusOnCell ? focusProps(r, c) : {})}
                          >
                            {content}
                          </Tag>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p id={`${ids}-keys`} className="mt-2 text-xs text-[color:var(--color-muted)]">
            {editing ? (
              EDIT_KEYS_HELP
            ) : (
              <>
                In the table, the arrow keys move from cell to cell; Home and End go to the start or end of a row, Page Up and
                Page Down move ten rows. Press a column&apos;s name to sort by it.
              </>
            )}
          </p>
        </>
      )}

      <EmptyDimensions dimensions={emptyDimensions} />
    </div>
  );
}
