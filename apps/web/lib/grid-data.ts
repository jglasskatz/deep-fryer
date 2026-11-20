import { frameworkDimension } from '@deep-fryer/contract';
import {
  assignIndicatorKeys,
  formatIndicatorValue,
  frameworkIndicatorKeys,
  isIndicatorKey,
  pctToVizLevel,
  WHOLE_DIMENSION_GAP,
  type Confidence,
  type DimensionData,
  type GeographicScale,
  type Ring,
} from '@deep-fryer/core';
import type { Dimension, DimensionVersion } from '@deep-fryer/db';

/*
 * The Data page's rows: every dimension's latest version (draft or
 * published) flattened into one row per indicator. Pure over what the page
 * already read (admin-data tenantDimensions), so the table, the download and
 * their tests all work from the same rows. The search, filter and sort the
 * table offers are here too, as plain functions.
 */

/** The parts of admin-data's DimensionWithVersions these rows read. */
export interface GridDimensionInput {
  dimension: Pick<Dimension, 'id' | 'slug' | 'canonicalSlug' | 'ring' | 'publishedVersionId'>;
  latest: Pick<DimensionVersion, 'id' | 'versionNum' | 'data'> | null;
}

export interface GridEvidence {
  /** Where the snapshot image is served. */
  href: string;
  /** Where the PDF copy is served, when there is one. */
  pdfHref?: string;
  /** The day the page was captured (YYYY-MM-DD). */
  capturedOn: string;
}

export interface GridRow {
  /** `<dimension slug>/<indicator key>`: the row's name in a downloaded file. */
  rowId: string;
  dimensionId: string;
  dimensionSlug: string;
  dimensionName: string;
  ring: Ring;
  /** The number of the dimension version this row was read from. */
  baseVersion: number;
  /** Whether that version is the one the public sees. */
  published: boolean;
  key: string;
  name: string;
  value: number | string | null;
  unit: string;
  year: number | null;
  target: number | string | null;
  /** The doughnut's -100…150 level from the indicator's score, or null when it is not scored. */
  vizLevel: number | null;
  source: string;
  sourceUrl: string;
  supportingSourceUrl: string;
  geographicScale: GeographicScale | '';
  confidence: Confidence | '';
  evidence: GridEvidence | null;
  /**
   * Why research found no usable figure, when the version records a gap for
   * this row, or for the whole dimension and this row has no value.
   */
  gapReason: string | null;
}

export interface GridRowsOptions {
  /** The address of a stored evidence file (lib/data evidenceUrl for this portrait). */
  evidenceHref?: (storagePath: string) => string;
}

/** What `value` holds when it has nothing to show: null, blank text or a non-finite number. */
export function isEmptyValue(value: number | string | null | undefined): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (typeof value === 'number' && !Number.isFinite(value))
  );
}

/** A readable name for a key with no indicator behind it: "hate-crimes-reported" reads "Hate crimes reported". */
export function nameFromKey(key: string): string {
  const words = key.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The dimension's own name, else the framework's name for it, else its slug (a custom dimension never saved). */
function dimensionName(dimension: GridDimensionInput['dimension'], content: DimensionData | undefined): string {
  return content?.name?.trim() || frameworkDimension(dimension.slug, dimension.canonicalSlug)?.name || dimension.slug;
}

/** The reason a version records for a gap covering the whole dimension, or null when it records none. */
function wholeDimensionGapReason(content: DimensionData | undefined): string | null {
  const reason = content?.gaps?.find((gap) => gap.indicator === WHOLE_DIMENSION_GAP)?.reason?.trim();
  return reason || null;
}

/**
 * One row per indicator of each dimension's latest version, in the
 * dimensions' display order and then the version's own order; then, per
 * dimension, one row for each indicator the version records as a gap but
 * does not list (research found no usable figure for it), so a missing
 * framework indicator is a visible row and not an absence.
 *
 * Rows are keyed as a save would key them (core assignIndicatorKeys against
 * the framework's indicators): a version written before keys existed gets
 * the keys its next save will store, so the row IDs in a file downloaded now
 * still name the same rows afterwards.
 */
export function gridRows(dims: readonly GridDimensionInput[], options: GridRowsOptions = {}): GridRow[] {
  const rows: GridRow[] = [];
  for (const { dimension, latest } of dims) {
    if (!latest) continue;
    const content = latest.data;
    const known = frameworkIndicatorKeys(dimension.slug, dimension.canonicalSlug);
    const indicators = assignIndicatorKeys(content.indicators ?? [], [], known);
    const wholeGap = wholeDimensionGapReason(content);
    const gapReasons = new Map<string, string>();
    for (const gap of content.gaps ?? []) {
      if (gap.indicator !== WHOLE_DIMENSION_GAP && isIndicatorKey(gap.indicator) && !gapReasons.has(gap.indicator)) {
        gapReasons.set(gap.indicator, gap.reason);
      }
    }
    const base = {
      dimensionId: dimension.id,
      dimensionSlug: dimension.slug,
      dimensionName: dimensionName(dimension, content),
      ring: dimension.ring,
      baseVersion: latest.versionNum,
      published: dimension.publishedVersionId === latest.id,
    };
    const listed = new Set<string>();
    for (const ind of indicators) {
      const key = ind.key as string;
      listed.add(key);
      const evidence = ind.evidence && options.evidenceHref
        ? {
            href: options.evidenceHref(ind.evidence.snapshot_path),
            ...(ind.evidence.pdf_path ? { pdfHref: options.evidenceHref(ind.evidence.pdf_path) } : {}),
            capturedOn: ind.evidence.captured_at.slice(0, 10),
          }
        : null;
      const value = isEmptyValue(ind.value) ? null : ind.value;
      rows.push({
        ...base,
        rowId: `${dimension.slug}/${key}`,
        key,
        name: ind.name,
        value,
        unit: ind.unit ?? '',
        year: typeof ind.year === 'number' ? ind.year : null,
        target: isEmptyValue(ind.target) ? null : ind.target,
        vizLevel: value !== null && typeof ind.level_pct === 'number' && Number.isFinite(ind.level_pct)
          ? pctToVizLevel(ind.level_pct)
          : null,
        source: ind.source ?? '',
        sourceUrl: ind.source_url ?? '',
        supportingSourceUrl: ind.supporting_source_url ?? '',
        geographicScale: ind.geographic_scale ?? '',
        confidence: ind.confidence ?? '',
        evidence,
        gapReason: value === null ? (gapReasons.get(key) ?? wholeGap) : null,
      });
    }
    for (const [key, reason] of gapReasons) {
      if (listed.has(key)) continue;
      rows.push({
        ...base,
        rowId: `${dimension.slug}/${key}`,
        key,
        name: known.find((k) => k.key === key)?.name ?? nameFromKey(key),
        value: null,
        unit: '',
        year: null,
        target: null,
        vizLevel: null,
        source: '',
        sourceUrl: '',
        supportingSourceUrl: '',
        geographicScale: '',
        confidence: '',
        evidence: null,
        gapReason: reason,
      });
    }
  }
  return rows;
}

/** A dimension with no row in the table, by name. */
export interface DimensionWithoutRows {
  name: string;
  /** Why research found no usable figure for the whole dimension, when its version records that; else null. */
  gapReason: string | null;
}

/**
 * The dimensions that have no row in the table: no version yet, a version
 * with no indicators, or one where research recorded that the whole
 * dimension has no usable figure (with the reason it gave).
 */
export function dimensionsWithoutRows(
  dims: readonly GridDimensionInput[],
  rows: readonly GridRow[],
): DimensionWithoutRows[] {
  const withRows = new Set(rows.map((r) => r.dimensionId));
  return dims
    .filter((d) => !withRows.has(d.dimension.id))
    .map((d) => ({ name: dimensionName(d.dimension, d.latest?.data), gapReason: wholeDimensionGapReason(d.latest?.data) }));
}

/** A row ID's dimension slug and indicator key, or null when it is not one. */
export function parseRowId(rowId: string): { dimensionSlug: string; key: string } | null {
  const slash = rowId.indexOf('/');
  if (slash <= 0) return null;
  const dimensionSlug = rowId.slice(0, slash);
  const key = rowId.slice(slash + 1);
  return isIndicatorKey(key) && /^[a-z0-9][a-z0-9-]*$/.test(dimensionSlug) ? { dimensionSlug, key } : null;
}

// ---- Search, filter and sort ----

export type GridShow = 'all' | 'no-value' | 'no-source-link' | 'low-confidence' | 'not-published';

/** The "Show" choices, in the order the table offers them. */
export const GRID_SHOW_OPTIONS: readonly { value: GridShow; label: string }[] = [
  { value: 'all', label: 'All rows' },
  { value: 'no-value', label: 'Rows with no value' },
  { value: 'no-source-link', label: 'Rows with no source link' },
  { value: 'low-confidence', label: 'Rows with low confidence' },
  { value: 'not-published', label: 'Rows not yet published' },
];

export function isGridShow(value: unknown): value is GridShow {
  return GRID_SHOW_OPTIONS.some((o) => o.value === value);
}

const SHOW_TESTS: Record<GridShow, (row: GridRow) => boolean> = {
  all: () => true,
  'no-value': (row) => row.value === null,
  'no-source-link': (row) => row.sourceUrl.trim() === '',
  'low-confidence': (row) => row.confidence === 'low',
  'not-published': (row) => !row.published,
};

/** Lower case with accents dropped, so "anos" finds "años". */
export function searchText(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Everything a search looks through for one row: each cell as stored and as
 * the table shows it ("1240" and "1,240", the status and confidence in
 * words, "Data needed" and the gap's reason, the version's "draft" or
 * "published", the evidence's links and day).
 */
function rowSearchText(row: GridRow, statusWord: GridQuery['statusWord']): string {
  const shownValue = (v: number | string | null) => (v === null ? null : formatIndicatorValue(v, ''));
  return searchText(
    [
      row.name,
      row.dimensionName,
      row.published ? 'published' : 'draft',
      row.value,
      row.value === null ? `${formatIndicatorValue(null, '')}\n${row.gapReason ?? ''}` : shownValue(row.value),
      row.unit,
      row.year,
      row.target,
      shownValue(row.target),
      row.value !== null && statusWord ? statusWord(row.vizLevel) : null,
      row.source,
      row.sourceUrl,
      row.supportingSourceUrl,
      row.geographicScale,
      row.confidence,
      row.evidence ? ['snapshot', row.evidence.pdfHref ? 'pdf' : '', row.evidence.capturedOn].join(' ') : null,
      row.rowId,
    ]
      .filter((v) => v !== null && v !== '')
      .join('\n'),
  );
}

export interface GridQuery {
  /** Words to look for; a row matches when it contains every one. */
  search?: string;
  show?: GridShow;
  /** A dimension slug, or empty for every dimension. */
  dimension?: string;
  /** The status in words the table shows for a doughnut level, so a search finds it ("Critical"). */
  statusWord?: (vizLevel: number | null) => string;
}

export function filterRows(rows: readonly GridRow[], query: GridQuery): GridRow[] {
  const words = searchText(query.search ?? '').split(/\s+/).filter(Boolean);
  const show = SHOW_TESTS[query.show ?? 'all'] ?? SHOW_TESTS.all;
  return rows.filter((row) => {
    if (query.dimension && row.dimensionSlug !== query.dimension) return false;
    if (!show(row)) return false;
    if (words.length === 0) return true;
    const text = rowSearchText(row, query.statusWord);
    return words.every((w) => text.includes(w));
  });
}

/** The table columns rows can be sorted by. */
export type GridSortKey =
  | 'indicator'
  | 'dimension'
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

export type SortDirection = 'ascending' | 'descending';

export interface GridSort {
  key: GridSortKey;
  direction: SortDirection;
}

const CONFIDENCE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/** The value a row sorts by: a number, text, or null for nothing (always last). */
function sortValue(row: GridRow, key: GridSortKey): number | string | null {
  const blankAsNull = (v: string) => (v.trim() === '' ? null : v);
  switch (key) {
    case 'indicator':
      return row.name;
    case 'dimension':
      return row.dimensionName;
    case 'value':
      return row.value;
    case 'unit':
      return blankAsNull(row.unit);
    case 'year':
      return row.year;
    case 'target':
      return row.target;
    case 'status':
      return row.vizLevel;
    case 'source':
      return blankAsNull(row.source);
    case 'source_url':
      return blankAsNull(row.sourceUrl);
    case 'supporting_source_url':
      return blankAsNull(row.supportingSourceUrl);
    case 'geographic_scale':
      return blankAsNull(row.geographicScale);
    case 'confidence':
      return row.confidence ? (CONFIDENCE_RANK[row.confidence] ?? null) : null;
    case 'evidence':
      return row.evidence?.capturedOn ?? null;
  }
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function compareValues(a: number | string, b: number | string): number {
  // Numbers before text, so a column mixing "12" and "12–33% (varies)" stays readable.
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return collator.compare(a, b);
}

/**
 * Rows sorted by one column, ties kept in their table order. Rows with
 * nothing in the column go last in either direction, so sorting by value
 * never hides the figures behind a page of empty rows.
 */
export function sortRows(rows: readonly GridRow[], sort: GridSort | null): GridRow[] {
  if (!sort) return [...rows];
  const sign = sort.direction === 'descending' ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, sort.key) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.index - b.index;
        return a.value === null ? 1 : -1;
      }
      return sign * compareValues(a.value, b.value) || a.index - b.index;
    })
    .map((x) => x.row);
}

export const GRID_SORT_KEYS: readonly GridSortKey[] = [
  'indicator',
  'dimension',
  'value',
  'unit',
  'year',
  'target',
  'status',
  'source',
  'source_url',
  'supporting_source_url',
  'geographic_scale',
  'confidence',
  'evidence',
];

export function isGridSortKey(value: unknown): value is GridSortKey {
  return GRID_SORT_KEYS.includes(value as GridSortKey);
}
