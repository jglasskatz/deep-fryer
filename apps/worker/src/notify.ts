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
} from '@deep-fryer/db';

/**
 * Staff notifications when a research run finishes (SPEC §6 behavior layer:
 * notifications.email_on_run_complete / email_on_flagged_finding).
 *
 * Recipients are the people who act on a run: the portrait's owners and
 * editors plus the organization's owners. One email per run; a failure to
 * send is logged and never fails the run — the review queue is the system
 * of record, email is a nudge.
 */

export interface RunSummary {
  tenantName: string;
  tenantSlug: string;
  runId: string;
  status: 'complete' | 'failed';
  sessions: number;
  failedSessions: number;
  findings: number;
  flagged: number;
  gaps: number;
}

export interface ComposedEmail {
  subject: string;
  text: string;
}

/** Pure: what to send for a run, given the tenant's preferences — or null for nothing. */
export function composeRunEmail(
  s: RunSummary,
  prefs: NotificationConfig,
  appUrl: string,
): ComposedEmail | null {
  const wantsRun = prefs.email_on_run_complete;
  const wantsFlags = prefs.email_on_flagged_finding && s.flagged > 0;
  if (!wantsRun && !wantsFlags) return null;

  const link = `${appUrl.replace(/\/+$/, '')}/${s.tenantSlug}/admin/review?run=${s.runId}`;
  const flaggedLine =
    s.flagged > 0
      ? `${s.flagged} finding${s.flagged === 1 ? '' : 's'} flagged by verification — each needs a human decision before anything is published.`
      : 'No findings were flagged by verification.';

  if (s.status === 'failed') {
    return {
      subject: `Research run failed — ${s.tenantName}`,
      text: [
        `A research run for ${s.tenantName} failed: ${s.failedSessions} of ${s.sessions} sessions did not complete.`,
        s.findings > 0
          ? `Findings recorded before the failure (${s.findings}) are in the review queue. Failed sessions are not counted against your plan.`
          : 'No findings were recorded. Failed sessions are not counted against your plan; if every session failed the same way, ask your administrator to check the research service configuration.',
        `Re-plan the affected dimensions from the review queue: ${link}`,
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
      `The research run for ${s.tenantName} finished: ${s.findings} findings (${s.gaps} documented data gap${s.gaps === 1 ? '' : 's'}) from ${s.sessions} sessions${s.failedSessions ? `, ${s.failedSessions} of which failed` : ''}.`,
      flaggedLine,
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
    sessions: sessions.length,
    failedSessions: sessions.filter((s) => s.status === 'failed').length,
    findings: runFindings.length,
    gaps: runFindings.filter((f) => f.payload.kind === 'gap').length,
    flagged: runFindings.filter(
      (f) => f.payload.kind === 'indicator' && f.verification && isFlagged(f.verification as FindingVerification),
    ).length,
  };
}

let transport: Transporter | null = null;

async function send(to: string[], email: ComposedEmail): Promise<void> {
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
    const email = composeRunEmail(summary, prefs, process.env.APP_URL ?? 'http://localhost:3000');
    if (!email) return;
    const to = await runRecipients(run!.tenantId);
    if (to.length === 0) return;
    await send(to, email);
  } catch (err) {
    console.error(`[notify] run ${runId}: ${err instanceof Error ? err.message : err}`);
  }
}
