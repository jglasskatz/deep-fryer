/**
 * How a dimension's status looks outside the canvas: in the visible list, in
 * the detail panel, and in the panel's legend.
 */

/**
 * The status dot beside a dimension in the list and the panel: the doughnut's
 * own reading of viz_level (green inside the safe space, amber just past a
 * boundary, red well past it, grey without data). Decoration only — the
 * status is always written out next to it, so colour never carries meaning
 * on its own (WCAG 1.4.1). Palette hues, so dark mode remaps them.
 */
export function statusDotClass(level: number | null): string {
  return STATUS_DOT[statusGroup(level)];
}

/**
 * The four readings a status dot (and a summary chip) can show: inside the
 * safe space, just past a boundary, well past it, or no data yet.
 */
export type StatusGroup = 'thriving' | 'attention' | 'critical' | 'unknown';

/** Display order of the summary chips: best to worst, then no data. */
export const STATUS_GROUPS: readonly StatusGroup[] = ['thriving', 'attention', 'critical', 'unknown'];

/** Each reading's dot colour; statusDotClass and the summary chips share it. */
export const STATUS_DOT: Readonly<Record<StatusGroup, string>> = {
  thriving: 'bg-green-600',
  attention: 'bg-amber-500',
  critical: 'bg-red-600',
  unknown: 'bg-gray-400',
};

/** Which reading a viz_level (-100…150 scale) falls in, by the doughnut's own cut-offs. */
export function statusGroup(level: number | null): StatusGroup {
  if (level === null || Number.isNaN(level)) return 'unknown';
  if (level <= 0) return 'thriving';
  if (level <= 50) return 'attention';
  return 'critical';
}

/** How many dimensions fall in each reading: one per wedge on the doughnut. */
export function statusCounts(dims: readonly { viz_level: number | null }[]): Record<StatusGroup, number> {
  const counts: Record<StatusGroup, number> = { thriving: 0, attention: 0, critical: 0, unknown: 0 };
  for (const d of dims) counts[statusGroup(d.viz_level)] += 1;
  return counts;
}

/**
 * The canvas's own colours, read from the vendored renderer
 * (components/doughnut/doughnut-renderer.js) as Doughnut.tsx configures it,
 * for the legend's swatches. The canvas paints them on its own white
 * background in both themes (it is a picture, see app/theme-dark.css), so the
 * swatches are fixed colours too: a swatch must look like the wedge it
 * explains. They only repeat the legend's words.
 */
export const DOUGHNUT_COLOURS = {
  /** `_donutFilling`: the ring (the safe and just space), and the small bump of a dimension inside it. */
  ring: 'rgb(140,215,85)',
  /** `_donutFrosting`: the ring's dark-green borders. */
  ringEdge: 'rgb(71,112,32)',
  /**
   * The first stop of `_grdGlobal`, which `setColours(2, …)` selects: every
   * shortfall and overshoot wedge is this red (an overshoot fades toward
   * white only beyond the outer dashed circle).
   */
  beyond: 'rgb(211,63,54)',
  /** "lightgray": the full-length wedge of a dimension without data. */
  noData: 'rgb(211,211,211)',
} as const;
