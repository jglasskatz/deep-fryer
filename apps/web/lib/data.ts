import { cache } from 'react';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { SLUG_RE, evidencePublicBase, type OutreachContactData } from '@deep-fryer/core';
import {
  organizations,
  outreachContacts,
  outreachContactVersions,
  publicTenantBySlug,
  publishedDoughnut,
  tenantBySlug,
  tenantIsPublic,
  tenants,
  withAuthContext,
  type Tenant,
} from '@deep-fryer/db';
import type { PublishedPortrait } from './portrait';
import { mockPortrait } from './mock-data';
import { hasDatabase } from './env';
import { systemDb, userDb } from './db';

export { hasDatabase };

/*
 * Who sees a portrait (migration 0015): it is PUBLIC once it has published a
 * dimension version, and stays public until archived. Before that only its
 * members see it — the database refuses everyone else, so reads made as the
 * person (userDb) need no check of their own: a signed-in member's page
 * renders, and an anonymous visitor's is a 404 (the read comes back null).
 *
 * Two kinds of public read must not depend on who is asking, and use the
 * helpers below instead of userDb: responses every reader shares (the
 * CORS-open, publicly cacheable open-data API), and lists that are the same
 * for every reader (the landing page's portraits). Through userDb a member
 * would see their own private portrait in them — and a shared cache could
 * keep that answer for everyone.
 */

/**
 * The public read path, as the person asking. Goes through the
 * published_doughnut(slug) SQL function, which runs under the reader's own
 * row-level security, so the app serves exactly what the database lets them
 * see: published dimensions of a public portrait, or — for its members — of
 * their portrait before it is public (no dimensions until the first
 * publish). Local dev without DATABASE_URL falls back to the bundled demo
 * portrait.
 *
 * Memoized for one request (React cache): a page and its generateMetadata
 * both need the portrait, and read it once.
 */
export const getPortrait = cache(async (slug: string): Promise<PublishedPortrait | null> => {
  if (!hasDatabase()) {
    return slug === mockPortrait.tenant.slug ? mockPortrait : null;
  }
  return userDb((db) => publishedDoughnut<PublishedPortrait>(db, slug));
});

/**
 * The portrait as the public sees it, whoever is asking: read as an
 * anonymous visitor (row-level security with no user), so a portrait that
 * is not public is null even for its members. For the open-data API and
 * anything else every reader shares. Its own short transaction on the
 * pooled client; not for use inside another one (lib/db.ts).
 */
export const getPublicPortrait = cache(async (slug: string): Promise<PublishedPortrait | null> => {
  if (!hasDatabase()) {
    return slug === mockPortrait.tenant.slug ? mockPortrait : null;
  }
  return withAuthContext(systemDb(), null, (db) => publishedDoughnut<PublishedPortrait>(db, slug));
});

/**
 * A public portrait's row by slug, or null when there is none — unknown,
 * archived, or not yet published — whoever is asking. The system context
 * with the public rule applied explicitly (packages/db tenantIsPublic): one
 * query, for checks such as the open-data progress exports'. Without a
 * database there are no portrait rows (the demo portrait is bundled data).
 */
export const publicTenant = cache(async (slug: string): Promise<Tenant | null> => {
  if (!hasDatabase() || !SLUG_RE.test(slug)) return null;
  return publicTenantBySlug(systemDb(), slug);
});

export interface PublicPortraitSummary {
  slug: string;
  name: string;
  region: string | null;
  organization: { slug: string; name: string };
}

/**
 * The deployment's public portraits — every one, or one organization's —
 * for pages that list them the same way for every reader (the landing
 * page's showcase and directory). Never a portrait that is not public, even
 * for its members. Ordered by organization, then family order, then name;
 * an organization's own list comes in its family order. Without a database:
 * none (the demo portrait is bundled data, linked on its own).
 */
export const publicPortraits = cache(async (organizationSlug?: string): Promise<PublicPortraitSummary[]> => {
  if (!hasDatabase()) return [];
  if (organizationSlug !== undefined && !SLUG_RE.test(organizationSlug)) return [];
  const rows = await systemDb()
    .select({
      slug: tenants.slug,
      name: tenants.name,
      region: tenants.region,
      organizationSlug: organizations.slug,
      organizationName: organizations.name,
    })
    .from(tenants)
    .innerJoin(organizations, eq(organizations.id, tenants.organizationId))
    .where(
      organizationSlug === undefined ? tenantIsPublic() : and(tenantIsPublic(), eq(organizations.slug, organizationSlug)),
    )
    .orderBy(asc(organizations.name), asc(tenants.familyOrder), asc(tenants.name));
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    region: r.region,
    organization: { slug: r.organizationSlug, name: r.organizationName },
  }));
});

/**
 * Public base URL for a tenant's evidence (SPEC-v3 §2.1). The URL scheme is
 * shared with the worker that writes the objects (core's
 * evidencePublicBase); local dev serves from public/.
 */
export function evidenceBase(tenantSlug: string): string {
  return evidencePublicBase(tenantSlug, process.env.S3_PUBLIC_URL);
}

export function evidenceUrl(tenantSlug: string, storagePath: string): string {
  return `${evidenceBase(tenantSlug)}/${storagePath}`;
}

/** Published outreach contacts for the public /outreach page. */
export async function publishedOutreachContacts(
  tenantSlug: string,
): Promise<Pick<OutreachContactData, 'org' | 'website' | 'why' | 'tags'>[]> {
  if (!hasDatabase()) return [];
  return withAuthContext(systemDb(), null, async (db) => {
    const tenant = await tenantBySlug(db, tenantSlug);
    if (!tenant) return [];
    const versions = await db
      .select({ data: outreachContactVersions.data })
      .from(outreachContacts)
      .innerJoin(outreachContactVersions, and(eq(outreachContactVersions.id, outreachContacts.publishedVersionId), eq(outreachContactVersions.contactId, outreachContacts.id)))
      .where(and(eq(outreachContacts.tenantId, tenant.id), isNull(outreachContacts.archivedAt), eq(outreachContactVersions.status, 'published')));
    return versions.map(({ data }) => ({ org: data.org, website: data.website, why: data.why, tags: data.tags }));
  });
}
