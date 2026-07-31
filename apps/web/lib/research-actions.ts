'use server';

import { revalidatePath } from 'next/cache';
import { getAuth, requireRole } from './auth';
import { applyRun, createPlannedRun, tenantIdBySlug } from './research';

export async function planResearchAction(input: {
  tenantSlug: string;
  dimensionIds?: string[];
  reviewerNotes?: Record<string, string>;
}) {
  const tenantId = await tenantIdBySlug(input.tenantSlug);
  if (!tenantId) throw new Error('unknown tenant');
  await requireRole(tenantId, 'editor');
  const auth = await getAuth();
  const { run, sessionCount } = await createPlannedRun({
    tenantId,
    dimensionIds: input.dimensionIds,
    reviewerNotes: input.reviewerNotes,
    requestedBy: auth.userId,
  });
  revalidatePath(`/${input.tenantSlug}/admin/research`);
  return { runId: run.id, sessionCount };
}

export async function applyResearchAction(input: { tenantSlug: string; runId: string }) {
  const tenantId = await tenantIdBySlug(input.tenantSlug);
  if (!tenantId) throw new Error('unknown tenant');
  await requireRole(tenantId, 'editor');
  await applyRun(tenantId, input.runId);
  revalidatePath(`/${input.tenantSlug}/admin/research`);
  revalidatePath(`/${input.tenantSlug}/admin/research/${input.runId}`);
}
