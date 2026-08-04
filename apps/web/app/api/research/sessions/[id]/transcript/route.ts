import { gunzipSync } from 'node:zlib';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, researchRuns, researchSessions } from '@deep-fryer/db';
import { getRole, roleAtLeast } from '@/lib/auth';

/**
 * Session transcript (SPEC.md §8, §11): owner/audit access only. The default
 * review surface is findings + evidence; this is the post-hoc audit trail.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const [session] = await db.select().from(researchSessions).where(eq(researchSessions.id, id));
  if (!session) return NextResponse.json({ error: 'unknown session' }, { status: 404 });
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, session.runId));
  if (!run) return NextResponse.json({ error: 'orphan session' }, { status: 404 });

  const role = await getRole(run.tenantId);
  if (!roleAtLeast(role, 'owner')) {
    return NextResponse.json(
      { error: 'transcript access is restricted to tenant owners' },
      { status: 403 },
    );
  }

  if (!session.transcript) {
    return NextResponse.json({ error: 'no transcript recorded' }, { status: 404 });
  }

  const jsonl = gunzipSync(session.transcript).toString('utf8');
  return new NextResponse(jsonl, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': `attachment; filename="session-${id}.jsonl"`,
    },
  });
}
