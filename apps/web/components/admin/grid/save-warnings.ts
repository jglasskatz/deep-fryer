import { formatIndicatorValue } from '@deep-fryer/core';
import type { GridRow } from '@/lib/grid-data';
import { readValueText, type EditableColumnKey } from '@/lib/spreadsheet-import';
import type { StagedChange } from './edit-session';

/*
 * Pre-save review and warning computation for the data table's edit mode.
 * Pure over the staged changes and the rows they came from: groups edits by
 * dimension and indicator, counts how many drafts will be created, and flags
 * changes worth a careful second look before saving.
 */

export type SaveWarningKind =
  | 'published-dimension'
  | 'cleared-value'
  | 'large-numeric-change'
  | 'missing-source'
  | 'cell-note';

export interface SaveWarning {
  kind: SaveWarningKind;
  message: string;
}

export interface SaveReviewIndicator {
  rowId: string;
  indicatorName: string;
  changes: StagedChange[];
  warnings: SaveWarning[];
}

export interface SaveReviewDimension {
  dimensionId: string;
  dimensionName: string;
  baseVersion: number;
  published: boolean;
  dimensionWarnings: SaveWarning[];
  indicators: SaveReviewIndicator[];
}

export interface SaveReview {
  dimensionCount: number;
  indicatorCount: number;
  changeCount: number;
  publishedDimensionCount: number;
  warningCount: number;
  dimensions: SaveReviewDimension[];
}

/** Relative numeric swing above which we flag a value edit as a potential typo or paste mismatch. */
export const LARGE_SWING_RATIO = 0.5;

function formatNumber(n: number): string {
  return formatIndicatorValue(n, '');
}

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function indicatorWarnings(changes: readonly StagedChange[], row: GridRow | undefined): SaveWarning[] {
  const warnings: SaveWarning[] = [];
  const byColumn = new Map<EditableColumnKey, StagedChange>();
  for (const c of changes) byColumn.set(c.column, c);

  const valueChange = byColumn.get('value');
  if (valueChange) {
    const beforeVal = row ? row.value : readValueText(valueChange.before);
    const afterVal = readValueText(valueChange.after);

    // 1. Clearing a previously populated value (turns it into missing data / gap).
    if (valueChange.clearsValue && beforeVal !== null) {
      if (typeof beforeVal === 'number' && Number.isFinite(beforeVal)) {
        warnings.push({
          kind: 'cleared-value',
          message: `Clears the numeric value ${formatNumber(beforeVal)}, turning this indicator into missing data (a gap).`,
        });
      } else {
        warnings.push({
          kind: 'cleared-value',
          message: `Clears the value “${String(beforeVal)}”, turning this indicator into missing data (a gap).`,
        });
      }
    }

    // 2. Large numeric change (>50% swing or sign change).
    if (
      typeof beforeVal === 'number' &&
      Number.isFinite(beforeVal) &&
      typeof afterVal === 'number' &&
      Number.isFinite(afterVal) &&
      beforeVal !== afterVal
    ) {
      const signChanged = (beforeVal > 0 && afterVal < 0) || (beforeVal < 0 && afterVal > 0);
      if (signChanged) {
        warnings.push({
          kind: 'large-numeric-change',
          message: `Sign changed from ${formatNumber(beforeVal)} to ${formatNumber(afterVal)}. Check for a typo or pasted column misalignment.`,
        });
      } else if (beforeVal !== 0) {
        const ratio = Math.abs(afterVal - beforeVal) / Math.abs(beforeVal);
        // Tiny epsilon so exact 50% decimal swings (e.g. 12.4 -> 18.6) do not trip on IEEE-754 rounding.
        if (ratio > LARGE_SWING_RATIO + 1e-9) {
          const pct = Math.round(ratio * 100);
          const direction = afterVal > beforeVal ? 'increase' : 'decrease';
          warnings.push({
            kind: 'large-numeric-change',
            message: `Large numeric change: ${formatNumber(beforeVal)} to ${formatNumber(afterVal)} (${pct}% ${direction}). Check for a typo or pasted column misalignment.`,
          });
        }
      }
    }
  }

  // 3. Changing value (to a populated value), unit, or target without a source name or source URL.
  const trackedFields: string[] = [];
  if (valueChange && !valueChange.clearsValue) trackedFields.push('Value');
  if (byColumn.has('unit')) trackedFields.push('Unit');
  if (byColumn.has('target')) trackedFields.push('Target');

  if (trackedFields.length > 0) {
    const effectiveSource = (byColumn.get('source')?.after ?? row?.source ?? '').trim();
    const effectiveSourceUrl = (byColumn.get('source_url')?.after ?? row?.sourceUrl ?? '').trim();
    const missingName = !effectiveSource;
    const missingUrl = !effectiveSourceUrl;
    if (missingName && missingUrl) {
      warnings.push({
        kind: 'missing-source',
        message: `Changed ${joinList(trackedFields)} without a source name or source link.`,
      });
    } else if (missingName) {
      warnings.push({
        kind: 'missing-source',
        message: `Changed ${joinList(trackedFields)} without a source name.`,
      });
    } else if (missingUrl) {
      warnings.push({
        kind: 'missing-source',
        message: `Changed ${joinList(trackedFields)} without a source link.`,
      });
    }
  }

  // 4. Carry forward any non-blocking cell notes (nameless indicator, short year, non-URL link).
  for (const c of changes) {
    if (c.note) {
      warnings.push({
        kind: 'cell-note',
        message: `${c.columnLabel}: ${c.note}`,
      });
    }
  }

  return warnings;
}

/**
 * Group staged changes by dimension and indicator, and compute pre-save
 * warnings for the confirmation dialog. Order follows the staged changes
 * (which are in table order).
 */
export function buildSaveReview(changes: readonly StagedChange[], rows: readonly GridRow[]): SaveReview {
  const rowsById = new Map(rows.map((r) => [r.rowId, r]));
  const dimOrder: string[] = [];
  const dimBuckets = new Map<
    string,
    {
      dimensionId: string;
      dimensionName: string;
      baseVersion: number;
      published: boolean;
      rowOrder: string[];
      rows: Map<string, { indicatorName: string; changes: StagedChange[] }>;
    }
  >();

  for (const change of changes) {
    const row = rowsById.get(change.rowId);
    let dim = dimBuckets.get(change.dimensionId);
    if (!dim) {
      dim = {
        dimensionId: change.dimensionId,
        dimensionName: change.dimensionName,
        baseVersion: change.baseVersion,
        published: row?.published ?? false,
        rowOrder: [],
        rows: new Map(),
      };
      dimBuckets.set(change.dimensionId, dim);
      dimOrder.push(change.dimensionId);
    } else if (row?.published) {
      dim.published = true;
    }

    let ind = dim.rows.get(change.rowId);
    if (!ind) {
      ind = { indicatorName: change.indicatorName, changes: [] };
      dim.rows.set(change.rowId, ind);
      dim.rowOrder.push(change.rowId);
    }
    ind.changes.push(change);
  }

  let indicatorCount = 0;
  let publishedDimensionCount = 0;
  let warningCount = 0;

  const dimensions: SaveReviewDimension[] = dimOrder.map((dimId) => {
    const bucket = dimBuckets.get(dimId)!;
    const dimensionWarnings: SaveWarning[] = [];
    if (bucket.published) {
      publishedDimensionCount++;
      dimensionWarnings.push({
        kind: 'published-dimension',
        message: `${bucket.dimensionName} is currently published (v${bucket.baseVersion}). Saving creates a new draft (v${bucket.baseVersion + 1}) and will not publish automatically.`,
      });
    }
    warningCount += dimensionWarnings.length;

    const indicators: SaveReviewIndicator[] = bucket.rowOrder.map((rowId) => {
      indicatorCount++;
      const entry = bucket.rows.get(rowId)!;
      const warnings = indicatorWarnings(entry.changes, rowsById.get(rowId));
      warningCount += warnings.length;
      return {
        rowId,
        indicatorName: entry.indicatorName,
        changes: entry.changes,
        warnings,
      };
    });

    return {
      dimensionId: bucket.dimensionId,
      dimensionName: bucket.dimensionName,
      baseVersion: bucket.baseVersion,
      published: bucket.published,
      dimensionWarnings,
      indicators,
    };
  });

  return {
    dimensionCount: dimensions.length,
    indicatorCount,
    changeCount: changes.length,
    publishedDimensionCount,
    warningCount,
    dimensions,
  };
}
