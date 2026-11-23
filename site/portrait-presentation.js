/** Presentation-only distinctions. Never supplies a score for an unknown value. */
// Legacy snapshots sometimes encode a gap as prose rather than null. Keep
// that original text intact, but do not count an explicit missing-data marker
// as an observation. Real qualitative statements remain available values.
// A marker may name where or when the data is missing ("at city level",
// "for 2024"), but only with plain words and years. Anything else after it,
// such as a clause break, a bracket or a measured number, means the text also
// reports a value, so it is shown rather than replaced with a gap.
const missingValue = /^(?:(?:(?:data|value|measurement)\s+)?(?:not available|unavailable|not reported|not published)(?:\s+(?:at|for|in)(?:\s+(?:[a-z][a-z'\/-]*|\d{4}(?:[-\u2013]\d{2,4})?))*)?|n\/a|unknown|data needed)[.!]?$/i;
export function hasValue(indicator) {
  if (indicator.status === 'gap') return false;
  const value = indicator.value;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim() !== '' && !missingValue.test(value.trim());
}
export function dimensionState(dimension) {
  if (dimension.level === null) return dimension.indicators.some(hasValue) ? 'unscored' : 'unknown';
  return dimension.level <= 0 ? 'within' : 'outside';
}
/** Neutral unscored colour, distinct from pale data gaps and green safe results. */
export function dimensionColour(dimension, selected = false) {
  if (selected) return '#0066cc';
  const state = dimensionState(dimension);
  // A zero score has no bar area. The renderer's label pill makes the safe
  // result visibly green without inventing a nonzero or negative magnitude.
  if (state === 'within') return '#8cd755';
  return state === 'unscored' ? '#777777' : null;
}
export function dimensionStatus(dimension) {
  const state = dimensionState(dimension);
  if (state === 'unknown') return 'Data needed';
  if (state === 'unscored') return dimension.indicators.some(indicator => indicator.kind === 'observation' && hasValue(indicator))
    ? 'Unscored observation' : 'Value available · score unknown';
  return state === 'within' ? 'Within target' : dimension.ring === 'social' ? 'Shortfall' : 'Overshoot';
}
export function regionSummary(portrait) {
  const region = (portrait.region || '').trim();
  const first = region.split(/(?<=[.!?])\s+/)[0];
  return first && first.length <= 120 ? first : `${portrait.group} portrait`;
}
/**
 * Computed county population-weighted extreme-heat day means (e.g.
 * 14.757709506983256) come from tract division; round only for display while
 * preserving exact stored values in portraits.json and Definition details.
 */
export function isNoisyHeatMean(indicator) {
  return (
    indicator?.indicator_slug === 'extreme-heat-days' &&
    typeof indicator.value === 'number' &&
    Number.isFinite(indicator.value) &&
    indicator.unit === 'population-weighted mean days/year'
  );
}
export function displayIndicatorValue(indicator, formatValue) {
  if (isNoisyHeatMean(indicator)) {
    return `${Number(indicator.value.toFixed(1))} days/year (population-weighted mean)`;
  }
  return formatValue(indicator?.value, indicator?.unit);
}
export const POLICY_SLIDER_COLOURS = Object.freeze({
  focus: '#0066cc',
  improves: '#2e7d32',
  mixed: '#b7791f',
  withinTarget: '#8cd755',
  unscored: '#777777',
});
export function clampSliderProgress(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
export function interpolatePolicyLevels(policy, progress) {
  const clamped = clampSliderProgress(progress);
  const t = clamped / 100;
  const impactBySlug = new Map(policy.impacts.map((item) => [item.slug, item]));
  return policy.baseline.map((dim) => {
    const type = dim.ring === 'social' ? 'inner' : 'outer';
    const impact = impactBySlug.get(dim.slug);
    if (!impact) {
      const colour =
        dim.level === 0
          ? POLICY_SLIDER_COLOURS.withinTarget
          : dim.level === null && dim.unscored
            ? POLICY_SLIDER_COLOURS.unscored
            : null;
      return { type, name: dim.name, level: dim.level ?? 'NaN', colour };
    }
    const highlight =
      clamped === 0
        ? POLICY_SLIDER_COLOURS.focus
        : impact.direction === 'improves'
          ? POLICY_SLIDER_COLOURS.improves
          : POLICY_SLIDER_COLOURS.mixed;
    if (dim.level === null || impact.afterLevel === null) {
      return { type, name: dim.name, level: dim.level ?? 'NaN', colour: highlight };
    }
    const startLevel = dim.ring === 'social' ? Math.min(100, dim.level) : dim.level;
    const interpolated = Math.round(startLevel + (impact.afterLevel - startLevel) * t);
    return {
      type,
      name: dim.name,
      level: clamped === 0 ? dim.level : interpolated,
      colour: highlight,
    };
  });
}
