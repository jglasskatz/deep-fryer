/**
 * The NYC portrait family: the whole-city doughnut plus one per borough.
 * Drives the family nav and the compare view. Pilot-scoped: when a second
 * multi-portrait family exists, this moves into tenant config.
 */
export interface FamilyMember {
  slug: string;
  name: string;
  short: string;
}

export const NYC_FAMILY: FamilyMember[] = [
  { slug: 'nyc', name: 'New York City', short: 'NYC' },
  { slug: 'manhattan', name: 'Manhattan', short: 'MN' },
  { slug: 'brooklyn', name: 'Brooklyn', short: 'BK' },
  { slug: 'queens', name: 'Queens', short: 'QN' },
  { slug: 'bronx', name: 'The Bronx', short: 'BX' },
  { slug: 'staten-island', name: 'Staten Island', short: 'SI' },
];

export function inNycFamily(slug: string): boolean {
  return NYC_FAMILY.some((m) => m.slug === slug);
}
