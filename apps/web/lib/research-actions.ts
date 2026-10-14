'use server';

import { revalidatePath } from 'next/cache';
import { getAuth, requireTenantRole } from './auth';
import { applyRun, createPlannedRun } from './research';
import { action } from './action-result';
import { audit } from './audit';

export const planResearchAction = action(async (input: {
  tenantSlug: string;
  dimensionIds?: string[];
  reviewerNotes?: Record<string, string>;
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const auth = await getAuth();
  const { run, sessionCount } = await createPlannedRun({
    tenantId: tenant.id,
    dimensionIds: input.dimensionIds,
    reviewerNotes: input.reviewerNotes,
    requestedBy: auth.userId,
  });
  revalidatePath(`/${input.tenantSlug}/admin/research`);
  return { runId: run.id, sessionCount };
});

export const applyResearchAction = action(async (input: { tenantSlug: string; runId: string }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const run = await applyRun(tenant.id, input.runId);
  await audit(tenant.id, 'research_run', run.id, 'apply', null, {
    sessions: run.plan.sessions.length,
  });
  revalidatePath(`/${input.tenantSlug}/admin/research`);
  revalidatePath(`/${input.tenantSlug}/admin/research/${input.runId}`);
});
