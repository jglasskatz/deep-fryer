import { eq } from 'drizzle-orm';
import { getDb, tenants } from '@deep-fryer/db';

/**
 * For tests only: put a portrait on the public plane, as its first publish
 * would (migration 0015). A newly provisioned portrait is private — nobody but
 * its members can read it or anything in it, and nobody else may file a
 * submission, a translation request or a comment for it — so a test of what
 * the public sees or does marks its portrait public first. Writes
 * first_published_at directly, in the system context like the provisioning
 * it follows (the database's guard keeps only the app role from writing it),
 * so no dimension is published and nothing else about the portrait changes.
 */
export async function markPortraitPublic(tenantId: string, at: Date = new Date()): Promise<void> {
  await getDb().update(tenants).set({ firstPublishedAt: at }).where(eq(tenants.id, tenantId));
}
