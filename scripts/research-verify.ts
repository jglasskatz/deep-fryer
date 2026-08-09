#!/usr/bin/env tsx
/**
 * research-verify — the run-level verification gate (pack-research's
 * run-time counterpart). Staged cheap-to-expensive, keel exit semantics
 * (0 pass · 1 warnings · 2 blocked):
 *
 *   1. deterministic  — coverage, evidence archived, citations resolve
 *   2. verifier       — unsupported/uncertain rates, tier mix, gap honesty
 *   3. human review   — every dimension dispositioned, every flagged finding
 *                       individually dispositioned, spot-check sample verified
 *   4. confirmation   — approval bound to a content hash of the findings;
 *                       changed findings void the approval
 *
 * All evaluation lives in @deep-fryer/research's gate module — the
 * /admin/verify web surface computes the identical report, and approvals
 * recorded there and here are interchangeable. This script is fetch + print
 * + the --approve insert:  research-verify --tenant nyc --approve --approved-by <who>
 */
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { currentDispositions } from '@deep-fryer/core';
import { APPROVE_ACTION, computeGateReport } from '@deep-fryer/research';
import {
  auditLog,
  dimensions,
  dimensionVersions,
  findings,
  getDb,
  researchRuns,
  researchSessions,
  reviewNotes,
  tenantBySlug,
} from '@deep-fryer/db';

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const tenant = get('--tenant');
  if (!tenant) {
    console.error(
      'Usage: research-verify --tenant <slug> [--run <id>] [--approve --approved-by <name>]',
    );
    process.exit(2);
  }
  return {
    tenant,
    runId: get('--run'),
    approve: argv.includes('--approve'),
    approvedBy: get('--approved-by'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  const tenant = await tenantBySlug(db, args.tenant);
  if (!tenant) throw new Error(`unknown tenant '${args.tenant}'`);

  const [run] = args.runId
    ? await db.select().from(researchRuns).where(eq(researchRuns.id, args.runId))
    : await db
        .select()
        .from(researchRuns)
        .where(and(eq(researchRuns.tenantId, tenant.id), eq(researchRuns.status, 'complete')))
        .orderBy(desc(researchRuns.createdAt))
        .limit(1);
  if (!run) throw new Error('no completed research run found for this tenant');
  if (run.tenantId !== tenant.id) throw new Error('run does not belong to this tenant');

  const sessions = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.runId, run.id));
  const sessionIds = sessions.map((s) => s.id);
  const runFindings = sessionIds.length
    ? await db.select().from(findings).where(inArray(findings.sessionId, sessionIds))
    : [];

  const dimIds = [...new Set(runFindings.map((f) => f.dimensionId))];
  const dims = dimIds.length
    ? await db.select().from(dimensions).where(inArray(dimensions.id, dimIds))
    : [];

  const reviewedVersions = await db
    .select({ dimensionId: dimensionVersions.dimensionId })
    .from(dimensionVersions)
    .where(eq(dimensionVersions.researchRunId, run.id));
  const auditRows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenant.id), gt(auditLog.ts, run.createdAt)));
  const noteRows = await db.select().from(reviewNotes).where(eq(reviewNotes.runId, run.id));

  const report = computeGateReport({
    run: { id: run.id, createdAt: run.createdAt, tenantSlug: tenant.slug },
    findings: runFindings,
    sessions,
    dimensionSlugById: new Map(dims.map((d) => [d.id, d.slug])),
    versionsForRun: reviewedVersions,
    auditRowsAfterRun: auditRows,
    dispositions: currentDispositions(noteRows),
  });
  const violations = [...report.violations];

  if (args.approve) {
    // Approval never coexists with open criticals; the confirmation-required
    // violation itself is not a blocker to the act of approving.
    const blocking = violations.filter(
      (x) => x.severity === 'critical' && x.stage !== 'confirmation',
    );
    if (blocking.length > 0) {
      violations.push({
        stage: 'confirmation',
        severity: 'critical',
        message: 'cannot approve: critical violations are open (review-disposes-each-flag)',
      });
    } else if (!args.approvedBy) {
      violations.push({
        stage: 'confirmation',
        severity: 'critical',
        message: 'approval requires --approved-by <name> — an anonymous approval attests to nothing',
      });
    } else {
      await db.insert(auditLog).values({
        tenantId: tenant.id,
        entity: 'research_run',
        entityId: run.id,
        action: APPROVE_ACTION,
        after: {
          content_hash: report.hash,
          approved_by: args.approvedBy,
          signature_meaning: 'verified',
          findings: report.rollups.total,
          gaps: report.rollups.gaps,
          unsupported: report.rollups.unsupported,
          uncertain: report.rollups.uncertain,
          sample_spot_checked: report.sample.map((s) => s.label),
          via: 'cli',
        },
      });
      console.log(`\n✓ Approval recorded for run ${run.id.slice(0, 8)} by ${args.approvedBy}`);
      console.log(
        `  content hash ${report.hash.slice(0, 16)}… — any change to findings voids this approval`,
      );
      // The just-recorded approval satisfies confirmation for this report.
      const idx = violations.findIndex((x) => x.stage === 'confirmation');
      if (idx >= 0) violations.splice(idx, 1);
    }
  }

  // ---- Report ----
  const r = report.rollups;
  console.log(`\nresearch-verify · tenant ${tenant.slug} · run ${run.id.slice(0, 8)}`);
  console.log(
    `  findings ${r.total} (${r.indicators} indicators, ${r.gaps} gaps) · ` +
      `verifier: ${r.supported} pass / ${r.unsupported} fail / ${r.uncertain} uncertain`,
  );
  if (report.sample.length) {
    console.log(
      `  spot-check sample (inspect before approving): ${report.sample.map((s) => s.label).join(', ')}`,
    );
  }
  const finalCritical = violations.some((x) => x.severity === 'critical');
  for (const stage of ['deterministic', 'verifier', 'review', 'confirmation'] as const) {
    const rows = violations.filter((x) => x.stage === stage);
    if (rows.length === 0) {
      console.log(`  ✓ ${stage}`);
    } else {
      for (const row of rows) {
        console.log(`  ${row.severity === 'critical' ? '✗' : '⚠'} ${stage}: ${row.message}`);
      }
    }
  }

  const exitCode = finalCritical ? 2 : violations.length > 0 ? 1 : 0;
  console.log(
    exitCode === 2
      ? '\n✗ Blocked'
      : exitCode === 1
        ? '\n⚠ Passed with warnings'
        : '\n✓ Verified and approved',
  );
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
