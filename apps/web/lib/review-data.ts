import 'server-only';
import { gunzipSync } from 'node:zlib';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  dimensions,
  dimensionVersions,
  findings,
  findingAudits,
  researchRuns,
  researchSessions,
  type DbExecutor,
  type Dimension,
  type Finding,
  type ResearchFunding,
  type ResearchRun,
} from '@deep-fryer/db';
import type { ReviewAudit } from '@deep-fryer/core';
import { systemDb, userDb } from './db';
import { deploymentResearchKeyConfigured, supportEmail } from './env';
import {
  failureCause,
  groupCauses,
  runStoppedCause,
  transcriptSignals,
  type FailureCause,
  type FailureContext,
  type TranscriptSignals,
} from './run-failure';
import { TtlCache } from './ttl-cache';

export interface ReviewCardData {
  dimension: Dimension;
  dimensionName: string;
  findings: (Finding & { audits: ReviewAudit[] })[];
  sessionId: string | null;
  /** Set when this run's findings were already approved into a version. */
  approvedVersionNum: number | null;
}

/** A run that failed, as the review queue lists it: what it managed, and why it stopped. */
export interface FailedRunSummary {
  run: ResearchRun;
  /**
   * Planned sessions that did not complete — failed, or never started
   * because the run stopped first (the worker writes a session row only
   * when the session starts) — counted as the run page counts them.
   */
  incompleteSessions: number;
  findings: number;
  /** The reason that stopped most of its sessions (lib/run-failure.ts). */
  cause: FailureCause;
}

export interface ReviewQueueData {
  /**
   * Runs with findings to review: every complete run, and a failed run that
   * recorded findings before it stopped (the failure email says they are
   * here, so they must be).
   */
  reviewableRuns: ResearchRun[];
  selectedRun: ResearchRun | null;
  cards: ReviewCardData[];
  /** The most recent failed runs, newest first, each linking to its run page. */
  failedRuns: FailedRunSummary[];
}

/** How many failed runs the review queue names; older ones stay on the research page's history. */
const FAILED_RUNS_LISTED = 5;

/** The review queue (SPEC.md §9): one card per dimension per run. */
export async function reviewQueue(tenantId: string, runId?: string): Promise<ReviewQueueData> {
  const base = await userDb(async (db) => {
    const settledRuns = await db
      .select()
      .from(researchRuns)
      .where(and(eq(researchRuns.tenantId, tenantId), inArray(researchRuns.status, ['complete', 'failed'])))
      .orderBy(desc(researchRuns.createdAt));

    const failed = settledRuns.filter((r) => r.status === 'failed');
    const failedIds = failed.map((r) => r.id);
    const sessionCounts = failedIds.length
      ? await db
          .select({
            runId: researchSessions.runId,
            completed: sql<number>`count(*) filter (where ${researchSessions.status} = 'complete')::int`,
          })
          .from(researchSessions)
          .where(inArray(researchSessions.runId, failedIds))
          .groupBy(researchSessions.runId)
      : [];
    const findingCounts = failedIds.length
      ? await db
          .select({ runId: researchSessions.runId, findings: sql<number>`count(*)::int` })
          .from(findings)
          .innerJoin(researchSessions, eq(researchSessions.id, findings.sessionId))
          .where(inArray(researchSessions.runId, failedIds))
          .groupBy(researchSessions.runId)
      : [];
    const sessionsByRun = new Map(sessionCounts.map((c) => [c.runId, c]));
    const findingsByRun = new Map(findingCounts.map((c) => [c.runId, c.findings]));

    const reviewableRuns = settledRuns.filter((r) => r.status === 'complete' || (findingsByRun.get(r.id) ?? 0) > 0);
    const failedRuns = failed.slice(0, FAILED_RUNS_LISTED).map((run) => ({
      run,
      incompleteSessions: Math.max(0, run.plan.sessions.length - (sessionsByRun.get(run.id)?.completed ?? 0)),
      findings: findingsByRun.get(run.id) ?? 0,
    }));

    const selectedRun =
      (runId ? reviewableRuns.find((r) => r.id === runId) : reviewableRuns[0]) ?? null;
    if (!selectedRun) return { reviewableRuns, selectedRun: null, cards: [], failedRuns };
    const cards = await reviewCards(db, selectedRun);
    return { reviewableRuns, selectedRun, cards, failedRuns };
  });

  // After the user transaction, never inside it: the causes come from
  // transcripts, read in the system context (lib/db.ts — no second pooled
  // connection while a transaction holds one).
  // One run at a time: each is a query or two on the pool, and five at once
  // would take five connections for one page view.
  const failedRuns: FailedRunSummary[] = [];
  for (const summary of base.failedRuns) {
    const bySession = await runFailureCauses(tenantId, summary.run.id);
    const groups = groupCauses([...bySession].map(([key, cause]) => ({ key, cause })));
    const main = groups.sort((a, b) => b.keys.length - a.keys.length)[0]?.cause ?? runStoppedCause(supportEmail());
    failedRuns.push({ ...summary, cause: main });
  }
  return { ...base, failedRuns };
}

async function reviewCards(db: DbExecutor, selectedRun: ResearchRun): Promise<ReviewCardData[]> {
  // Explicit columns: the user role cannot read transcripts (migration 0005).
  const sessions = await db
    .select({ id: researchSessions.id, dimensionId: researchSessions.dimensionId })
    .from(researchSessions)
    .where(eq(researchSessions.runId, selectedRun.id));
  const sessionIds = sessions.map((s) => s.id);
  const runFindings = sessionIds.length
    ? await db.select().from(findings).where(inArray(findings.sessionId, sessionIds))
    : [];

  const auditRows = runFindings.length
    ? await db.select().from(findingAudits).where(inArray(findingAudits.findingId, runFindings.map(finding => finding.id)))
    : [];
  const withAudits: ReviewCardData['findings'] = runFindings.map(finding => ({ ...finding, audits: auditRows.filter(audit => audit.findingId === finding.id).map(audit => ({
    id: audit.id, findingId: audit.findingId, source: audit.source, disposition: audit.disposition,
    reason: audit.reason, correction: audit.correction, appliedAt: audit.appliedAt?.toISOString() ?? null,
    appliedVersionId: audit.appliedVersionId, appliedRunId: audit.appliedRunId,
  })) }));

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

  return dimensionIds
    .map((dimId) => {
      const dimension = dimById.get(dimId);
      if (!dimension) return null;
      return {
        dimension,
        dimensionName: nameByDim.get(dimId) ?? dimension.slug,
        findings: withAudits.filter((f) => f.dimensionId === dimId),
        sessionId: sessionByDim.get(dimId) ?? null,
        approvedVersionNum: approvedByDim.get(dimId) ?? null,
      };
    })
    .filter((c): c is ReviewCardData => c !== null)
    .sort((a, b) => a.dimension.displayOrder - b.dimension.displayOrder);
}

/**
 * The portrait's dimensions as the run page names them: the slug of each id
 * (how a session row is matched to its plan entry) and a readable name per
 * slug — the latest version's name, as the review cards use, else the slug.
 */
export async function runDimensionLabels(
  tenantId: string,
): Promise<{ slugById: Map<string, string>; nameBySlug: Map<string, string> }> {
  return userDb(async (db) => {
    const dims = await db
      .select({ id: dimensions.id, slug: dimensions.slug })
      .from(dimensions)
      .where(eq(dimensions.tenantId, tenantId));
    const names = dims.length
      ? await db
          .selectDistinctOn([dimensionVersions.dimensionId], {
            dimensionId: dimensionVersions.dimensionId,
            name: sql<string | null>`${dimensionVersions.data}->>'name'`,
          })
          .from(dimensionVersions)
          .where(inArray(dimensionVersions.dimensionId, dims.map((d) => d.id)))
          .orderBy(dimensionVersions.dimensionId, desc(dimensionVersions.versionNum))
      : [];
    const nameById = new Map(names.map((n) => [n.dimensionId, n.name]));
    return {
      slugById: new Map(dims.map((d) => [d.id, d.slug])),
      nameBySlug: new Map(dims.map((d) => [d.slug, nameById.get(d.id) || d.slug])),
    };
  });
}

/** What failureCause needs besides the transcript: read when the page renders, so a key configured since counts. */
const contextFor = (funding: ResearchFunding): FailureContext => ({
  funding,
  researchKeyConfigured: deploymentResearchKeyConfigured(),
  support: supportEmail(),
});

/**
 * What each failed session's transcript says (lib/run-failure.ts
 * transcriptSignals), by session id. A session's transcript is written once,
 * in the same update that fails it, and never changes after (apps/worker
 * research-apply.ts), so a failed session's signals are kept for good — the
 * run page refreshes every few seconds and must not unzip the same
 * transcripts each time. Bounded like every process-wide cache here.
 */
const signalsCache = new TtlCache<TranscriptSignals | null>(6 * 60 * 60_000, 5_000);

/**
 * Transcripts larger than this are not read: one that size is a session
 * that researched at length, and unzipping it on a page view costs more
 * than its cause is worth. Its cause reads as "stopped unexpectedly".
 */
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
const MAX_TRANSCRIPT_TEXT = 48 * 1024 * 1024;

/**
 * Why each failed session of a run failed, in plain words (lib/run-failure.ts
 * failureCause), by session id. Callers have already required the editor
 * role on the run's portrait (the run page, the review queue).
 *
 * Transcripts are owner-only (migration 0005), so this reads them in the
 * system context — the run is checked against `tenantId` in the same query —
 * and returns only the classified cause, from a fixed vocabulary; the one
 * message passed through as written is the worker's own staff-facing reason
 * for a run on the organization's key. Never call it inside a userDb
 * transaction (lib/db.ts).
 */
export async function runFailureCauses(tenantId: string, runId: string): Promise<Map<string, FailureCause>> {
  const db = systemDb();
  const rows = await db
    .select({
      id: researchSessions.id,
      funding: researchRuns.funding,
      bytes: sql<number | null>`octet_length(${researchSessions.transcript})`,
    })
    .from(researchSessions)
    .innerJoin(researchRuns, eq(researchRuns.id, researchSessions.runId))
    .where(
      and(
        eq(researchSessions.runId, runId),
        eq(researchRuns.tenantId, tenantId),
        eq(researchSessions.status, 'failed'),
      ),
    );
  if (rows.length === 0) return new Map();

  const toRead = rows.filter(
    (r) => signalsCache.get(r.id) === undefined && r.bytes !== null && r.bytes <= MAX_TRANSCRIPT_BYTES,
  );
  for (const r of rows) {
    if (signalsCache.get(r.id) !== undefined) continue;
    if (r.bytes === null) signalsCache.set(r.id, null);
    else if (r.bytes > MAX_TRANSCRIPT_BYTES) signalsCache.set(r.id, {});
  }
  if (toRead.length) {
    const transcripts = await db
      .select({ id: researchSessions.id, transcript: researchSessions.transcript })
      .from(researchSessions)
      .where(inArray(researchSessions.id, toRead.map((r) => r.id)));
    for (const t of transcripts) signalsCache.set(t.id, decodeSignals(t.transcript));
  }

  const ctx = contextFor(rows[0]!.funding);
  return new Map(
    rows.map((r) => {
      // null is a real answer (no transcript at all); only a miss — evicted meanwhile — reads as "nothing known".
      const signals = signalsCache.get(r.id);
      return [r.id, failureCause(signals === undefined ? {} : signals, ctx)];
    }),
  );
}

/** A stored transcript's signals; one that will not unzip or is too large unpacked tells nothing ({}). */
function decodeSignals(transcript: Buffer | null): TranscriptSignals | null {
  if (!transcript) return null;
  try {
    return transcriptSignals(gunzipSync(transcript, { maxOutputLength: MAX_TRANSCRIPT_TEXT }).toString('utf8'));
  } catch {
    return {};
  }
}
