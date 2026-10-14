import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { hasDatabase } from '@/lib/env';
import { systemDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Liveness + readiness for the load balancer / compose healthcheck: 200 when
 * the process is up and Postgres answers within 2 s, 503 otherwise. No
 * details beyond that — this endpoint is public.
 */
export async function GET() {
  if (!hasDatabase()) return NextResponse.json({ ok: true, database: 'not configured' });
  try {
    await Promise.race([
      systemDb().execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
