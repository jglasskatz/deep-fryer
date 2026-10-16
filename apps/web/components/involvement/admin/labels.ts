import { framework } from '@deep-fryer/contract';
import { INVOLVEMENT_KINDS, type InvolvementKind } from '@deep-fryer/core';

/**
 * Plain-English words for the staff pages about getting involved (staff
 * pages are English-only by convention). Shared by the server-rendered
 * review page and the client forms so a kind or dimension is named the same
 * way in a row and in the form that edits it.
 *
 * The kind descriptions are SPEC-v6 §4.1's table: what each kind means for a
 * resident, so staff choose the one residents will understand. Residents see
 * the kinds through the language catalogs (m.involvement.kind.*), not these.
 */
export const KIND_LABELS: Record<InvolvementKind, { name: string; meaning: string }> = {
  volunteer: { name: 'Volunteer', meaning: 'Give time: cleanups, food banks, tutoring' },
  services: { name: 'Services', meaning: 'Get help or enroll: benefits, programs, legal help' },
  civic: { name: 'Civic', meaning: 'Have your say: community boards, hearings, public comment, elections' },
  organize: { name: 'Organize', meaning: 'Join a group or campaign' },
  other: { name: 'Other', meaning: 'Anything else' },
};

/** Kinds in the order the form offers them. */
export const KIND_OPTIONS = INVOLVEMENT_KINDS.map((kind) => ({ kind, ...KIND_LABELS[kind] }));

/** The two rings of the doughnut, for grouping the dimension picker the way residents see the doughnut. */
export const RINGS = [
  { ring: 'social', title: 'Social foundation' },
  { ring: 'ecological', title: 'Ecological ceiling' },
] as const;

const DIMENSION_NAMES = new Map(framework.dimensions.map((d) => [d.slug, d.name]));

/** A framework dimension's name; an unknown slug is shown as itself so nothing is silently hidden. */
export function dimensionName(slug: string): string {
  return DIMENSION_NAMES.get(slug) ?? slug;
}

/** The dimensions a listing serves, in words: empty means every dimension. */
export function dimensionsInWords(slugs: string[]): string {
  return slugs.length === 0 ? 'All dimensions' : slugs.map(dimensionName).join(', ');
}
