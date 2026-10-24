import 'server-only';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { auditDecision } from '@deep-fryer/core';
import { dimensionVersions, dimensions, findingAudits, researchRuns, type Finding } from '@deep-fryer/db';
import { userDb } from './db';
import { configValueIn } from './admin-data';
import { bulkApprovalPlan, liveDimensions, runResearch, runSettled, spotCheckSample } from './draft-portrait';

export async function machineApprovalSummary(tenantId: string, runId: string) {
  return userDb(async (db) => {
    const enabled = (await configValueIn(db, tenantId, 'review_policy'))?.audit_apply === 'bulk';
    const empty = { enabled, findings: 0, dimensions: 0, sample: [] as Finding[], open: 0 };
    const [run] = await db.select().from(researchRuns).where(and(eq(researchRuns.id, runId), eq(researchRuns.tenantId, tenantId)));
    if (!run || !runSettled(run)) return empty;
    const dims = await liveDimensions(db, tenantId);
    const plan = bulkApprovalPlan(dims, await runResearch(db, run, dims.map((d) => d.id)));
    if (plan.open.length) return { ...empty, open: plan.open.length };
    const ids = plan.eligible.flatMap((d) => d.findings.map((f) => f.id));
    if (!ids.length) return empty;
    const audits = await db.select().from(findingAudits).where(and(inArray(findingAudits.findingId, ids), isNull(findingAudits.appliedAt)));
    const eligible = plan.eligible.filter((d) => d.findings.every((f) => auditDecision(audits.filter((a) => a.findingId === f.id))?.disposition === 'approve'));
    const findings = eligible.flatMap((d) => d.findings);
    const selected = new Set(spotCheckSample(findings.map((f) => f.id), runId));
    return { enabled, findings: findings.length, dimensions: eligible.length, sample: findings.filter((f) => selected.has(f.id)), open: 0 };
  });
}

/** Current authored drafts only; action rechecks the exact selection atomically. */
export async function reviewedDrafts(tenantId: string) {
  return userDb(async (db) => {
    const rows = await db.selectDistinctOn([dimensionVersions.dimensionId], { version: dimensionVersions, slug: dimensions.slug })
      .from(dimensionVersions).innerJoin(dimensions, eq(dimensions.id, dimensionVersions.dimensionId))
      .where(and(eq(dimensions.tenantId, tenantId), isNull(dimensions.archivedAt)))
      .orderBy(dimensionVersions.dimensionId, desc(dimensionVersions.versionNum));
    return rows.filter(({ version }) => version.status === 'draft' && version.origin !== 'import' && Boolean(version.createdBy))
      .map(({ version, slug }) => ({ id: version.id, dimensionId: version.dimensionId, name: version.data.name || slug, versionNum: version.versionNum,
        changeNote: version.changeNote, origin: version.origin, indicators: version.data.indicators.length, gaps: version.data.gaps?.length ?? 0 }));
  });
}
