import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { currentDispositions, isFlagged } from '@deep-fryer/core';
import {
  dimensions,
  dimensionVersions,
  findings,
  getDb,
  researchRuns,
  researchSessions,
  reviewNotes,
  type Dimension,
  type Finding,
  type ResearchRun,
} from '@deep-fryer/db';

export interface DispositionSummary {
  verified: number;
  rejected: number;
  needsRework: number;
  /** Flagged findings with no individual disposition — these block approval. */
  openFlags: number;
}

export interface ReviewCardData {
  dimension: Dimension;
  dimensionName: string;
  findings: Finding[];
  sessionId: string | null;
  /** Set when this run's findings were already approved into a version. */
  approvedVersionNum: number | null;
  dispositions: DispositionSummary;
}

export interface ReviewQueueData {
  completeRuns: ResearchRun[];
  selectedRun: ResearchRun | null;
  cards: ReviewCardData[];
}

/** The review queue (SPEC.md §9): one card per dimension per run. */
export async function reviewQueue(tenantId: string, runId?: string): Promise<ReviewQueueData> {
  const db = getDb();
  const completeRuns = await db
    .select()
    .from(researchRuns)
    .where(and(eq(researchRuns.tenantId, tenantId), eq(researchRuns.status, 'complete')))
    .orderBy(desc(researchRuns.createdAt));

  const selectedRun =
    (runId ? completeRuns.find((r) => r.id === runId) : completeRuns[0]) ?? null;
  if (!selectedRun) return { completeRuns, selectedRun: null, cards: [] };

  const sessions = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.runId, selectedRun.id));
  const sessionIds = sessions.map((s) => s.id);
  const runFindings = sessionIds.length
    ? await db.select().from(findings).where(inArray(findings.sessionId, sessionIds))
    : [];

  const dimensionIds = [...new Set(runFindings.map((f) => f.dimensionId))];
  const dims = dimensionIds.length
    ? await db.select().from(dimensions).where(inArray(dimensions.id, dimensionIds))
    : [];
  const dimById = new Map(dims.map((d) => [d.id, d]));

  const approvedVersions = dimensionIds.length
    ? await db
        .select()
        .from(dimensionVersions)
        .where(
          and(
            inArray(dimensionVersions.dimensionId, dimensionIds),
            eq(dimensionVersions.researchRunId, selectedRun.id),
          ),
        )
    : [];
  const approvedByDim = new Map(approvedVersions.map((v) => [v.dimensionId, v.versionNum]));

  const latestNames = dimensionIds.length
    ? await db
        .selectDistinctOn([dimensionVersions.dimensionId], {
          dimensionId: dimensionVersions.dimensionId,
          name: sql<string>`${dimensionVersions.data}->>'name'`,
        })
        .from(dimensionVersions)
        .where(inArray(dimensionVersions.dimensionId, dimensionIds))
        .orderBy(dimensionVersions.dimensionId, desc(dimensionVersions.versionNum))
    : [];
  const nameByDim = new Map(latestNames.map((r) => [r.dimensionId, r.name]));

  const sessionByDim = new Map(
    sessions.filter((s) => s.dimensionId).map((s) => [s.dimensionId as string, s.id]),
  );

  const noteRows = await db
    .select()
    .from(reviewNotes)
    .where(eq(reviewNotes.runId, selectedRun.id));
  const dispositionByFinding = new Map(
    currentDispositions(noteRows).map((d) => [d.findingId, d]),
  );

  const cards: ReviewCardData[] = dimensionIds
    .map((dimId) => {
      const dimension = dimById.get(dimId);
      if (!dimension) return null;
      const dimFindings = runFindings.filter((f) => f.dimensionId === dimId);
      const summary: DispositionSummary = { verified: 0, rejected: 0, needsRework: 0, openFlags: 0 };
      for (const f of dimFindings) {
        const d = dispositionByFinding.get(f.id);
        if (d?.state === 'verified') summary.verified += 1;
        else if (d?.state === 'rejected') summary.rejected += 1;
        else if (d?.state === 'needs_rework') summary.needsRework += 1;
        else if (!f.verification || isFlagged(f.verification)) summary.openFlags += 1;
      }
      return {
        dimension,
        dimensionName: nameByDim.get(dimId) ?? dimension.slug,
        findings: dimFindings,
        sessionId: sessionByDim.get(dimId) ?? null,
        approvedVersionNum: approvedByDim.get(dimId) ?? null,
        dispositions: summary,
      };
    })
    .filter((c): c is ReviewCardData => c !== null)
    .sort((a, b) => a.dimension.displayOrder - b.dimension.displayOrder);

  return { completeRuns, selectedRun, cards };
}
