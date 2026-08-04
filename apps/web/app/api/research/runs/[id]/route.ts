import { NextResponse } from 'next/server';
import { runWithSessions } from '@/lib/admin-data';
import { getRole, roleAtLeast } from '@/lib/auth';

/** GET /api/research/runs/:id — status of a run, its sessions, and metering. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await runWithSessions(id);
  if (!data) return NextResponse.json({ error: 'unknown run' }, { status: 404 });

  const role = await getRole(data.run.tenantId);
  if (!roleAtLeast(role, 'viewer')) {
    return NextResponse.json({ error: 'requires membership' }, { status: 403 });
  }

  return NextResponse.json({
    run_id: data.run.id,
    status: data.run.status,
    created_at: data.run.createdAt,
    completed_at: data.run.completedAt,
    token_usage: data.run.tokenUsage,
    sessions: data.sessions.map((s) => ({
      id: s.id,
      kind: s.kind,
      dimension_id: s.dimensionId,
      status: s.status,
      started_at: s.startedAt,
      completed_at: s.completedAt,
    })),
    findings_count: data.findings.length,
  });
}
