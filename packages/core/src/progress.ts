import type { MappingFunctionName } from '@deep-fryer/contract';

/**
 * Progress monitoring (SPEC-v4 §4): how each indicator has moved since a
 * baseline, and whether that movement keeps pace with the adopted target.
 *
 * Pure over already-fetched history so the public progress page, the admin
 * overview, and the CSV export compute identical statuses.
 *
 * Time is the *data year* (the year a measurement describes), never the date
 * it was published: a 2024 ACS figure researched in 2026 is a 2024 point.
 * When the same data year was published more than once (a correction, a
 * re-research), the latest publication wins.
 *
 * Trajectory framing (docs/nyc-impact-research.md §1): a wedge outside the
 * safe zone at baseline is an inherited condition; what the administration
 * owns is the pace from there. With a target year, the engine draws a
 * straight glidepath from the baseline value to the target and reports
 * whether the latest value is on the right side of it — and, when there is
 * only one measurement so far, the annual pace the target requires.
 */

export interface ProgressConfig {
  /**
   * Latest data year that counts as the baseline. null = the earliest data
   * point available. NYC: 2025 ("conditions as of January 2026").
   */
  baseline_year: number | null;
  /** How the baseline is described to the public ("January 2026"). */
  baseline_label: string;
}

export const defaultProgressConfig: ProgressConfig = {
  baseline_year: null,
  baseline_label: 'First published measurement',
};

export interface ProgressTarget {
  target: number;
  function: MappingFunctionName;
  low?: number;
  high?: number;
  /** Year the adopted goal is due (LL148: 30% canopy by 2040). */
  target_year?: number;
}

export interface ObservedPoint {
  /** Data year the value describes. */
  year: number;
  value: number;
  /** When this value was published; breaks same-year ties (latest wins). */
  publishedAt: Date;
}

export interface SeriesPoint {
  year: number;
  value: number;
}

export type ProgressStatus =
  | 'met'
  | 'on_track'
  | 'off_track'
  | 'improving'
  | 'worsening'
  | 'no_change'
  | 'baseline_only'
  | 'no_target'
  | 'no_data';

export interface IndicatorProgress {
  series: SeriesPoint[];
  baseline: SeriesPoint | null;
  /** True when no point at/before the configured baseline year exists. */
  baselineIsFallback: boolean;
  current: SeriesPoint | null;
  target: number | null;
  targetYear: number | null;
  direction: MappingFunctionName | null;
  changeSinceBaseline: number | null;
  /** Glidepath value expected at the current data year (target_year set). */
  expectedNow: number | null;
  /** Annual change still required to reach the target by target_year. */
  requiredAnnualChange: number | null;
  status: ProgressStatus;
}

/** Collapse raw observations into one point per data year, latest publication winning. */
export function buildSeries(points: ObservedPoint[]): SeriesPoint[] {
  const byYear = new Map<number, ObservedPoint>();
  for (const p of points) {
    if (!Number.isFinite(p.value) || !Number.isInteger(p.year)) continue;
    const prev = byYear.get(p.year);
    if (!prev || p.publishedAt.getTime() >= prev.publishedAt.getTime()) byYear.set(p.year, p);
  }
  return [...byYear.values()]
    .sort((a, b) => a.year - b.year)
    .map(({ year, value }) => ({ year, value }));
}

/** Distance from the safe side of the target; 0 when met. Larger is worse. */
function shortfall(value: number, t: ProgressTarget): number {
  if (t.function === 'higher_is_better') return Math.max(0, t.target - value);
  if (t.function === 'lower_is_better') return Math.max(0, value - t.target);
  const low = t.low ?? t.target;
  const high = t.high ?? t.target;
  if (value < low) return low - value;
  if (value > high) return value - high;
  return 0;
}

const EPSILON = 1e-9;

export function indicatorProgress(
  points: ObservedPoint[],
  target: ProgressTarget | null,
  config: ProgressConfig = defaultProgressConfig,
): IndicatorProgress {
  const series = buildSeries(points);
  const current = series.at(-1) ?? null;

  let baseline: SeriesPoint | null = null;
  let baselineIsFallback = false;
  if (series.length) {
    if (config.baseline_year === null) {
      baseline = series[0]!;
    } else {
      const atOrBefore = series.filter((p) => p.year <= config.baseline_year!);
      baseline = atOrBefore.at(-1) ?? null;
      if (!baseline) {
        baseline = series[0]!;
        baselineIsFallback = true;
      }
    }
  }

  const base: IndicatorProgress = {
    series,
    baseline,
    baselineIsFallback,
    current,
    target: target?.target ?? null,
    targetYear: target?.target_year ?? null,
    direction: target?.function ?? null,
    changeSinceBaseline: baseline && current ? round(current.value - baseline.value) : null,
    expectedNow: null,
    requiredAnnualChange: null,
    status: 'no_data',
  };

  if (!current) return base;
  if (!target) return { ...base, status: 'no_target' };

  const currentGap = shortfall(current.value, target);
  if (currentGap <= EPSILON) return { ...base, status: 'met' };

  const targetYear = target.target_year ?? null;
  // Pace still required from the latest measurement: the "choice ahead".
  const yearsLeft = targetYear !== null ? targetYear - current.year : null;
  const goal = nearestSafeValue(current.value, target);
  const requiredAnnualChange =
    yearsLeft !== null && yearsLeft > 0 ? round((goal - current.value) / yearsLeft) : null;

  if (!baseline || baseline.year === current.year) {
    return { ...base, requiredAnnualChange, status: 'baseline_only' };
  }

  const baselineGap = shortfall(baseline.value, target);
  if (currentGap > baselineGap + EPSILON) {
    return { ...base, requiredAnnualChange, status: 'worsening' };
  }

  if (targetYear !== null && targetYear > baseline.year) {
    const span = targetYear - baseline.year;
    const elapsed = Math.min(span, current.year - baseline.year);
    const baselineGoal = nearestSafeValue(baseline.value, target);
    const expectedNow = round(baseline.value + ((baselineGoal - baseline.value) * elapsed) / span);
    const expectedGap = shortfall(expectedNow, target);
    return {
      ...base,
      expectedNow,
      requiredAnnualChange,
      status: currentGap <= expectedGap + EPSILON ? 'on_track' : 'off_track',
    };
  }

  if (Math.abs(currentGap - baselineGap) <= EPSILON) {
    return { ...base, requiredAnnualChange, status: 'no_change' };
  }
  return { ...base, requiredAnnualChange, status: 'improving' };
}

/** The closest value that satisfies the target (the band edge for bands). */
function nearestSafeValue(value: number, t: ProgressTarget): number {
  if (t.function !== 'band') return t.target;
  const low = t.low ?? t.target;
  const high = t.high ?? t.target;
  return value < low ? low : value > high ? high : value;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export const PROGRESS_STATUS_LABEL: Record<ProgressStatus, string> = {
  met: 'Target met',
  on_track: 'On track',
  off_track: 'Off track',
  improving: 'Improving',
  worsening: 'Worsening',
  no_change: 'No change',
  baseline_only: 'Baseline set',
  no_target: 'Tracked (no target)',
  no_data: 'Data needed',
};

/** Counts per status — the headline line on progress pages. */
export function summarizeProgress(rows: { status: ProgressStatus }[]): Record<ProgressStatus, number> {
  const out = Object.fromEntries(
    Object.keys(PROGRESS_STATUS_LABEL).map((k) => [k, 0]),
  ) as Record<ProgressStatus, number>;
  for (const r of rows) out[r.status] += 1;
  return out;
}
