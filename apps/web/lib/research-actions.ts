'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { researchRuns } from '@deep-fryer/db';
import type { ResearchStrategy } from '@deep-fryer/core';
import { getAuth, requireTenantRole } from './auth';
import { applyRun, createPlannedRun } from './research';
import { action, UserError } from './action-result';
import { audit } from './audit';
import { systemDb, userDb } from './db';

export const planResearchAction = action(async (input: {
  tenantSlug: string;
  dimensionIds?: string[];
  reviewerNotes?: Record<string, string>;
  strategy?: ResearchStrategy;
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  if (input.strategy !== undefined && input.strategy !== 'standard' && input.strategy !== 'deep') {
    throw new UserError('Choose the standard or deep research strategy.');
  }
  const auth = await getAuth();
  const { run, sessionCount } = await createPlannedRun({
    tenantId: tenant.id,
    dimensionIds: input.dimensionIds,
    reviewerNotes: input.reviewerNotes,
    requestedBy: auth.userId,
    strategy: input.strategy,
  });
  revalidatePath(`/${input.tenantSlug}/admin/research`);
  return { runId: run.id, sessionCount };
});

export const applyResearchAction = action(async (input: { tenantSlug: string; runId: string }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const run = await applyRun(tenant.id, input.runId);
  await audit(tenant.id, 'research_run', run.id, 'apply', null, {
    sessions: run.plan.sessions.length,
    // Who pays (SPEC-v7 §4): the organization's own key, or the plan's allowance.
    funding: run.funding,
  });
  revalidatePath(`/${input.tenantSlug}/admin/research`);
  revalidatePath(`/${input.tenantSlug}/admin/research/${input.runId}`);
});

/**
 * "Build my doughnut" (SPEC-v7 §4): one click after /start plans the full
 * run — the region context plus every dimension, 22 sessions for a
 * framework portrait — and applies it, through the same createPlannedRun
 * and applyRun every other run goes through, so the billing gate, the
 * queue, and the run page behave exactly as for a run planned by hand. The
 * gate picks who pays: the organization's own Anthropic API key when one is
 * on file, otherwise the plan's session allowance. Either way it needs a
 * plan in good standing — building is never free — and research on the plan
 * also needs the deployment's research key (lib/billing.ts
 * assertFundingUsable).
 *
 * One step, all or nothing: if the gate refuses (no plan yet, an allowance
 * that does not fit, a server that cannot run research on the plan), the run
 * this click planned is removed again, so a refused click leaves nothing
 * behind to clean up. And while a run for the portrait is already queued or
 * running, the click is refused — a second full run would spend twice for
 * the same doughnut.
 */
export const buildDoughnut = action(async (input: { tenantSlug: string }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const auth = await getAuth();

  const [inProgress] = await userDb((db) =>
    db
      .select({ id: researchRuns.id })
      .from(researchRuns)
      .where(
        and(
          eq(researchRuns.tenantId, tenant.id),
          or(
            eq(researchRuns.status, 'running'),
            and(eq(researchRuns.status, 'planned'), isNotNull(researchRuns.appliedAt)),
          ),
        ),
      )
      .limit(1),
  );
  if (inProgress) {
    throw new UserError('Research for this portrait is already under way. Follow it on the research page; it was not started twice.');
  }

  const { run, sessionCount } = await createPlannedRun({ tenantId: tenant.id, requestedBy: auth.userId });
  let applied: Awaited<ReturnType<typeof applyRun>>;
  try {
    applied = await applyRun(tenant.id, run.id);
  } catch (err) {
    // Only the run this click planned, and only while it was never applied.
    // System context, like applyRun: the app role cannot delete research runs at all (migration 0013 leaves it
    // SELECT and INSERT of planned runs only), so the cleanup runs as the table owner.
    await systemDb()
      .delete(researchRuns)
      .where(
        and(
          eq(researchRuns.id, run.id),
          eq(researchRuns.tenantId, tenant.id),
          eq(researchRuns.status, 'planned'),
          isNull(researchRuns.appliedAt),
        ),
      )
      .catch((cleanupErr: unknown) => console.error('[build-doughnut] could not remove the refused plan', cleanupErr));
    throw err;
  }
  await audit(tenant.id, 'research_run', applied.id, 'apply', null, {
    sessions: sessionCount,
    funding: applied.funding,
    via: 'build_doughnut',
  });

  revalidatePath(`/${input.tenantSlug}/admin/research`);
  revalidatePath('/start');
  return { runId: applied.id, sessionCount, funding: applied.funding };
});
