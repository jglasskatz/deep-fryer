'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, max } from 'drizzle-orm';
import {
  deriveVizLevel,
  type DimensionData,
  type DimensionGap,
  type Indicator,
} from '@deep-fryer/core';
import {
  auditLog,
  dimensions,
  dimensionVersions,
  findings,
  getDb,
  researchSessions,
  tenants,
} from '@deep-fryer/db';
import { getAuth, requireRole } from './auth';
import { publishVersion } from './actions';
import { planResearchAction } from './research-actions';

async function tenantOrThrow(slug: string) {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  if (!tenant) throw new Error(`unknown tenant '${slug}'`);
  return tenant;
}

async function latestVersion(dimensionId: string) {
  const db = getDb();
  const [latest] = await db
    .select()
    .from(dimensionVersions)
    .where(eq(dimensionVersions.dimensionId, dimensionId))
    .orderBy(desc(dimensionVersions.versionNum))
    .limit(1);
  return latest ?? null;
}

/**
 * Approve (SPEC.md §9): materialize the run's verified findings for one
 * dimension as a draft version with origin 'research', preserving the
 * narrative fields from the current version. Publish is a separate act
 * (default review policy gates everything on a human decision) — pass
 * `publish: true` for approve-and-publish in one step.
 */
export async function approveFindings(input: {
  tenantSlug: string;
  runId: string;
  dimensionId: string;
  publish?: boolean;
}) {
  const tenant = await tenantOrThrow(input.tenantSlug);
  await requireRole(tenant.id, 'editor');
  const db = getDb();

  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.id, input.dimensionId), eq(dimensions.tenantId, tenant.id)));
  if (!dimension) throw new Error('unknown dimension');

  const runFindings = await db
    .select({ finding: findings })
    .from(findings)
    .innerJoin(researchSessions, eq(findings.sessionId, researchSessions.id))
    .where(
      and(eq(researchSessions.runId, input.runId), eq(findings.dimensionId, input.dimensionId)),
    );
  if (runFindings.length === 0) throw new Error('no findings for this dimension in this run');

  const base = await latestVersion(dimension.id);

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

  const maxRows = await db
    .select({ maxVersion: max(dimensionVersions.versionNum) })
    .from(dimensionVersions)
    .where(eq(dimensionVersions.dimensionId, dimension.id));
  const maxVersion = maxRows[0]?.maxVersion ?? 0;

  const auth = await getAuth();
  const [version] = await db
    .insert(dimensionVersions)
    .values({
      dimensionId: dimension.id,
      versionNum: maxVersion + 1,
      status: 'draft',
      data,
      vizLevel: deriveVizLevel(data),
      origin: 'research',
      researchRunId: input.runId,
      createdBy: auth.userId,
    })
    .returning();
  if (!version) throw new Error('version insert failed');

  await db.insert(auditLog).values({
    tenantId: tenant.id,
    userId: auth.userId,
    entity: 'dimension_version',
    entityId: version.id,
    action: 'approve_findings',
    after: {
      dimension: dimension.slug,
      run_id: input.runId,
      indicators: indicators.length,
      gaps: gaps.length,
    },
  });

  if (input.publish) {
    await publishVersion({ tenantSlug: input.tenantSlug, versionId: version.id });
  }

  revalidatePath(`/${input.tenantSlug}/admin/review`);
  revalidatePath(`/${input.tenantSlug}/admin`);
  return { versionId: version.id, versionNum: version.versionNum };
}

/** Re-research (SPEC.md §8 Rerun): user-directed, reviewer notes injected verbatim. */
export async function reResearchDimension(input: {
  tenantSlug: string;
  dimensionId: string;
  notes: string;
}) {
  const { runId } = await planResearchAction({
    tenantSlug: input.tenantSlug,
    dimensionIds: [input.dimensionId],
    reviewerNotes: { [input.dimensionId]: input.notes },
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
  const tenant = await tenantOrThrow(input.tenantSlug);
  await requireRole(tenant.id, 'editor');
  const db = getDb();

  const reason = input.reason.trim();
  if (!reason) throw new Error('a reason is required to flag a data gap');

  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.id, input.dimensionId), eq(dimensions.tenantId, tenant.id)));
  if (!dimension) throw new Error('unknown dimension');

  const base = await latestVersion(dimension.id);
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

  const maxRows = await db
    .select({ maxVersion: max(dimensionVersions.versionNum) })
    .from(dimensionVersions)
    .where(eq(dimensionVersions.dimensionId, dimension.id));

  const auth = await getAuth();
  const [version] = await db
    .insert(dimensionVersions)
    .values({
      dimensionId: dimension.id,
      versionNum: (maxRows[0]?.maxVersion ?? 0) + 1,
      status: 'draft',
      data,
      vizLevel: null,
      origin: 'human',
      changeNote: `Flagged as data gap: ${reason}`,
      createdBy: auth.userId,
    })
    .returning();
  if (!version) throw new Error('version insert failed');

  await db.insert(auditLog).values({
    tenantId: tenant.id,
    userId: auth.userId,
    entity: 'dimension_version',
    entityId: version.id,
    action: 'flag_gap',
    after: { dimension: dimension.slug, reason },
  });

  await publishVersion({ tenantSlug: input.tenantSlug, versionId: version.id });
  revalidatePath(`/${input.tenantSlug}/admin/review`);
  return { versionId: version.id };
}
