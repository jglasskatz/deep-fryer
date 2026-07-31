import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getRole, roleAtLeast } from '@/lib/auth';
import { applyRun, tenantIdBySlug } from '@/lib/research';

const bodySchema = z.object({
  tenant: z.string(),
  run_id: z.string().uuid(),
});

/** POST /api/research/apply — enqueue a planned run for the worker. */
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const tenantId = await tenantIdBySlug(body.tenant);
    if (!tenantId) return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });

    const role = await getRole(tenantId);
    if (!roleAtLeast(role, 'editor')) {
      return NextResponse.json({ error: 'requires editor role' }, { status: 403 });
    }

    const run = await applyRun(tenantId, body.run_id);
    return NextResponse.json({ run_id: run.id, enqueued: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'apply failed' },
      { status: 400 },
    );
  }
}
