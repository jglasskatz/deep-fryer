#!/usr/bin/env tsx
/**
 * DEVELOPMENT ONLY: publish synthetic indicator history so the progress,
 * compare, and insights views can be exercised locally without running
 * research. Every value is labeled "SYNTHETIC DEMO VALUE" in its source
 * field and change note, sources are unlinked, and the script refuses to
 * touch a database that is not on this machine (or NODE_ENV=production).
 *
 *   DATABASE_URL=postgres://…@localhost/… tsx scripts/seed-demo-data.ts --org nyc
 *
 * Three published versions per dimension — data years 2023, 2025 (the NYC
 * baseline), and 2026 — so every progress status is reachable. Values are
 * deterministic per (portrait, indicator) so reruns are stable.
 *
 * Every portrait it seeds is also marked with the `sample_data` config key
 * (@deep-fryer/core SAMPLE_DATA_CONFIG_KEY): its public pages, embed and
 * organization pages then say "Sample data — not research", and the
 * open-data API carries `sample_data: true`, so a screenshot or an export of
 * a demo stack cannot pass for a city's measurements. Seeding publishes, so
 * a portrait that was private until its first publish becomes public here
 * (migration 0015) — already labelled. Replacing the values with real
 * research does not clear the mark: delete the row when that happens.
 */
import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { frameworkDimension } from '@deep-fryer/contract';
import {
  SAMPLE_DATA_CONFIG_KEY,
  computeScoring,
  deriveVizLevel,
  resolveThreshold,
  type DimensionData,
  type TenantConfigMap,
} from '@deep-fryer/core';
import {
  appendDimensionVersion,
  dimensions,
  dimensionVersions,
  getDb,
  latestVersion,
  organizationBySlug,
  tenantConfig,
  tenants,
} from '@deep-fryer/db';

const LABEL = 'SYNTHETIC DEMO VALUE — not research';
const YEARS = [2023, 2025, 2026];

function guard() {
  if (process.env.NODE_ENV === 'production') throw new Error('refusing to seed demo data with NODE_ENV=production');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', 'db', '::1'].includes(url.hostname)) {
    throw new Error(`refusing to seed demo data into non-local database host ${url.hostname}`);
  }
}

/** Deterministic 0..1 from a string. */
function unit(seed: string): number {
  return parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) / 0xffffffff;
}

function round(n: number): number {
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
}

async function main() {
  guard();
  const db = getDb();
  const orgSlug = process.argv[process.argv.indexOf('--org') + 1];
  if (!process.argv.includes('--org') || !orgSlug) throw new Error('usage: seed-demo-data --org <slug>');
  const org = await organizationBySlug(db, orgSlug);
  if (!org) throw new Error(`unknown organization ${orgSlug}`);
  const portraits = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.organizationId, org.id), isNull(tenants.archivedAt)));

  for (const tenant of portraits) {
    const [overridesRow] = await db
      .select()
      .from(tenantConfig)
      .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, 'threshold_overrides')));
    const overrides = (overridesRow?.value ?? {}) as TenantConfigMap['threshold_overrides'];
    const dims = await db
      .select()
      .from(dimensions)
      .where(and(eq(dimensions.tenantId, tenant.id), isNull(dimensions.archivedAt)));

    let marked = false;
    for (const dim of dims) {
      const base = await latestVersion(db, dim.id);
      if (!base) continue;
      if (!marked) {
        // The mark lands before the first synthetic value is published, so
        // there is no moment at which the portrait shows them unlabelled.
        await db
          .insert(tenantConfig)
          .values({ tenantId: tenant.id, key: SAMPLE_DATA_CONFIG_KEY, value: true, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [tenantConfig.tenantId, tenantConfig.key],
            set: { value: true, updatedAt: new Date() },
          });
        marked = true;
      }
      const fw = frameworkDimension(dim.slug, dim.canonicalSlug);
      for (const [step, year] of YEARS.entries()) {
        const indicators = base.data.indicators.map((ind) => {
          const ref = ind.scoring?.threshold_ref ?? fw?.indicators.find((f) => f.name === ind.name)?.threshold_ref;
          const t = ref ? resolveThreshold(ref, overrides) : undefined;
          if (!ref || !t) return { ...ind, value: null, year: null };
          // Start somewhere between 40% short of and 15% past the target,
          // then drift per step: some improve, some worsen, some stall.
          const seed = `${tenant.slug}:${dim.slug}:${ind.name}`;
          // Realistic spread: an explicit threshold scale, else a fifth of the target.
          const scale = t.scale ?? Math.max(Math.abs(t.target) * 0.2, 1);
          const start = t.target + (t.function === 'higher_is_better' ? -1 : 1) * scale * (unit(seed) * 0.55 - 0.15);
          const drift = (unit(`${seed}:drift`) - 0.4) * scale * 0.08;
          const value = round(start + (t.function === 'higher_is_better' ? 1 : -1) * drift * step * 2);
          const { level_pct, scoring } = computeScoring(value, ref, t);
          return {
            ...ind,
            value,
            year,
            target: t.target,
            level_pct,
            scoring,
            source: LABEL,
            source_url: '',
            evidence: undefined,
            confidence: 'low' as const,
          };
        });
        const data: DimensionData = { ...base.data, indicators, gaps: base.data.gaps };
        const version = await appendDimensionVersion(db, {
          dimensionId: dim.id,
          status: 'draft',
          data,
          vizLevel: deriveVizLevel(data),
          origin: 'human',
          changeNote: `DEMO SEED (${year}): synthetic values for local development only`,
        });
        const publishedAt = new Date(Date.UTC(year + 1, 0, 15));
        const [prev] = await db.select().from(dimensions).where(eq(dimensions.id, dim.id));
        await db
          .update(dimensionVersions)
          .set({ status: 'published', publishedAt })
          .where(eq(dimensionVersions.id, version.id));
        if (prev?.publishedVersionId) {
          await db
            .update(dimensionVersions)
            .set({ status: 'archived' })
            .where(eq(dimensionVersions.id, prev.publishedVersionId));
        }
        await db.update(dimensions).set({ publishedVersionId: version.id }).where(eq(dimensions.id, dim.id));
      }
    }
    // A portrait with no dimension versions to vary got no synthetic values, so no mark either.
    console.log(
      marked
        ? `seeded synthetic history for ${tenant.slug} (marked sample_data)`
        : `nothing to seed for ${tenant.slug} (no dimension versions)`,
    );
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
