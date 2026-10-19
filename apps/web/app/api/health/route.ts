import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { withAuthContext } from '@deep-fryer/db';
import { hasDatabase } from '@/lib/env';
import { systemDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Liveness + readiness for the load balancer, the image's HEALTHCHECK, the
 * preflight and the operator's start check (docs/deploy.md §3): 200 when the
 * process is up and Postgres serves a visitor's query within 2 s, 503
 * otherwise. No details beyond that — this endpoint is public.
 *
 * The probe reaches Postgres the way every page does (withAuthContext: one
 * transaction as the non-owner deep_fryer_app role, here an anonymous
 * visitor) and reads tenants, the first table a portrait page reads. A bare
 * `select 1` on the owner connection answered 200 for a database restored
 * from pg_dump without the cluster roles — deep_fryer_app missing, or
 * created afterwards with none of its grants — while every portrait page was
 * a 500 (docs/deploy.md §6, Restore). Row-level security still applies, so a
 * deployment with no portraits yet reads no rows rather than failing: only a
 * missing role or grant, or an unreachable database, is a 503.
 */
export async function GET() {
  if (!hasDatabase()) return NextResponse.json({ ok: true, database: 'not configured' });
  try {
    await Promise.race([
      withAuthContext(systemDb(), null, (tx) => tx.execute(sql`select 1 from tenants limit 1`)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
