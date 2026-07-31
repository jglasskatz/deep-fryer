import { getDb, publishedDoughnut } from '@deep-fryer/db';
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
 * Public URL for an evidence snapshot stored in the tenant's bucket
 * (SPEC.md §4: one bucket per tenant). Local dev serves from public/.
 */
export function evidenceUrl(tenantSlug: string, storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (base) {
    return `${base}/storage/v1/object/public/tenant-${tenantSlug}/${storagePath}`;
  }
  return `/evidence/${tenantSlug}/${storagePath}`;
}
