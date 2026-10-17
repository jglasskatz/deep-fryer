'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { deriveVizLevel, type DimensionData, type FindingPayload } from '@deep-fryer/core';
import {
  appendDimensionVersion,
  dimensions,
  findings,
  type DbExecutor,
  type Dimension,
  type DimensionVersion,
  latestVersion,
  researchRuns,
  researchSessions,
} from '@deep-fryer/db';
import { getAuth, requireTenantRole } from './auth';
import { audit } from './audit';
import {
  bulkApprovalPlan,
  liveDimensions,
  researchVersionData,
  runResearch,
  runSettled,
} from './draft-portrait';
import { publishVersionFor } from './publish';
import { createPlannedRun } from './research';
import { action, UserError } from './action-result';
import { userDb } from './db';

async function dimensionInTenantOrThrow(db: DbExecutor, tenantId: string, dimensionId: string) {
  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.id, dimensionId), eq(dimensions.tenantId, tenantId)));
  if (!dimension) throw new UserError('Unknown dimension.');
  return dimension;
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
): Promise<{ version: DimensionVersion; data: DimensionData }> {
  const base = await latestVersion(db, dimension.id);
  const data = researchVersionData(base?.data, dimension.slug, payloads);
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
 */
export const approveFindings = action(async (input: {
  tenantSlug: string;
  runId: string;
  dimensionId: string;
  publish?: boolean;
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  return userDb(async (db) => {
    await lockRunApprovals(db, input.runId);
    const dimension = await dimensionInTenantOrThrow(db, tenant.id, input.dimensionId);

    // In the order they were recorded, as the draft doughnut reads them: the
    // first indicator is the wedge's headline.
    const runFindings = await db
      .select({ finding: findings })
      .from(findings)
      .innerJoin(researchSessions, eq(findings.sessionId, researchSessions.id))
      .where(
        and(eq(researchSessions.runId, input.runId), eq(findings.dimensionId, input.dimensionId)),
      )
      .orderBy(findings.createdAt, findings.id);
    if (runFindings.length === 0) throw new UserError('No findings for this dimension in this run.');

    const { version, data } = await appendResearchVersion(
      db,
      dimension,
      input.runId,
      runFindings.map(({ finding }) => finding.payload),
    );

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
 * approved, naming the version it went into.
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

/**
 * Re-research (SPEC.md §8 Rerun): user-directed, reviewer notes injected
 * verbatim. Plans only — the reviewer inspects the plan and applies it (the
 * quota-checked step) from the run page.
 */
export const reResearchDimension = action(async (input: {
  tenantSlug: string;
  dimensionId: string;
  notes: string;
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const dimension = await userDb((db) => dimensionInTenantOrThrow(db, tenant.id, input.dimensionId));
  const auth = await getAuth();
  const { run } = await createPlannedRun({
    tenantId: tenant.id,
    dimensionIds: [dimension.id],
    reviewerNotes: { [dimension.id]: input.notes.trim().slice(0, 4000) },
    requestedBy: auth.userId,
  });
  revalidatePath(`/${input.tenantSlug}/admin/research`);
  return { runId: run.id };
});

/**
 * Flag gap (SPEC.md §9): publish an honest data-gap wedge — gray, not
 * hidden. Values are cleared, the gap is recorded with the reviewer's
 * reason, and the wedge renders as unknown.
 */
export const flagGap = action(async (input: {
  tenantSlug: string;
  dimensionId: string;
  indicator: string;
  reason: string;
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  return userDb(async (db) => {
    const reason = input.reason.trim();
    if (!reason) throw new UserError('A reason is required to flag a data gap.');

    const dimension = await dimensionInTenantOrThrow(db, tenant.id, input.dimensionId);

    const base = await latestVersion(db, dimension.id);
    if (!base) throw new UserError('This dimension has no versions yet.');

    const data: DimensionData = {
      ...base.data,
      indicators: base.data.indicators.map((ind) => ({
        ...ind,
        value: null,
        level_pct: undefined,
        scoring: undefined,
      })),
      gaps: [
        ...(base.data.gaps ?? []),
        {
          indicator: input.indicator,
          reason,
          scales_tried: [],
          searched_at: new Date().toISOString(),
        },
      ],
    };

    const auth = await getAuth();
    const version = await appendDimensionVersion(db, {
      dimensionId: dimension.id,
      status: 'draft',
      data,
      vizLevel: null,
      origin: 'human',
      changeNote: `Flagged as data gap: ${reason}`,
      createdBy: auth.userId,
    });

    await audit(
      tenant.id,
      'dimension_version',
      version.id,
      'flag_gap',
      null,
      { dimension: dimension.slug, reason },
      db,
    );

    await publishVersionFor(db, tenant, version.id);
    revalidatePath(`/${input.tenantSlug}/admin/review`);
    revalidatePath(`/${input.tenantSlug}/admin/draft`);
    return { versionId: version.id };
  });
});
