'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { dimensions, getDb } from '@deep-fryer/db';
import { getAuth, requireTenantRole } from './auth';
import { audit } from './audit';
import { configValue } from './admin-data';
import { createPlannedRun, applyRun } from './research';
import { action, UserError } from './action-result';

/**
 * Request additional research for one dimension from the insights surface.
 * Gated on the per-tenant `features.request_research` flag (SPEC §6 behavior
 * layer), editor role, and the organization's research quota (applyRun);
 * plans a single-dimension run with the requester's note injected verbatim
 * (SPEC §8 Rerun) and enqueues it.
 */
export const requestResearch = action(async (input: {
  tenantSlug: string;
  dimensionSlug: string;
  note: string;
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');

  const features = await configValue(tenant.id, 'features');
  if (!features?.request_research) {
    throw new UserError('Additional-research requests are not enabled for this portrait.');
  }

  const db = getDb();
  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.tenantId, tenant.id), eq(dimensions.slug, input.dimensionSlug)));
  if (!dimension) throw new UserError('Unknown dimension.');

  const note = input.note.trim().slice(0, 2000);
  const auth = await getAuth();
  const { run, sessionCount } = await createPlannedRun({
    tenantId: tenant.id,
    dimensionIds: [dimension.id],
    reviewerNotes: note ? { [dimension.id]: note } : undefined,
    requestedBy: auth.userId,
  });
  await applyRun(tenant.id, run.id);

  await audit(tenant.id, 'research_run', run.id, 'request_research', null, {
    dimension: dimension.slug,
    sessions: sessionCount,
    note: note || null,
  });

  revalidatePath('/o', 'layout');
  return { runId: run.id, sessionCount };
});
