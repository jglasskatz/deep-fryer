'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { dimensions, getDb } from '@deep-fryer/db';
import { requireTenantRole } from './auth';
import { audit } from './audit';
import { configValue } from './admin-data';
import { createPlannedRun, applyRun } from './research';

/**
 * Request additional research for one dimension from the insights surface.
 * Gated on the per-tenant `features.request_research` flag (SPEC §6 behavior
 * layer) and editor role; plans a single-dimension run with the requester's
 * note injected verbatim (SPEC §8 Rerun) and enqueues it.
 */
export async function requestResearch(input: {
  tenantSlug: string;
  dimensionSlug: string;
  note: string;
}) {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');

  const features = await configValue(tenant.id, 'features');
  if (!features?.request_research) {
    throw new Error('additional-research requests are not enabled for this portrait');
  }

  const db = getDb();
  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.tenantId, tenant.id), eq(dimensions.slug, input.dimensionSlug)));
  if (!dimension) throw new Error('unknown dimension');

  const note = input.note.trim().slice(0, 2000);
  const { run, sessionCount } = await createPlannedRun({
    tenantId: tenant.id,
    dimensionIds: [dimension.id],
    reviewerNotes: note ? { [dimension.id]: note } : undefined,
  });
  await applyRun(tenant.id, run.id);

  await audit(tenant.id, 'research_run', run.id, 'request_research', null, {
    dimension: dimension.slug,
    sessions: sessionCount,
    note: note || null,
  });

  revalidatePath('/insights');
  return { runId: run.id, sessionCount };
}
