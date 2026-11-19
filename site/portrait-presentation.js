/** Presentation-only distinctions. Never supplies a score for an unknown value. */
// Legacy snapshots sometimes encode a gap as prose rather than null. Keep
// that original text intact, but do not count an explicit missing-data marker
// as an observation. Real qualitative statements remain available values.
const missingValue = /^(?:(?:(?:data|value|measurement)\s+)?(?:not available|unavailable|not reported|not published)(?:\s+(?:at|for|in)\b.*)?|n\/a|unknown|data needed)[.!]?$/i;
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
