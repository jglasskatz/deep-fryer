import type { PortraitFeature } from '@deep-fryer/core';

/**
 * The header's link lists, as plain data (SiteHeader renders them). Kept
 * apart from the component so the feature rules below are unit-tested
 * (nav-links.test.ts): SPEC-v7 §3.3 says a feature that is off loses its
 * links everywhere, and a link to a 404 is the failure that rule prevents.
 */
export interface NavLink {
  href: string;
  label: string;
  primary?: boolean;
  /** Items waiting for staff (admin queues); shown as a badge when above 0. */
  count?: number;
  /** What the count is of, read after it by screen readers ("3 awaiting approval"). */
  countLabel?: string;
}

export type PortraitFeatures = Record<PortraitFeature, boolean>;

/**
 * A portrait's public links. Progress and methodology are core. Get involved
 * is core too: the page lists the organizations research found even with the
 * involvement feature off (only its curated listings and form are the
 * feature's). Emergencies is the emergency feature's.
 */
export function tenantNavLinks(
  tenantSlug: string,
  features: PortraitFeatures,
  labels: { progress: string; methodology: string; getInvolved: string; emergency: string },
  href: (path: string) => string,
): NavLink[] {
  const links: NavLink[] = [
    { href: href(`/${tenantSlug}/progress`), label: labels.progress },
    { href: href(`/${tenantSlug}/methodology`), label: labels.methodology },
    { href: href(`/${tenantSlug}/outreach`), label: labels.getInvolved },
  ];
  if (features.emergency) links.push({ href: href(`/${tenantSlug}/emergency`), label: labels.emergency });
  return links;
}

/**
 * The staff links for a portrait (English: the admin pages exist only in
 * English). Content work first (review, then what residents send in:
 * comments), then the portrait's sections, then the team and the account.
 * Discussion, Policy, Emergency, and Get involved follow their features;
 * a queue's badge is shown only with its link.
 */
export function adminNavLinks({
  tenantSlug,
  orgSlug,
  features,
  counts,
}: {
  tenantSlug: string;
  /** The organization holding the portrait, for its billing page. */
  orgSlug: string | null;
  features: PortraitFeatures;
  counts: { heldComments: number; newSubmissions: number } | null;
}): NavLink[] {
  const a = `/${tenantSlug}/admin`;
  const links: NavLink[] = [
    { href: a, label: 'Overview' },
    { href: `${a}/review`, label: 'Review' },
  ];
  if (features.discussion) {
    links.push({ href: `${a}/discussion`, label: 'Discussion', count: counts?.heldComments, countLabel: 'awaiting approval' });
  }
  links.push({ href: `${a}/research`, label: 'Research' });
  if (features.policy_analysis) links.push({ href: `${a}/policy`, label: 'Policy' });
  if (features.emergency) links.push({ href: `${a}/emergency`, label: 'Emergency' });
  if (features.involvement) {
    links.push({
      href: `${a}/involvement`,
      label: 'Get involved',
      count: counts?.newSubmissions,
      countLabel: 'new submissions',
    });
  }
  links.push({ href: `${a}/members`, label: 'Members' });
  links.push({ href: `${a}/settings`, label: 'Settings' });
  if (orgSlug) links.push({ href: `/o/${orgSlug}/billing`, label: 'Billing' });
  links.push({ href: `/${tenantSlug}`, label: 'Public site ↗' });
  return links;
}

/** The family nav's organization views: Compare and Insights are a feature; progress is core. */
export function familyViews(features: PortraitFeatures): ('compare' | 'insights' | 'progress')[] {
  return features.family_compare ? ['compare', 'insights', 'progress'] : ['progress'];
}
