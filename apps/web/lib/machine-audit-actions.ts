'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { applyFindingCorrection, auditDecision, computeScoring, deriveVizLevel, resolveThreshold, type FindingPayload } from '@deep-fryer/core';
import { appendDimensionVersion, dimensions, dimensionVersions, findingAudits, findings, latestVersion,
  researchRuns, researchSessions, type DbExecutor, type Dimension, type Finding, type FindingAudit, type Tenant } from '@deep-fryer/db';
import { getAuth, requireTenantRole } from './auth';
import { audit } from './audit';
import { configValueIn } from './admin-data';
import { action, UserError } from './action-result';
import { userDb } from './db';
import { bulkApprovalPlan, liveDimensions, researchVersionData, runResearch, runSettled, spotCheckSample } from './draft-portrait';
import { createPlannedRunIn } from './research';
import { publishVersionFor } from './publish';

const lock = (db: DbExecutor, runId: string) => db.execute(sql`select pg_advisory_xact_lock(61005, hashtext(${runId}))`);
const refresh = (slug: string) => {
  for (const path of ['', '/admin', '/admin/review', '/admin/draft', '/admin/research']) revalidatePath(`/${slug}${path}`);
};
const sameIds = (left: string[], right: string[]) => left.length === right.length && new Set(left).size === left.length && left.every((id) => right.includes(id));
interface AuditApplicationResult { versionId?: string; versionNum?: number; runId?: string }

async function settledRun(db: DbExecutor, tenantId: string, runId: string) {
  const [run] = await db.select().from(researchRuns).where(and(eq(researchRuns.id, runId), eq(researchRuns.tenantId, tenantId)));
  if (!run || !runSettled(run)) throw new UserError('Only a finished run in this portrait can be reviewed.');
  return run;
}

async function dimensionFindings(db: DbExecutor, runId: string, dimensionId: string) {
  const rows = await db.select({ finding: findings }).from(findings)
    .innerJoin(researchSessions, eq(researchSessions.id, findings.sessionId))
    .where(and(eq(researchSessions.runId, runId), eq(findings.dimensionId, dimensionId)))
    .orderBy(findings.createdAt, findings.id);
  return rows.map((r) => r.finding);
}

async function recordApplications(db: DbExecutor, tenant: Tenant, audits: FindingAudit[], reference: { versionId?: string; runId?: string }) {
  const { userId } = await getAuth();
  if (!userId) throw new UserError('Sign in to apply a recommendation.');
  for (const recommendation of audits) {
    await db.update(findingAudits).set({ appliedBy: userId, appliedAt: new Date(),
      appliedVersionId: reference.versionId ?? null, appliedRunId: reference.runId ?? null,
    }).where(and(eq(findingAudits.id, recommendation.id), isNull(findingAudits.appliedAt)));
    await audit(tenant.id, 'finding_audit', recommendation.id, 'apply_machine_audit', null,
      { finding_id: recommendation.findingId, disposition: recommendation.disposition, ...reference }, db);
  }
}

async function applyCard(db: DbExecutor, tenant: Tenant, runId: string, dimension: Dimension, rows: Finding[], audits: FindingAudit[]): Promise<AuditApplicationResult> {
  const pending = audits.filter((a) => !a.appliedAt);
  const decisions = new Map(rows.map((f) => [f.id, auditDecision(pending.filter((a) => a.findingId === f.id))]));
  const reruns = [...decisions.values()].filter((a) => a?.disposition === 're_research');
  const { userId } = await getAuth();
  if (reruns.length) {
    const notes = reruns.map((a) => a!.reason).join('\n\n').slice(0, 4000);
    const { run } = await createPlannedRunIn(db, { tenantId: tenant.id, dimensionIds: [dimension.id],
      reviewerNotes: { [dimension.id]: notes }, requestedBy: userId });
    await recordApplications(db, tenant, pending, { runId: run.id });
    return { runId: run.id };
  }
  const overrides = await configValueIn(db, tenant.id, 'threshold_overrides');
  let edited = false;
  const payloads: FindingPayload[] = rows.map((finding) => {
    const decision = decisions.get(finding.id);
    if (decision?.disposition === 'reject') {
      return { kind: 'gap', indicator_slug: finding.indicatorSlug,
        reason: `Excluded during review: ${decision.reason}`, searched_at: new Date().toISOString(),
        scales_tried: finding.payload.kind === 'indicator' ? [finding.payload.geographic_scale] : finding.payload.scales_tried };
    }
    if (decision?.disposition === 'edit') {
      edited = true;
      const corrected = applyFindingCorrection(finding.payload, decision.correction);
      if (corrected.kind !== 'indicator' || typeof corrected.value !== 'number') throw new UserError('This correction needs a manual edit with a scoring explanation.');
      const threshold = resolveThreshold(corrected.scoring.threshold_ref, overrides ?? undefined);
      if (!threshold) throw new UserError('The correction has no recognized scoring contract. Edit it manually before publication.');
      return { ...corrected, ...computeScoring(corrected.value, corrected.scoring.threshold_ref, threshold), target: threshold.target };
    }
    return finding.payload;
  });
  const base = await latestVersion(db, dimension.id);
  const data = researchVersionData(base?.data, dimension.slug, payloads);
  const version = await appendDimensionVersion(db, { dimensionId: dimension.id, status: 'draft', data,
    vizLevel: deriveVizLevel(data), origin: edited ? 'human' : 'research', researchRunId: runId,
    createdBy: userId, changeNote: `Human-applied machine audit: ${pending.map((a) => `${a.disposition}: ${a.reason}`).join(' | ')}` });
  await recordApplications(db, tenant, pending, { versionId: version.id });
  await audit(tenant.id, 'dimension_version', version.id, 'approve_findings', null,
    { run_id: runId, dimension: dimension.slug, machine_audits: pending.map((a) => a.id), indicators: data.indicators.length }, db);
  return { versionId: version.id, versionNum: version.versionNum };
}

/** Exact immutable recommendation IDs bind this click to the preview shown. */
export const applyMachineAudits = action(async (input: {
  tenantSlug: string; runId: string; dimensionId: string; expectedAuditIds: string[];
}): Promise<AuditApplicationResult> => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  return userDb(async (db) => {
    await lock(db, input.runId);
    await settledRun(db, tenant.id, input.runId);
    const [dimension] = await db.select().from(dimensions).where(and(eq(dimensions.id, input.dimensionId), eq(dimensions.tenantId, tenant.id)));
    if (!dimension || dimension.archivedAt) throw new UserError('Unknown active dimension.');
    const rows = await dimensionFindings(db, input.runId, dimension.id);
    if (!rows.length) throw new UserError('No findings for this dimension in this run.');
    const audits = await db.select().from(findingAudits).where(inArray(findingAudits.findingId, rows.map((f) => f.id)));
    const pending = audits.filter((a) => !a.appliedAt);
    if (!pending.length && input.expectedAuditIds.length && input.expectedAuditIds.every((id) => audits.some((a) => a.id === id && a.appliedAt))) {
      const applied = audits.find((a) => a.id === input.expectedAuditIds[0])!;
      return applied.appliedRunId ? { runId: applied.appliedRunId } : { versionId: applied.appliedVersionId! };
    }
    if (!pending.length || !sameIds(input.expectedAuditIds, pending.map((a) => a.id))) throw new UserError('The audit recommendations changed. Reload and inspect the current recommendations.');
    const [already] = await db.select({ id: dimensionVersions.id }).from(dimensionVersions)
      .where(and(eq(dimensionVersions.dimensionId, dimension.id), eq(dimensionVersions.researchRunId, input.runId))).limit(1);
    if (already) throw new UserError('This dimension already has a reviewed version from this run. Make any further correction in the version editor.');
    const result = await applyCard(db, tenant, input.runId, dimension, rows, audits);
    refresh(tenant.slug);
    return result;
  });
});

/** Bulk mode is opt-in. All existing flag, completed-session and source
 * spot-check gates still apply; no machine opinion weakens those gates. */
export const applyMachineApproved = action(async (input: {
  tenantSlug: string; runId: string; expectedFindings: number; spotChecked: string[];
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  return userDb(async (db) => {
    await lock(db, input.runId);
    if ((await configValueIn(db, tenant.id, 'review_policy'))?.audit_apply !== 'bulk') throw new UserError('This portrait requires applying recommendations one card at a time.');
    const run = await settledRun(db, tenant.id, input.runId);
    const dims = await liveDimensions(db, tenant.id);
    const plan = bulkApprovalPlan(dims, await runResearch(db, run, dims.map((d) => d.id)));
    if (plan.open.length) throw new UserError('Review every flagged dimension individually before applying recommendations in bulk.');
    const ids = plan.eligible.flatMap((d) => d.findings.map((f) => f.id));
    const audits = ids.length ? await db.select().from(findingAudits).where(and(inArray(findingAudits.findingId, ids), isNull(findingAudits.appliedAt))) : [];
    const eligible = plan.eligible.filter((d) => d.findings.every((f) => auditDecision(audits.filter((a) => a.findingId === f.id))?.disposition === 'approve'));
    const eligibleIds = eligible.flatMap((d) => d.findings.map((f) => f.id));
    if (eligibleIds.length > input.expectedFindings || !spotCheckSample(eligibleIds, run.id).every((id) => input.spotChecked.includes(id))) {
      throw new UserError('The recommendations or source sample changed. Reload and check the current sample.');
    }
    const versions = [];
    for (const item of eligible) versions.push(await applyCard(db, tenant, run.id, item.dimension, item.findings, audits.filter((a) => item.findings.some((f) => f.id === a.findingId))));
    refresh(tenant.slug);
    return { findings: eligibleIds.length, versions };
  });
});

/** The caller previews exact draft IDs. Nothing unreviewed or superseded can
 * enter the publication batch; dual-review policy is checked per version. */
export const publishReviewed = action(async (input: { tenantSlug: string; versionIds: string[] }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  if (input.versionIds.length > 200 || new Set(input.versionIds).size !== input.versionIds.length) throw new UserError('Select distinct reviewed drafts.');
  return userDb(async (db) => {
    const rows = input.versionIds.length ? await db.select({ version: dimensionVersions, dimension: dimensions }).from(dimensionVersions)
      .innerJoin(dimensions, eq(dimensions.id, dimensionVersions.dimensionId))
      .where(and(inArray(dimensionVersions.id, input.versionIds), eq(dimensions.tenantId, tenant.id))) : [];
    if (rows.length !== input.versionIds.length) throw new UserError('A selected version is not in this portrait.');
    const sorted = rows.sort((a, b) => a.dimension.id.localeCompare(b.dimension.id));
    for (const { version, dimension } of sorted) {
      await db.execute(sql`select id from dimensions where id=${dimension.id}::uuid for update`);
      if (version.status !== 'draft' || version.origin === 'import' || !version.createdBy || dimension.archivedAt || (await latestVersion(db, dimension.id))?.id !== version.id) {
        throw new UserError('A selected draft changed or is no longer current. Reload before publishing.');
      }
      await publishVersionFor(db, tenant, version.id);
    }
    refresh(tenant.slug);
    return { published: rows.length };
  });
});
