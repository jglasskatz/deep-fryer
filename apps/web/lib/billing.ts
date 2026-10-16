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
  researchSessionsOnOrganizationKey,
  researchSessionsUsed,
  seatCount,
  subscriptionFor,
  type OrganizationApiKeyInfo,
  type ResearchFunding,
  type Subscription,
} from '@deep-fryer/db';
import { UserError } from './action-result';
import { systemDb } from './db';
import { bringYourOwnKeyAvailable } from './env';

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
  /**
   * `researchSessions` is the plan's allowance used this period — plan-funded
   * sessions only (packages/db researchSessionsUsed), the number the research
   * gate checks. `researchSessionsOnKey` counts, by the same rules, sessions
   * that ran or are reserved to run on the organization's own API key: no
   * allowance applies to them, so pages name them apart from the meter
   * (keyFundedSessionsNote).
   */
  usage: { researchSessions: number; researchSessionsOnKey: number; portraits: number; seats: number };
  /**
   * The organization's own Anthropic API key on file (SPEC-v7 §4) — its
   * hint and dates only; the ciphertext is never selected — or null.
   */
  apiKey: OrganizationApiKeyInfo | null;
}

export const billingSummary = cache(async (organizationId: string): Promise<BillingSummary> => {
  const db = systemDb();
  const sub = await subscriptionFor(db, organizationId);
  const [researchSessions, researchSessionsOnKey, portraits, seats, apiKey] = await Promise.all([
    sub ? researchSessionsUsed(db, organizationId, sub.currentPeriodStart, sub.currentPeriodEnd) : 0,
    sub ? researchSessionsOnOrganizationKey(db, organizationId, sub.currentPeriodStart, sub.currentPeriodEnd) : 0,
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
    usage: { researchSessions, researchSessionsOnKey, portraits, seats },
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
 * Why research is refused when the gate puts it on the organization's own key
 * but this server cannot read stored keys: DF_SECRETS_KEY is unset (lost in a
 * restore, or removed by an operator who stopped offering the option). The
 * worker would only fail every session (apps/worker org-key.ts
 * ORG_KEY_NO_SECRETS_KEY), and work put on the key never moves to the
 * deployment's key — it was not checked against the plan's allowance — so
 * nothing is started. Either way out works: the operator sets the secret, or
 * an owner removes the key (removal needs no secret), which puts research
 * back on the plan.
 */
export const ORG_KEY_UNREADABLE =
  'Research would run on this organization’s own Anthropic API key, but this server cannot read stored keys: the operator has not set DF_SECRETS_KEY. Ask the operator to set it, or have an organization owner remove the key under Billing to run research on the plan instead.';

/**
 * Refuse, before anything is recorded, research the gate put on the
 * organization's key while this server cannot read it (ORG_KEY_UNREADABLE).
 * Called inside the gate's transaction (lib/research.ts applyRun,
 * lib/policy-actions.ts), so a refusal rolls back the whole spend.
 */
export function assertFundingUsable(funding: ResearchFunding, keysReadable: boolean = bringYourOwnKeyAvailable()): void {
  if (funding === 'organization_key' && !keysReadable) throw new UserError(ORG_KEY_UNREADABLE);
}

/**
 * What the billing page says about organizations' own keys on a server that
 * cannot read stored keys (DF_SECRETS_KEY unset), or null when it can. With no
 * key on file research simply runs on the plan; with one on file it does not —
 * the gate puts research on the key and assertFundingUsable refuses it — so
 * the page must not say "runs on your plan" then, and says how to get going.
 */
export function apiKeyUnavailableNotice(
  keyOnFile: boolean,
  keysReadable: boolean = bringYourOwnKeyAvailable(),
): string | null {
  if (keysReadable) return null;
  return keyOnFile
    ? 'The key on file cannot be used on this server: the operator has not set DF_SECRETS_KEY, which keys are encrypted with. Until it is set, research and policy analyses are refused rather than run on your plan; an owner can remove the key to run them on your plan instead.'
    : 'Using your own key is not available on this server: the operator has not set DF_SECRETS_KEY, which keys are encrypted with. Research runs on your plan.';
}

/**
 * What applying `sessions` research sessions would do right now — who would
 * pay and whether the gate would let it through — for pages that explain a
 * button before it is clicked ("Build my doughnut" on /start). The same
 * decision function as the gate itself (packages/db decideResearchSpend),
 * fed from the summary, and the same refusal of a key this server cannot
 * read (assertFundingUsable); the gate re-decides under the lock at click
 * time.
 */
export function previewResearchSpend(
  summary: BillingSummary,
  sessions: number,
  keysReadable: boolean = bringYourOwnKeyAvailable(),
): ResearchSpendPreview {
  const { funding, check } = decideResearchSpend(
    summary.subscription,
    summary.usage.researchSessions,
    summary.apiKey !== null,
    sessions,
  );
  // A standing refusal reads the same whoever pays, so it keeps its own words.
  if (check.allowed && funding === 'organization_key' && !keysReadable) {
    return { funding, allowed: false, message: ORG_KEY_UNREADABLE, remaining: check.remaining };
  }
  return { funding, allowed: check.allowed, message: check.message, remaining: check.remaining };
}

/**
 * The sentence that goes with every research-session meter (the org hub, the billing page, the research and policy
 * pages). The meter is the plan's allowance — plan-funded sessions only (`usage.researchSessions`) — so its label
 * alone no longer says what an organization researching on its own API key has run. This names the sessions the
 * research gate put on that key, with their count when there were any this period whether or not the key is still on
 * file (a key removed mid-period does not hand its sessions to the plan), and is empty when there is nothing to
 * qualify: no key on file and nothing run on one. It speaks of the allowance rather than of "the meter above" because
 * the research and policy pages show their standing message in the meter's place when research is blocked. One
 * function, so the pages cannot word it differently.
 */
export function keyFundedSessionsNote(summary: BillingSummary): string {
  const onKey = summary.usage.researchSessionsOnKey;
  if (onKey === 0 && !summary.apiKey) return '';
  const note = 'Research sessions on the organization’s own API key do not count against the plan’s allowance';
  return onKey > 0 ? `${note} (${onKey.toLocaleString('en-US')} this period).` : `${note}.`;
}

export const WARNING_COPY: Record<NonNullable<Standing['warning']>, string> = {
  past_due:
    'An invoice is past due. Research continues while it is settled — pay or contact us from Billing.',
  trial_ending: 'The trial ends within a week. Choose a plan under Billing to keep researching.',
  cancel_scheduled: 'The subscription is set to end at the close of this period.',
};
