import type { PlanId, SubscriptionStatus } from '@deep-fryer/core';
import { getDb, subscriptions } from '@deep-fryer/db';

/**
 * For tests only: put an organization on a paid plan, as a completed
 * checkout or a staff contract would. Nothing in the product gives an
 * organization research for free any more — provisionOrganization creates
 * no subscription — so a test of research spend buys its organization a
 * plan first: `researchSessions` sets the period's allowance (the contract
 * override), and `status` lets a test put the plan in bad standing. Writes in
 * the system context, like the provisioning it follows; a second call
 * replaces the first.
 */
export async function givePlan(
  organizationId: string,
  {
    plan = 'community',
    researchSessions = null,
    status = 'active',
  }: { plan?: Exclude<PlanId, 'trial'>; researchSessions?: number | null; status?: SubscriptionStatus } = {},
): Promise<void> {
  const start = new Date();
  const values = {
    plan,
    status,
    collection: 'card' as const,
    currentPeriodStart: start,
    currentPeriodEnd: new Date(start.getTime() + 30 * 86_400_000),
    researchSessionsOverride: researchSessions,
  };
  await getDb()
    .insert(subscriptions)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({ target: subscriptions.organizationId, set: values });
}
