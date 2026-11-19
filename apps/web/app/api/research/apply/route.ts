import { NextResponse } from 'next/server';
import { z } from 'zod';
import { driverError, tenantBySlug } from '@deep-fryer/db';
import { getRole, roleAtLeast } from '@/lib/auth';
import { applyRun } from '@/lib/research';
import { systemDb } from '@/lib/db';

const bodySchema = z.object({
  tenant: z.string(),
  run_id: z.string().uuid(),
});

/** POST /api/research/apply — enqueue a planned run for the worker. */
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const tenant = await tenantBySlug(systemDb(), body.tenant);
    if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });

    const role = await getRole(tenant.id);
    if (!roleAtLeast(role, 'editor')) {
      return NextResponse.json({ error: 'requires editor role' }, { status: 403 });
    }

    const run = await applyRun(tenant.id, body.run_id);
    return NextResponse.json({ run_id: run.id, enqueued: true });
  } catch (err) {
    // A failed query reports what the database said, never the SQL and
    // parameters the ORM puts in its own message.
    const reason = driverError(err);
    return NextResponse.json(
      { error: reason instanceof Error ? reason.message : 'apply failed' },
      { status: 400 },
    );
  }
}
