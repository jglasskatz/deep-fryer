import { sql } from 'drizzle-orm';
import { defaultRetention } from '@deep-fryer/core';
import type { DbExecutor } from './client.js';

/**
 * Municipal retention policy (SPEC §8), executed only by the housekeeping
 * worker in system context. Expiry removes compressed transcript bytes,
 * never findings, versions, source exhibits, usage, or review/audit records.
 * Active/queued sessions are ineligible regardless of their start date.
 *
 * Config is read in the same statement as the update. Invalid/unset values
 * use the documented seven-year default. Extremely large numeric policies
 * retain forever rather than overflowing an interval or shortening policy.
 */
export async function pruneExpiredTranscripts(
  db: DbExecutor,
  now: Date = new Date(),
  tenantIds?: readonly string[],
): Promise<{ research: number; policy: number }> {
  if (!Number.isFinite(now.getTime())) throw new RangeError('invalid transcript-retention time');
  if (tenantIds?.length === 0) return { research: 0, policy: 0 };
  const retention = sql`retention AS (
    SELECT t.id AS tenant_id,
      CASE WHEN jsonb_typeof(c.value -> 'transcript_days') = 'number' THEN
        CASE WHEN (c.value ->> 'transcript_days') ~ '^[0-9]+$'
               AND (c.value ->> 'transcript_days')::numeric >= 1
          THEN least((c.value ->> 'transcript_days')::numeric, 1000000000)
          ELSE ${defaultRetention.transcript_days}
        END
        ELSE ${defaultRetention.transcript_days}
      END AS days
    FROM tenants t
    LEFT JOIN tenant_config c ON c.tenant_id = t.id AND c.key = 'retention'
    ${tenantIds ? sql`WHERE t.id IN (${sql.join(tenantIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
  )`;
  // Both counters and cleanup commit atomically. PostgreSQL evaluates the
  // age comparison in days, so even huge policies never construct an
  // overflowing timestamp/interval.
  return db.transaction(async (tx) => {
    const research = await tx.execute<{ id: string }>(sql`
      WITH ${retention}
      UPDATE research_sessions s SET transcript = NULL
      FROM research_runs r, retention p
      WHERE s.run_id = r.id AND p.tenant_id = r.tenant_id
        AND r.status IN ('complete', 'failed')
        AND s.status IN ('complete', 'failed')
        AND s.completed_at IS NOT NULL AND s.transcript IS NOT NULL
        AND EXTRACT(EPOCH FROM (${now.toISOString()}::timestamptz - s.completed_at)) / 86400 > p.days
      RETURNING s.id`);
    const policy = await tx.execute<{ id: string }>(sql`
      WITH ${retention}
      UPDATE policy_analyses a SET transcript = NULL
      FROM retention p
      WHERE p.tenant_id = a.tenant_id
        AND a.status IN ('complete', 'failed')
        AND a.completed_at IS NOT NULL AND a.transcript IS NOT NULL
        AND EXTRACT(EPOCH FROM (${now.toISOString()}::timestamptz - a.completed_at)) / 86400 > p.days
      RETURNING a.id`);
    return { research: research.length, policy: policy.length };
  });
}
