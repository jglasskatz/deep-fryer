/** Presentation-only distinctions. Never supplies a score for an unknown value. */
export const hasValue = indicator => indicator.value !== null && indicator.value !== undefined && indicator.value !== '';
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
