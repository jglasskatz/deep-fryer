import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  acceptedScales,
  currentDispositions,
  isFlagged,
  maxDataAgeYears,
  type CurrentDisposition,
  type GeographicScale,
} from '@deep-fryer/core';
import { computeGateReport, contentHash, type GateReport } from '@deep-fryer/research';
import {
  auditLog,
  dimensions,
  dimensionVersions,
  findings,
  getDb,
  researchRuns,
  researchSessions,
  reviewNotes,
  sourcesBySnapshotPaths,
  tenants,
  type Finding,
  type ResearchRun,
  type ReviewNote,
} from '@deep-fryer/db';

/**
 * Loaders for the verification admin mode (SPEC.md §9). Everything the
 * dashboard shows comes out of computeGateReport — the same call the
 * research-verify CLI makes — so the two surfaces can never disagree.
 */

export interface VerifyRunSummary {
  run: ResearchRun;
  findingCount: number;
  flaggedCount: number;
  dispositionCount: number;
  approvalState: 'none' | 'current' | 'stale';
}

export async function verifyRuns(tenantId: string): Promise<VerifyRunSummary[]> {
  const db = getDb();
  const runs = await db
    .select()
    .from(researchRuns)
    .where(and(eq(researchRuns.tenantId, tenantId), eq(researchRuns.status, 'complete')))
    .orderBy(desc(researchRuns.createdAt));
  if (runs.length === 0) return [];

  const runIds = runs.map((r) => r.id);
  const sessions = await db
    .select({ id: researchSessions.id, runId: researchSessions.runId })
    .from(researchSessions)
    .where(inArray(researchSessions.runId, runIds));
  const sessionRun = new Map(sessions.map((s) => [s.id, s.runId]));
  const rows = sessions.length
    ? await db
        .select()
        .from(findings)
        .where(inArray(findings.sessionId, sessions.map((s) => s.id)))
    : [];
  const approvals = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'research_verify.approve')));
  const notes = await db
    .select({ runId: reviewNotes.runId, disposition: reviewNotes.disposition })
    .from(reviewNotes)
    .where(inArray(reviewNotes.runId, runIds));

  return runs.map((run) => {
    const runRows = rows.filter((f) => sessionRun.get(f.sessionId) === run.id);
    const hash = contentHash(runRows);
    const runApprovals = approvals.filter((a) => a.entityId === run.id);
    const current = runApprovals.some(
      (a) => (a.after as { content_hash?: string } | null)?.content_hash === hash,
    );
    return {
      run,
      findingCount: runRows.length,
      flaggedCount: runRows.filter((f) => !f.verification || isFlagged(f.verification)).length,
      dispositionCount: notes.filter((n) => n.runId === run.id && n.disposition).length,
      approvalState: current ? 'current' : runApprovals.length > 0 ? 'stale' : 'none',
    };
  });
}

export interface VerifyFinding {
  finding: Finding;
  dimensionSlug: string;
  dimensionName: string;
  flagged: boolean;
  inSample: boolean;
  disposition: CurrentDisposition | null;
  /** Full note thread for this finding, oldest first. */
  notes: ReviewNote[];
}

export interface VerifyDimensionContext {
  slug: string;
  name: string;
  /** The exact prompt that produced this dimension's findings. */
  prompt: string | null;
  /** The bars this dimension was judged against, from the frozen configSnapshot. */
  maxAgeYears: number;
  acceptedScales: GeographicScale[];
}

export interface VerifyRunData {
  run: ResearchRun;
  report: GateReport;
  findings: VerifyFinding[];
  dimensionContexts: Map<string, VerifyDimensionContext>;
  /** Run-scoped commentary (no finding attached), oldest first. */
  runNotes: ReviewNote[];
  dispositions: CurrentDisposition[];
  /** evidence.snapshot_path → source-library row id, for archived-text links. */
  sourceIds: Record<string, string>;
}

export async function verifyRun(tenantId: string, runId: string): Promise<VerifyRunData | null> {
  const db = getDb();
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(and(eq(researchRuns.id, runId), eq(researchRuns.tenantId, tenantId)));
  if (!run) return null;

  const sessions = await db
    .select({
      id: researchSessions.id,
      dimensionId: researchSessions.dimensionId,
      kind: researchSessions.kind,
    })
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
  const slugById = new Map(dims.map((d) => [d.id, d.slug]));
  const latestNames = dimIds.length
    ? await db
        .selectDistinctOn([dimensionVersions.dimensionId], {
          dimensionId: dimensionVersions.dimensionId,
          name: sql<string>`${dimensionVersions.data}->>'name'`,
        })
        .from(dimensionVersions)
        .where(inArray(dimensionVersions.dimensionId, dimIds))
        .orderBy(dimensionVersions.dimensionId, desc(dimensionVersions.versionNum))
    : [];
  const nameByDim = new Map(latestNames.map((r) => [r.dimensionId, r.name]));

  const versionsForRun = await db
    .select({ dimensionId: dimensionVersions.dimensionId })
    .from(dimensionVersions)
    .where(eq(dimensionVersions.researchRunId, run.id));
  const auditRows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), gt(auditLog.ts, run.createdAt)));
  const noteRows = await db
    .select()
    .from(reviewNotes)
    .where(eq(reviewNotes.runId, run.id))
    .orderBy(reviewNotes.createdAt);

  // Tenant slug only feeds deep-link text in violation messages.
  const [tenantRow] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));

  const dispositions = currentDispositions(noteRows);
  const report = computeGateReport({
    run: { id: run.id, createdAt: run.createdAt, tenantSlug: tenantRow?.slug ?? '' },
    findings: runFindings,
    sessions,
    dimensionSlugById: slugById,
    versionsForRun,
    auditRowsAfterRun: auditRows,
    dispositions,
  });

  const sampleIds = new Set(report.sample.map((s) => s.findingId));
  const dispositionById = new Map(dispositions.map((d) => [d.findingId, d]));
  const verifyFindings: VerifyFinding[] = runFindings
    .map((f) => ({
      finding: f,
      dimensionSlug: slugById.get(f.dimensionId) ?? f.dimensionId,
      dimensionName: nameByDim.get(f.dimensionId) ?? slugById.get(f.dimensionId) ?? '',
      flagged: !f.verification || isFlagged(f.verification),
      inSample: sampleIds.has(f.id),
      disposition: dispositionById.get(f.id) ?? null,
      notes: noteRows.filter((n) => n.findingId === f.id),
    }))
    .sort(
      (a, b) =>
        a.dimensionSlug.localeCompare(b.dimensionSlug) ||
        a.finding.indicatorSlug.localeCompare(b.finding.indicatorSlug),
    );

  const promptBySlug = new Map(
    run.plan.sessions
      .filter((s) => s.kind === 'dimension' && s.dimension_slug)
      .map((s) => [s.dimension_slug as string, s.prompt]),
  );
  const dimensionContexts = new Map<string, VerifyDimensionContext>(
    dims.map((d) => [
      d.slug,
      {
        slug: d.slug,
        name: nameByDim.get(d.id) ?? d.slug,
        prompt: promptBySlug.get(d.slug) ?? null,
        maxAgeYears: maxDataAgeYears(run.configSnapshot.recency, d.slug),
        acceptedScales: acceptedScales(run.configSnapshot.scale_policy, d.slug),
      },
    ]),
  );

  const evidencePaths = runFindings.flatMap((f) =>
    f.payload.kind === 'indicator' && f.payload.evidence?.snapshot_path
      ? [f.payload.evidence.snapshot_path]
      : [],
  );
  const sourceRows = await sourcesBySnapshotPaths(db, tenantId, [...new Set(evidencePaths)]);
  const sourceIds = Object.fromEntries([...sourceRows].map(([path, s]) => [path, s.id]));

  return {
    run,
    report,
    findings: verifyFindings,
    dimensionContexts,
    runNotes: noteRows.filter((n) => !n.findingId),
    dispositions,
    sourceIds,
  };
}
