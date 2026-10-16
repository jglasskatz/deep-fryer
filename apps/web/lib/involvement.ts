import 'server-only';
import { cache } from 'react';
import { and, asc, eq } from 'drizzle-orm';
import { framework } from '@deep-fryer/contract';
import { INVOLVEMENT_KINDS, type InvolvementKind, type InvolvementListingView } from '@deep-fryer/core';
import { involvementListings, tenantBySlug, tenantConfig, type InvolvementListing } from '@deep-fryer/db';
import { userDb } from './db';
import { parseEmergencyConfig } from './emergency';
import { hasDatabase } from './env';
import { dimensionLabel } from './i18n/content';
import type { Messages } from './i18n/messages/en';
import { frameworkSlugOf } from './policy';
import type { PublishedDimension } from './portrait';

/**
 * The public read path for "how to get involved" (SPEC-v6 §4.1): the
 * published listings of one portrait, for its dimension pages and its Get
 * involved page.
 *
 * Reads run through userDb, so row-level security applies to the request's
 * own role: an anonymous resident can only ever read published listings
 * (involvement_listings_public_read). Members of the portrait may read
 * drafts too (involvement_listings_member_read, for the admin pages) — so
 * the query also filters on `published` itself: a staff member looking at
 * the public page must see exactly what residents see, not their drafts.
 */

export interface InvolvementView {
  listings: InvolvementListingView[];
  /**
   * The portrait's clock (its emergency config's time zone, America/New_York
   * by default), for the "Link checked {date}" stamp: a check made at 9 pm
   * in New York must not read as the next day's date.
   */
  timeZone: string;
}

const KINDS = new Set<string>(INVOLVEMENT_KINDS);

/** A listing row as the public pages show it (and nothing they do not). */
export function listingView(row: InvolvementListing): InvolvementListingView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    url: row.url,
    phone: row.phone,
    // The column is the involvement_kind enum; the guard keeps a value added
    // to the enum before this code learns it from rendering as a missing key.
    kind: KINDS.has(row.kind) ? (row.kind as InvolvementKind) : 'other',
    dimension_slugs: row.dimensionSlugs,
    link_checked_at: row.linkCheckedAt ? row.linkCheckedAt.toISOString() : null,
    display_order: row.displayOrder,
  };
}

/**
 * Everything the public pages need about one portrait's listings, or null
 * when the portrait does not exist or is archived (and without a database,
 * the bundled demo portrait has none). Memoized per request: a page and its
 * sections share one read.
 */
export const involvementView = cache(async (tenantSlug: string): Promise<InvolvementView | null> => {
  if (!hasDatabase()) return null;
  return userDb(async (db) => {
    const tenant = await tenantBySlug(db, tenantSlug);
    if (!tenant || tenant.archivedAt) return null;
    const rows = await db
      .select()
      .from(involvementListings)
      .where(and(eq(involvementListings.tenantId, tenant.id), eq(involvementListings.published, true)))
      .orderBy(asc(involvementListings.displayOrder), asc(involvementListings.name));
    const [config] = await db
      .select({ value: tenantConfig.value })
      .from(tenantConfig)
      .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, 'emergency')));
    return {
      listings: rows.map(listingView),
      timeZone: parseEmergencyConfig(config?.value).config.time_zone,
    };
  });
});

/** The published listings of a portrait, in staff's order (empty when there is none, or no portrait). */
export async function publishedListings(tenantSlug: string): Promise<InvolvementListingView[]> {
  return (await involvementView(tenantSlug))?.listings ?? [];
}

// ---- Grouping for the Get involved page --------------------------------------

export interface DimensionListings<L> {
  /** Framework dimension slug. */
  slug: string;
  listings: L[];
}

const FRAMEWORK_ORDER = new Map(framework.dimensions.map((d, i) => [d.slug, i]));

/**
 * Listings grouped the way the Get involved page lists them: one group per
 * dimension that has any, in the framework's order (the social foundation's
 * twelve, then the ecological ceiling's nine — the order of the doughnut
 * itself), then the general listings (no dimensions: they serve all of
 * them) on their own. A listing serving three dimensions appears in each of
 * the three groups; that is where a reader scanning one dimension looks for
 * it. Within a group, listings keep the order they came in (staff's
 * display order, then name, from the query). Slugs the framework does not
 * know are skipped: the schema refuses them, so only a hand-edited row could
 * carry one, and there is no heading to put it under.
 *
 * `only` narrows to one dimension (the page's filter); general listings are
 * kept, since they serve that dimension too.
 */
export function groupListingsByDimension<L extends Pick<InvolvementListingView, 'dimension_slugs'>>(
  listings: L[],
  only: string | null = null,
): { dimensions: DimensionListings<L>[]; general: L[] } {
  const bySlug = new Map<string, L[]>();
  const general: L[] = [];
  for (const listing of listings) {
    if (listing.dimension_slugs.length === 0) {
      general.push(listing);
      continue;
    }
    for (const slug of new Set(listing.dimension_slugs)) {
      if (!FRAMEWORK_ORDER.has(slug) || (only !== null && slug !== only)) continue;
      const group = bySlug.get(slug) ?? [];
      group.push(listing);
      bySlug.set(slug, group);
    }
  }
  const dimensions = [...bySlug.entries()]
    .sort(([a], [b]) => FRAMEWORK_ORDER.get(a)! - FRAMEWORK_ORDER.get(b)!)
    .map(([slug, group]) => ({ slug, listings: group }));
  return { dimensions, general };
}

// ---- The form's dimension choices -------------------------------------------

/**
 * The dimensions the submission form offers: the portrait's published ones,
 * in the doughnut's order, each named in the reader's language and valued
 * by its framework slug (what a submission stores and the schema accepts).
 * A custom dimension with no framework counterpart is left out — a
 * submission could not name it — and two portrait dimensions mapped onto
 * one framework dimension are offered once.
 */
export function formDimensionOptions(m: Messages, dimensions: PublishedDimension[]): { slug: string; name: string }[] {
  const seen = new Set<string>();
  return [...dimensions]
    .sort((a, b) => a.display_order - b.display_order)
    .flatMap((d) => {
      const slug = frameworkSlugOf(d);
      if (!FRAMEWORK_ORDER.has(slug) || seen.has(slug)) return [];
      seen.add(slug);
      return [{ slug, name: dimensionLabel(m, d.slug, d.data.name) }];
    });
}

/** Whether a slug names one of the framework's dimensions (a valid ?dim= filter or form value). */
export function isFrameworkDimension(slug: string | null | undefined): slug is string {
  return typeof slug === 'string' && FRAMEWORK_ORDER.has(slug);
}
