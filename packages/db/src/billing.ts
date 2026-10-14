import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { DbExecutor } from './client.js';
import {
  organizationMembers,
  organizations,
  researchRuns,
  subscriptions,
  tenantMembers,
  tenants,
  type Organization,
  type Subscription,
} from './schema.js';

/**
 * Billing reads (SPEC-v4 §3). Usage is computed from research runs rather
 * than kept in a separate ledger: runs are durable records already, so the
 * number on the billing page is reconstructable from the audit trail.
 */

export async function subscriptionFor(
  db: DbExecutor,
  organizationId: string,
): Promise<Subscription | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId));
  return row ?? null;
}

/**
 * Lock the organization's subscription row for the rest of the transaction.
 * The research gate takes this lock before reading usage so two concurrent
 * applies cannot both pass a quota that only fits one of them.
 */
export async function lockSubscription(
  tx: DbExecutor,
  organizationId: string,
): Promise<Subscription | null> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .for('update');
  return row ?? null;
}

/**
 * Research sessions consumed by an organization's runs applied in
 * [since, until). Runs still queued or running count their full planned
 * session list (a reservation); finished runs count only sessions that did
 * not fail — the customer never pays for our infrastructure failures.
 */
export async function researchSessionsUsed(
  db: DbExecutor,
  organizationId: string,
  since: Date,
  until: Date,
): Promise<number> {
  const rows = await db
    .select({
      used: sql<number>`coalesce(sum(
        CASE WHEN ${researchRuns.status} IN ('planned', 'running')
          THEN jsonb_array_length(${researchRuns.plan}->'sessions')
          ELSE (SELECT count(*) FROM research_sessions s
                 WHERE s.run_id = ${researchRuns.id} AND s.status <> 'failed')
        END), 0)::int`,
    })
    .from(researchRuns)
    .innerJoin(tenants, eq(tenants.id, researchRuns.tenantId))
    .where(
      and(
        eq(tenants.organizationId, organizationId),
        gte(researchRuns.appliedAt, since),
        lt(researchRuns.appliedAt, until),
      ),
    );
  return rows[0]?.used ?? 0;
}

/** Active (non-archived) portraits an organization holds. */
export async function portraitCount(db: DbExecutor, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tenants)
    .where(and(eq(tenants.organizationId, organizationId), isNull(tenants.archivedAt)));
  return row?.n ?? 0;
}

/** Distinct people with any role in the organization or any of its portraits. */
export async function seatCount(db: DbExecutor, organizationId: string): Promise<number> {
  const result = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM (
      SELECT ${organizationMembers.userId} AS user_id FROM ${organizationMembers}
        WHERE ${organizationMembers.organizationId} = ${organizationId}
      UNION
      SELECT tm.user_id FROM ${tenantMembers} tm
        JOIN ${tenants} t ON t.id = tm.tenant_id
        WHERE t.organization_id = ${organizationId}
    ) people`);
  return Number(result[0]?.n ?? 0);
}

export async function organizationForTenant(
  db: DbExecutor,
  tenantId: string,
): Promise<Organization | null> {
  const [row] = await db
    .select({ org: organizations })
    .from(tenants)
    .innerJoin(organizations, eq(organizations.id, tenants.organizationId))
    .where(eq(tenants.id, tenantId));
  return row?.org ?? null;
}

export async function organizationByStripeCustomer(
  db: DbExecutor,
  stripeCustomerId: string,
): Promise<Organization | null> {
  const [row] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.stripeCustomerId, stripeCustomerId));
  return row ?? null;
}
