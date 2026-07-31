import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PortraitConfig, TenantConfigKey, TenantConfigMap } from '@deep-fryer/core';
import {
  auditLog,
  comments,
  dimensions,
  dimensionVersions,
  findings,
  getDb,
  researchRuns,
  researchSessions,
  tenants,
  tenantConfig,
  type Dimension,
  type DimensionVersion,
  type Tenant,
} from '@deep-fryer/db';

export async function adminTenant(slug: string): Promise<Tenant | null> {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  return tenant ?? null;
}

export interface DimensionWithVersions {
  dimension: Dimension;
  published: DimensionVersion | null;
  latest: DimensionVersion | null;
}

export async function tenantDimensions(tenantId: string): Promise<DimensionWithVersions[]> {
  const db = getDb();
  const dims = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.tenantId, tenantId), isNull(dimensions.archivedAt)))
    .orderBy(dimensions.displayOrder);

  if (dims.length === 0) return [];
  const versionIds = dims.flatMap((d) => (d.publishedVersionId ? [d.publishedVersionId] : []));
  const published = versionIds.length
    ? await db.select().from(dimensionVersions).where(inArray(dimensionVersions.id, versionIds))
    : [];
  const publishedById = new Map(published.map((v) => [v.id, v]));

  const latestRows = await db
    .select()
    .from(dimensionVersions)
    .where(
      inArray(
        dimensionVersions.dimensionId,
        dims.map((d) => d.id),
      ),
    )
    .orderBy(desc(dimensionVersions.versionNum));
  const latestByDim = new Map<string, DimensionVersion>();
  for (const v of latestRows) {
    if (!latestByDim.has(v.dimensionId)) latestByDim.set(v.dimensionId, v);
  }

  return dims.map((dimension) => ({
    dimension,
    published: dimension.publishedVersionId
      ? (publishedById.get(dimension.publishedVersionId) ?? null)
      : null,
    latest: latestByDim.get(dimension.id) ?? null,
  }));
}

export async function dimensionById(dimensionId: string) {
  const db = getDb();
  const [dimension] = await db.select().from(dimensions).where(eq(dimensions.id, dimensionId));
  return dimension ?? null;
}

export async function versionTimeline(dimensionId: string): Promise<DimensionVersion[]> {
  const db = getDb();
  return db
    .select()
    .from(dimensionVersions)
    .where(eq(dimensionVersions.dimensionId, dimensionId))
    .orderBy(desc(dimensionVersions.versionNum));
}

export async function tenantConfigMap(tenantId: string): Promise<Partial<TenantConfigMap>> {
  const db = getDb();
  const rows = await db.select().from(tenantConfig).where(eq(tenantConfig.tenantId, tenantId));
  const map: Record<string, unknown> = {};
  for (const row of rows) map[row.key] = row.value;
  return map as Partial<TenantConfigMap>;
}

export function portraitConfigFromMap(map: Partial<TenantConfigMap>): PortraitConfig | null {
  if (!map.region || !map.source_priority || !map.recency || !map.scale_policy) return null;
  return {
    region: map.region,
    source_priority: map.source_priority,
    recency: map.recency,
    scale_policy: map.scale_policy,
    threshold_overrides: map.threshold_overrides ?? {},
  };
}

export async function configValue<K extends TenantConfigKey>(
  tenantId: string,
  key: K,
): Promise<TenantConfigMap[K] | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(tenantConfig)
    .where(and(eq(tenantConfig.tenantId, tenantId), eq(tenantConfig.key, key)));
  return (row?.value as TenantConfigMap[K]) ?? null;
}

/** Staleness overview (SPEC.md §8 rerun loop): newest data year per dimension vs recency policy. */
export interface StalenessRow {
  dimensionId: string;
  slug: string;
  name: string;
  newestYear: number | null;
  maxAgeYears: number;
  stale: boolean;
}

export async function stalenessOverview(tenantId: string): Promise<StalenessRow[]> {
  const withVersions = await tenantDimensions(tenantId);
  const map = await tenantConfigMap(tenantId);
  const recency = map.recency ?? { default_max_age_years: 5 };
  const currentYear = new Date().getFullYear();

  return withVersions.map(({ dimension, published }) => {
    const years = (published?.data.indicators ?? [])
      .map((i) => i.year)
      .filter((y): y is number => typeof y === 'number');
    const newestYear = years.length ? Math.max(...years) : null;
    const maxAgeYears =
      recency.per_dimension?.[dimension.slug] ?? recency.default_max_age_years;
    return {
      dimensionId: dimension.id,
      slug: dimension.slug,
      name: published?.data.name ?? dimension.slug,
      newestYear,
      maxAgeYears,
      stale: newestYear !== null && currentYear - newestYear > maxAgeYears,
    };
  });
}

export async function recentAudit(tenantId: string, limit = 25) {
  const db = getDb();
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.tenantId, tenantId))
    .orderBy(desc(auditLog.ts))
    .limit(limit);
}

export async function tenantRuns(tenantId: string) {
  const db = getDb();
  return db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.tenantId, tenantId))
    .orderBy(desc(researchRuns.createdAt));
}

export async function runWithSessions(runId: string) {
  const db = getDb();
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  if (!run) return null;
  const sessions = await db
    .select({
      id: researchSessions.id,
      runId: researchSessions.runId,
      dimensionId: researchSessions.dimensionId,
      kind: researchSessions.kind,
      status: researchSessions.status,
      reviewerNotes: researchSessions.reviewerNotes,
      startedAt: researchSessions.startedAt,
      completedAt: researchSessions.completedAt,
    })
    .from(researchSessions)
    .where(eq(researchSessions.runId, runId));
  const sessionFindings = await db
    .select()
    .from(findings)
    .where(
      inArray(
        findings.sessionId,
        sessions.map((s) => s.id),
      ),
    );
  return { run, sessions, findings: sessionFindings };
}

/** Comment counts per dimension — the "most discussed" overview signal. */
export async function commentCounts(tenantId: string): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ dimensionId: comments.dimensionId, count: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(eq(comments.tenantId, tenantId), isNull(comments.removedAt)))
    .groupBy(comments.dimensionId);
  return new Map(rows.map((r) => [r.dimensionId, r.count]));
}
