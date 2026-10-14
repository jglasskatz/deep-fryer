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
  getDb,
  portraitCount,
  researchSessionsUsed,
  seatCount,
  subscriptionFor,
  type Subscription,
} from '@deep-fryer/db';

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
}

export const billingSummary = cache(async (organizationId: string): Promise<BillingSummary> => {
  const db = getDb();
  const sub = await subscriptionFor(db, organizationId);
  const [researchSessions, portraits, seats] = await Promise.all([
    sub ? researchSessionsUsed(db, organizationId, sub.currentPeriodStart, sub.currentPeriodEnd) : 0,
    portraitCount(db, organizationId),
    seatCount(db, organizationId),
  ]);
  const s = standing(sub);
  return {
    subscription: sub,
    plan: sub && isPlanId(sub.plan) ? PLANS[sub.plan] : null,
    standing: s,
    blockedMessage: standingMessage(s.reason),
    limits: sub ? effectiveLimits(sub) : null,
    usage: { researchSessions, portraits, seats },
  };
});

export const WARNING_COPY: Record<NonNullable<Standing['warning']>, string> = {
  past_due:
    'An invoice is past due. Research continues while it is settled — pay or contact us from Billing.',
  trial_ending: 'The trial ends within a week. Choose a plan under Billing to keep researching.',
  cancel_scheduled: 'The subscription is set to end at the close of this period.',
};
