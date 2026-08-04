import type { Threshold } from '@deep-fryer/contract';
import { getThreshold } from '@deep-fryer/contract';
import type { DimensionData, IndicatorScoring } from './types.js';

/**
 * The thresholds engine (SPEC.md §8 "Scoring").
 *
 * level_pct semantics: 0 = exactly at the boundary, positive = outside the
 * safe zone (shortfall/overshoot), negative = inside it. The mapping function
 * is *named* and comes from this fixed set — config carries data plus a
 * function name, never an expression.
 */

export interface ScoringResult {
  level_pct: number;
  scoring: IndicatorScoring;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function computeScoring(
  value: number,
  thresholdRef: string,
  threshold: Threshold,
): ScoringResult {
  const fn = threshold.function;
  const target = threshold.target;

  if (fn === 'band') {
    const { low, high } = threshold;
    if (typeof low !== 'number' || typeof high !== 'number' || high <= low) {
      throw new TypeError(`threshold ${thresholdRef}: band requires low < high`);
    }
    const width = high - low;
    let levelPct: number;
    let math: string;
    if (value < low) {
      levelPct = round1(((low - value) / width) * 100);
      math = `level_pct = (low − value) ⁄ (high − low) × 100 = (${low} − ${value}) ⁄ ${width} × 100 = ${fmt(levelPct)}`;
    } else if (value > high) {
      levelPct = round1(((value - high) / width) * 100);
      math = `level_pct = (value − high) ⁄ (high − low) × 100 = (${value} − ${high}) ⁄ ${width} × 100 = ${fmt(levelPct)}`;
    } else {
      const dist = Math.min(value - low, high - value);
      levelPct = round1((-dist / width) * 100);
      math = `level_pct = −min(value − low, high − value) ⁄ (high − low) × 100 = −${dist} ⁄ ${width} × 100 = ${fmt(levelPct)}`;
    }
    return {
      level_pct: levelPct,
      scoring: {
        threshold_ref: thresholdRef,
        function: fn,
        inputs: { value, low, high },
        worked_math: math,
      },
    };
  }

  const scale = threshold.scale ?? Math.abs(target);
  if (scale === 0) {
    throw new TypeError(`threshold ${thresholdRef}: scale is required when target = 0`);
  }

  let levelPct: number;
  let math: string;
  if (fn === 'higher_is_better') {
    levelPct = round1(((target - value) / scale) * 100);
    math = `level_pct = (target − value) ⁄ scale × 100 = (${target} − ${value}) ⁄ ${scale} × 100 = ${fmt(levelPct)}`;
  } else {
    levelPct = round1(((value - target) / scale) * 100);
    math = `level_pct = (value − target) ⁄ scale × 100 = (${value} − ${target}) ⁄ ${scale} × 100 = ${fmt(levelPct)}`;
  }

  return {
    level_pct: levelPct,
    scoring: {
      threshold_ref: thresholdRef,
      function: fn,
      inputs: { value, target, scale },
      worked_math: math,
    },
  };
}

function fmt(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * Framework default + tenant override, merged. The override never mutates the
 * default (SPEC.md §6): a partial override keeps the default's other fields.
 */
export function resolveThreshold(
  thresholdRef: string,
  overrides?: Record<string, Partial<Threshold> & { target: number; rationale: string }>,
): Threshold | undefined {
  const base = getThreshold(thresholdRef);
  const override = overrides?.[thresholdRef];
  if (!base && !override) return undefined;
  if (!base) return override as Threshold;
  if (!override) return base;
  return { ...base, ...override };
}

export type VizAggregation = 'worst_of' | 'average';

/**
 * viz_level derives from the indicators' level_pcts (default worst_of), then
 * maps through the same -100..150 curve as v0.
 */
export function deriveVizLevel(
  data: DimensionData,
  aggregation: VizAggregation = 'worst_of',
): number | null {
  const pcts = data.indicators
    .map((i) => i.level_pct)
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));

  if (pcts.length === 0) return null;

  const agg =
    aggregation === 'worst_of'
      ? Math.max(...pcts)
      : pcts.reduce((a, b) => a + b, 0) / pcts.length;

  return pctToVizLevel(agg);
}

/** -100..150 display range: 0..50% maps to 0..100, 50..100% to 100..150, capped. */
export function pctToVizLevel(pct: number): number {
  if (pct <= 0) return Math.max(-100, pct * 2);
  if (pct <= 50) return (pct / 50) * 100;
  if (pct <= 100) return 100 + ((pct - 50) / 50) * 50;
  return 150;
}
