import { eq, inArray } from 'drizzle-orm';
import { tenantBucketName, type OutreachContactData } from '@deep-fryer/core';
import {
  getDb,
  outreachContacts,
  outreachContactVersions,
  publishedDoughnut,
  tenantBySlug,
} from '@deep-fryer/db';
import type { PublishedPortrait } from './portrait';
import { mockPortrait } from './mock-data';

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * The public read path. Goes through the published_doughnut(slug) SQL
 * function so the app serves exactly what RLS-governed clients would see.
 * Local dev without DATABASE_URL falls back to the bundled demo portrait.
 */
export async function getPortrait(slug: string): Promise<PublishedPortrait | null> {
  if (!hasDatabase()) {
    return slug === mockPortrait.tenant.slug ? mockPortrait : null;
  }
  return publishedDoughnut<PublishedPortrait>(getDb(), slug);
}

/**
 * Public base URL for a tenant's evidence storage (SPEC.md §4: one bucket
 * per tenant). This is the single home of the URL scheme; local dev serves
 * from public/.
 */
export function evidenceBase(tenantSlug: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (base) {
    return `${base}/storage/v1/object/public/${tenantBucketName(tenantSlug)}`;
  }
  return `/evidence/${tenantSlug}`;
}

export function evidenceUrl(tenantSlug: string, storagePath: string): string {
  return `${evidenceBase(tenantSlug)}/${storagePath}`;
}

/** Published outreach contacts for the public /outreach page. */
export async function publishedOutreachContacts(
  tenantSlug: string,
): Promise<OutreachContactData[]> {
  if (!hasDatabase()) return [];
  const db = getDb();
  const tenant = await tenantBySlug(db, tenantSlug);
  if (!tenant) return [];
  const rows = await db
    .select()
    .from(outreachContacts)
    .where(eq(outreachContacts.tenantId, tenant.id));
  const publishedIds = rows.flatMap((r) => (r.publishedVersionId ? [r.publishedVersionId] : []));
  if (publishedIds.length === 0) return [];
  const versions = await db
    .select()
    .from(outreachContactVersions)
    .where(inArray(outreachContactVersions.id, publishedIds));
  return versions.map((v) => v.data);
}

/** The tenant's embed-origin allowlist ([] when unset or no database). */
export async function tenantEmbedOrigins(tenantSlug: string): Promise<string[]> {
  if (!hasDatabase()) return [];
  const tenant = await tenantBySlug(getDb(), tenantSlug);
  return tenant?.embedOrigins ?? [];
}
