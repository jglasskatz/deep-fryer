'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import {
  currentDispositions,
  deriveVizLevel,
  partitionForApproval,
  renderAnnotationsForRerun,
  type DimensionData,
  type DimensionGap,
  type Indicator,
} from '@deep-fryer/core';
import {
  appendDimensionVersion,
  dimensions,
  findings,
  getDb,
  latestVersion,
  researchSessions,
  reviewNotes,
} from '@deep-fryer/db';
import { getAuth, requireTenantRole } from './auth';
import { audit } from './audit';
import { publishVersion } from './actions';
import { planResearchAction } from './research-actions';

async function dimensionInTenantOrThrow(tenantId: string, dimensionId: string) {
  const db = getDb();
  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.id, dimensionId), eq(dimensions.tenantId, tenantId)));
  if (!dimension) throw new Error('unknown dimension');
  return dimension;
}

/**
 * Approve (SPEC.md §9): materialize the run's verified findings for one
 * dimension as a draft version with origin 'research', preserving the
 * narrative fields from the current version. Publish is a separate act
 * (default review policy gates everything on a human decision) — pass
 * `publish: true` for approve-and-publish in one step.
 *
 * Strict gate (review-disposes-each-flag): every flagged finding needs an
 * individual disposition before this dimension can materialize — a reviewer
 * overrides the verifier by dispositioning a failed finding as 'verified',
 * with their note as the record. Rejected findings never materialize;
 * needs_rework blocks the dimension outright.
 */
export async function approveFindings(input: {
  tenantSlug: string;
  runId: string;
  dimensionId: string;
  publish?: boolean;
}) {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const db = getDb();
  const dimension = await dimensionInTenantOrThrow(tenant.id, input.dimensionId);

  const runFindings = await db
    .select({ finding: findings })
    .from(findings)
    .innerJoin(researchSessions, eq(findings.sessionId, researchSessions.id))
    .where(
      and(eq(researchSessions.runId, input.runId), eq(findings.dimensionId, input.dimensionId)),
    );
  if (runFindings.length === 0) throw new Error('no findings for this dimension in this run');

  const noteRows = await db
    .select()
    .from(reviewNotes)
    .where(and(eq(reviewNotes.runId, input.runId), eq(reviewNotes.dimensionId, input.dimensionId)));
  const dispositions = currentDispositions(noteRows);
  const partition = partitionForApproval(
    runFindings.map(({ finding }) => finding),
    dispositions,
  );

  const slugOf = (id: string) =>
    runFindings.find(({ finding }) => finding.id === id)?.finding.indicatorSlug ?? id;
  if (partition.blockedNeedsRework.length > 0) {
    throw new Error(
      `findings marked needs-rework — re-research or re-disposition first: ${partition.blockedNeedsRework.map(slugOf).join(', ')}`,
    );
  }
  if (partition.undispositionedFlagged.length > 0) {
    throw new Error(
      `flagged findings need individual dispositions before approval (review-disposes-each-flag): ${partition.undispositionedFlagged.map(slugOf).join(', ')} — disposition them in /${input.tenantSlug}/admin/verify/${input.runId}`,
    );
  }
  if (partition.indicators.length === 0 && partition.gaps.length === 0) {
    throw new Error(
      'every finding was rejected — nothing to materialize; flag an honest gap or plan a re-research instead',
    );
  }

  const base = await latestVersion(db, dimension.id);

  const indicators: Indicator[] = partition.indicators.map((p) => ({
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
  }));
  const gaps: DimensionGap[] = partition.gaps.map((p) => ({
    indicator: p.indicator_slug,
    reason: p.reason,
    scales_tried: p.scales_tried,
    searched_at: p.searched_at,
  }));

  const data: DimensionData = {
    name: base?.data.name ?? dimension.slug,
    icon: base?.data.icon ?? '',
    description: base?.data.description ?? '',
    context: base?.data.context ?? '',
    indicators,
    gaps: gaps.length ? gaps : undefined,
    actions: base?.data.actions ?? [],
    policy_spotlight: base?.data.policy_spotlight,
    justice_spotlight: base?.data.justice_spotlight,
  };

  const auth = await getAuth();
  const version = await appendDimensionVersion(db, {
    dimensionId: dimension.id,
    status: 'draft',
    data,
    vizLevel: deriveVizLevel(data),
    origin: 'research',
    researchRunId: input.runId,
    createdBy: auth.userId,
  });

  await audit(tenant.id, 'dimension_version', version.id, 'approve_findings', null, {
    dimension: dimension.slug,
    run_id: input.runId,
    indicators: indicators.length,
    gaps: gaps.length,
    rejected_excluded: partition.rejected.length,
    dispositions: dispositions.length,
  });

  if (input.publish) {
    await publishVersion({ tenantSlug: input.tenantSlug, versionId: version.id });
  }

  revalidatePath(`/${input.tenantSlug}/admin/review`);
  revalidatePath(`/${input.tenantSlug}/admin`);
  return { versionId: version.id, versionNum: version.versionNum };
}

/**
 * Re-research (SPEC.md §8 Rerun): user-directed, reviewer notes injected
 * verbatim. When the rerun follows a reviewed run, that run's structured
 * dispositions and annotations for this dimension travel along as JSON
 * (verified-discoveries-seed-reruns) — reviewer knowledge feeds the next
 * session instead of being rediscovered from scratch.
 */
export async function reResearchDimension(input: {
  tenantSlug: string;
  dimensionId: string;
  notes: string;
  /** The reviewed run whose dispositions/annotations seed the rerun. */
  fromRunId?: string;
}) {
  let notes = input.notes;
  if (input.fromRunId) {
    const db = getDb();
    const noteRows = await db
      .select()
      .from(reviewNotes)
      .where(
        and(
          eq(reviewNotes.runId, input.fromRunId),
          eq(reviewNotes.dimensionId, input.dimensionId),
        ),
      );
    if (noteRows.length > 0) {
      const dispositions = currentDispositions(noteRows);
      const byFinding = new Map(dispositions.map((d) => [d.findingId, d]));
      const slugs = await db
        .select({ id: findings.id, indicatorSlug: findings.indicatorSlug })
        .from(findings)
        .innerJoin(researchSessions, eq(findings.sessionId, researchSessions.id))
        .where(
          and(
            eq(researchSessions.runId, input.fromRunId),
            eq(findings.dimensionId, input.dimensionId),
          ),
        );
      const block = renderAnnotationsForRerun(
        slugs.map((f) => ({
          indicatorSlug: f.indicatorSlug,
          disposition: byFinding.get(f.id),
          notes: noteRows.filter((n) => n.findingId === f.id),
        })),
      );
      if (block) notes = [input.notes.trim(), block].filter(Boolean).join('\n\n');
    }
  }
  const { runId } = await planResearchAction({
    tenantSlug: input.tenantSlug,
    dimensionIds: [input.dimensionId],
    reviewerNotes: { [input.dimensionId]: notes },
  });
  return { runId };
}

/**
 * Flag gap (SPEC.md §9): publish an honest data-gap wedge — gray, not
 * hidden. Values are cleared, the gap is recorded with the reviewer's
 * reason, and the wedge renders as unknown.
 */
export async function flagGap(input: {
  tenantSlug: string;
  dimensionId: string;
  indicator: string;
  reason: string;
}) {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const db = getDb();

  const reason = input.reason.trim();
  if (!reason) throw new Error('a reason is required to flag a data gap');

  const dimension = await dimensionInTenantOrThrow(tenant.id, input.dimensionId);

  const base = await latestVersion(db, dimension.id);
  if (!base) throw new Error('dimension has no versions');

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

  await audit(tenant.id, 'dimension_version', version.id, 'flag_gap', null, {
    dimension: dimension.slug,
    reason,
  });

  await publishVersion({ tenantSlug: input.tenantSlug, versionId: version.id });
  revalidatePath(`/${input.tenantSlug}/admin/review`);
  return { versionId: version.id };
}
