import { NextResponse } from 'next/server';
import { z } from 'zod';
import { boundedRecord, REQUEST_LIMITS, RESEARCH_STRATEGIES } from '@deep-fryer/core';
import { driverError, tenantBySlug } from '@deep-fryer/db';
import { userDb } from '@/lib/db';
import { getAuth, getRole, roleAtLeast } from '@/lib/auth';
import { createPlannedRun } from '@/lib/research';
import { isSignedIn, SIGN_IN_REQUIRED } from '@/lib/signed-in';

/** Dimension ids and the notes keyed by them: at most one per dimension of the portrait. */
const bodySchema = z.object({
  tenant: z.string(),
  dimension_ids: z.array(z.guid()).max(REQUEST_LIMITS.dimensions).optional(),
  reviewer_notes: boundedRecord(z.string(), z.string(), REQUEST_LIMITS.dimensions).optional(),
  // A strategy by name; the plan records its newest version.
  strategy: z.enum(RESEARCH_STRATEGIES).optional(),
});

/**
 * POST /api/research/plan — render a run without spending tokens (SPEC §8).
 * Someone signed out is answered before the body is read; the tenant and
 * role checks need the body's tenant, so they follow the parse.
 */
export async function POST(request: Request) {
  try {
    if (!(await isSignedIn())) return NextResponse.json(SIGN_IN_REQUIRED, { status: 401 });
    const body = bodySchema.parse(await request.json());
    const tenant = await userDb((db) => tenantBySlug(db, body.tenant));
    if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });

    const role = await getRole(tenant.id);
    if (!roleAtLeast(role, 'editor')) {
      return NextResponse.json({ error: 'requires editor role' }, { status: 403 });
    }

    const auth = await getAuth();
    const { run, sessionCount } = await createPlannedRun({
      tenantId: tenant.id,
      dimensionIds: body.dimension_ids,
      reviewerNotes: body.reviewer_notes,
      requestedBy: auth.userId,
      strategy: body.strategy,
    });
    return NextResponse.json({
      run_id: run.id,
      status: run.status,
      session_count: sessionCount,
      config_hash: run.plan.config_hash,
      plugin_version: run.plan.plugin_version,
      strategy: run.plan.strategy,
      strategy_version: run.plan.strategy_version,
      models: run.plan.models,
      caps: run.plan.caps,
    });
  } catch (err) {
    // A failed query reports what the database said, never the SQL and
    // parameters the ORM puts in its own message.
    const reason = driverError(err);
    return NextResponse.json(
      { error: reason instanceof Error ? reason.message : 'plan failed' },
      { status: 400 },
    );
  }
}
