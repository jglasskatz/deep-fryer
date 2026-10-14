import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { frameworkDimension } from '@deep-fryer/contract';
import { checkResearchQuota } from '@deep-fryer/core';
import {
  dimensions,
  latestVersion,
  lockSubscription,
  organizationForTenant,
  researchRuns,
  researchSessionsUsed,
} from '@deep-fryer/db';
import {
  enqueueResearchApply,
  renderPlan,
  type PlanDimensionSpec,
} from '@deep-fryer/research';
import { portraitConfigFromMap, tenantConfigMap } from './admin-data';
import { UserError } from './action-result';
import { systemDb, userDb } from './db';

/**
 * Plan (SPEC.md §8): render the full session list — prompts, tool
 * allowlists, config hash — without spending tokens, and store it on the
 * run row for inspection before apply.
 */
export async function createPlannedRun(input: {
  tenantId: string;
  dimensionIds?: string[];
  reviewerNotes?: Record<string, string>;
  requestedBy?: string | null;
}) {
  return userDb(async (db) => {
    const configMap = await tenantConfigMap(input.tenantId);
    const config = portraitConfigFromMap(configMap);
    if (!config) {
      throw new UserError(
        'Portrait config is incomplete (region, source priority, recency, and scale policy are required) — fill it in under Settings.',
      );
    }

    const where = [eq(dimensions.tenantId, input.tenantId), isNull(dimensions.archivedAt)];
    if (input.dimensionIds?.length) {
      where.push(inArray(dimensions.id, input.dimensionIds));
    }
    const dims = await db
      .select()
      .from(dimensions)
      .where(and(...where))
      .orderBy(dimensions.displayOrder);
    if (dims.length === 0) throw new UserError('Select at least one dimension.');

    const specs: PlanDimensionSpec[] = [];
    for (const dim of dims) {
      const frameworkDim = frameworkDimension(dim.slug, dim.canonicalSlug);
      let indicators = frameworkDim?.indicators ?? [];
      let name = frameworkDim?.name ?? dim.slug;

      if (!frameworkDim) {
        // Custom dimension: research whatever indicators its latest version names.
        const latest = await latestVersion(db, dim.id);
        name = latest?.data.name ?? dim.slug;
        indicators = (latest?.data.indicators ?? []).map((ind) => ({
          slug: ind.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          name: ind.name,
          unit: ind.unit,
          threshold_ref: ind.scoring?.threshold_ref ?? '',
        }));
      }

      specs.push({
        dimensionId: dim.id,
        slug: dim.slug,
        ring: dim.ring,
        name,
        indicators,
        reviewerNotes: input.reviewerNotes?.[dim.id],
      });
    }

    const plan = renderPlan({ config, dimensions: specs });

    const [run] = await db
      .insert(researchRuns)
      .values({
        tenantId: input.tenantId,
        status: 'planned',
        plan,
        configSnapshot: config,
        requestedBy: input.requestedBy ?? null,
      })
      .returning();
    if (!run) throw new Error('run insert failed');

    return { run, sessionCount: plan.sessions.length };
  });
}

/**
 * Apply: the moment research spend starts, so the billing gate lives here
 * (SPEC-v4 §3). In one transaction: lock the run and the organization's
 * subscription row, compute the period's usage, check the plan's quota, and
 * stamp applied_at — so two concurrent applies cannot both fit into a quota
 * that only holds one of them. The queue insert happens after commit; if it
 * fails, applied_at is cleared again so the reservation does not leak.
 */
export async function applyRun(tenantId: string, runId: string) {
  // System context: the quota is organization-wide (runs on portraits this
  // person cannot see still count) and the subscription row is locked for
  // the check. Callers have already required the editor role.
  const db = systemDb();
  const run = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(researchRuns)
      .where(and(eq(researchRuns.id, runId), eq(researchRuns.tenantId, tenantId)))
      .for('update');
    if (!row) throw new UserError('Unknown run.');
    if (row.status !== 'planned' || row.appliedAt) {
      throw new UserError(`This run was already applied (status: ${row.status}).`);
    }

    const org = await organizationForTenant(tx, tenantId);
    if (!org) throw new Error(`tenant ${tenantId} has no organization`);
    const sub = await lockSubscription(tx, org.id);
    const used = sub
      ? await researchSessionsUsed(tx, org.id, sub.currentPeriodStart, sub.currentPeriodEnd)
      : 0;
    const check = checkResearchQuota(sub, used, row.plan.sessions.length);
    if (!check.allowed) throw new UserError(check.message ?? 'Research is not available on this plan.');

    const [applied] = await tx
      .update(researchRuns)
      .set({ appliedAt: new Date() })
      .where(eq(researchRuns.id, row.id))
      .returning();
    return applied!;
  });

  try {
    await enqueueResearchApply(run.id);
  } catch (err) {
    await db.update(researchRuns).set({ appliedAt: null }).where(eq(researchRuns.id, run.id));
    throw err;
  }
  return run;
}
