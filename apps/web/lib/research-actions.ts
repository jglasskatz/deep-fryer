'use server';

import { revalidatePath } from 'next/cache';
import { getAuth, requireTenantRole } from './auth';
import { applyRun, createPlannedRun } from './research';

export async function planResearchAction(input: {
  tenantSlug: string;
  dimensionIds?: string[];
  reviewerNotes?: Record<string, string>;
}) {
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
}

export async function applyResearchAction(input: { tenantSlug: string; runId: string }) {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  await applyRun(tenant.id, input.runId);
  revalidatePath(`/${input.tenantSlug}/admin/research`);
  revalidatePath(`/${input.tenantSlug}/admin/research/${input.runId}`);
}
