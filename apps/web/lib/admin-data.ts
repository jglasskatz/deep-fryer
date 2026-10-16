import 'server-only';
import { cache } from 'react';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  defaultTenantConfig,
  maxDataAgeYears,
  type PortraitConfig,
  type TenantConfigKey,
  type TenantConfigMap,
} from '@deep-fryer/core';
import {
  auditLog,
  comments,
  dimensions,
  dimensionVersions,
  findings,
  latestVersionsByDimension,
  researchRuns,
  researchSessions,
  tenantBySlug,
  tenantConfig,
  type DbExecutor,
  type Dimension,
  type DimensionVersion,
  type Tenant,
} from '@deep-fryer/db';

import { userDb } from './db';

/*
 * Admin-plane and methodology reads. Every function runs in userDb(): the
 * database itself limits results to what the signed-in person may see
 * (members see drafts and runs; the public sees published history and the
 * methodology config keys).
 */

const CONFIG_FALLBACK = defaultTenantConfig('', '');

/**
 * Memoized for one request (React cache): the admin guard, the header's
 * queue badges and the page title all look the portrait up.
 */
export const adminTenant = cache((slug: string): Promise<Tenant | null> => {
  return userDb((db) => tenantBySlug(db, slug));
});

export interface DimensionWithVersions {
  dimension: Dimension;
  published: DimensionVersion | null;
  latest: DimensionVersion | null;
}

export async function tenantDimensions(tenantId: string): Promise<DimensionWithVersions[]> {
  return userDb(async (db) => {
    const dims = await db
      .select()
      .from(dimensions)
      .where(and(eq(dimensions.tenantId, tenantId), isNull(dimensions.archivedAt)))
      .orderBy(dimensions.displayOrder);

    if (dims.length === 0) return [];
    const versionIds = dims.flatMap((d) => (d.publishedVersionId ? [d.publishedVersionId] : []));
    const [published, latestByDim] = await Promise.all([
      versionIds.length
        ? db.select().from(dimensionVersions).where(inArray(dimensionVersions.id, versionIds))
        : Promise.resolve([] as DimensionVersion[]),
      latestVersionsByDimension(
        db,
        dims.map((d) => d.id),
      ),
    ]);
    const publishedById = new Map(published.map((v) => [v.id, v]));

    return dims.map((dimension) => ({
      dimension,
      published: dimension.publishedVersionId
        ? (publishedById.get(dimension.publishedVersionId) ?? null)
        : null,
      latest: latestByDim.get(dimension.id) ?? null,
    }));
  });
}

/** Lean id→slug map for pages that need nothing else. */
export async function dimensionSlugMap(tenantId: string): Promise<Map<string, string>> {
  return userDb(async (db) => {
    const rows = await db
      .select({ id: dimensions.id, slug: dimensions.slug })
      .from(dimensions)
      .where(eq(dimensions.tenantId, tenantId));
    return new Map(rows.map((r) => [r.id, r.slug]));
  });
}

export async function dimensionById(dimensionId: string) {
  return userDb(async (db) => {
    const [dimension] = await db.select().from(dimensions).where(eq(dimensions.id, dimensionId));
    return dimension ?? null;
  });
}

export async function versionTimeline(dimensionId: string): Promise<DimensionVersion[]> {
  return userDb(async (db) => {
    return db
      .select()
      .from(dimensionVersions)
      .where(eq(dimensionVersions.dimensionId, dimensionId))
      .orderBy(desc(dimensionVersions.versionNum));
  });
}

/**
 * Every config key the reader may see for a portrait, in its own userDb
 * transaction — for pages. Inside a transaction use tenantConfigMapIn.
 */
export async function tenantConfigMap(tenantId: string): Promise<Partial<TenantConfigMap>> {
  return userDb((db) => tenantConfigMapIn(db, tenantId));
}

/**
 * The same, read on a transaction the caller already holds (research.ts
 * createPlannedRun). Calling tenantConfigMap there would open a second
 * transaction on another pooled connection while the caller's is held, and
 * as many such requests at once as the pool has connections would wait on
 * each other for good (lib/features.ts portraitFeaturesIn). The caller's
 * transaction runs as the same person, so row-level security returns the
 * same rows.
 */
export async function tenantConfigMapIn(db: DbExecutor, tenantId: string): Promise<Partial<TenantConfigMap>> {
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

/** One config key, in its own userDb transaction. Inside a transaction use configValueIn. */
export async function configValue<K extends TenantConfigKey>(
  tenantId: string,
  key: K,
): Promise<TenantConfigMap[K] | null> {
  return userDb((db) => configValueIn(db, tenantId, key));
}

/**
 * One config key, read on a transaction the caller already holds (actions.ts
 * saveDimensionEdit) — not through configValue, whose own transaction would
 * wait for a second pooled connection while the caller's holds the first
 * (see tenantConfigMapIn).
 */
export async function configValueIn<K extends TenantConfigKey>(
  db: DbExecutor,
  tenantId: string,
  key: K,
): Promise<TenantConfigMap[K] | null> {
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

/** Pure over already-fetched data so pages never re-run the dimension queries. */
export function stalenessOverview(
  withVersions: DimensionWithVersions[],
  recency: PortraitConfig['recency'] = CONFIG_FALLBACK.recency,
): StalenessRow[] {
  const currentYear = new Date().getFullYear();

  return withVersions.map(({ dimension, published }) => {
    const years = (published?.data.indicators ?? [])
      .map((i) => i.year)
      .filter((y): y is number => typeof y === 'number');
    const newestYear = years.length ? Math.max(...years) : null;
    const maxAgeYears = maxDataAgeYears(recency, dimension.slug);
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
  return userDb(async (db) => {
    return db
      .select()
      .from(auditLog)
      .where(eq(auditLog.tenantId, tenantId))
      .orderBy(desc(auditLog.ts))
      .limit(limit);
  });
}

export async function tenantRuns(tenantId: string) {
  return userDb(async (db) => {
    return db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.tenantId, tenantId))
      .orderBy(desc(researchRuns.createdAt));
  });
}

export async function runWithSessions(runId: string) {
  return userDb(async (db) => {
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
  });
}

/** Comment counts per dimension — the "most discussed" overview signal. */
export async function commentCounts(tenantId: string): Promise<Map<string, number>> {
  return userDb(async (db) => {
    const rows = await db
      .select({ dimensionId: comments.dimensionId, count: sql<number>`count(*)::int` })
      .from(comments)
      .where(and(eq(comments.tenantId, tenantId), isNull(comments.removedAt)))
      .groupBy(comments.dimensionId);
    return new Map(rows.map((r) => [r.dimensionId, r.count]));
  });
}
