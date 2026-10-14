import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  dimensions,
  dimensionVersions,
  findings,
  researchRuns,
  researchSessions,
  type Dimension,
  type Finding,
  type ResearchRun,
} from '@deep-fryer/db';
import { userDb } from './db';

export interface ReviewCardData {
  dimension: Dimension;
  dimensionName: string;
  findings: Finding[];
  sessionId: string | null;
  /** Set when this run's findings were already approved into a version. */
  approvedVersionNum: number | null;
}

export interface ReviewQueueData {
  completeRuns: ResearchRun[];
  selectedRun: ResearchRun | null;
  cards: ReviewCardData[];
}

/** The review queue (SPEC.md §9): one card per dimension per run. */
export async function reviewQueue(tenantId: string, runId?: string): Promise<ReviewQueueData> {
  return userDb(async (db) => {
    const completeRuns = await db
      .select()
      .from(researchRuns)
      .where(and(eq(researchRuns.tenantId, tenantId), eq(researchRuns.status, 'complete')))
      .orderBy(desc(researchRuns.createdAt));

    const selectedRun =
      (runId ? completeRuns.find((r) => r.id === runId) : completeRuns[0]) ?? null;
    if (!selectedRun) return { completeRuns, selectedRun: null, cards: [] };

    // Explicit columns: the user role cannot read transcripts (migration 0005).
    const sessions = await db
      .select({ id: researchSessions.id, dimensionId: researchSessions.dimensionId })
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

    const cards: ReviewCardData[] = dimensionIds
      .map((dimId) => {
        const dimension = dimById.get(dimId);
        if (!dimension) return null;
        return {
          dimension,
          dimensionName: nameByDim.get(dimId) ?? dimension.slug,
          findings: runFindings.filter((f) => f.dimensionId === dimId),
          sessionId: sessionByDim.get(dimId) ?? null,
          approvedVersionNum: approvedByDim.get(dimId) ?? null,
        };
      })
      .filter((c): c is ReviewCardData => c !== null)
      .sort((a, b) => a.dimension.displayOrder - b.dimension.displayOrder);

    return { completeRuns, selectedRun, cards };
  });
}
