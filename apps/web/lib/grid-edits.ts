import { z } from 'zod';
import { frameworkDimension } from '@deep-fryer/contract';
import {
  assignIndicatorKeys,
  computeScoring,
  dimensionDataSchema,
  frameworkIndicatorKeys,
  resolveThreshold,
  WHOLE_DIMENSION_GAP,
  type Confidence,
  type DimensionData,
  type GeographicScale,
  type Indicator,
} from '@deep-fryer/core';
import { UserError } from './action-result';
import { nameFromKey, parseRowId } from './grid-data';
import { columnLabel, readCell, type EditableColumnKey } from './spreadsheet-import';

/*
 * Pure validation, grouping and patch helpers for saving data-grid edits
 * (lib/grid-actions.ts). Separated from the 'use server' module so every
 * row-matching, preservation, scoring and provenance rule can be unit tested
 * directly and 'use server' exports only the server action itself.
 */

export const editableColumnSchema = z.enum([
  'indicator',
  'value',
  'unit',
  'year',
  'target',
  'source',
  'source_url',
  'supporting_source_url',
  'geographic_scale',
  'confidence',
]);

export const gridCellEditSchema = z.object({
  rowId: z.string().trim().min(1).max(200),
  dimensionId: z.guid(),
  baseVersion: z.number().int().min(1),
  column: editableColumnSchema,
  text: z.string().max(10_000),
});

export const saveGridEditsSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(120),
  edits: z.array(gridCellEditSchema).min(1, 'No changes to save.').max(2_000),
  changeNote: z.string().trim().max(500).optional(),
});

export interface GridCellEdit {
  rowId: string;
  dimensionId: string;
  baseVersion: number;
  column: EditableColumnKey;
  text: string;
}

export interface SaveGridEditsInput {
  tenantSlug: string;
  edits: GridCellEdit[];
  changeNote?: string;
}

export interface SavedDimensionDraft {
  dimensionId: string;
  dimensionSlug: string;
  dimensionName: string;
  versionId: string;
  versionNum: number;
  indicatorCount: number;
  cellCount: number;
}

export interface SaveGridEditsResult {
  dimensions: SavedDimensionDraft[];
  totalIndicators: number;
  totalCells: number;
}

export interface GroupedDimensionEdits {
  dimensionId: string;
  baseVersion: number;
  byRowId: Map<string, Map<EditableColumnKey, string>>;
}

/**
 * Group cell edits by dimensionId (preserving order), validating each rowId,
 * consistent baseVersion per dimension, and each cell's stored format.
 */
export function groupGridEdits(edits: readonly GridCellEdit[]): Map<string, GroupedDimensionEdits> {
  const grouped = new Map<string, GroupedDimensionEdits>();

  for (const edit of edits) {
    if (!parseRowId(edit.rowId)) {
      throw new UserError(`Invalid row ID '${edit.rowId}'.`);
    }
    const reading = readCell(edit.column, edit.text);
    if (!reading.ok) {
      throw new UserError(`${columnLabel(edit.column)} of '${edit.rowId}': ${reading.problem}`);
    }

    let dimGroup = grouped.get(edit.dimensionId);
    if (!dimGroup) {
      dimGroup = {
        dimensionId: edit.dimensionId,
        baseVersion: edit.baseVersion,
        byRowId: new Map(),
      };
      grouped.set(edit.dimensionId, dimGroup);
    } else if (dimGroup.baseVersion !== edit.baseVersion) {
      throw new UserError('Conflicting base versions submitted for the same dimension. Reload the page and try again.');
    }

    let rowEdits = dimGroup.byRowId.get(edit.rowId);
    if (!rowEdits) {
      rowEdits = new Map();
      dimGroup.byRowId.set(edit.rowId, rowEdits);
    }
    rowEdits.set(edit.column, edit.text);
  }

  return grouped;
}

export interface GridDimensionTarget {
  slug: string;
  canonicalSlug: string | null;
}

/**
 * Apply staged cell edits for one dimension onto its latest DimensionData:
 * - matches rows by `<dimensionSlug>/<indicatorKey>` (PR #59 row-id discipline)
 * - preserves every untouched indicator, context, actions, action_sources,
 *   spotlights, and dimension metadata verbatim
 * - promotes a gap-only indicator row when edited
 * - enforces SPEC.md §7: any changed non-null value requires supporting_source_url
 * - strips stale scoring when a value is cleared or non-numeric, and re-runs
 *   the thresholds engine over numeric indicators (respecting threshold_overrides)
 */
export function applyDimensionGridEdits(
  dimension: GridDimensionTarget,
  previousData: DimensionData,
  byRowId: ReadonlyMap<string, ReadonlyMap<EditableColumnKey, string>>,
  overrides: Record<string, { target: number; rationale: string }> | null,
): DimensionData {
  const known = frameworkIndicatorKeys(dimension.slug, dimension.canonicalSlug);
  const previousIndicators = assignIndicatorKeys(previousData.indicators ?? [], [], known);
  const indexByKey = new Map<string, number>();
  previousIndicators.forEach((ind, idx) => {
    if (ind.key) indexByKey.set(ind.key, idx);
  });

  const gapKeys = new Set<string>();
  for (const gap of previousData.gaps ?? []) {
    if (gap.indicator !== WHOLE_DIMENSION_GAP) gapKeys.add(gap.indicator);
  }

  const nextIndicators: Indicator[] = previousIndicators.map((ind) => ({ ...ind }));
  const valueChangedKeys = new Set<string>();
  const targetChangedKeys = new Set<string>();
  const populatedKeys = new Set<string>();

  for (const [rowId, colEdits] of byRowId) {
    const parsedId = parseRowId(rowId);
    if (!parsedId || parsedId.dimensionSlug !== dimension.slug) {
      throw new UserError(`Row '${rowId}' does not belong to dimension '${dimension.slug}'.`);
    }

    const existingIdx = indexByKey.get(parsedId.key);
    const prevInd = existingIdx !== undefined ? previousIndicators[existingIdx]! : null;

    let working: Indicator;
    if (existingIdx !== undefined) {
      working = { ...nextIndicators[existingIdx]! };
    } else if (gapKeys.has(parsedId.key)) {
      working = {
        key: parsedId.key,
        name: known.find((k) => k.key === parsedId.key)?.name ?? nameFromKey(parsedId.key),
        value: null,
        unit: '',
        year: null,
        target: null,
        source: '',
        source_url: '',
        confidence: 'low',
        geographic_scale: 'city',
      };
    } else {
      throw new UserError(`Unknown indicator '${rowId}' in dimension '${dimension.slug}'.`);
    }

    for (const [column, rawText] of colEdits) {
      const reading = readCell(column, rawText);
      if (!reading.ok) {
        throw new UserError(`${columnLabel(column)} of '${working.name}': ${reading.problem}`);
      }
      switch (column) {
        case 'indicator':
          working.name = reading.value as string;
          break;
        case 'value': {
          const nextVal = reading.value as number | string | null;
          working.value = nextVal;
          if (!prevInd || String(prevInd.value ?? '') !== String(nextVal ?? '')) {
            valueChangedKeys.add(parsedId.key);
          }
          break;
        }
        case 'unit':
          working.unit = reading.value as string;
          break;
        case 'year':
          working.year = reading.value as number | null;
          break;
        case 'target':
          working.target = reading.value as number | string | null;
          targetChangedKeys.add(parsedId.key);
          break;
        case 'source':
          working.source = reading.value as string;
          break;
        case 'source_url':
          working.source_url = reading.value as string;
          break;
        case 'supporting_source_url': {
          const url = (reading.value as string).trim();
          if (url) working.supporting_source_url = url;
          else delete working.supporting_source_url;
          break;
        }
        case 'geographic_scale':
          working.geographic_scale = reading.value as GeographicScale;
          break;
        case 'confidence':
          working.confidence = reading.value as Confidence;
          break;
      }
    }

    // SPEC.md §7: any changed non-null value must carry a supporting source URL.
    if (valueChangedKeys.has(parsedId.key) && working.value !== null && !working.supporting_source_url?.trim()) {
      throw new UserError(`Indicator '${working.name}': value changes require a supporting source URL.`);
    }

    if (valueChangedKeys.has(parsedId.key)) {
      if (working.value === null || typeof working.value !== 'number') {
        delete working.level_pct;
        delete working.scoring;
      }
      if (working.value !== null) {
        populatedKeys.add(parsedId.key);
      }
    }

    if (existingIdx !== undefined) {
      nextIndicators[existingIdx] = working;
    } else {
      indexByKey.set(parsedId.key, nextIndicators.length);
      nextIndicators.push(working);
    }
  }

  // Re-run thresholds engine over numeric indicators (matching lib/actions.ts rescore).
  const frameworkDim = frameworkDimension(dimension.slug, dimension.canonicalSlug);
  const rescoredIndicators: Indicator[] = nextIndicators.map((ind) => {
    const key = ind.key ?? '';
    const ref =
      ind.scoring?.threshold_ref ??
      (frameworkDim?.indicators.find((fi) => fi.slug === key) ??
        frameworkDim?.indicators.find((fi) => fi.name === ind.name))?.threshold_ref;

    if (!ref || typeof ind.value !== 'number') {
      if (valueChangedKeys.has(key) && !ref) {
        const { level_pct: _l, scoring: _s, ...rest } = ind;
        return rest;
      }
      return ind;
    }

    const threshold = resolveThreshold(ref, overrides ?? undefined);
    if (!threshold) {
      if (valueChangedKeys.has(key)) {
        const { level_pct: _l, scoring: _s, ...rest } = ind;
        return rest;
      }
      return ind;
    }

    try {
      const { level_pct, scoring } = computeScoring(ind.value, ref, threshold);
      const keepEditedTarget = targetChangedKeys.has(key);
      return {
        ...ind,
        level_pct,
        scoring,
        target: keepEditedTarget
          ? ind.target
          : typeof ind.target === 'number' || ind.target === null
            ? threshold.target
            : ind.target,
      };
    } catch {
      return ind;
    }
  });

  // Preserve all dimension-level metadata, context, actions, spotlights, and untouched gaps.
  const nextGaps =
    previousData.gaps && populatedKeys.size > 0
      ? previousData.gaps.filter((g) => g.indicator === WHOLE_DIMENSION_GAP || !populatedKeys.has(g.indicator))
      : previousData.gaps;

  const candidate: DimensionData = {
    ...previousData,
    indicators: rescoredIndicators,
    ...(nextGaps !== undefined ? { gaps: nextGaps } : {}),
  };

  return dimensionDataSchema.parse(candidate) as DimensionData;
}
