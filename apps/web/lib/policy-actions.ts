'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  POLICY_ANALYSIS_SESSIONS,
  POLICY_BRIEF_MAX_CHARS,
  checkResearchQuota,
  standing,
  type ResearchQuotaCheck,
} from '@deep-fryer/core';
import {
  lockSubscription,
  organizationForTenant,
  policyAnalyses,
  researchSessionsUsed,
  type Subscription,
} from '@deep-fryer/db';
import { enqueuePolicyAnalysis } from '@deep-fryer/research';
import { action, UserError } from './action-result';
import { audit } from './audit';
import { getAuth, requireTenantRole } from './auth';
import { systemDb } from './db';

/**
 * Policy analysis writes (SPEC-v5 §2). Starting an analysis is a research
 * spend — one session against the organization's plan — so it follows the
 * research apply gate (lib/research.ts applyRun): quota check and insert in
 * one system transaction under the subscription lock, the queue insert after
 * commit, and a failed enqueue settles the row as failed so the reserved
 * session is released (researchSessionsUsed skips failed analyses).
 */

const BRIEF_MIN_CHARS = 50;
const TITLE_MIN_CHARS = 3;
const TITLE_MAX_CHARS = 200;

/** Empty optional fields arrive as '' from forms; they mean "not given". */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const inputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(TITLE_MIN_CHARS, `Give the analysis a title of at least ${TITLE_MIN_CHARS} characters.`)
    .max(TITLE_MAX_CHARS, `Keep the title to ${TITLE_MAX_CHARS} characters or fewer.`)
    // One line: the title is a heading, an email subject, and a prompt attribute.
    .transform((s) => s.replace(/\s+/g, ' ')),
  brief: z
    .string()
    .trim()
    .min(BRIEF_MIN_CHARS, `Paste the policy brief — at least ${BRIEF_MIN_CHARS} characters, so there is something to analyze.`)
    .max(
      POLICY_BRIEF_MAX_CHARS,
      `The brief is over the ${POLICY_BRIEF_MAX_CHARS.toLocaleString('en-US')}-character limit. Paste the policy's summary and operative sections.`,
    ),
  sourceUrl: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(2000, 'The source link is too long.')
      .url('The source must be a full link, starting with https://.')
      // https only (the model may fetch it; the page links it): the same rule
      // the analysis schema applies to the sources it cites.
      .refine((u) => /^https:\/\//i.test(u), 'The source link must start with https://.')
      .optional(),
  ),
});

/** Validation failures read as one plain sentence, not "brief: String must contain…". */
function parseInput(input: unknown): z.infer<typeof inputSchema> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new UserError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
  }
  return parsed.data;
}

/**
 * The quota refusal in the terms of this action. An organization without
 * good standing (no plan, trial over, unpaid) keeps the billing message;
 * one that has simply spent its allowance hears what an analysis costs —
 * the shared research message speaks of "this run".
 */
function quotaMessage(sub: Subscription | null, check: ResearchQuotaCheck): string {
  if (!sub || !standing(sub).active) {
    return check.message ?? 'Research is not available on this plan.';
  }
  const n = POLICY_ANALYSIS_SESSIONS;
  return `A policy analysis uses ${n} research session${n === 1 ? '' : 's'}; ${check.remaining} of ${check.limit} remain this billing period. Wait for the period to renew on ${sub.currentPeriodEnd.toISOString().slice(0, 10)}, or upgrade the plan.`;
}

const NOT_QUEUED =
  'The analysis could not be queued for the worker, so it never ran. It was not counted against your plan.';

export const createPolicyAnalysis = action(
  async (input: { tenantSlug: string; title: string; brief: string; sourceUrl?: string }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
    const fields = parseInput(input);
    const auth = await getAuth();

    // System context: the quota is organization-wide (analyses and runs on
    // portraits this person cannot see still count), the subscription row is
    // locked for the check, and the app role has no insert policy on
    // policy_analyses by design (migration 0008). The editor check above is
    // the authorization.
    const db = systemDb();
    const analysis = await db.transaction(async (tx) => {
      const org = await organizationForTenant(tx, tenant.id);
      if (!org) throw new Error(`tenant ${tenant.id} has no organization`);
      const sub = await lockSubscription(tx, org.id);
      const used = sub
        ? await researchSessionsUsed(tx, org.id, sub.currentPeriodStart, sub.currentPeriodEnd)
        : 0;
      const check = checkResearchQuota(sub, used, POLICY_ANALYSIS_SESSIONS);
      if (!check.allowed) throw new UserError(quotaMessage(sub, check));

      const [row] = await tx
        .insert(policyAnalyses)
        .values({
          tenantId: tenant.id,
          title: fields.title,
          brief: fields.brief,
          sourceUrl: fields.sourceUrl ?? null,
          status: 'queued',
          requestedBy: auth.userId,
        })
        .returning({ id: policyAnalyses.id });
      if (!row) throw new Error('policy analysis insert returned no row');
      // The brief itself stays on the analysis row; the audit trail records
      // that one was submitted and how large it was.
      await audit(
        tenant.id,
        'policy_analysis',
        row.id,
        'create',
        null,
        { title: fields.title, source_url: fields.sourceUrl ?? null, brief_chars: fields.brief.length },
        tx,
      );
      return row;
    });

    const listPath = `/${input.tenantSlug}/admin/policy`;
    try {
      await enqueuePolicyAnalysis(analysis.id);
    } catch (err) {
      console.error(`[policy] enqueue failed for analysis ${analysis.id}:`, err);
      await db
        .update(policyAnalyses)
        .set({ status: 'failed', error: NOT_QUEUED, completedAt: new Date() })
        .where(and(eq(policyAnalyses.id, analysis.id), eq(policyAnalyses.status, 'queued')));
      revalidatePath(listPath);
      throw new UserError(
        'The analysis could not be started — the job queue did not answer. It was not counted against your plan; try again in a moment.',
      );
    }

    revalidatePath(listPath);
    return { id: analysis.id };
  },
);
