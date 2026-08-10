import type { DimensionData, Indicator, Ring } from './types.js';

/**
 * Progress-over-time domain logic (SPEC.md §10 /progress). The honesty rule
 * (numbers-carry-epistemic-type): an arrow is earned only by new data — the
 * indicator's vintage (`year`) advanced AND its scored position moved. A
 * same-vintage change is a revision (a correction or re-score), rendered as
 * "revised", never as progress.
 */

export type IndicatorChangeKind =
  | 'progress'
  | 'regress'
  | 'revised'
  | 'unchanged'
  | 'new'
  | 'removed';

const LEVEL_EPSILON = 0.5; // level_pct noise floor — sub-half-point moves are "unchanged"

export function classifyIndicatorChange(
  prev: Indicator | undefined,
  next: Indicator | undefined,
): IndicatorChangeKind {
  if (!prev && !next) return 'unchanged';
  if (!prev) return 'new';
  if (!next) return 'removed';

  const valueChanged = String(prev.value ?? '') !== String(next.value ?? '');
  const yearAdvanced = prev.year !== null && next.year !== null && next.year > prev.year;
  const bothScored = prev.level_pct !== undefined && next.level_pct !== undefined;

  if (yearAdvanced) {
    if (!bothScored) return valueChanged ? 'revised' : 'unchanged';
    const delta = next.level_pct! - prev.level_pct!;
    if (Math.abs(delta) < LEVEL_EPSILON) return 'unchanged';
    // level_pct: 0 = at the boundary, positive = outside the safe zone —
    // decreasing means moving toward/inside safety on both rings.
    return delta < 0 ? 'progress' : 'regress';
  }
  if (valueChanged || (bothScored && Math.abs(next.level_pct! - prev.level_pct!) >= LEVEL_EPSILON)) {
    return 'revised';
  }
  return 'unchanged';
}

export interface IndicatorDelta {
  name: string;
  unit: string;
  kind: IndicatorChangeKind;
  from?: { value: number | string | null; year: number | null; level_pct?: number };
  to?: { value: number | string | null; year: number | null; level_pct?: number };
}

export interface DimensionDelta {
  slug: string;
  name: string;
  ring: Ring;
  fromViz: number | null;
  toViz: number | null;
  /** toViz − fromViz; null when either side is unscored. */
  vizDelta: number | null;
  indicators: IndicatorDelta[];
}

export interface EraShape {
  slug: string;
  ring: Ring;
  viz_level: number | null;
  data: DimensionData;
}

/** Match dimensions by slug across two eras; indicators by name. */
export function diffPortraits(from: EraShape[], to: EraShape[]): DimensionDelta[] {
  const fromBySlug = new Map(from.map((d) => [d.slug, d]));
  const toBySlug = new Map(to.map((d) => [d.slug, d]));
  const slugs = [...new Set([...from, ...to].map((d) => d.slug))];

  return slugs.map((slug) => {
    const a = fromBySlug.get(slug);
    const b = toBySlug.get(slug);
    const shape = (b ?? a)!;
    const aInd = new Map((a?.data.indicators ?? []).map((i) => [i.name, i]));
    const bInd = new Map((b?.data.indicators ?? []).map((i) => [i.name, i]));
    const names = [...new Set([...aInd.keys(), ...bInd.keys()])];

    const indicators: IndicatorDelta[] = names.map((name) => {
      const prev = aInd.get(name);
      const next = bInd.get(name);
      const pick = (i: Indicator | undefined) =>
        i ? { value: i.value, year: i.year, level_pct: i.level_pct } : undefined;
      return {
        name,
        unit: (next ?? prev)?.unit ?? '',
        kind: classifyIndicatorChange(prev, next),
        from: pick(prev),
        to: pick(next),
      };
    });

    const fromViz = a?.viz_level ?? null;
    const toViz = b?.viz_level ?? null;
    return {
      slug,
      name: shape.data.name,
      ring: shape.ring,
      fromViz,
      toViz,
      vizDelta: fromViz !== null && toViz !== null ? toViz - fromViz : null,
      indicators,
    };
  });
}
