import 'server-only';
import { cache } from 'react';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { frameworkDimension } from '@deep-fryer/contract';
import {
  defaultProgressConfig,
  indicatorProgress,
  resolveThreshold,
  type DimensionData,
  type IndicatorProgress,
  type ObservedPoint,
  type ProgressConfig,
  type Ring,
  type TenantConfigMap,
} from '@deep-fryer/core';
import { dimensions, dimensionVersions, tenantBySlug, tenantConfig, type Tenant } from '@deep-fryer/db';
import { userDb } from './db';
import { hasDatabase } from './env';

/**
 * Progress monitoring reads (SPEC-v4 §4). History is every version of a
 * dimension that was ever published — the public record — never drafts.
 * The engine in core turns that history plus the resolved threshold into a
 * status; this module only gathers.
 */

export interface ProgressRow extends IndicatorProgress {
  dimensionSlug: string;
  dimensionName: string;
  ring: Ring;
  displayOrder: number;
  indicator: string;
  unit: string;
  thresholdRef: string | null;
  rationale: string | null;
  source: string | null;
  sourceUrl: string | null;
  geographicScale: string | null;
}

export interface GapRow {
  dimensionSlug: string;
  dimensionName: string;
  indicator: string;
  reason: string;
}

export interface TenantProgress {
  tenant: Tenant;
  config: ProgressConfig;
  rows: ProgressRow[];
  gaps: GapRow[];
}

type Overrides = TenantConfigMap['threshold_overrides'];

function thresholdRefFor(
  dimensionSlug: string,
  canonicalSlug: string | null,
  ind: DimensionData['indicators'][number],
): string | null {
  return (
    ind.scoring?.threshold_ref ??
    frameworkDimension(dimensionSlug, canonicalSlug)?.indicators.find((fi) => fi.name === ind.name)
      ?.threshold_ref ??
    null
  );
}

export const tenantProgress = cache(async (tenantSlug: string): Promise<TenantProgress | null> => {
  if (!hasDatabase()) return null;
  return userDb(async (db) => {
    const tenant = await tenantBySlug(db, tenantSlug);
    if (!tenant || tenant.archivedAt) return null;

    const [configRows, versionRows] = await Promise.all([
      db.select().from(tenantConfig).where(eq(tenantConfig.tenantId, tenant.id)),
      db
        .select({
          dimensionId: dimensions.id,
          slug: dimensions.slug,
          canonicalSlug: dimensions.canonicalSlug,
          ring: dimensions.ring,
          displayOrder: dimensions.displayOrder,
          currentVersionId: dimensions.publishedVersionId,
          versionId: dimensionVersions.id,
          data: dimensionVersions.data,
          publishedAt: dimensionVersions.publishedAt,
        })
        .from(dimensionVersions)
        .innerJoin(dimensions, eq(dimensions.id, dimensionVersions.dimensionId))
        .where(
          and(
            eq(dimensions.tenantId, tenant.id),
            isNull(dimensions.archivedAt),
            isNotNull(dimensionVersions.publishedAt),
          ),
        )
        // Version number breaks publication-time ties so "latest publication
        // wins" in buildSeries is deterministic.
        .orderBy(asc(dimensions.displayOrder), asc(dimensionVersions.publishedAt), asc(dimensionVersions.versionNum)),
    ]);

    const config = (configRows.find((r) => r.key === 'progress')?.value as ProgressConfig | undefined) ??
      defaultProgressConfig;
    const overrides = (configRows.find((r) => r.key === 'threshold_overrides')?.value ?? {}) as Overrides;

    // Observations per (dimension, indicator) across every once-published version.
    const observed = new Map<string, ObservedPoint[]>();
    const current = versionRows.filter((v) => v.versionId === v.currentVersionId);
    for (const v of versionRows) {
      for (const ind of v.data.indicators) {
        if (typeof ind.value !== 'number' || typeof ind.year !== 'number') continue;
        const key = `${v.slug}::${ind.name}`;
        const list = observed.get(key) ?? [];
        list.push({ year: ind.year, value: ind.value, publishedAt: v.publishedAt! });
        observed.set(key, list);
      }
    }

    const rows: ProgressRow[] = [];
    const gaps: GapRow[] = [];
    for (const v of current) {
      for (const ind of v.data.indicators) {
        const ref = thresholdRefFor(v.slug, v.canonicalSlug, ind);
        const threshold = ref ? resolveThreshold(ref, overrides) : undefined;
        const progress = indicatorProgress(
          observed.get(`${v.slug}::${ind.name}`) ?? [],
          threshold
            ? {
                target: threshold.target,
                function: threshold.function,
                low: threshold.low,
                high: threshold.high,
                target_year: threshold.target_year,
              }
            : null,
          config,
        );
        rows.push({
          ...progress,
          dimensionSlug: v.slug,
          dimensionName: v.data.name,
          ring: v.ring,
          displayOrder: v.displayOrder,
          indicator: ind.name,
          unit: ind.unit,
          thresholdRef: ref,
          rationale: threshold?.rationale ?? null,
          source: ind.source || null,
          sourceUrl: ind.source_url || null,
          geographicScale: ind.geographic_scale ?? null,
        });
      }
      for (const gap of v.data.gaps ?? []) {
        gaps.push({
          dimensionSlug: v.slug,
          dimensionName: v.data.name,
          indicator: gap.indicator,
          reason: gap.reason,
        });
      }
    }
    return { tenant, config, rows, gaps };
  });
});

/** CSV for open-data portals and council packets (RFC 4180 quoting). */
export function progressCsv(p: TenantProgress): string {
  const header = [
    'portrait',
    'ring',
    'dimension',
    'indicator',
    'unit',
    'baseline_year',
    'baseline_value',
    'latest_year',
    'latest_value',
    'change_since_baseline',
    'target',
    'target_year',
    'status',
    'expected_now',
    'required_annual_change',
    'geographic_scale',
    'source',
    'source_url',
  ];
  const q = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of p.rows) {
    lines.push(
      [
        p.tenant.slug,
        r.ring,
        r.dimensionName,
        r.indicator,
        r.unit,
        r.baseline?.year,
        r.baseline?.value,
        r.current?.year,
        r.current?.value,
        r.changeSinceBaseline,
        r.target,
        r.targetYear,
        r.status,
        r.expectedNow,
        r.requiredAnnualChange,
        r.geographicScale,
        r.source,
        r.sourceUrl,
      ]
        .map(q)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
