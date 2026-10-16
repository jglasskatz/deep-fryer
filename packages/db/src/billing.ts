import { and, eq, gte, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  POLICY_ANALYSIS_SESSIONS,
  checkResearchQuota,
  effectiveLimits,
  standing,
  type ResearchQuotaCheck,
} from '@deep-fryer/core';
import type { DbExecutor } from './client.js';
import {
  organizationApiKeys,
  organizationMembers,
  organizations,
  policyAnalyses,
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
  // A policy analysis is one session (SPEC-v5 §2), counted from creation
  // (when it is queued) unless it failed — the same rule as research.
  const [analyses] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(policyAnalyses)
    .innerJoin(tenants, eq(tenants.id, policyAnalyses.tenantId))
    .where(
      and(
        eq(tenants.organizationId, organizationId),
        ne(policyAnalyses.status, 'failed'),
        gte(policyAnalyses.createdAt, since),
        lt(policyAnalyses.createdAt, until),
      ),
    );
  return (rows[0]?.used ?? 0) + (analyses?.n ?? 0) * POLICY_ANALYSIS_SESSIONS;
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

// ---- The organization's own API key (SPEC-v7 §4) -------------------------------
//
// The key itself is AES-256-GCM ciphertext (@deep-fryer/core/secrets) that only
// the worker decrypts (apps/worker/src/org-key.ts). Everything here reads and
// writes it without ever selecting `ciphertext`: the web app's role has no
// SELECT grant on that column (migration 0011), so these helpers work in a
// person's RLS context (userDb) as well as the system context, and a page can
// never put the ciphertext in its data by accident.

/** What may be shown about a key on file: which key (its hint) and when. */
export interface OrganizationApiKeyInfo {
  provider: string;
  keyHint: string;
  createdBy: string | null;
  createdAt: Date;
  validatedAt: Date | null;
}

/** The organization's key on file, without its ciphertext; null when there is none. */
export async function organizationApiKeyInfo(
  db: DbExecutor,
  organizationId: string,
): Promise<OrganizationApiKeyInfo | null> {
  const [row] = await db
    .select({
      provider: organizationApiKeys.provider,
      keyHint: organizationApiKeys.keyHint,
      createdBy: organizationApiKeys.createdBy,
      createdAt: organizationApiKeys.createdAt,
      validatedAt: organizationApiKeys.validatedAt,
    })
    .from(organizationApiKeys)
    .where(eq(organizationApiKeys.organizationId, organizationId));
  return row ?? null;
}

/**
 * Store (or replace) the organization's key. `ciphertext` must already be
 * encrypted; the caller has validated the key with the provider just now,
 * so `validatedAt` is that moment. Nothing is returned — in particular not
 * the ciphertext, which the app role could not read back anyway.
 */
export async function upsertOrganizationApiKey(
  db: DbExecutor,
  values: { organizationId: string; ciphertext: string; keyHint: string; createdBy: string | null; validatedAt: Date },
): Promise<void> {
  const now = new Date();
  const row = {
    provider: 'anthropic',
    ciphertext: values.ciphertext,
    keyHint: values.keyHint,
    createdBy: values.createdBy,
    // A replaced key is a new key: its "added" date is now, not the old one's.
    createdAt: now,
    validatedAt: values.validatedAt,
  };
  await db
    .insert(organizationApiKeys)
    .values({ organizationId: values.organizationId, ...row })
    .onConflictDoUpdate({ target: organizationApiKeys.organizationId, set: row });
}

/** Remove the organization's key. Returns the hint of the key removed, or null when none was on file. */
export async function deleteOrganizationApiKey(db: DbExecutor, organizationId: string): Promise<string | null> {
  const [row] = await db
    .delete(organizationApiKeys)
    .where(eq(organizationApiKeys.organizationId, organizationId))
    .returning({ keyHint: organizationApiKeys.keyHint });
  return row?.keyHint ?? null;
}

// ---- The research spend gate ------------------------------------------------------

/**
 * Who pays for a research spend (SPEC-v7 §4): the organization's own
 * Anthropic API key, or the plan's research-session allowance on the
 * deployment's key.
 */
export type ResearchFunding = 'organization_key' | 'plan';

export interface ResearchGate {
  subscription: Subscription | null;
  funding: ResearchFunding;
  check: ResearchQuotaCheck;
}

/**
 * Pure: the gate's decision from the facts it reads — the subscription, the
 * period's usage, and whether a key is on file. Shared by the gate below
 * (which reads those facts under the subscription lock) and by pages that
 * preview what a click would do (apps/web/lib/billing.ts), so the preview
 * and the decision cannot disagree.
 *
 * - The organization must be in good standing, whoever pays (core
 *   `standing`: no plan, an expired trial, a canceled or unpaid subscription
 *   all refuse). The key pays for model tokens, not for hosting, review, and
 *   support (SPEC-v7 §4: "Hosting after the trial still needs a plan").
 * - With a key on file, the sessions run on that key, so the plan's session
 *   allowance is not checked — that is the only thing a key waives
 *   (SPEC-v7 §4: "sessions are then not counted against a plan's allowance").
 * - Without one, the allowance is checked as always (core
 *   checkResearchQuota).
 */
export function decideResearchSpend(
  sub: Subscription | null,
  used: number,
  hasOrganizationKey: boolean,
  requested: number,
  now: Date = new Date(),
): Omit<ResearchGate, 'subscription'> {
  if (!hasOrganizationKey) {
    return { funding: 'plan', check: checkResearchQuota(sub, used, requested, now) };
  }
  if (!sub || !standing(sub, now).active) {
    // Standing refusals read the same whoever pays; checkResearchQuota phrases them.
    return { funding: 'organization_key', check: checkResearchQuota(sub, used, requested, now) };
  }
  const limit = effectiveLimits(sub).researchSessions;
  return {
    funding: 'organization_key',
    check: { allowed: true, used, limit, remaining: Math.max(0, limit - used), message: null },
  };
}

/**
 * The one gate in front of every research spend — a research run's apply
 * (apps/web/lib/research.ts) and a policy analysis's creation
 * (apps/web/lib/policy-actions.ts). Call it inside the transaction that
 * records the spend: it locks the organization's subscription row first, so
 * two concurrent spends are decided one after the other. The rules are
 * decideResearchSpend's.
 *
 * Usage stays recorded per session as before: researchSessionsUsed counts
 * every run and analysis, whoever paid, because neither row records how it
 * was paid (the decision is in the audit entry of the apply or creation).
 * While a key is on file that count is informational; if the key is
 * removed, sessions already run in the period count toward the allowance.
 */
export async function gateResearchSpend(
  tx: DbExecutor,
  organizationId: string,
  requested: number,
  now: Date = new Date(),
): Promise<ResearchGate> {
  const sub = await lockSubscription(tx, organizationId);
  const used = sub ? await researchSessionsUsed(tx, organizationId, sub.currentPeriodStart, sub.currentPeriodEnd) : 0;
  const hasKey = (await organizationApiKeyInfo(tx, organizationId)) !== null;
  return { subscription: sub, ...decideResearchSpend(sub, used, hasKey, requested, now) };
}
