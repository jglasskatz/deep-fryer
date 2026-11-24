'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import {
  assignIndicatorKeys,
  deriveVizLevel,
  frameworkIndicatorKeys,
  isIndicatorKey,
  isResearchStrategy,
  checkReviewCause,
  reviewLabelRows,
  WHOLE_DIMENSION_GAP,
  type DimensionData,
  type FindingPayload,
  type Indicator,
  type ResearchStrategy,
  type ReviewLabelInput,
} from '@deep-fryer/core';
import {
  appendDimensionVersion,
  dimensions,
  findings,
  type DbExecutor,
  type Dimension,
  type DimensionVersion,
  type Finding,
  type ResearchRun,
  latestVersion,
  researchRuns,
  researchSessions,
  reviewLabels,
} from '@deep-fryer/db';
import { getAuth, requireTenantRole } from './auth';
import { audit } from './audit';
import {
  approvalFindings,
  bulkApprovalPlan,
  isStandIn,
  liveDimensions,
  researchVersionData,
  runResearch,
  runSettled,
  STAND_INS_ONLY_TEXT,
} from './draft-portrait';
import { publishVersionFor } from './publish';
import { createPlannedRunIn } from './research';
import { action, UserError } from './action-result';
import { userDb } from './db';
import { configValueIn } from './admin-data';

async function dimensionInTenantOrThrow(db: DbExecutor, tenantId: string, dimensionId: string) {
  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.id, dimensionId), eq(dimensions.tenantId, tenantId)));
  if (!dimension) throw new UserError('Unknown dimension.');
  return dimension;
}

/** What a review decision says when its run is not one of this portrait's. */
const RUN_NOT_HERE = 'That research run is not part of this portrait. Reload the page and try again. Nothing was saved.';

/** A run of this portrait, as the review card names it, or a plain refusal. */
async function reviewRunOrThrow(db: DbExecutor, tenantId: string, runId: unknown): Promise<ResearchRun> {
  if (typeof runId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
    throw new UserError(RUN_NOT_HERE);
  }
  const [run] = await db.select().from(researchRuns).where(and(eq(researchRuns.id, runId), eq(researchRuns.tenantId, tenantId)));
  if (!run) throw new UserError(RUN_NOT_HERE);
  return run;
}

/** One dimension's findings from one run, in the order they were recorded. */
async function runDimensionFindings(db: DbExecutor, runId: string, dimensionId: string): Promise<Finding[]> {
  const rows = await db
    .select({ finding: findings })
    .from(findings)
    .innerJoin(researchSessions, eq(findings.sessionId, researchSessions.id))
    .where(and(eq(researchSessions.runId, runId), eq(findings.dimensionId, dimensionId)))
    .orderBy(findings.createdAt, findings.id);
  return rows.map((r) => r.finding);
}

/**
 * Record one decision and its cause for each finding it covers
 * (review_labels), on the decision's own transaction, as the signed-in
 * reviewer.
 */
async function recordReviewLabels(db: DbExecutor, input: Omit<ReviewLabelInput, 'reviewerId'>): Promise<void> {
  const { userId } = await getAuth();
  if (!userId) throw new UserError('Sign in to review findings.');
  await db.insert(reviewLabels).values(reviewLabelRows({ ...input, reviewerId: userId }));
}

/**
 * Advisory-lock namespace (the first key of pg_advisory_xact_lock(int, int))
 * that serializes approvals of one run's findings — the single approve and
 * "Approve all unflagged" — so bulk approval's "not yet approved from this
 * run" check and its inserts are atomic: without it, two reviewers (or a
 * double click) approving at once would each find the dimension unapproved
 * and each add a version. The second key hashes the run id; a collision only
 * makes two runs' approvals wait for each other briefly. Distinct from the
 * other namespaces (lib/involvement-actions.ts 61_001 and 61_002,
 * lib/translation-requests.ts 61_003, packages/db sign-in-requests.ts 61_004).
 */
const LOCK_RUN_APPROVAL = 61_005;

async function lockRunApprovals(db: DbExecutor, runId: string): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_RUN_APPROVAL}::int, hashtext(${runId}))`);
}

/**
 * One dimension's findings from one run as a new draft version with origin
 * 'research' (lib/draft-portrait.ts researchVersionData: indicators and gaps
 * from the findings, narrative kept from the latest version), its status
 * derived by the core engine. Shared by the single approve and bulk
 * approval, on the caller's userDb transaction.
 */
async function appendResearchVersion(
  db: DbExecutor,
  dimension: Dimension,
  runId: string,
  payloads: FindingPayload[],
  includeNarrative = false,
): Promise<{ version: DimensionVersion; data: DimensionData }> {
  const base = await latestVersion(db, dimension.id);
  const data = researchVersionData(base?.data, dimension.slug, payloads, includeNarrative);
  const auth = await getAuth();
  const version = await appendDimensionVersion(db, {
    dimensionId: dimension.id,
    status: 'draft',
    data,
    vizLevel: deriveVizLevel(data),
    origin: 'research',
    researchRunId: runId,
    createdBy: auth.userId,
  });
  return { version, data };
}

/**
 * Approve (SPEC.md §9): materialize the run's findings for one dimension as
 * a draft version with origin 'research', preserving the narrative fields
 * from the current version. Publish is a separate act (default review policy
 * gates everything on a human decision) — pass `publish: true` for
 * approve-and-publish in one step.
 *
 * Stand-ins among the run's findings are left waiting: each is accepted or
 * rejected on its own, never by approving the dimension. A dimension whose
 * findings in the run are all stand-ins is refused, approving nothing.
 *
 * Each finding approved is recorded as "correct as cited" (review_labels).
 */
export const approveFindings = action(async (input: {
  tenantSlug: string;
  runId: string;
  dimensionId: string;
  publish?: boolean;
  includeNarrative?: boolean;
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  return userDb(async (db) => {
    await lockRunApprovals(db, input.runId);
    const [run] = await db.select().from(researchRuns).where(and(eq(researchRuns.id, input.runId), eq(researchRuns.tenantId, tenant.id)));
    if (!run || !runSettled(run)) throw new UserError('Only a finished run in this portrait can be reviewed.');
    const dimension = await dimensionInTenantOrThrow(db, tenant.id, input.dimensionId);

    // In the order they were recorded, as the draft doughnut reads them: the
    // first indicator is the wedge's headline.
    const recorded = await runDimensionFindings(db, input.runId, input.dimensionId);
    if (recorded.length === 0) throw new UserError('No findings for this dimension in this run.');
    const runFindings = recorded.filter((finding) => !isStandIn(finding));
    if (runFindings.length === 0) throw new UserError(STAND_INS_ONLY_TEXT);
    if (input.includeNarrative && runFindings.some((finding) => finding.payload.kind === 'indicator' && finding.payload.narrative_draft && finding.verification?.narrative_supported !== 'pass')) {
      throw new UserError('The drafted narrative and actions need source verification before inclusion. Edit them manually or request research.');
    }

    const { version, data } = await appendResearchVersion(
      db,
      dimension,
      input.runId,
      runFindings.map((finding) => finding.payload),
      input.includeNarrative ?? false,
    );
    await recordReviewLabels(db, {
      tenantId: tenant.id,
      dimensionId: dimension.id,
      run,
      findingIds: runFindings.map((finding) => finding.id),
      decision: 'approve',
    });

    await audit(
      tenant.id,
      'dimension_version',
      version.id,
      'approve_findings',
      null,
      {
        dimension: dimension.slug,
        run_id: input.runId,
        indicators: data.indicators.length,
        gaps: data.gaps?.length ?? 0,
      },
      db,
    );

    if (input.publish) {
      await publishVersionFor(db, tenant, version.id);
    }

    revalidatePath(`/${input.tenantSlug}/admin/review`);
    revalidatePath(`/${input.tenantSlug}/admin/draft`);
    revalidatePath(`/${input.tenantSlug}/admin`);
    return { versionId: version.id, versionNum: version.versionNum };
  });
});

/**
 * Approve all unflagged (the draft doughnut's bulk action): for one settled
 * run, approve as drafts — exactly as the single approve does, never
 * publishing — every dimension whose findings all passed: each a sourced
 * indicator the verifier judged with no check failing, from a session that
 * completed, on a dimension nobody has dealt with yet (lib/draft-portrait.ts
 * bulkApprovalPlan).
 *
 * It keeps the review principle (review-disposes-each-flag): every flagged
 * item is disposed of individually, so while any dimension of the run still
 * has a flag open it approves nothing; and `spotChecked` must include every
 * finding of the random sample of those it approves that the confirmation
 * asked the person to check against their sources (spotCheckSample) — their
 * audit entries say so. `expectedFindings` is the count the confirmation
 * stated: it never approves more than the person agreed to (it can only be
 * fewer — someone approved some meanwhile). With nothing left to approve it
 * succeeds, approving nothing.
 *
 * One transaction under the run's approval lock, so it is all or nothing and
 * running it again approves nothing twice. One audit entry per finding
 * approved, naming the version it went into, and one review label recording
 * it as "correct as cited".
 */
export const approveUnflaggedFindings = action(async (input: {
  tenantSlug: string;
  runId: string;
  expectedFindings: number;
  spotChecked: string[];
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  return userDb(async (db) => {
    await lockRunApprovals(db, input.runId);
    const [run] = await db
      .select()
      .from(researchRuns)
      .where(and(eq(researchRuns.id, input.runId), eq(researchRuns.tenantId, tenant.id)));
    if (!run) throw new UserError('Unknown research run.');
    if (!runSettled(run)) {
      throw new UserError("This run hasn't finished yet. Approve its findings once it has — nothing was approved.");
    }

    const dims = await liveDimensions(db, tenant.id);
    const plan = bulkApprovalPlan(dims, await runResearch(db, run, dims.map((d) => d.id)));
    if (plan.open.length > 0) {
      throw new UserError(
        `${plan.open.length === 1 ? '1 dimension' : `${plan.open.length} dimensions`} of this run still ${plan.open.length === 1 ? 'has' : 'have'} flagged findings to review one by one. Review ${plan.open.length === 1 ? 'it' : 'them'} on ${plan.open.length === 1 ? 'its card' : 'their cards'} first — nothing was approved.`,
      );
    }
    // Nothing left (approved meanwhile, or a second click): nothing to check, nothing to do.
    if (plan.findingCount === 0) return { findings: 0, versions: [] };
    if (plan.findingCount > input.expectedFindings) {
      throw new UserError(
        'More findings are ready to approve than this page showed. Reload it and confirm again — nothing was approved.',
      );
    }
    // Every finding of the sample drawn now must be one the person checked:
    // when someone approved part of the run meanwhile, the draw can change,
    // and a finding nobody looked at is never passed off as spot-checked.
    const checked = new Set(input.spotChecked);
    if (!plan.sample.every((f) => checked.has(f.id))) {
      throw new UserError(
        'The findings to spot-check have changed since this page loaded. Reload it and check the new sample — nothing was approved.',
      );
    }
    const sample = new Set(plan.sample.map((f) => f.id));

    const versions: { dimension: string; versionNum: number }[] = [];
    for (const { dimension, findings: dimFindings } of plan.eligible) {
      const { version } = await appendResearchVersion(
        db,
        dimension,
        run.id,
        dimFindings.map((f) => f.payload),
      );
      versions.push({ dimension: dimension.slug, versionNum: version.versionNum });
      await recordReviewLabels(db, {
        tenantId: tenant.id,
        dimensionId: dimension.id,
        run,
        findingIds: dimFindings.map((f) => f.id),
        decision: 'approve',
      });
      for (const finding of dimFindings) {
        await audit(
          tenant.id,
          'finding',
          finding.id,
          'approve_finding',
          null,
          {
            dimension: dimension.slug,
            indicator: finding.indicatorSlug,
            run_id: run.id,
            version_id: version.id,
            version_num: version.versionNum,
            bulk: true,
            spot_checked: sample.has(finding.id),
          },
          db,
        );
      }
    }

    revalidatePath(`/${input.tenantSlug}/admin/review`);
    revalidatePath(`/${input.tenantSlug}/admin/draft`);
    revalidatePath(`/${input.tenantSlug}/admin`);
    return { findings: plan.findingCount, versions };
  });
});

/** Whether any research finding for this dimension named the indicator `key`. */
async function researchNamed(db: DbExecutor, dimensionId: string, key: string): Promise<boolean> {
  const [row] = await db
    .select({ id: findings.id })
    .from(findings)
    .where(and(eq(findings.dimensionId, dimensionId), eq(findings.indicatorSlug, key)))
    .limit(1);
  return row !== undefined;
}

/**
 * Re-research (SPEC.md §8 Rerun): user-directed, reviewer notes injected
 * verbatim. Plans only — the reviewer inspects the plan and applies it (the
 * quota-checked step) from the run page.
 *
 * It needs a cause: why the run's findings for this dimension are not good
 * enough (core review-causes.ts). The plan and one review label per finding
 * of the reviewed run, all with that cause and the notes, are written on one
 * transaction; without a cause nothing is planned.
 */
export const reResearchDimension = action(async (input: {
  tenantSlug: string;
  /** The run whose findings the reviewer is sending back. */
  runId: string;
  dimensionId: string;
  notes: string;
  cause: string;
  /** Research strategy for the new run (`hybrid`, `standard`, or `deep`). */
  strategy?: ResearchStrategy;
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  if (input.strategy !== undefined && !isResearchStrategy(input.strategy)) {
    throw new UserError('Choose the standard, hybrid, or deep research strategy.');
  }
  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 4000) : '';
  const why = checkReviewCause(input.cause, notes);
  if (!why.ok) throw new UserError(`${why.problem} Nothing was planned.`);
  return userDb(async (db) => {
    const reviewed = await reviewRunOrThrow(db, tenant.id, input.runId);
    const dimension = await dimensionInTenantOrThrow(db, tenant.id, input.dimensionId);
    const auth = await getAuth();
    const { run } = await createPlannedRunIn(db, {
      tenantId: tenant.id,
      dimensionIds: [dimension.id],
      reviewerNotes: { [dimension.id]: notes },
      requestedBy: auth.userId,
      strategy: input.strategy,
    });
    await recordReviewLabels(db, {
      tenantId: tenant.id,
      dimensionId: dimension.id,
      run: reviewed,
      findingIds: approvalFindings(await runDimensionFindings(db, reviewed.id, dimension.id)).map((f) => f.id),
      decision: 're_research',
      cause: why.cause,
      note: notes,
    });
    revalidatePath(`/${input.tenantSlug}/admin/research`);
    return { runId: run.id };
  });
});

/** What flagGap says when the key it is given names no indicator of the dimension. */
const NOT_IN_DIMENSION = 'That indicator is not part of this dimension. Reload the page and choose again. Nothing was saved.';

/**
 * Flag gap (SPEC.md §9): record that one indicator has no acceptable data,
 * as a new draft version. Only the row with that key (core
 * assignIndicatorKeys) is cleared — its value and score — and the gap,
 * naming the key, carries the reviewer's reason, which the public sees on
 * the gray wedge once the draft is published. WHOLE_DIMENSION_GAP clears
 * every indicator of the dimension instead.
 *
 * The key must be one the dimension knows: a row of its latest version, a
 * gap it already records, or an indicator research reported for it (a gap
 * card names one the version may not have yet; its gap is recorded with
 * nothing to clear). Any other key is refused. A gap already recorded for
 * the same key is replaced, so flagging again updates the reason rather than
 * listing the gap twice.
 *
 * Nothing is published here: the draft is published like any other
 * reviewed draft, where a required second reviewer still applies.
 *
 * Flagging a gap rejects what the reviewed run found for that indicator (or
 * for the whole dimension), so it needs a cause, recorded with the reason as
 * one review label per finding it rejects, on the same transaction.
 */
export const flagGap = action(async (input: {
  tenantSlug: string;
  /** The run whose findings the reviewer is rejecting. */
  runId: string;
  dimensionId: string;
  /** The indicator's key, or WHOLE_DIMENSION_GAP. */
  indicator: string;
  reason: string;
  cause: string;
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  // A call from the page always sends a key and a reason as text; anything
  // else gets the same plain refusal as an unknown key, before any lookup.
  const key: unknown = input.indicator;
  if (!isIndicatorKey(key) && key !== WHOLE_DIMENSION_GAP) throw new UserError(NOT_IN_DIMENSION);
  return userDb(async (db) => {
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!reason) throw new UserError('A reason is required to flag a data gap.');
    const why = checkReviewCause(input.cause, reason);
    if (!why.ok) throw new UserError(`${why.problem} Nothing was saved.`);

    const reviewed = await reviewRunOrThrow(db, tenant.id, input.runId);
    const dimension = await dimensionInTenantOrThrow(db, tenant.id, input.dimensionId);

    const base = await latestVersion(db, dimension.id);
    if (!base) throw new UserError('This dimension has no versions yet.');

    const indicators = assignIndicatorKeys(
      base.data.indicators,
      [],
      frameworkIndicatorKeys(dimension.slug, dimension.canonicalSlug),
    );
    const whole = key === WHOLE_DIMENSION_GAP;
    const target = whole ? undefined : indicators.find((ind) => ind.key === key);
    const known =
      whole ||
      target !== undefined ||
      (base.data.gaps ?? []).some((gap) => gap.indicator === key) ||
      (await researchNamed(db, dimension.id, key));
    if (!known) {
      throw new UserError(NOT_IN_DIMENSION);
    }

    const cleared = (ind: Indicator): Indicator => ({ ...ind, value: null, level_pct: undefined, scoring: undefined });
    const data: DimensionData = {
      ...base.data,
      indicators: indicators.map((ind) => (whole || ind.key === key ? cleared(ind) : ind)),
      gaps: [
        ...(base.data.gaps ?? []).filter((gap) => gap.indicator !== key),
        { indicator: key, reason, scales_tried: [], searched_at: new Date().toISOString() },
      ],
    };

    const label = whole ? 'every indicator' : `"${target?.name ?? key}"`;
    const auth = await getAuth();
    const version = await appendDimensionVersion(db, {
      dimensionId: dimension.id,
      status: 'draft',
      data,
      vizLevel: deriveVizLevel(data),
      origin: 'human',
      changeNote: `Flagged ${label} as a data gap: ${reason}`,
      createdBy: auth.userId,
    });

    await audit(
      tenant.id,
      'dimension_version',
      version.id,
      'flag_gap',
      null,
      { dimension: dimension.slug, indicator: key, reason },
      db,
    );
    const rejected = approvalFindings(await runDimensionFindings(db, reviewed.id, dimension.id))
      .filter((f) => whole || f.indicatorSlug === key);
    await recordReviewLabels(db, {
      tenantId: tenant.id,
      dimensionId: dimension.id,
      run: reviewed,
      findingIds: rejected.map((f) => f.id),
      decision: 'reject',
      cause: why.cause,
      note: reason,
    });

    const requiresSecondReview = (await configValueIn(db, tenant.id, 'review_policy'))?.dual_review_on_edits === true;
    revalidatePath(`/${input.tenantSlug}/admin/review`);
    revalidatePath(`/${input.tenantSlug}/admin/draft`);
    revalidatePath(`/${input.tenantSlug}/admin`);
    return { versionId: version.id, versionNum: version.versionNum, requiresSecondReview };
  });
});
