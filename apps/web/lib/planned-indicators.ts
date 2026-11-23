import type { FrameworkDimension, FrameworkIndicator } from '@deep-fryer/contract';
import {
  assignIndicatorKeys,
  isIndicatorKey,
  WHOLE_DIMENSION_GAP,
  type DimensionData,
  type Indicator,
} from '@deep-fryer/core';

/**
 * Pure: the exact list of indicators a research run plans for one dimension —
 * shared by `createPlannedRunIn` (lib/research.ts) and the Research page's
 * `NewRunForm` session/cost estimate so they can never disagree.
 *
 * - An unversioned dimension (`latest == null`) uses the framework defaults.
 * - For a versioned dimension, `latest.data.indicators` is authoritative and
 *   each row keeps its stable `ind.key` (assigned via `assignIndicatorKeys`
 *   against the framework's known slugs when missing on legacy versions),
 *   never re-deriving a mangled slug from its display name.
 * - Any indicator stored in `latest.data.gaps` is re-included (matched against
 *   `frameworkDim` or `priorIndicators` for display name, unit, and
 *   `threshold_ref`) so approving a gap never permanently erases that
 *   indicator from future runs.
 */
export function plannedIndicatorsForDimension(
  latest: { data: DimensionData } | null | undefined,
  frameworkDim: FrameworkDimension | undefined,
  priorIndicators: readonly Indicator[] = [],
): FrameworkIndicator[] {
  if (!latest) return frameworkDim?.indicators ?? [];

  const knownFramework = (frameworkDim?.indicators ?? []).map((fi) => ({
    key: fi.slug,
    name: fi.name,
  }));
  const keyed = assignIndicatorKeys(latest.data.indicators, priorIndicators, knownFramework);
  const fwBySlug = new Map((frameworkDim?.indicators ?? []).map((fi) => [fi.slug, fi]));
  const fwByName = new Map((frameworkDim?.indicators ?? []).map((fi) => [fi.name.trim().toLowerCase(), fi]));
  const priorByKey = new Map(
    priorIndicators
      .filter((ind): ind is Indicator & { key: string } => isIndicatorKey(ind.key))
      .map((ind) => [ind.key, ind]),
  );

  const planned: FrameworkIndicator[] = [];
  const seen = new Set<string>();

  for (const ind of keyed) {
    const slug = ind.key!;
    if (seen.has(slug)) continue;
    seen.add(slug);
    const fwMatch = fwBySlug.get(slug) ?? fwByName.get(ind.name.trim().toLowerCase());
    planned.push({
      slug,
      name: ind.name,
      unit: ind.unit,
      threshold_ref: ind.scoring?.threshold_ref ?? fwMatch?.threshold_ref ?? '',
    });
  }

  for (const gap of latest.data.gaps ?? []) {
    if (gap.indicator === WHOLE_DIMENSION_GAP) {
      if (planned.length === 0 && frameworkDim) {
        for (const fi of frameworkDim.indicators) {
          if (seen.has(fi.slug)) continue;
          seen.add(fi.slug);
          planned.push(fi);
        }
      }
      continue;
    }
    if (!isIndicatorKey(gap.indicator) || seen.has(gap.indicator)) continue;
    seen.add(gap.indicator);
    const fwMatch = fwBySlug.get(gap.indicator);
    if (fwMatch) {
      planned.push(fwMatch);
      continue;
    }
    const prior = priorByKey.get(gap.indicator);
    planned.push({
      slug: gap.indicator,
      name: prior?.name ?? gap.indicator,
      unit: prior?.unit ?? '',
      threshold_ref: prior?.scoring?.threshold_ref ?? '',
    });
  }

  return planned;
}
