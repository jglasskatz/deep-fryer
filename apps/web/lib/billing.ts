import 'server-only';
import { cache } from 'react';
import { and, asc, eq, isNotNull, isNull, notExists } from 'drizzle-orm';
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
  researchRuns,
  researchSessionsOnOrganizationKey,
  researchSessionsUsed,
  seatCount,
  subscriptionFor,
  tenants,
  type OrganizationApiKeyInfo,
  type ResearchFunding,
  type Subscription,
} from '@deep-fryer/db';
import { UserError } from './action-result';
import { systemDb } from './db';
import { bringYourOwnKeyAvailable, deploymentResearchKeyConfigured, supportEmail } from './env';

/**
 * Billing reads for pages (SPEC-v4 §3). One summary shape, so the org hub,
 * the research page's quota line, and the billing page cannot disagree about
 * what an organization has used or may do.
 */
export interface BillingSummary {
  subscription: Subscription | null;
  plan: PlanDefinition | null;
  standing: Standing;
  /**
   * Human-readable reason research is unavailable, when it is: the plan's
   * standing first (no plan yet, a lapsed one), then — for an organization in
   * good standing whose research the plan would pay for — a deployment that
   * has no research key of its own (researchUnavailableNotice).
   */
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
    sub ? researchSessionsUsed(db, organizationId, sub.currentPeriodStart) : 0,
    sub ? researchSessionsOnOrganizationKey(db, organizationId, sub.currentPeriodStart) : 0,
    portraitCount(db, organizationId),
    seatCount(db, organizationId),
    organizationApiKeyInfo(db, organizationId),
  ]);
  const s = standing(sub);
  // With no key on file the plan pays, and the plan's sessions run on the deployment's key.
  const planUnusable = s.active && apiKey === null && !deploymentResearchKeyConfigured();
  return {
    subscription: sub,
    plan: sub && isPlanId(sub.plan) ? PLANS[sub.plan] : null,
    standing: s,
    blockedMessage: standingMessage(s.reason) ?? (planUnusable ? researchUnavailableNotice() : null),
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
 * "Contact …" for the end of a message a customer cannot act on alone: the
 * deployment's support address (SUPPORT_EMAIL), or whoever runs the server
 * when none is set (development; production requires one). Pages that can
 * render a link make the address a mailto link themselves.
 */
export function contactSentence(contact: string | null = supportEmail()): string {
  return contact ? `Contact ${contact}.` : 'Contact whoever runs this server.';
}

/**
 * Why research is refused when the gate puts it on the organization's own key
 * but this server cannot read stored keys (DF_SECRETS_KEY unset: lost in a
 * restore, or removed by an operator who stopped offering the option). The
 * worker would only fail every session (apps/worker org-key.ts
 * ORG_KEY_NO_SECRETS_KEY), and work put on the key never moves to the
 * deployment's key — it was not checked against the plan's allowance — so
 * nothing is started. Either way out works: the operator sets the secret, or
 * an owner removes the key (removal needs no secret), which puts research
 * back on the plan. Customer-facing, so it names no setting — the server log
 * does (assertFundingUsable).
 */
export function orgKeyUnreadableMessage(contact: string | null = supportEmail()): string {
  return `Research would run on this organization’s own Anthropic API key, but this server isn’t set up to use stored organization keys right now — nothing was charged. An organization owner can remove the key under Billing to run research on the plan instead. ${contactSentence(contact)}`;
}

/**
 * Why research the plan would pay for is refused on a deployment without a
 * research key of its own (env.ts deploymentResearchKeyConfigured): every
 * session would fail in the worker for want of a key, so nothing is
 * recorded, reserved, or counted. The refusal at click time; pages and
 * previews say the same thing beforehand with researchUnavailableNotice.
 */
export function researchUnavailableMessage(contact: string | null = supportEmail()): string {
  return `Research isn't available on this server yet — nothing was charged. ${contactSentence(contact)}`;
}

/**
 * The same fact as researchUnavailableMessage, worded for before anything is
 * clicked (the meter's place on the research and policy pages, the billing
 * page, the build step's disabled button). Where organizations may store
 * their own key, research on it runs regardless, so the notice says so.
 */
export function researchUnavailableNotice(
  contact: string | null = supportEmail(),
  keysStorable: boolean = bringYourOwnKeyAvailable(),
): string {
  const ownKey = keysStorable
    ? ' Research on your organization’s own Anthropic API key can run meanwhile: an organization owner adds it under Billing.'
    : '';
  return `Research on your plan isn't available on this server yet. ${contactSentence(contact)}${ownKey}`;
}

/**
 * Why the gate's funding decision cannot be carried out on this server, or
 * null when it can: a key-funded spend while stored keys cannot be read, or a
 * plan-funded one while the deployment has no research key. Shared by the
 * refusal (assertFundingUsable) and the preview (previewResearchSpend), so a
 * button is never enabled for a click the action would refuse.
 */
function fundingProblem(
  funding: ResearchFunding,
  keysReadable: boolean,
  researchKeyConfigured: boolean,
): 'organization_key_unreadable' | 'no_research_key' | null {
  if (funding === 'organization_key') return keysReadable ? null : 'organization_key_unreadable';
  return researchKeyConfigured ? null : 'no_research_key';
}

/**
 * Refuse, before anything is recorded, research this server cannot carry out
 * on the funding the gate chose: the organization's key while stored keys
 * cannot be read (orgKeyUnreadableMessage), or the plan while the deployment
 * has no research key (researchUnavailableMessage). Called inside the gate's
 * transaction (lib/research.ts applyRun — every build, run and re-run —
 * and lib/policy-actions.ts), so a refusal rolls back the whole spend.
 * Research on the organization's own key never depends on the deployment's.
 *
 * The customer reads which way out there is; the operator reads, in the
 * server log, which setting is missing.
 */
export function assertFundingUsable(
  funding: ResearchFunding,
  keysReadable: boolean = bringYourOwnKeyAvailable(),
  researchKeyConfigured: boolean = deploymentResearchKeyConfigured(),
): void {
  const problem = fundingProblem(funding, keysReadable, researchKeyConfigured);
  if (problem === 'organization_key_unreadable') {
    console.warn('[billing] refused research on an organization key: DF_SECRETS_KEY is not set on the web service');
    throw new UserError(orgKeyUnreadableMessage());
  }
  if (problem === 'no_research_key') {
    console.warn(
      '[billing] refused plan-funded research: DF_RESEARCH_KEY_CONFIGURED is not "true" (the worker has no ANTHROPIC_API_KEY, or compose does not pass the flag to the web service)',
    );
    throw new UserError(researchUnavailableMessage());
  }
}

/**
 * What the billing page says about organizations' own keys on a server that
 * cannot read stored keys (DF_SECRETS_KEY unset), or null when it can. With no
 * key on file research simply runs on the plan; with one on file it does not —
 * the gate puts research on the key and assertFundingUsable refuses it — so
 * the page must not say "runs on your plan" then, and says how to get going.
 * It names no setting: the reader is a customer, who can only ask.
 */
export function apiKeyUnavailableNotice(
  keyOnFile: boolean,
  keysReadable: boolean = bringYourOwnKeyAvailable(),
  contact: string | null = supportEmail(),
): string | null {
  if (keysReadable) return null;
  return keyOnFile
    ? `The key on file can’t be used: this server isn’t set up to store organization keys. Until that changes, research and policy analyses are refused rather than run on your plan; an owner can remove the key to run them on your plan instead. ${contactSentence(contact)}`
    : `This server isn’t set up to store organization keys. ${contactSentence(contact)}`;
}

/**
 * What applying `sessions` research sessions would do right now — who would
 * pay and whether the gate would let it through — for pages that explain a
 * button before it is clicked ("Build my doughnut" on /start). The same
 * decision function as the gate itself (packages/db decideResearchSpend),
 * fed from the summary, then the same check that the chosen funding can be
 * carried out on this server (assertFundingUsable's), in the same order as
 * at apply; the gate re-decides under the lock at click time.
 */
export function previewResearchSpend(
  summary: BillingSummary,
  sessions: number,
  keysReadable: boolean = bringYourOwnKeyAvailable(),
  researchKeyConfigured: boolean = deploymentResearchKeyConfigured(),
): ResearchSpendPreview {
  const { funding, check } = decideResearchSpend(
    summary.subscription,
    summary.usage.researchSessions,
    summary.apiKey !== null,
    sessions,
  );
  // A standing or quota refusal comes first, as at apply, and reads the same whoever pays.
  if (check.allowed) {
    const problem = fundingProblem(funding, keysReadable, researchKeyConfigured);
    if (problem) {
      const message = problem === 'organization_key_unreadable' ? orgKeyUnreadableMessage() : researchUnavailableNotice();
      return { funding, allowed: false, message, remaining: check.remaining };
    }
  }
  return { funding, allowed: check.allowed, message: check.message, remaining: check.remaining };
}

/**
 * The organization's first portrait (in family order) that has never had
 * research applied — one set up at /start and not yet built — or null. The
 * billing page offers the way back to its build step (/start?portrait=…)
 * and returns there after checkout. Archived portraits do not count; a run
 * applied and since finished, failed or not, means the doughnut was built
 * once and later research goes through the research page.
 */
export async function firstUnbuiltPortrait(
  organizationId: string,
): Promise<{ id: string; slug: string; name: string } | null> {
  const db = systemDb();
  const [row] = await db
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
    .from(tenants)
    .where(
      and(
        eq(tenants.organizationId, organizationId),
        isNull(tenants.archivedAt),
        notExists(
          db
            .select({ id: researchRuns.id })
            .from(researchRuns)
            .where(and(eq(researchRuns.tenantId, tenants.id), isNotNull(researchRuns.appliedAt))),
        ),
      ),
    )
    .orderBy(asc(tenants.familyOrder), asc(tenants.createdAt))
    .limit(1);
  return row ?? null;
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
  cancel_scheduled: 'The subscription is set to end at the close of this period.',
};
