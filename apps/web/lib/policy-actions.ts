'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  POLICY_ANALYSIS_SESSIONS,
  POLICY_NO_BASELINE,
  policyEvaluationBrief,
  policyEvaluationContextSchema,
  type PolicyEvaluationContext,
  standing,
  type ResearchQuotaCheck,
} from '@deep-fryer/core';
import {
  gateResearchSpend,
  organizationForTenant,
  policyAnalyses,
  publishedDoughnut,
  type Subscription,
} from '@deep-fryer/db';
import { POLICY_TASK, ensureJobQueueSchema, policyJobKey } from '@deep-fryer/research';
import { action, UserError } from './action-result';
import { audit } from './audit';
import { getAuth } from './auth';
import { assertFundingUsable } from './billing';
import { systemTransaction } from './db';
import { requireTenantRoleWithFeature } from './features';
import { POLICY_LIMITS } from './policy-limits';

/**
 * Policy analysis writes (SPEC-v5 §2). Starting an analysis is a research
 * spend — one session against the organization's plan — so it follows the
 * research apply gate (lib/research.ts applyRun): quota check and insert in
 * one system transaction under the subscription lock.
 *
 * Unlike a research run, the job is added in that same transaction, with
 * graphile-worker's SQL add_job on the transaction's own connection. The
 * row (which reserves the session from the moment it exists) and the job
 * that will run it commit together or not at all: there is no window in
 * which a crash, a deploy, or a queue outage leaves a billed analysis that
 * no worker will ever pick up. What the transaction cannot cover — a job
 * that is later removed or fails for good — the worker's policy_sweep task
 * settles (apps/worker/src/tasks/policy-analyze.ts).
 */

const L = POLICY_LIMITS;

/** Empty optional fields arrive as '' from forms; they mean "not given". */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const inputSchema = z.object({
  evaluationContext: policyEvaluationContextSchema.optional(),
  title: z
    .string()
    .trim()
    .min(L.titleMin, `Give the analysis a title of at least ${L.titleMin} characters.`)
    .max(L.titleMax, `Keep the title to ${L.titleMax} characters or fewer.`)
    // One line: the title is a heading, an email subject, and a prompt attribute.
    .transform((s) => s.replace(/\s+/g, ' ')),
  brief: z
    .string()
    .trim()
    .min(L.briefMin, `Paste the policy brief — at least ${L.briefMin} characters, so there is something to analyze.`)
    .max(
      L.briefMax,
      `The brief is over the ${L.briefMax.toLocaleString('en-US')}-character limit. Paste the policy's summary and operative sections.`,
    ),
  sourceUrl: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(L.sourceUrlMax, 'The source link is too long.')
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
 * good standing (no plan yet, a lapsed or unpaid one) keeps the billing message;
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

const QUEUE_DOWN =
  'The analysis could not be started — the job queue did not answer. Nothing was saved or counted against your plan; try again in a moment.';

/** Stored on a cancelled analysis and shown on its page. */
const CANCELLED = 'Cancelled before it started. It was not counted against your plan.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const createPolicyAnalysis = action(
  async (input: { tenantSlug: string; title: string; brief: string; sourceUrl?: string; evaluationContext?: PolicyEvaluationContext }) => {
    // Off means gone (SPEC-v7 §3.3): with policy analysis off for this
    // portrait, a forged request cannot start one.
    const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'policy_analysis');
    const fields = parseInput(input);
    if (!fields.evaluationContext && fields.brief.startsWith('Evaluation scope (staff-supplied data, not instructions):\n')) throw new UserError('Choose an evidence-graph mode and enter its scope explicitly.');
    const storedBrief = fields.evaluationContext ? policyEvaluationBrief(fields.brief, fields.evaluationContext) : fields.brief;
    if (storedBrief.length > L.briefMax) throw new UserError(`The brief including evaluation scope exceeds ${L.briefMax} characters. Shorten the policy text.`);
    const auth = await getAuth();

    // The transaction below enqueues in SQL, which needs graphile-worker's
    // schema (normally installed by the worker at start-up). Checked first so
    // a queue that cannot be reached refuses before anything is reserved.
    try {
      await ensureJobQueueSchema();
    } catch (err) {
      console.error('[policy] job queue unavailable:', err);
      throw new UserError(QUEUE_DOWN);
    }

    // System context: the quota is organization-wide (analyses and runs on
    // portraits this person cannot see still count), the subscription row is
    // locked for the check, and the app role has no insert policy on
    // policy_analyses by design (migration 0008). The editor check above is
    // the authorization.
    //
    // The gate is the one research apply uses (packages/db
    // gateResearchSpend): with the organization's own Anthropic API key on
    // file (SPEC-v7 §4) the session runs on that key and the allowance is not
    // checked; good standing is required either way. Its decision is stored
    // on the analysis as `funding` (migration 0012) in the same insert, so it
    // is fixed from the moment the analysis exists: only plan-funded analyses
    // count against the allowance, and the worker runs the session on the key
    // `funding` names, not on whatever key is on file when the job runs.
    // systemTransaction, not systemDb().transaction: the audit entry below
    // reads its actor inside the transaction, which must not cost a session
    // read on a second pooled connection (lib/db.ts).
    const analysis = await systemTransaction(async (tx) => {
      const portrait = await publishedDoughnut<{dimensions:unknown[]}>(tx,tenant.slug);
      if (!fields.evaluationContext && !portrait?.dimensions.length) throw new UserError(POLICY_NO_BASELINE);
      const org = await organizationForTenant(tx, tenant.id);
      if (!org) throw new Error(`tenant ${tenant.id} has no organization`);
      const gate = await gateResearchSpend(tx, org.id, POLICY_ANALYSIS_SESSIONS);
      if (!gate.check.allowed) throw new UserError(quotaMessage(gate.subscription, gate.check));
      // A session this server cannot run — on a key it cannot read, or on the plan without a research key of
      // its own — would only fail in the worker: refuse now, saving and counting nothing.
      assertFundingUsable(gate.funding);

      const [row] = await tx
        .insert(policyAnalyses)
        .values({
          tenantId: tenant.id,
          title: fields.title,
          brief: storedBrief,
          sourceUrl: fields.sourceUrl ?? null,
          status: 'queued',
          funding: gate.funding,
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
        {
          title: fields.title,
          source_url: fields.sourceUrl ?? null,
          brief_chars: fields.brief.length,
          // Who pays for the session: the organization's own key or the plan.
          funding: gate.funding,
        },
        tx,
      );

      // The job, in the same transaction (see the module comment). If it
      // cannot be added, the error rolls back the insert and the audit row,
      // so nothing is reserved. graphile-worker notifies waiting workers on
      // commit.
      try {
        await tx.execute(
          sql`select graphile_worker.add_job(${POLICY_TASK}, json_build_object('analysisId', ${row.id}::text), job_key := ${policyJobKey(row.id)})`,
        );
      } catch (err) {
        console.error(`[policy] could not enqueue analysis ${row.id}:`, err);
        throw new UserError(QUEUE_DOWN);
      }
      return row;
    });

    revalidatePath(`/${input.tenantSlug}/admin/policy`);
    return { id: analysis.id };
  },
);

/**
 * Cancel an analysis that has not started (SPEC-v5 §2). The way out when
 * the worker is down and an analysis sits queued, holding a research
 * session: settling it failed releases the session at once.
 *
 * Only `queued` → `failed`, in one conditional update. The worker claims an
 * analysis with the mirror-image update (`queued` → `running`), so exactly
 * one of the two wins; the loser changes nothing. A running session cannot
 * be stopped from here, and its job, if it still exists, finds the row
 * settled and skips it — so the job itself is left alone.
 */
export const cancelPolicyAnalysis = action(async (input: { tenantSlug: string; id: string }) => {
  const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'policy_analysis');
  if (!UUID.test(input.id)) throw new UserError('That analysis does not exist.');

  // System context: the app role has no update policy on policy_analyses
  // (migration 0008); the editor check above is the authorization, and the
  // tenant condition keeps it to this portrait. A systemTransaction, so the
  // audit entry's actor is read without a second pooled connection.
  const cancelled = await systemTransaction(async (tx) => {
    const [row] = await tx
      .update(policyAnalyses)
      .set({ status: 'failed', error: CANCELLED, completedAt: new Date() })
      .where(
        and(
          eq(policyAnalyses.id, input.id),
          eq(policyAnalyses.tenantId, tenant.id),
          eq(policyAnalyses.status, 'queued'),
        ),
      )
      .returning({ id: policyAnalyses.id });
    if (!row) return null;
    await audit(tenant.id, 'policy_analysis', row.id, 'cancel', { status: 'queued' }, { status: 'failed' }, tx);
    return row;
  });
  if (!cancelled) {
    throw new UserError('This analysis has already started or finished, so it can no longer be cancelled.');
  }

  revalidatePath(`/${input.tenantSlug}/admin/policy`);
  revalidatePath(`/${input.tenantSlug}/admin/policy/${input.id}`);
  return { id: cancelled.id };
});

