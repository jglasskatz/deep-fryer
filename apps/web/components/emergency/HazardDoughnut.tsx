'use client';

import { useMemo } from 'react';
import type { Ring } from '@deep-fryer/core';
import {
  HIGHLIGHT_COLOURS,
  ImpactDoughnut,
  type ImpactDimension,
  type ImpactDoughnutLabels,
  type ImpactHighlight,
} from '@/components/doughnut/ImpactDoughnut';

/**
 * One hazard on the flashing doughnut (SPEC-v5 §3, "threats in terms of
 * risk/impact"), with its key. A client component because the swatches use
 * the doughnut's own highlight colours (a client module's values cannot be
 * read while rendering on the server), so the key always matches the chart.
 *
 * The list of threatened dimensions is the chart's accessible equivalent:
 * each row states the impact in words, and a wedge click lands on its row
 * (`#threat-{slug}`).
 */

export type ImpactLevel = 'low' | 'moderate' | 'high';

/** One wedge: today's published level, and the hazard's impact on it (if any). */
export interface HazardWedge {
  slug: string;
  ring: Ring;
  /** In the reader's language. */
  name: string;
  current: number | null;
  impact: ImpactLevel | null;
}

const IMPACT_HIGHLIGHT: Record<ImpactLevel, ImpactHighlight> = {
  low: 'risk_low',
  moderate: 'risk_moderate',
  high: 'risk_high',
};

function Swatch({ level }: { level: ImpactLevel }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 shrink-0 rounded-sm"
      style={{ background: HIGHLIGHT_COLOURS[IMPACT_HIGHLIGHT[level]] }}
    />
  );
}

export function HazardDoughnut({
  dimensions,
  threatened,
  labels,
  ariaLabel,
  threatensLabel,
  legendLabel,
  impactLabels,
}: {
  dimensions: HazardWedge[];
  /**
   * The hazard's threatened dimensions, each with its row text already in
   * the reader's language ("Health (high impact)", from the catalog's
   * dimensionImpact pattern, so translators control the punctuation).
   */
  threatened: { slug: string; label: string; impact: ImpactLevel }[];
  labels: ImpactDoughnutLabels;
  ariaLabel: string;
  threatensLabel: string;
  legendLabel: string;
  impactLabels: Record<ImpactLevel, string>;
}) {
  // Hazards do not project wedge sizes (alternate null): only the tint
  // changes, by impact level.
  const wedges = useMemo<ImpactDimension[]>(
    () =>
      dimensions.map((d) => ({
        slug: d.slug,
        ring: d.ring,
        name: d.name,
        current: d.current,
        alternate: null,
        highlight: d.impact ? IMPACT_HIGHLIGHT[d.impact] : null,
      })),
    [dimensions],
  );
  return (
    <div className="mt-4 flex flex-col items-center gap-6 lg:flex-row lg:items-start">
      <ImpactDoughnut dimensions={wedges} size={480} anchorPrefix="threat-" ariaLabel={ariaLabel} labels={labels} />
      <div className="w-full max-w-sm text-sm">
        <p className="font-medium">{threatensLabel}</p>
        <ul className="mt-2 space-y-1">
          {threatened.map((d) => (
            // Scroll margin clears the sticky header (see ANCHOR in EmergencySections).
            <li key={d.slug} id={`threat-${d.slug}`} className="flex scroll-mt-48 items-center gap-2 sm:scroll-mt-36">
              <Swatch level={d.impact} />
              <span>{d.label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-[color:var(--color-muted)]">{legendLabel}</p>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--color-muted)]">
          {(['high', 'moderate', 'low'] as const).map((level) => (
            <li key={level} className="flex items-center gap-1.5">
              <Swatch level={level} />
              {impactLabels[level]}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
