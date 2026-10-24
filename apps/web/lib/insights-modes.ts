/** Family comparisons use published normalized dimension scores, never raw
 * indicator values with potentially different definitions or units. */
export const INSIGHT_MODES = ['absolute', 'vs-city', 'vs-target', 'rank'] as const;
export type InsightMode = (typeof INSIGHT_MODES)[number];
export function insightMode(value: unknown): InsightMode {
  return INSIGHT_MODES.includes(value as InsightMode) ? value as InsightMode : 'absolute';
}
export interface InsightScore { slug: string; level: number | null }
export function comparisonScores(mode: InsightMode, members: InsightScore[], whole: string | null): Map<string, number | null> {
  const reference = whole ? members.find(member => member.slug === whole)?.level ?? null : null;
  const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
  const contestants = members.filter(member => member.slug !== whole && finite(member.level));
  return new Map(members.map(member => {
    if (!finite(member.level)) return [member.slug, null];
    if (mode === 'vs-city') return [member.slug, finite(reference) ? member.level - reference : null];
    if (mode === 'rank') return [member.slug, member.slug === whole ? null : 1 + contestants.filter(other => other.level! < member.level!).length];
    // The published score's target is zero, so subtracting it preserves the
    // absolute score. Say so in the view rather than inventing another scale.
    return [member.slug, member.level];
  }));
}
export function insightGeometry(value: number, mode: InsightMode, memberCount: number) {
  const min = mode === 'rank' ? 0 : mode === 'vs-city' ? -250 : -100;
  const max = mode === 'rank' ? Math.max(memberCount, 1) : mode === 'vs-city' ? 250 : 150;
  const clamped = Math.max(min, Math.min(max, value));
  const zeroX = min === 0 ? 0 : 100 * -min / (max - min);
  const x = 100 * (clamped - min) / (max - min);
  return { zeroX, left: Math.min(zeroX, x), width: Math.abs(x - zeroX) };
}
export function insightValue(value: number, mode: InsightMode): string {
  if (mode === 'rank') return `#${value}`;
  const rounded = Math.round(value);
  return mode === 'vs-city' && rounded > 0 ? `+${rounded}` : String(rounded === 0 ? 0 : rounded);
}
