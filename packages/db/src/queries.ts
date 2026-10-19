import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from './client.js';
import {
  dimensionVersions,
  tenants,
  type DimensionVersion,
  type NewDimensionVersion,
  type Tenant,
} from './schema.js';

/**
 * The public read path (SPEC.md §11): published versions only, via the same
 * SQL function RLS-governed clients use. The function runs as the caller
 * (migration 0015), so it answers with what the caller's policies allow: for
 * an anonymous visitor, nothing unless the portrait is public; for a member,
 * their portrait (published dimensions only, none before the first publish);
 * in the system context, any portrait.
 */
export async function publishedDoughnut<T = unknown>(db: DbExecutor, slug: string): Promise<T | null> {
  const result = await db.execute<{ portrait: T | null }>(
    sql`SELECT published_doughnut(${slug}) AS portrait`,
  );
  return result[0]?.portrait ?? null;
}

/**
 * The public-plane rule (migration 0015) as a condition on `tenants`: live,
 * and published at least once. Row-level security applies it to every read
 * made as a person (tenants_public_read); this is for the few public reads
 * that run in the system context and so bypass it — the web middleware's
 * embed and translation lookups, listings of public portraits — which must
 * apply it themselves. The same predicate as SQL tenant_is_public().
 */
export function tenantIsPublic(): SQL {
  return sql`(${tenants.archivedAt} IS NULL AND ${tenants.firstPublishedAt} IS NOT NULL)`;
}

/** A portrait by slug only if it is public (tenantIsPublic), for system-context reads of the public plane. */
export async function publicTenantBySlug(db: DbExecutor, slug: string): Promise<Tenant | null> {
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.slug, slug), tenantIsPublic()));
  return tenant ?? null;
}

/** Newest version of one dimension, or null. */
export async function latestVersion(
  db: DbExecutor,
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
  db: DbExecutor,
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

const UNIQUE_VIOLATION = '23505';
const MAX_APPEND_ATTEMPTS = 5;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}

/**
 * Append the next immutable version (SPEC.md §7). The number is allocated by
 * the INSERT itself (max + 1 in a subselect), and a concurrent append that
 * takes the same number trips the (dimension_id, version_num) unique
 * constraint and retries — two reviewers approving at once both land, in
 * some order, instead of one silently failing (SPEC-v3 §2.2 item 4). Each
 * attempt runs in its own (sub)transaction so a retry works inside a caller's
 * transaction too.
 */
export async function appendDimensionVersion(
  db: DbExecutor,
  values: Omit<NewDimensionVersion, 'versionNum'>,
): Promise<DimensionVersion> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [version] = await tx
          .insert(dimensionVersions)
          .values({
            ...values,
            versionNum: sql`(SELECT coalesce(max(${dimensionVersions.versionNum}), 0) + 1 FROM ${dimensionVersions} WHERE ${dimensionVersions.dimensionId} = ${values.dimensionId})`,
          })
          .returning();
        if (!version) throw new Error('dimension version insert returned no row');
        return version;
      });
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= MAX_APPEND_ATTEMPTS) throw err;
    }
  }
}
