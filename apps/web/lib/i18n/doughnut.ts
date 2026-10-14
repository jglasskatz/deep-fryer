import type { Messages } from './messages/en';

/**
 * The doughnut's words, as a plain serializable object: the doughnut is a
 * client component (canvas + tooltip), so the server picks the reader's
 * catalog and passes only these strings down.
 */
export interface DoughnutLabels {
  chartLabel: string;
  summary: string;
  summaryWithGaps: string;
  portrait: string;
  dimensionsOf: string;
  dataNeeded: string;
  year: string;
  source: string;
  fullPortrait: string;
  social: string;
  ecological: string;
  level: Messages['doughnut']['level'];
}

export function doughnutLabels(m: Messages): DoughnutLabels {
  const d = m.doughnut;
  return {
    chartLabel: d.chartLabel,
    summary: d.summary,
    summaryWithGaps: d.summaryWithGaps,
    portrait: d.portrait,
    dimensionsOf: d.dimensionsOf,
    dataNeeded: d.dataNeeded,
    year: d.year,
    source: d.source,
    fullPortrait: d.fullPortrait,
    social: m.common.socialFoundation,
    ecological: m.common.ecologicalCeiling,
    level: d.level,
  };
}
