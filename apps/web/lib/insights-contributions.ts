import type { Indicator } from '@deep-fryer/core';
import type { PublishedPortrait } from './portrait';

export interface ContributionMember { slug: string; name: string }
export interface ContributionRow {
  name: string;
  unit: string;
  year: number | null;
  reference: string;
  cityValue: number | null;
  total: number | null;
  parts: { slug: string; name: string; value: number }[];
  unavailable: string | null;
}
/** Only explicitly additive registry entries, identical scoring references,
 * units and years, and local observations can form a contribution stack.
 * The independently published whole remains a separate comparison. */
export function insightContributions(
  members: ContributionMember[],
  portraits: Map<string, PublishedPortrait>,
  whole: string | null,
  dimension: string,
  additiveSlugs: readonly string[],
): ContributionRow[] {
  if (!whole) return [];
  const wholeDimension = portraits.get(whole)?.dimensions.find(d => d.slug === dimension);
  const isLocal = (indicator: Indicator) => ['city', 'county'].includes(indicator.geographic_scale);
  const localNumber = (indicator: Indicator | undefined): indicator is Indicator & { value: number } => Boolean(indicator && typeof indicator.value === 'number' && Number.isFinite(indicator.value) && indicator.value >= 0 && isLocal(indicator));
  return (wholeDimension?.data.indicators ?? []).flatMap(city => {
    const reference = city.scoring?.threshold_ref;
    if (!reference || !additiveSlugs.includes(reference.split('.').at(-1)!)) return [];
    const row: ContributionRow = { name: city.name, unit: city.unit, year: city.year, reference, cityValue: localNumber(city) ? city.value : null, total: null, parts: [], unavailable: null };
    const parts = members.filter(member => member.slug !== whole);
    if (!parts.length || !localNumber(city) || city.year === null) {
      row.unavailable = 'A dated local whole-jurisdiction count and all member counts are needed.';
      return [row];
    }
    for (const member of parts) {
      const candidates = portraits.get(member.slug)?.dimensions.find(d => d.slug === dimension)?.data.indicators.filter(indicator => indicator.scoring?.threshold_ref === reference) ?? [];
      const indicator = candidates[0];
      if (candidates.length !== 1 || !localNumber(indicator) || indicator.year !== city.year || indicator.unit.trim() !== city.unit.trim()) {
        row.unavailable = 'Not combined: at least one member is missing a comparable local count, unit, or data year.';
        return [row];
      }
      row.parts.push({ ...member, value: indicator.value });
    }
    row.total = row.parts.reduce((total, member) => total + member.value, 0);
    return [row];
  });
}
