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
  if (level === null || Number.isNaN(level)) return 'bg-gray-400';
  if (level <= 0) return 'bg-green-600';
  if (level <= 50) return 'bg-amber-500';
  return 'bg-red-600';
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
