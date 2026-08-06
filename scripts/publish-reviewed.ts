#!/usr/bin/env tsx
/**
 * Materialize and publish reviewed findings as dimension versions, mirroring
 * approveFindings + publishVersion (apps/web/lib/review-actions.ts) outside
 * the web app. Inclusion rule per indicator (latest finding wins, so fix-up
 * runs supersede originals): verifier 'pass' OR an honest gap OR the
 * indicator is on the audit-approved allowlist (dispositions approve/edit
 * from docs/review-briefs). Anything else stays unpublished in the queue.
 *
 *   tsx scripts/publish-reviewed.ts --tenant nyc --allow slug1,slug2 [--dry]
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  deriveVizLevel,
  type DimensionData,
  type DimensionGap,
  type Indicator,
} from '@deep-fryer/core';
import {
  appendDimensionVersion,
  dimensions,
  dimensionVersions,
  findings,
  getDb,
  latestVersion,
  researchRuns,
  researchSessions,
  tenantBySlug,
} from '@deep-fryer/db';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const db = getDb();
  const tenantSlug = arg('tenant');
  if (!tenantSlug) throw new Error('--tenant required');
  const allow = new Set((arg('allow') ?? '').split(',').filter(Boolean));
  const dry = process.argv.includes('--dry');

  const tenant = await tenantBySlug(db, tenantSlug);
  if (!tenant) throw new Error(`tenant ${tenantSlug} missing`);

  const runs = await db
    .select()
    .from(researchRuns)
    .where(and(eq(researchRuns.tenantId, tenant.id), eq(researchRuns.status, 'complete')));
  if (!runs.length) throw new Error('no complete runs');
  const runIds = runs.map((r) => r.id);
  const sessions = await db
    .select()
    .from(researchSessions)
    .where(inArray(researchSessions.runId, runIds));
  const sessionRun = new Map(sessions.map((s) => [s.id, s.runId]));
  const rows = await db
    .select()
    .from(findings)
    .where(inArray(findings.sessionId, sessions.map((s) => s.id)))
    .orderBy(findings.createdAt);

  const dims = await db.select().from(dimensions).where(eq(dimensions.tenantId, tenant.id));

  for (const dim of dims) {
    // Latest finding per indicator slug for this dimension.
    const latest = new Map<string, (typeof rows)[number]>();
    for (const f of rows) if (f.dimensionId === dim.id) latest.set(f.indicatorSlug, f);
    if (!latest.size) {
      console.log(`${dim.slug}: no findings — left unpublished`);
      continue;
    }

    const indicators: Indicator[] = [];
    const gaps: DimensionGap[] = [];
    const skipped: string[] = [];
    let lastRunId: string | null = null;
    for (const f of latest.values()) {
      const p = f.payload;
      const verdict = f.verification?.content_supported;
      if (p.kind === 'gap') {
        gaps.push({
          indicator: p.indicator_slug,
          reason: p.reason,
          scales_tried: p.scales_tried,
          searched_at: p.searched_at,
        });
        lastRunId = sessionRun.get(f.sessionId) ?? lastRunId;
      } else if (p.kind === 'indicator' && (verdict === 'pass' || allow.has(f.indicatorSlug))) {
        indicators.push({
          name: p.name,
          value: p.value,
          unit: p.unit,
          year: p.year,
          target: p.target,
          level_pct: p.level_pct,
          scoring: p.scoring,
          source: p.source,
          source_url: p.source_url,
          source_tier: p.source_tier,
          evidence: p.evidence,
          confidence: p.confidence,
          geographic_scale: p.geographic_scale,
        });
        lastRunId = sessionRun.get(f.sessionId) ?? lastRunId;
      } else {
        skipped.push(`${f.indicatorSlug}(${verdict})`);
      }
    }

    if (!indicators.length && !gaps.length) {
      console.log(`${dim.slug}: nothing publishable (skipped ${skipped.join(', ')})`);
      continue;
    }

    const base = await latestVersion(db, dim.id);
    const data: DimensionData = {
      name: base?.data.name ?? dim.slug,
      icon: base?.data.icon ?? '',
      description: base?.data.description ?? '',
      context: base?.data.context ?? '',
      indicators,
      gaps: gaps.length ? gaps : undefined,
      actions: base?.data.actions ?? [],
      policy_spotlight: base?.data.policy_spotlight,
      justice_spotlight: base?.data.justice_spotlight,
    };

    if (dry) {
      console.log(
        `${dim.slug}: would publish ${indicators.length} indicators, ${gaps.length} gaps` +
          (skipped.length ? `; hold ${skipped.join(', ')}` : ''),
      );
      continue;
    }

    const version = await appendDimensionVersion(db, {
      dimensionId: dim.id,
      status: 'draft',
      data,
      vizLevel: deriveVizLevel(data),
      origin: 'research',
      researchRunId: lastRunId,
      createdBy: null,
    });
    await db
      .update(dimensionVersions)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(dimensionVersions.id, version.id));
    await db
      .update(dimensions)
      .set({ publishedVersionId: version.id })
      .where(eq(dimensions.id, dim.id));
    console.log(
      `${dim.slug}: published v${version.versionNum} — ${indicators.length} indicators, ${gaps.length} gaps` +
        (skipped.length ? `; held back: ${skipped.join(', ')}` : ''),
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
