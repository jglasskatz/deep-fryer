import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuth, getRole, roleAtLeast } from '@/lib/auth';
import { createPlannedRun, tenantIdBySlug } from '@/lib/research';

const bodySchema = z.object({
  tenant: z.string(),
  dimension_ids: z.array(z.string().uuid()).optional(),
  reviewer_notes: z.record(z.string()).optional(),
});

/** POST /api/research/plan — render a run without spending tokens (SPEC §8). */
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const tenantId = await tenantIdBySlug(body.tenant);
    if (!tenantId) return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });

    const role = await getRole(tenantId);
    if (!roleAtLeast(role, 'editor')) {
      return NextResponse.json({ error: 'requires editor role' }, { status: 403 });
    }

    const auth = await getAuth();
    const { run, sessionCount } = await createPlannedRun({
      tenantId,
      dimensionIds: body.dimension_ids,
      reviewerNotes: body.reviewer_notes,
      requestedBy: auth.userId,
    });
    return NextResponse.json({
      run_id: run.id,
      status: run.status,
      session_count: sessionCount,
      config_hash: run.plan.config_hash,
      plugin_version: run.plan.plugin_version,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'plan failed' },
      { status: 400 },
    );
  }
}
