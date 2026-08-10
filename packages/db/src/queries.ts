import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { getDb } from './client.js';
import { dimensionVersions, type DimensionVersion, type NewDimensionVersion } from './schema.js';

type Db = ReturnType<typeof getDb>;

/**
 * The public read path (SPEC.md §11): published versions only, via the same
 * SQL function RLS-governed clients use.
 */
export async function publishedDoughnut<T = unknown>(db: Db, slug: string): Promise<T | null> {
  const result = await db.execute<{ portrait: T | null }>(
    sql`SELECT published_doughnut(${slug}) AS portrait`,
  );
  return result[0]?.portrait ?? null;
}

/**
 * The portrait as it stood at `at` (SPEC.md §10 /progress): identical shape
 * to publishedDoughnut, resolved from publication history (published_at
 * survives archive, so past eras reconstruct exactly).
 */
export async function publishedDoughnutAsOf<T = unknown>(
  db: Db,
  slug: string,
  at: Date,
): Promise<T | null> {
  // postgres-js can't bind a Date on the raw execute path — send ISO text.
  const result = await db.execute<{ portrait: T | null }>(
    sql`SELECT published_doughnut_asof(${slug}, ${at.toISOString()}::timestamptz) AS portrait`,
  );
  return result[0]?.portrait ?? null;
}

/** Distinct publish days for a tenant — the candidate progress eras. */
export async function publishedSnapshotDates(db: Db, tenantId: string): Promise<Date[]> {
  const rows = await db.execute<{ day: string }>(sql`
    SELECT DISTINCT date_trunc('day', v.published_at) AS day
      FROM dimension_versions v
      JOIN dimensions d ON d.id = v.dimension_id
     WHERE d.tenant_id = ${tenantId} AND v.published_at IS NOT NULL
     ORDER BY 1
  `);
  return [...rows].map((r) => new Date(r.day));
}

/** Newest version of one dimension, or null. */
export async function latestVersion(
  db: Db,
  dimensionId: string,
): Promise<DimensionVersion | null> {
  const [row] = await db
    .select()
    .from(dimensionVersions)
    .where(eq(dimensionVersions.dimensionId, dimensionId))
    .orderBy(desc(dimensionVersions.versionNum))
    .limit(1);
  return row ?? null;
}

/** Newest version per dimension in one DISTINCT ON query. */
export async function latestVersionsByDimension(
  db: Db,
  dimensionIds: string[],
): Promise<Map<string, DimensionVersion>> {
  if (dimensionIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([dimensionVersions.dimensionId])
    .from(dimensionVersions)
    .where(inArray(dimensionVersions.dimensionId, dimensionIds))
    .orderBy(dimensionVersions.dimensionId, desc(dimensionVersions.versionNum));
  return new Map(rows.map((v) => [v.dimensionId, v]));
}

/**
 * Append the next immutable version (SPEC.md §7): the version-number
 * allocation lives here so every write path shares one mechanism.
 */
export async function appendDimensionVersion(
  db: Db,
  values: Omit<NewDimensionVersion, 'versionNum'>,
): Promise<DimensionVersion> {
  const previous = await latestVersion(db, values.dimensionId);
  const [version] = await db
    .insert(dimensionVersions)
    .values({ ...values, versionNum: (previous?.versionNum ?? 0) + 1 })
    .returning();
  if (!version) throw new Error('dimension version insert returned no row');
  return version;
}
