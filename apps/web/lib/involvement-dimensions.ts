import 'server-only';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { dimensions, latestVersionsByDimension, type DbExecutor } from '@deep-fryer/db';

/** Actual local addresses, never aliases inferred from a framework reference. */
export async function involvementDimensionOptionsIn(db: DbExecutor, tenantId: string, publishedOnly = false) {
  const rows = await db.select().from(dimensions).where(and(
    eq(dimensions.tenantId, tenantId), isNull(dimensions.archivedAt),
    publishedOnly ? isNotNull(dimensions.publishedVersionId) : undefined,
  )).orderBy(dimensions.displayOrder, dimensions.slug);
  const latest = await latestVersionsByDimension(db, rows.map(row => row.id));
  return rows.map(row => ({ slug: row.slug, name: latest.get(row.id)?.data.name ?? row.slug }));
}

/** Validation/public filtering needs addresses only, never full draft content. */
export async function involvementDimensionSlugsIn(db: DbExecutor, tenantId: string, publishedOnly = false) {
  const rows = await db.select({slug:dimensions.slug}).from(dimensions).where(and(
    eq(dimensions.tenantId,tenantId),isNull(dimensions.archivedAt),
    publishedOnly ? isNotNull(dimensions.publishedVersionId) : undefined,
  ));
  return rows.map(row=>row.slug);
}

export async function validInvolvementDimensionsIn(db: DbExecutor, tenantId: string, slugs: string[], publishedOnly = false) {
  if (slugs.length === 0) return true; // Explicit general listing / unspecified submission.
  const allowed = new Set(await involvementDimensionSlugsIn(db, tenantId, publishedOnly));
  return slugs.every(slug => allowed.has(slug));
}
