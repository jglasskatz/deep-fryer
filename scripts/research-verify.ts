#!/usr/bin/env tsx
/**
 * research-verify — the run-level verification gate (pack-research's
 * run-time counterpart). Staged cheap-to-expensive, keel exit semantics
 * (0 pass · 1 warnings · 2 blocked):
 *
 *   1. deterministic  — coverage, evidence archived, citations resolve
 *   2. verifier       — unsupported/uncertain rates, tier mix, gap honesty
 *   3. human review   — every dimension dispositioned + spot-check sample
 *   4. confirmation   — approval bound to a content hash of the findings;
 *                       changed findings void the approval
 *
 * Blocks with "REVIEW REQUIRED" until the review queue has dispositioned
 * every dimension, then blocks with "CONFIRMATION REQUIRED" until a human
 * records approval:  research-verify --tenant nyc --approve --approved-by <who>
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { isFlagged } from '@deep-fryer/core';
import {
  auditLog,
  dimensions,
  dimensionVersions,
  findings,
  getDb,
  researchRuns,
  researchSessions,
  tenantBySlug,
  type Finding,
} from '@deep-fryer/db';

interface GateViolation {
  stage: string;
  severity: 'critical' | 'warning';
  message: string;
}

const APPROVE_ACTION = 'research_verify.approve';

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

/** Deterministic sample of auto-passed findings (seeded by run id — ISA 530 spirit). */
function sampleIds(ids: string[], runId: string, size: number): string[] {
  const scored = ids.map((id) => ({
    id,
    score: createHash('sha256').update(runId + id).digest('hex'),
  }));
  scored.sort((a, b) => a.score.localeCompare(b.score));
  return scored.slice(0, size).map((s) => s.id);
}

function contentHash(rows: Finding[]): string {
  const canonical = rows
    .map((f) => ({ id: f.id, payload: f.payload, verification: f.verification }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  const violations: GateViolation[] = [];
  const v = (stage: string, severity: GateViolation['severity'], message: string) =>
    violations.push({ stage, severity, message });

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
  const dimName = new Map(dims.map((d) => [d.id, d.slug]));

  // ---- Stage 1: deterministic ----
  const planned = sessions.filter((s) => s.kind === 'dimension');
  for (const s of planned) {
    if (!runFindings.some((f) => f.sessionId === s.id)) {
      v('deterministic', 'critical', `session for ${dimName.get(s.dimensionId ?? '') ?? s.id} produced no findings and no gaps`);
    }
  }
  const indicatorFindings = runFindings.filter((f) => f.payload.kind === 'indicator');
  for (const f of runFindings) {
    if (!f.verification) {
      v('deterministic', 'critical', `finding ${f.indicatorSlug} has no verification record`);
      continue;
    }
    if (f.payload.kind === 'indicator') {
      if (!f.payload.evidence?.snapshot_path) {
        v('deterministic', 'critical', `${dimName.get(f.dimensionId)}/${f.indicatorSlug}: no evidence snapshot (evidence-archived-at-access)`);
      }
      if (!f.verification.url_ok) {
        v('deterministic', 'warning', `${dimName.get(f.dimensionId)}/${f.indicatorSlug}: source URL did not resolve — snapshot is the surviving record; needs review disposition`);
      }
    }
  }

  // ---- Stage 2: verifier verdicts ----
  const supported = indicatorFindings.filter((f) => f.verification?.content_supported === 'pass');
  const unsupported = indicatorFindings.filter((f) => f.verification?.content_supported === 'fail');
  const uncertain = indicatorFindings.filter(
    (f) => f.verification?.content_supported === 'uncertain',
  );
  if (indicatorFindings.length > 0) {
    const failRate = unsupported.length / indicatorFindings.length;
    if (failRate > 0.05) {
      v('verifier', 'critical', `unsupported-claim rate ${(failRate * 100).toFixed(1)}% exceeds 5% — the run itself is suspect, prefer re-research over hand-fixing`);
    } else if (unsupported.length > 0) {
      v('verifier', 'warning', `${unsupported.length} finding(s) contradicted by their own source — each needs individual disposition`);
    }
    if (uncertain.length / indicatorFindings.length > 0.25) {
      v('verifier', 'warning', `verifier uncertain on ${uncertain.length}/${indicatorFindings.length} findings — sources may be paywalled or unstable`);
    }
    const tier12 = indicatorFindings.filter((f) => f.payload.kind === 'indicator' && f.payload.source_tier <= 2);
    if (tier12.length / indicatorFindings.length < 0.5) {
      v('verifier', 'warning', `tier-1/2 source share ${((tier12.length / indicatorFindings.length) * 100).toFixed(0)}% is below 50% (source-tiers-exhausted-in-order)`);
    }
    for (const f of indicatorFindings) {
      if (f.payload.kind === 'indicator' && f.payload.source_tier >= 4) {
        v('verifier', 'warning', `${dimName.get(f.dimensionId)}/${f.indicatorSlug}: rests on a tier-${f.payload.source_tier} source`);
      }
    }
  }
  const gapCount = runFindings.filter((f) => f.payload.kind === 'gap').length;

  // ---- Stage 3: review completeness (the trigger) ----
  const reviewedVersions = await db
    .select()
    .from(dimensionVersions)
    .where(eq(dimensionVersions.researchRunId, run.id));
  const reviewedDims = new Set(reviewedVersions.map((r) => r.dimensionId));
  const auditRows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenant.id), gt(auditLog.ts, run.createdAt)));
  for (const row of auditRows) {
    if (row.action === 'flag_gap' || row.action === 'create_human_version') {
      const dim = (row.after as { dimension?: string } | null)?.dimension;
      const match = dims.find((d) => d.slug === dim);
      if (match) reviewedDims.add(match.id);
    }
  }
  const unreviewed = dimIds.filter((id) => !reviewedDims.has(id));
  for (const id of unreviewed) {
    v('review', 'critical', `dimension '${dimName.get(id)}' has findings awaiting disposition — review at /${tenant.slug}/admin/review?run=${run.id}`);
  }
  const passedIds = supported.map((f) => f.id);
  const sample = sampleIds(passedIds, run.id, Math.min(3, passedIds.length));
  const sampleDesc = sample.map((id) => {
    const f = runFindings.find((x) => x.id === id)!;
    return `${dimName.get(f.dimensionId)}/${f.indicatorSlug}`;
  });

  // ---- Stage 4: hash-bound confirmation ----
  const hash = contentHash(runFindings);
  const approvals = auditRows.filter(
    (r) => r.action === APPROVE_ACTION && r.entityId === run.id,
  );
  const currentApproval = approvals.find(
    (r) => (r.after as { content_hash?: string } | null)?.content_hash === hash,
  );
  const hasCritical = violations.some((x) => x.severity === 'critical');

  if (args.approve) {
    if (hasCritical) {
      v('confirmation', 'critical', 'cannot approve: critical violations are open (review-disposes-each-flag)');
    } else if (!args.approvedBy) {
      v('confirmation', 'critical', 'approval requires --approved-by <name> — an anonymous approval attests to nothing');
    } else {
      await db.insert(auditLog).values({
        tenantId: tenant.id,
        entity: 'research_run',
        entityId: run.id,
        action: APPROVE_ACTION,
        after: {
          content_hash: hash,
          approved_by: args.approvedBy,
          signature_meaning: 'verified',
          findings: runFindings.length,
          gaps: gapCount,
          unsupported: unsupported.length,
          uncertain: uncertain.length,
          sample_spot_checked: sampleDesc,
        },
      });
      console.log(`\n✓ Approval recorded for run ${run.id.slice(0, 8)} by ${args.approvedBy}`);
      console.log(`  content hash ${hash.slice(0, 16)}… — any change to findings voids this approval`);
    }
  } else if (!hasCritical && !currentApproval) {
    if (approvals.length > 0) {
      v('confirmation', 'critical', 'approval is STALE — findings changed since it was recorded (approval-binds-to-content); re-review and re-approve');
    } else {
      v('confirmation', 'critical', `CONFIRMATION REQUIRED — checks pass and review is complete; record it with: research-verify --tenant ${tenant.slug} --run ${run.id} --approve --approved-by <you>`);
    }
  }

  // ---- Report ----
  console.log(`\nresearch-verify · tenant ${tenant.slug} · run ${run.id.slice(0, 8)}`);
  console.log(
    `  findings ${runFindings.length} (${indicatorFindings.length} indicators, ${gapCount} gaps) · ` +
      `verifier: ${supported.length} pass / ${unsupported.length} fail / ${uncertain.length} uncertain`,
  );
  if (sampleDesc.length) {
    console.log(`  spot-check sample (inspect before approving): ${sampleDesc.join(', ')}`);
  }
  const finalCritical = violations.some((x) => x.severity === 'critical');
  for (const stage of ['deterministic', 'verifier', 'review', 'confirmation']) {
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
