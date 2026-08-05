#!/usr/bin/env tsx
/**
 * Borough reconciliation (docs/measurement.md instrument B) across the NYC
 * portrait family: the five boroughs must reconcile to the citywide figure.
 * Uses the latest finding per (tenant, indicator) from completed runs.
 */
import { eq, inArray } from 'drizzle-orm';
import {
  dimensions,
  findings,
  getDb,
  researchRuns,
  researchSessions,
  tenants,
} from '@deep-fryer/db';
import { reconcileBoroughs, type ScoredFinding } from '@deep-fryer/research';

const BOROUGHS: Record<string, number> = {
  manhattan: 1694251,
  brooklyn: 2736074,
  queens: 2405464,
  bronx: 1472654,
  'staten-island': 495747,
};

async function latestFindings(tenantSlug: string): Promise<ScoredFinding[]> {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug));
  if (!tenant) throw new Error(`tenant ${tenantSlug} missing`);
  const runs = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.tenantId, tenant.id));
  const completed = runs.filter((r) => r.status === 'complete').map((r) => r.id);
  if (!completed.length) return [];
  const sessions = await db
    .select()
    .from(researchSessions)
    .where(inArray(researchSessions.runId, completed));
  const rows = await db
    .select()
    .from(findings)
    .where(inArray(findings.sessionId, sessions.map((s) => s.id)))
    .orderBy(findings.createdAt);
  const dims = await db.select().from(dimensions).where(eq(dimensions.tenantId, tenant.id));
  const dimSlug = new Map(dims.map((d) => [d.id, d.slug]));
  // Last write wins per indicator: fix-up runs supersede originals.
  const latest = new Map<string, ScoredFinding>();
  for (const f of rows) {
    latest.set(f.indicatorSlug, {
      indicatorSlug: f.indicatorSlug,
      dimensionSlug: dimSlug.get(f.dimensionId) ?? 'unknown',
      tenantSlug,
      payload: f.payload,
      verification: f.verification,
    });
  }
  return [...latest.values()];
}

async function main() {
  const city = await latestFindings('nyc');
  const boroughs = await Promise.all(
    Object.entries(BOROUGHS).map(async ([slug, population]) => ({
      tenantSlug: slug,
      population,
      findings: await latestFindings(slug),
    })),
  );
  const rows = reconcileBoroughs({ city, boroughs });
  console.log('indicator | city | implied(5-borough) | divergence% | denom | n | flag');
  for (const r of rows) {
    console.log(
      [
        r.indicatorSlug,
        r.cityValue,
        r.impliedValue.toFixed(2),
        r.divergencePct.toFixed(1),
        r.denominator + (r.approximate ? '~' : ''),
        r.n,
        r.exceedsTolerance ? 'EXCEEDS' : 'ok',
      ].join(' | '),
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
