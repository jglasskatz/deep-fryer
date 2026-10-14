import { eq, inArray } from 'drizzle-orm';
import { evidencePublicBase, type OutreachContactData } from '@deep-fryer/core';
import {
  outreachContacts,
  outreachContactVersions,
  publishedDoughnut,
  tenantBySlug,
} from '@deep-fryer/db';
import type { PublishedPortrait } from './portrait';
import { mockPortrait } from './mock-data';
import { hasDatabase } from './env';
import { userDb } from './db';

export { hasDatabase };

/**
 * The public read path. Goes through the published_doughnut(slug) SQL
 * function so the app serves exactly what RLS-governed clients would see.
 * Local dev without DATABASE_URL falls back to the bundled demo portrait.
 */
export async function getPortrait(slug: string): Promise<PublishedPortrait | null> {
  if (!hasDatabase()) {
    return slug === mockPortrait.tenant.slug ? mockPortrait : null;
  }
  return userDb((db) => publishedDoughnut<PublishedPortrait>(db, slug));
}

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
): Promise<OutreachContactData[]> {
  if (!hasDatabase()) return [];
  return userDb(async (db) => {
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
  });
}
