'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import {
  deriveVizLevel,
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
} from '@deep-fryer/db';
import { getAuth, requireTenantRole } from './auth';
import { audit } from './audit';
import { publishVersionFor } from './publish';
import { createPlannedRun } from './research';
import { action, UserError } from './action-result';

async function dimensionInTenantOrThrow(tenantId: string, dimensionId: string) {
  const db = getDb();
  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.id, dimensionId), eq(dimensions.tenantId, tenantId)));
  if (!dimension) throw new UserError('Unknown dimension.');
  return dimension;
}

/**
 * Approve (SPEC.md §9): materialize the run's verified findings for one
 * dimension as a draft version with origin 'research', preserving the
 * narrative fields from the current version. Publish is a separate act
 * (default review policy gates everything on a human decision) — pass
 * `publish: true` for approve-and-publish in one step.
 */
export const approveFindings = action(async (input: {
  tenantSlug: string;
  runId: string;
  dimensionId: string;
  publish?: boolean;
}) => {
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
  if (runFindings.length === 0) throw new UserError('No findings for this dimension in this run.');

  const base = await latestVersion(db, dimension.id);

  const indicators: Indicator[] = [];
  const gaps: DimensionGap[] = [];
  for (const { finding } of runFindings) {
    const p = finding.payload;
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
  });

  if (input.publish) {
    await publishVersionFor(tenant, version.id);
  }

  revalidatePath(`/${input.tenantSlug}/admin/review`);
  revalidatePath(`/${input.tenantSlug}/admin`);
  return { versionId: version.id, versionNum: version.versionNum };
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
  const dimension = await dimensionInTenantOrThrow(tenant.id, input.dimensionId);
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
  const db = getDb();

  const reason = input.reason.trim();
  if (!reason) throw new UserError('A reason is required to flag a data gap.');

  const dimension = await dimensionInTenantOrThrow(tenant.id, input.dimensionId);

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

  await audit(tenant.id, 'dimension_version', version.id, 'flag_gap', null, {
    dimension: dimension.slug,
    reason,
  });

  await publishVersionFor(tenant, version.id);
  revalidatePath(`/${input.tenantSlug}/admin/review`);
  return { versionId: version.id };
});
