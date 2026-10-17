import { createTransport, type Transporter } from 'nodemailer';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { isFlagged, type FindingVerification, type NotificationConfig } from '@deep-fryer/core';
import {
  findings,
  getDb,
  organizationMembers,
  researchRuns,
  researchSessions,
  tenantConfig,
  tenantMembers,
  tenants,
  users,
  type ResearchFunding,
} from '@deep-fryer/db';

/**
 * Staff notifications when a research run finishes (SPEC §6 behavior layer:
 * notifications.email_on_run_complete / email_on_flagged_finding).
 *
 * Recipients are the people who act on a run: the portrait's owners and
 * editors plus the organization's owners. One email per run; a failure to
 * send is logged and never fails the run — the review queue and the run
 * page are the system of record, email is a nudge.
 *
 * Where each email points: a run with findings to review, to the review
 * queue; a failed run, to its run page, which names the reason each session
 * stopped and who can fix it (apps/web lib/run-failure.ts) and offers to
 * plan the failed dimensions again. The email itself does not guess the
 * reason beyond what it knows — whose key the run used.
 */

export interface RunSummary {
  tenantName: string;
  tenantSlug: string;
  runId: string;
  status: 'complete' | 'failed';
  /**
   * Whose key the run used (research_runs.funding, migration 0012). A run on
   * the organization's own key is never counted against the plan, and when
   * all of it fails the usual cause is that key — which the organization's
   * owners fix, not the deployment's administrator — so the failure email
   * says so.
   */
  funding: ResearchFunding;
  /** The run's planned sessions. */
  sessions: number;
  /** Of those, the ones that did not complete: failed, or never started because the run stopped first. */
  failedSessions: number;
  findings: number;
  flagged: number;
  gaps: number;
}

export interface ComposedEmail {
  subject: string;
  text: string;
}

/**
 * Pure: what to send for a run, given the tenant's preferences — or null for
 * nothing. `support` is the deployment's SUPPORT_EMAIL, named when a failure
 * is most likely the research service's own to fix.
 */
export function composeRunEmail(
  s: RunSummary,
  prefs: NotificationConfig,
  appUrl: string,
  support: string | null = null,
): ComposedEmail | null {
  const wantsRun = prefs.email_on_run_complete;
  const wantsFlags = prefs.email_on_flagged_finding && s.flagged > 0;
  if (!wantsRun && !wantsFlags) return null;

  const base = appUrl.replace(/\/+$/, '');
  const link = `${base}/${s.tenantSlug}/admin/review?run=${s.runId}`;
  const runLink = `${base}/${s.tenantSlug}/admin/research/${s.runId}`;
  const flaggedLine =
    s.flagged > 0
      ? `${s.flagged} finding${s.flagged === 1 ? '' : 's'} flagged by verification — each needs a human decision before anything is published.`
      : 'No findings were flagged by verification.';

  if (s.status === 'failed') {
    const ownKey = s.funding === 'organization_key';
    const recorded =
      s.findings > 0
        ? `Findings recorded before the failure (${s.findings}) can be reviewed from the run page.`
        : 'No findings were recorded.';
    // Who acts depends on whose key the run used. On the organization's own
    // key, its failures are most often the key itself (revoked, out of
    // credit, a model it may not use), which an organization owner fixes
    // under Billing; one reason is not always the key's — "model not found"
    // can also be the research service's own model setting (org-key.ts
    // orgKeyRejected) — so the email says where to send that one rather than
    // blaming either side. On the plan's sessions, a run in which every
    // session failed the same way is almost always the research service's
    // own key or settings — never something the portrait's staff did — so
    // the email says it is for the people who run the service, and names
    // their address when the deployment has one. The run page says which.
    const operator = support ? `the people who run this service (${support})` : 'the people who run this service';
    const reason = ownKey
      ? s.findings > 0
        ? `${recorded} This run used your organization's own Anthropic API key, so none of it is counted against your plan. If the key was refused, the run page says why and what an organization owner can do.`
        : `${recorded} This run used your organization's own Anthropic API key, so none of it is counted against your plan. If every session failed the same way, check that key first: the run page says why each session stopped, and an organization owner can replace the key under Billing. If it says the model setting may be wrong instead, pass it on to ${operator}.`
      : s.findings > 0
        ? `${recorded} Sessions that failed or did not run are not counted against your plan. The run page says why each one stopped.`
        : `${recorded} Sessions that failed or did not run are not counted against your plan. When every session fails the same way, the cause is usually on the research service's side (its key or its settings), which is for ${operator} to fix, not you; the run page says why each session stopped.`;
    return {
      subject: `Research run failed — ${s.tenantName}`,
      text: [
        `A research run for ${s.tenantName} failed: ${s.failedSessions} of ${s.sessions} sessions did not complete.`,
        reason,
        `See why, and plan the failed dimensions again: ${runLink}`,
      ].join('\n\n'),
    };
  }

  if (!wantsRun) {
    return {
      subject: `${s.flagged} flagged finding${s.flagged === 1 ? '' : 's'} to review — ${s.tenantName}`,
      text: [flaggedLine, `Review: ${link}`].join('\n\n'),
    };
  }

  return {
    subject: `Research run complete — ${s.tenantName}: ${s.findings} findings${s.flagged ? `, ${s.flagged} flagged` : ''}`,
    text: [
      `The research run for ${s.tenantName} finished: ${s.findings} findings (${s.gaps} documented data gap${s.gaps === 1 ? '' : 's'}) from ${s.sessions} sessions${s.failedSessions ? `, ${s.failedSessions} of which did not complete` : ''}.`,
      flaggedLine,
      ...(s.failedSessions
        ? [`The run page says why ${s.failedSessions === 1 ? 'that session' : 'those sessions'} stopped, and can plan ${s.failedSessions === 1 ? 'it' : 'them'} again: ${runLink}`]
        : []),
      'Nothing is public until a reviewer approves and publishes it.',
      `Open the review queue: ${link}`,
    ].join('\n\n'),
  };
}

/** Who gets told: portrait owners/editors and organization owners with an email. */
export async function runRecipients(tenantId: string): Promise<string[]> {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) return [];
  const [portraitPeople, orgOwners] = await Promise.all([
    db
      .select({ email: users.email })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(
        and(
          eq(tenantMembers.tenantId, tenantId),
          inArray(tenantMembers.role, ['owner', 'editor']),
          isNotNull(users.email),
        ),
      ),
    db
      .select({ email: users.email })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, tenant.organizationId),
          eq(organizationMembers.role, 'owner'),
          isNotNull(users.email),
        ),
      ),
  ]);
  return [...new Set([...portraitPeople, ...orgOwners].map((r) => r.email!.toLowerCase()))].sort();
}

export async function runSummary(runId: string): Promise<RunSummary | null> {
  const db = getDb();
  const [row] = await db
    .select({ run: researchRuns, tenant: tenants })
    .from(researchRuns)
    .innerJoin(tenants, eq(tenants.id, researchRuns.tenantId))
    .where(eq(researchRuns.id, runId));
  if (!row) return null;
  const sessions = await db
    .select({ id: researchSessions.id, status: researchSessions.status })
    .from(researchSessions)
    .where(eq(researchSessions.runId, runId));
  // The worker inserts a session row only when the session starts, so a run
  // stopped part-way has planned sessions with no row: they did not complete
  // either, and the email counts them with the failed ones.
  const planned = Math.max(row.run.plan.sessions.length, sessions.length);
  const neverStarted = planned - sessions.length;
  const runFindings = sessions.length
    ? await db
        .select({ payload: findings.payload, verification: findings.verification })
        .from(findings)
        .where(inArray(findings.sessionId, sessions.map((s) => s.id)))
    : [];
  return {
    tenantName: row.tenant.name,
    tenantSlug: row.tenant.slug,
    runId,
    status: row.run.status === 'failed' ? 'failed' : 'complete',
    funding: row.run.funding,
    sessions: planned,
    failedSessions: sessions.filter((s) => s.status === 'failed').length + neverStarted,
    findings: runFindings.length,
    gaps: runFindings.filter((f) => f.payload.kind === 'gap').length,
    flagged: runFindings.filter(
      (f) => f.payload.kind === 'indicator' && f.verification && isFlagged(f.verification as FindingVerification),
    ).length,
  };
}

let transport: Transporter | null = null;

/** The worker's one mail path (also used by tasks/policy-analyze.ts); logs instead of sending when SMTP is unset. */
export async function send(to: string[], email: ComposedEmail): Promise<void> {
  if (!process.env.SMTP_URL || !process.env.EMAIL_FROM) {
    console.info(`[notify] SMTP not configured; would email ${to.join(', ')}: ${email.subject}`);
    return;
  }
  transport ??= createTransport(process.env.SMTP_URL);
  // One message per recipient: staff addresses are never disclosed to each other.
  for (const address of to) {
    await transport.sendMail({ from: process.env.EMAIL_FROM, to: address, subject: email.subject, text: email.text });
  }
}

/** Called once per run after it settles. Never throws. */
export async function notifyRunFinished(runId: string): Promise<void> {
  try {
    const summary = await runSummary(runId);
    if (!summary) return;
    const [run] = await getDb().select({ tenantId: researchRuns.tenantId }).from(researchRuns).where(eq(researchRuns.id, runId));
    const [prefsRow] = await getDb()
      .select({ value: tenantConfig.value })
      .from(tenantConfig)
      .where(and(eq(tenantConfig.tenantId, run!.tenantId), eq(tenantConfig.key, 'notifications')));
    const prefs = (prefsRow?.value as NotificationConfig | undefined) ?? {
      email_on_run_complete: true,
      email_on_flagged_finding: true,
    };
    const email = composeRunEmail(
      summary,
      prefs,
      process.env.APP_URL ?? 'http://localhost:3000',
      process.env.SUPPORT_EMAIL?.trim() || null,
    );
    if (!email) return;
    const to = await runRecipients(run!.tenantId);
    if (to.length === 0) return;
    await send(to, email);
  } catch (err) {
    console.error(`[notify] run ${runId}: ${err instanceof Error ? err.message : err}`);
  }
}
