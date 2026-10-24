import 'server-only';
import { createHash } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  deriveVizLevel,
  isFlagged,
  type DimensionData,
  type DimensionGap,
  type FindingPayload,
  type Indicator,
} from '@deep-fryer/core';
import {
  dimensions,
  dimensionVersions,
  findings,
  findingAudits,
  latestVersionsByDimension,
  researchRuns,
  researchSessions,
  type DbExecutor,
  type Dimension,
  type DimensionVersion,
  type Finding,
  type ResearchRun,
} from '@deep-fryer/db';
import { userDb } from './db';
import { runPhase, type RunPhase } from './run-progress';

/*
 * The private draft doughnut and bulk approval (staff only, editor and up):
 * what the portrait would look like if the latest research were approved and
 * published, and which of that research can be approved without a reviewer
 * opening each card.
 *
 * Both are built from the same pieces as the single approve in
 * lib/review-actions.ts: a dimension's findings from one run become a
 * version's data through researchVersionData (the one place that mapping
 * lives), and its status comes from core's deriveVizLevel on that data — the
 * value approving stores and publishing shows. Nothing here scores anything
 * of its own.
 *
 * Bulk approval keeps the review principle (pack-research
 * review-disposes-each-flag; scripts/research-verify.ts reads it the same
 * way): every flagged item is disposed of individually, so there is no bulk
 * approval while a run still has flags open, and a person checks a random
 * sample of the auto-passed findings before they are approved unseen.
 */

/**
 * A run's findings for one dimension as the version approving them creates
 * (SPEC.md §9): indicators and gaps from the findings, in the order they were
 * recorded, and the narrative fields — name, icon, description, context,
 * actions, spotlights — kept from `base`, the dimension's latest version. A
 * finding whose payload is neither kind (output that did not match the
 * schema, kept for review as it was) contributes nothing.
 */
export function researchVersionData(
  base: DimensionData | null | undefined,
  dimensionSlug: string,
  payloads: readonly FindingPayload[],
  includeNarrative = false,
): DimensionData {
  const indicators: Indicator[] = [];
  const gaps: DimensionGap[] = [];
  for (const p of payloads) {
    if (p.kind === 'indicator') {
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
    } else if (p.kind === 'gap') {
      gaps.push({
        indicator: p.indicator_slug,
        reason: p.reason,
        scales_tried: p.scales_tried,
        searched_at: p.searched_at,
      });
    }
  }
  const narratives = includeNarrative ? payloads.flatMap((payload) =>
    payload.kind === 'indicator' && payload.narrative_draft ? [payload.narrative_draft] : []) : [];
  const proposedActions = [...new Map(narratives.flatMap(narrative => narrative.actions)
    .map(action => [`${action.text}\n${action.source_url}`, action])).values()];
  return {
    name: base?.name ?? dimensionSlug,
    icon: base?.icon ?? '',
    description: base?.description ?? '',
    context: narratives.length ? [...new Set(narratives.map(narrative => narrative.context))].join('\n\n') : base?.context ?? '',
    indicators,
    gaps: gaps.length ? gaps : undefined,
    actions: narratives.length ? proposedActions.map(action => action.text) : base?.actions ?? [],
    ...(narratives.length ? { action_sources: proposedActions } : base?.action_sources ? { action_sources: base.action_sources } : {}),
    policy_spotlight: base?.policy_spotlight,
    justice_spotlight: base?.justice_spotlight,
  };
}

/** The parts of a finding these rules read. */
export type FindingLike = Pick<Finding, 'id' | 'payload' | 'verification'> & { auditBlocked?: boolean };

/**
 * Whether a finding needs a reviewer's eye, as the review card counts its
 * "N flagged" badge (components/admin/ReviewCard.tsx): every gap card, and
 * every finding a check red-flagged (core isFlagged — never dropped).
 */
export function findingFlagged(f: FindingLike): boolean {
  return f.auditBlocked === true || f.payload.kind === 'gap' || (f.verification !== null && isFlagged(f.verification));
}

/**
 * Whether a finding may be approved without a reviewer opening its card: a
 * sourced indicator that was verified and passed every check. A finding the
 * verifier never judged (no verification yet) is not "passed".
 */
export function findingApprovable(f: FindingLike): boolean {
  return !f.auditBlocked && f.payload.kind === 'indicator' && f.verification !== null && !isFlagged(f.verification);
}

/**
 * Why bulk approval cannot take a dimension that a person has not yet dealt
 * with — a flag still open, which blocks bulk approval of the whole run until
 * it is disposed of on its card:
 * - `flagged`: a gap card or a red-flagged finding (the card's badge);
 * - `unverified`: a finding the verifier has not judged;
 * - `session_incomplete`: the dimension's session did not complete (it
 *   failed, or never finished), so its findings may be partial.
 */
export type OpenReason = 'flagged' | 'unverified' | 'session_incomplete';

/**
 * How a dimension of the run has already been dealt with, so bulk approval
 * leaves it alone (the same dispositions research-verify counts):
 * - `approved`: a version was approved from this run's findings for it;
 * - `reviewed_by_hand`: a person made a version of it since the run began
 *   — flagged it as a data gap, or edited it;
 * - `superseded`: a later run researches it again (a re-research).
 */
export type Disposition = 'approved' | 'reviewed_by_hand' | 'superseded';

export const OPEN_REASON_TEXT: Record<OpenReason, string> = {
  flagged: 'has flagged findings or gap cards',
  unverified: 'has findings the verifier has not judged',
  session_incomplete: 'its research session did not complete',
};

/**
 * One dimension of a run, as bulk approval judges it. A run approves a
 * dimension as a whole (one version from all of the run's findings for it,
 * as the single approve does), so a dimension is approved only when every
 * one of its findings passes: approving the passing half and dropping the
 * rest would publish a wedge that looks better than the research says.
 */
export function bulkVerdict(input: {
  findings: readonly FindingLike[];
  /** Every session of this dimension in the run completed. */
  sessionsComplete: boolean;
  /** A version was already approved from this run's findings for it. */
  approved: boolean;
  /** A person made a version of it since the run began. */
  reviewedByHand: boolean;
  /** A later run researches it again. */
  superseded: boolean;
}): 'eligible' | Disposition | OpenReason {
  if (input.approved) return 'approved';
  if (input.reviewedByHand) return 'reviewed_by_hand';
  if (input.superseded) return 'superseded';
  if (!input.sessionsComplete) return 'session_incomplete';
  if (input.findings.some(findingFlagged)) return 'flagged';
  if (!input.findings.every(findingApprovable)) return 'unverified';
  return 'eligible';
}

/** How many auto-passed findings a person checks before bulk approval, as research-verify samples. */
export const SPOT_CHECK_SIZE = 3;

/**
 * A random sample of auto-passed findings for a person to check against
 * their sources (ISA 530 spirit: the checks' miss rate is measured only by
 * looking at what they passed). Seeded by the run id — sha256(run id + finding
 * id), lowest first, as scripts/research-verify.ts sampleIds draws its own —
 * so the page that shows the sample and the action that requires it agree
 * without storing anything, and nobody can pick which findings get checked.
 */
export function spotCheckSample(ids: readonly string[], runId: string, size = SPOT_CHECK_SIZE): string[] {
  return ids
    .map((id) => ({ id, score: createHash('sha256').update(runId + id).digest('hex') }))
    .sort((a, b) => a.score.localeCompare(b.score))
    .slice(0, size)
    .map((s) => s.id);
}

/** A run counts for review once it has settled — the runs the review queue offers. */
export const runSettled = (run: Pick<ResearchRun, 'status' | 'appliedAt'>): boolean => {
  const phase = runPhase(run);
  return phase === 'complete' || phase === 'failed';
};

/** What one run holds for a portrait's dimensions, read in one transaction. */
export interface RunResearch {
  run: ResearchRun;
  /** Sessions by dimension id (explicit columns: the app role cannot read transcripts). */
  sessionsByDim: Map<string, { id: string; status: string }[]>;
  /** The run's findings by dimension id, in the order they were recorded. */
  findingsByDim: Map<string, Finding[]>;
  /** The newest version approved from this run, by dimension id. */
  runVersionByDim: Map<string, DimensionVersion>;
  /** Dimensions a person made a version of since the run began. */
  reviewedByHand: Set<string>;
  /** Slugs of the dimensions a later run researches again. */
  supersededSlugs: Set<string>;
}

/**
 * Read a run's research for the given dimensions, on the caller's
 * transaction (a userDb one: the page's, or the bulk approval's — never a
 * second one inside it, lib/db.ts).
 */
export async function runResearch(db: DbExecutor, run: ResearchRun, dimensionIds: string[]): Promise<RunResearch> {
  const sessions = await db
    .select({ id: researchSessions.id, dimensionId: researchSessions.dimensionId, status: researchSessions.status })
    .from(researchSessions)
    .where(eq(researchSessions.runId, run.id));
  const sessionIds = sessions.map((s) => s.id);
  // "Since the run began" compares with the run's own created_at in the
  // database: the Date in hand is cut to milliseconds, and Postgres keeps
  // microseconds, so comparing with it would count the run as later than
  // itself (and a version made in the same millisecond before it as after).
  const runCreatedAt = sql`(SELECT r0.created_at FROM ${researchRuns} r0 WHERE r0.id = ${run.id}::uuid)`;
  const [runFindings, runVersions, byHand, later] = dimensionIds.length
    ? await Promise.all([
        sessionIds.length
          ? db
              .select()
              .from(findings)
              .where(and(inArray(findings.sessionId, sessionIds), inArray(findings.dimensionId, dimensionIds)))
              .orderBy(findings.createdAt, findings.id)
          : Promise.resolve([] as Finding[]),
        db
          .select()
          .from(dimensionVersions)
          .where(and(inArray(dimensionVersions.dimensionId, dimensionIds), eq(dimensionVersions.researchRunId, run.id)))
          .orderBy(desc(dimensionVersions.versionNum)),
        db
          .selectDistinct({ dimensionId: dimensionVersions.dimensionId })
          .from(dimensionVersions)
          .where(
            and(
              inArray(dimensionVersions.dimensionId, dimensionIds),
              eq(dimensionVersions.origin, 'human'),
              gt(dimensionVersions.createdAt, runCreatedAt),
            ),
          ),
        // The dimension slugs later runs plan — read inside the database, so
        // the plans' rendered prompts never leave it.
        db.execute<{ slug: string }>(sql`
          SELECT DISTINCT s->>'dimension_slug' AS slug
          FROM ${researchRuns} r, jsonb_array_elements(r.plan->'sessions') s
          WHERE r.tenant_id = ${run.tenantId}::uuid
            AND r.id <> ${run.id}::uuid
            AND r.created_at > ${runCreatedAt}
            AND s->>'kind' = 'dimension'`),
      ])
    : [[] as Finding[], [] as DimensionVersion[], [] as { dimensionId: string }[], [] as { slug: string }[]];

  const sessionsByDim = new Map<string, { id: string; status: string }[]>();
  for (const s of sessions) {
    if (!s.dimensionId) continue;
    sessionsByDim.set(s.dimensionId, [...(sessionsByDim.get(s.dimensionId) ?? []), { id: s.id, status: s.status }]);
  }
  const auditRows = runFindings.length ? await db.select({ findingId: findingAudits.findingId, disposition: findingAudits.disposition })
    .from(findingAudits).where(and(inArray(findingAudits.findingId, runFindings.map((f) => f.id)), isNull(findingAudits.appliedAt))) : [];
  const blocked = new Set(auditRows.filter((a) => a.disposition !== 'approve').map((a) => a.findingId));
  const findingsByDim = new Map<string, Finding[]>();
  for (const f of runFindings) findingsByDim.set(f.dimensionId, [...(findingsByDim.get(f.dimensionId) ?? []), { ...f, auditBlocked: blocked.has(f.id) } as Finding]);
  const runVersionByDim = new Map<string, DimensionVersion>();
  // Newest first: the first one seen per dimension is the one kept.
  for (const v of runVersions) if (!runVersionByDim.has(v.dimensionId)) runVersionByDim.set(v.dimensionId, v);
  return {
    run,
    sessionsByDim,
    findingsByDim,
    runVersionByDim,
    reviewedByHand: new Set(byHand.map((v) => v.dimensionId)),
    supersededSlugs: new Set([...later].map((r) => r.slug)),
  };
}

/** What "Approve all unflagged" would do to a run, worked out from its research. */
export interface BulkApprovalPlan {
  /** Dimensions it approves, in display order, each with every one of its findings in the run. */
  eligible: { dimension: Dimension; findings: Finding[] }[];
  /** How many findings that is, across those dimensions. */
  findingCount: number;
  /** Dimensions with flags still open: while there are any, nothing is approved in bulk. */
  open: { dimension: Dimension; reason: OpenReason }[];
  /** Dimensions already dealt with, which bulk approval leaves alone. */
  disposed: Record<Disposition, number>;
  /** The auto-passed findings a person checks first, from those it approves (spotCheckSample). */
  sample: Finding[];
}

/**
 * Pure over a run's research: which of `dims` (the portrait's live
 * dimensions, in display order) bulk approval would approve, which flags are
 * still open, and the spot-check sample. A dimension the run has no findings
 * for is not part of it at all.
 */
export function bulkApprovalPlan(dims: readonly Dimension[], research: RunResearch): BulkApprovalPlan {
  const plan: BulkApprovalPlan = {
    eligible: [],
    findingCount: 0,
    open: [],
    disposed: { approved: 0, reviewed_by_hand: 0, superseded: 0 },
    sample: [],
  };
  for (const dimension of dims) {
    const dimFindings = research.findingsByDim.get(dimension.id) ?? [];
    if (dimFindings.length === 0) continue;
    const sessions = research.sessionsByDim.get(dimension.id) ?? [];
    const verdict = bulkVerdict({
      findings: dimFindings,
      sessionsComplete: sessions.length > 0 && sessions.every((s) => s.status === 'complete'),
      approved: research.runVersionByDim.has(dimension.id),
      reviewedByHand: research.reviewedByHand.has(dimension.id),
      superseded: research.supersededSlugs.has(dimension.slug),
    });
    if (verdict === 'eligible') {
      plan.eligible.push({ dimension, findings: dimFindings });
      plan.findingCount += dimFindings.length;
    } else if (verdict === 'approved' || verdict === 'reviewed_by_hand' || verdict === 'superseded') {
      plan.disposed[verdict] += 1;
    } else {
      plan.open.push({ dimension, reason: verdict });
    }
  }
  const passed = plan.eligible.flatMap((e) => e.findings);
  const sampled = new Set(spotCheckSample(passed.map((f) => f.id), research.run.id));
  plan.sample = passed.filter((f) => sampled.has(f.id));
  return plan;
}

/** The portrait's live dimensions (archived ones are not on the doughnut), in display order. */
export async function liveDimensions(db: DbExecutor, tenantId: string): Promise<Dimension[]> {
  return db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.tenantId, tenantId), isNull(dimensions.archivedAt)))
    .orderBy(dimensions.displayOrder);
}

/**
 * Where a draft wedge comes from:
 * - `research`: this run's findings, not yet approved — shown as approving
 *   them would make the version;
 * - `approved`: approved from this run as a draft version, not yet published;
 * - `published`: the published version, because this run has nothing newer
 *   for the dimension (no findings, or its findings were approved and that
 *   version is, or was, the published one);
 * - `none`: nothing researched in this run and nothing published.
 */
export type DraftSource = 'research' | 'approved' | 'published' | 'none';

export interface DraftDimension {
  dimensionId: string;
  slug: string;
  ring: Dimension['ring'];
  displayOrder: number;
  name: string;
  data: DimensionData | null;
  /** The wedge's level on the doughnut's -100…150 scale; null draws it grey (no data). */
  vizLevel: number | null;
  source: DraftSource;
  /** The version shown, for `approved` and `published`. */
  versionNum: number | null;
  /** This run's findings for the dimension, and how many of them need a reviewer's eye. */
  findings: number;
  flagged: number;
  /** Planned in this run and still being researched (the run is queued or running). */
  pending: boolean;
}

/**
 * Pure: one dimension's draft wedge. `findings` are the run's findings for it
 * from sessions that have finished — while a run is in progress a session
 * records its findings one by one, so a running session's would show a
 * wedge that changes as each lands.
 */
export function draftDimension(input: {
  dimension: Pick<Dimension, 'id' | 'slug' | 'ring' | 'displayOrder' | 'publishedVersionId'>;
  latest: DimensionVersion | null;
  published: DimensionVersion | null;
  runVersion: DimensionVersion | null;
  findings: readonly FindingLike[];
  pending: boolean;
}): DraftDimension {
  const { dimension, latest, published, runVersion } = input;
  const base = {
    dimensionId: dimension.id,
    slug: dimension.slug,
    ring: dimension.ring,
    displayOrder: dimension.displayOrder,
    findings: input.findings.length,
    flagged: input.findings.filter(findingFlagged).length,
    pending: input.pending,
  };
  const fromVersion = (v: DimensionVersion, source: DraftSource): DraftDimension => ({
    ...base,
    name: v.data.name || dimension.slug,
    data: v.data,
    vizLevel: v.vizLevel,
    source,
    versionNum: v.versionNum,
  });

  if (input.findings.length > 0) {
    // Approved from this run and still a draft: that version is what
    // publishing will show. One that was published (and perhaps replaced
    // since) is not draft research any more.
    if (runVersion && runVersion.status === 'draft') return fromVersion(runVersion, 'approved');
    if (!runVersion) {
      const data = researchVersionData(
        latest?.data,
        dimension.slug,
        input.findings.map((f) => f.payload),
      );
      return { ...base, name: data.name || dimension.slug, data, vizLevel: deriveVizLevel(data), source: 'research', versionNum: null };
    }
  }
  if (published) return fromVersion(published, 'published');
  return {
    ...base,
    name: latest?.data.name || dimension.slug,
    data: null,
    vizLevel: null,
    source: 'none',
    versionNum: null,
  };
}

/** A run the draft can be built from, as the picker lists it. */
export type DraftRunSummary = Pick<ResearchRun, 'id' | 'status' | 'appliedAt' | 'createdAt'>;

export interface DraftPortraitData {
  /** Applied runs, newest first: the draft can be built from any of them. */
  runs: DraftRunSummary[];
  run: ResearchRun | null;
  phase: RunPhase | null;
  /** Every live dimension, in display order. */
  dimensions: DraftDimension[];
  /** What "Approve all unflagged" would do — only for a settled run (the ones the review queue offers). */
  bulk: BulkApprovalPlan | null;
}

/**
 * The draft doughnut's data (SPEC.md §9, staff only): the portrait as the
 * chosen run's research would make it — by default the latest applied run,
 * which may still be in progress — with every dimension the run has not
 * produced shown as published. One userDb transaction: row-level security
 * lets members read drafts, runs and findings, and the page has already
 * required the editor role.
 */
export async function draftPortrait(tenantId: string, runId?: string): Promise<DraftPortraitData> {
  return userDb(async (db) => {
    const runs = await db
      .select({
        id: researchRuns.id,
        status: researchRuns.status,
        appliedAt: researchRuns.appliedAt,
        createdAt: researchRuns.createdAt,
      })
      .from(researchRuns)
      .where(and(eq(researchRuns.tenantId, tenantId), isNotNull(researchRuns.appliedAt)))
      .orderBy(desc(researchRuns.createdAt));
    const chosen = (runId ? runs.find((r) => r.id === runId) : runs[0]) ?? runs[0] ?? null;
    const [run] = chosen ? await db.select().from(researchRuns).where(eq(researchRuns.id, chosen.id)) : [];

    const dims = await liveDimensions(db, tenantId);
    const dimIds = dims.map((d) => d.id);
    const publishedIds = dims.flatMap((d) => (d.publishedVersionId ? [d.publishedVersionId] : []));
    const [latestByDim, publishedRows, research] = await Promise.all([
      latestVersionsByDimension(db, dimIds),
      publishedIds.length
        ? db.select().from(dimensionVersions).where(inArray(dimensionVersions.id, publishedIds))
        : Promise.resolve([] as DimensionVersion[]),
      run ? runResearch(db, run, dimIds) : Promise.resolve(null),
    ]);
    const publishedById = new Map(publishedRows.map((v) => [v.id, v]));

    const phase = run ? runPhase(run) : null;
    const settled = run ? runSettled(run) : false;
    const planned = new Set(
      (run?.plan.sessions ?? []).flatMap((s) => (s.kind === 'dimension' && s.dimension_slug ? [s.dimension_slug] : [])),
    );

    const draft = dims.map((dimension) => {
      const sessions = research?.sessionsByDim.get(dimension.id) ?? [];
      // A settled run's sessions have all stopped, whatever their status says
      // (one left "running" by a worker that died is failed, lib/run-progress.ts).
      const finished = sessions.filter((s) => settled || s.status === 'complete' || s.status === 'failed');
      const finishedIds = new Set(finished.map((s) => s.id));
      const dimFindings = (research?.findingsByDim.get(dimension.id) ?? []).filter((f) => finishedIds.has(f.sessionId));
      return draftDimension({
        dimension,
        latest: latestByDim.get(dimension.id) ?? null,
        published: dimension.publishedVersionId ? (publishedById.get(dimension.publishedVersionId) ?? null) : null,
        runVersion: research?.runVersionByDim.get(dimension.id) ?? null,
        findings: dimFindings,
        pending: !settled && planned.has(dimension.slug) && finished.length === 0,
      });
    });

    return {
      runs,
      run: run ?? null,
      phase,
      dimensions: draft,
      bulk: run && research && settled ? bulkApprovalPlan(dims, research) : null,
    };
  });
}

/**
 * Where a draft wedge (and its row) leads. A dimension this run researched
 * opens its review card once the run has settled — the review queue offers
 * settled runs only — and the run page until then; any other dimension opens
 * its own page, where its published version and history are.
 */
export function draftHref(
  tenantSlug: string,
  d: Pick<DraftDimension, 'dimensionId' | 'findings'>,
  run: { id: string; settled: boolean } | null,
): string {
  if (run && d.findings > 0) {
    return run.settled
      ? `/${tenantSlug}/admin/review?run=${run.id}#review-${d.dimensionId}`
      : `/${tenantSlug}/admin/research/${run.id}`;
  }
  return `/${tenantSlug}/admin/dim/${d.dimensionId}`;
}

/** Where a draft wedge's data comes from, in words, for its row in the list. */
export function draftNote(
  d: Pick<DraftDimension, 'source' | 'versionNum' | 'findings' | 'flagged' | 'pending'>,
  settled: boolean,
): string {
  const flagged = d.flagged > 0 ? ` · ${d.flagged} flagged` : '';
  switch (d.source) {
    case 'research':
      return `From this run, not yet approved${flagged}${settled ? '' : ' · review opens when the run finishes'}`;
    case 'approved':
      return `Approved as draft v${d.versionNum}, not yet published${flagged}`;
    case 'published':
      if (d.pending) return `Being researched now · showing published v${d.versionNum}`;
      return d.findings > 0
        ? `Published v${d.versionNum} · this run's findings were already approved and published`
        : `Published v${d.versionNum} · this run has nothing for it`;
    case 'none':
      return d.pending ? 'Being researched now · nothing published yet' : 'No data · nothing from this run, nothing published';
  }
}
