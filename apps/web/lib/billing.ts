import 'server-only';
import { cache } from 'react';
import {
  PLANS,
  effectiveLimits,
  isPlanId,
  standing,
  standingMessage,
  type Limits,
  type PlanDefinition,
  type Standing,
} from '@deep-fryer/core';
import {
  decideResearchSpend,
  organizationApiKeyInfo,
  portraitCount,
  researchSessionsUsed,
  seatCount,
  subscriptionFor,
  type OrganizationApiKeyInfo,
  type ResearchFunding,
  type Subscription,
} from '@deep-fryer/db';
import { systemDb } from './db';

/**
 * Billing reads for pages (SPEC-v4 §3). One summary shape, so the org hub,
 * the research page's quota line, and the billing page cannot disagree about
 * what an organization has used or may do.
 */
export interface BillingSummary {
  subscription: Subscription | null;
  plan: PlanDefinition | null;
  standing: Standing;
  /** Human-readable reason research is unavailable, when it is. */
  blockedMessage: string | null;
  limits: Limits | null;
  usage: { researchSessions: number; portraits: number; seats: number };
  /**
   * The organization's own Anthropic API key on file (SPEC-v7 §4) — its
   * hint and dates only; the ciphertext is never selected — or null.
   */
  apiKey: OrganizationApiKeyInfo | null;
}

export const billingSummary = cache(async (organizationId: string): Promise<BillingSummary> => {
  const db = systemDb();
  const sub = await subscriptionFor(db, organizationId);
  const [researchSessions, portraits, seats, apiKey] = await Promise.all([
    sub ? researchSessionsUsed(db, organizationId, sub.currentPeriodStart, sub.currentPeriodEnd) : 0,
    portraitCount(db, organizationId),
    seatCount(db, organizationId),
    organizationApiKeyInfo(db, organizationId),
  ]);
  const s = standing(sub);
  return {
    subscription: sub,
    plan: sub && isPlanId(sub.plan) ? PLANS[sub.plan] : null,
    standing: s,
    blockedMessage: standingMessage(s.reason),
    limits: sub ? effectiveLimits(sub) : null,
    usage: { researchSessions, portraits, seats },
    apiKey,
  };
});

export interface ResearchSpendPreview {
  funding: ResearchFunding;
  /** Whether the spend would pass the gate right now. */
  allowed: boolean;
  /** Why not, when it would not. */
  message: string | null;
  /** Sessions left in the plan's allowance this period (informational when funding is the key). */
  remaining: number;
}

/**
 * What applying `sessions` research sessions would do right now — who would
 * pay and whether the gate would let it through — for pages that explain a
 * button before it is clicked ("Build my doughnut" on /start). The same
 * decision function as the gate itself (packages/db decideResearchSpend),
 * fed from the summary; the gate re-decides under the lock at click time.
 */
export function previewResearchSpend(summary: BillingSummary, sessions: number): ResearchSpendPreview {
  const { funding, check } = decideResearchSpend(
    summary.subscription,
    summary.usage.researchSessions,
    summary.apiKey !== null,
    sessions,
  );
  return { funding, allowed: check.allowed, message: check.message, remaining: check.remaining };
}

export const WARNING_COPY: Record<NonNullable<Standing['warning']>, string> = {
  past_due:
    'An invoice is past due. Research continues while it is settled — pay or contact us from Billing.',
  trial_ending: 'The trial ends within a week. Choose a plan under Billing to keep researching.',
  cancel_scheduled: 'The subscription is set to end at the close of this period.',
};
