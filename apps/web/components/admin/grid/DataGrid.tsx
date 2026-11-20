'use client';

import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { formatIndicatorValue } from '@deep-fryer/core';
import { statusLabel } from '@/components/doughnut/Doughnut';
import { statusDotClass } from '@/components/portrait/status';
import { TABLE_COLUMNS, gridCsv, gridCsvFileName, type GridColumnKey } from '@/lib/grid-columns';
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
import { cellAttr, clampCell, nextCell, parseCellAttr, type CellPosition } from './grid-keys';
import { EMPTY_GRID_STATE, gridStateQuery, nextSort, rowAnchor, type DataGridState } from './grid-state';

/*
 * The Data page's table: every indicator of the portrait, one row each, with
 * a search box, a "Show" filter, a dimension filter, sorting by any column,
 * and a CSV download of every row. The search, filters and sort live in the
 * page address, so a filtered view can be reloaded or sent to someone.
 */

/** The status in words for a doughnut level, as the doughnut words it; "Not scored" without one. */
export function rowStatusWord(vizLevel: number | null): string {
  return vizLevel === null ? 'Not scored' : statusLabel(vizLevel, en.doughnut.level);
}

const CONFIDENCE_WORD: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

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
}

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
}: DataGridProps) {
  const ids = useId();
  const dimensions = useMemo(() => rowDimensions(rows), [rows]);
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
  useEffect(() => {
    const url = `${window.location.pathname}${gridStateQuery(state)}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, [state]);

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

  const update = (patch: Partial<DataGridState>) => setState((s) => ({ ...s, ...patch }));

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    const from = parseCellAttr(target?.dataset.cell) ?? current;
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

  /** The props that put a cell's focus target in the roving tab order. */
  const focusProps = (row: number, col: number, primary = true) => {
    const isActive = current.row === row && current.col === col;
    return { tabIndex: isActive ? 0 : -1, ...(primary ? { 'data-cell': cellAttr({ row, col }) } : {}) };
  };

  const download = () => {
    const csv = gridCsv(rows, {
      statusWord: rowStatusWord,
      absoluteUrl: (href) => new URL(href, window.location.origin).href,
    });
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
            className="min-h-11 rounded bg-black px-3 font-medium text-white"
            aria-describedby={`${ids}-download-about`}
            onClick={download}
          >
            Download CSV
          </button>
        </div>
      </div>
      <p id={`${ids}-download-about`} className="mt-1 text-xs text-[color:var(--color-muted)]">
        The file has all {rows.length} rows, whatever the search and filters, and opens in any spreadsheet program.
        Keep its Row ID and Version columns as they are.
      </p>

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
              its scroll padding keeps a cell scrolled into view clear of the sticky header row and first column. */}
          <div className="relative mt-4 max-h-[75vh] scroll-pt-12 scroll-pl-[11rem] overflow-auto rounded border border-black/15 sm:scroll-pl-[18rem]">
            <table
              ref={tableRef}
              role="grid"
              aria-label="Indicators"
              aria-describedby={`${ids}-keys`}
              aria-readonly="true"
              aria-rowcount={shown.length + 1}
              aria-colcount={TABLE_COLUMNS.length}
              className="w-max min-w-full border-separate border-spacing-0 text-left text-sm"
              onKeyDown={onKeyDown}
              onFocus={onFocus}
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
                        const { content, focusOnCell } = cell(row, col.key, r, c);
                        const Tag = c === 0 ? 'th' : 'td';
                        return (
                          <Tag
                            key={col.key}
                            {...(c === 0 ? { scope: 'row' } : {})}
                            aria-colindex={c + 1}
                            className={`border-b border-black/10 px-3 py-2 align-top font-normal ${COLUMN_CLASS[col.key] ?? ''} ${
                              c === 0 ? STICKY_ROW_CELL : ''
                            } ${FOCUS_RING}`}
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
            In the table, the arrow keys move from cell to cell; Home and End go to the start or end of a row, Page Up and
            Page Down move ten rows. Press a column&apos;s name to sort by it.
          </p>
        </>
      )}

      <EmptyDimensions dimensions={emptyDimensions} />
    </div>
  );
}
