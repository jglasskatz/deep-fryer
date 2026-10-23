/** Map a raw shortfall/overshoot percentage to the canonical -100..150 display range.
 * @param {number} pct
 * @returns {number}
 */
export function pctToVizLevel(pct) {
  if (pct <= 0) return Math.max(-100, pct * 2);
  if (pct <= 50) return (pct / 50) * 100;
  if (pct <= 100) return 100 + ((pct - 50) / 50) * 50;
  return 150;
}
