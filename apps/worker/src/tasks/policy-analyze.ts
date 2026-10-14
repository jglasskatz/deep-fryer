import type { Task } from 'graphile-worker';
import type { ZodError } from 'zod';
import { and, eq } from 'drizzle-orm';
import { frameworkDimension } from '@deep-fryer/contract';
import {
  policyAnalysisOutputSchema,
  policyAnalysisPrompt,
  projectDimensions,
  type DimensionData,
  type PublishedDimensionInput,
  type SessionTokenUsage,
} from '@deep-fryer/core';
import {
  getDb,
  policyAnalyses,
  publishedDoughnut,
  tenantConfig,
  tenants,
  users,
} from '@deep-fryer/db';
import type { PolicyJobPayload } from '@deep-fryer/research';
import { extractJson, runSessionWithRetry } from '../session.js';
import { send, type ComposedEmail } from '../notify.js';

/**
 * Policy analysis (SPEC-v5 §2): one Claude Agent SDK session reads a staff
 * member's policy brief and drafts projected impacts on the portrait's
 * doughnut dimensions. The output is untrusted until it passes
 * policyAnalysisOutputSchema; quantified projections are then re-scored with
 * the published thresholds (core projectDimensions) so a projected wedge and
 * a measured wedge share one scale. Nothing here is ever published — the
 * result lives in the staff plane, labeled as a projection.
 *
 * Billing: the analysis was counted as one research session when it was
 * queued (apps/web/lib/policy-actions.ts, under the subscription lock).
 * Settling it as failed releases that session, because
 * researchSessionsUsed() skips failed analyses — so every failure path below
 * must end in status 'failed', never leave the row queued or running.
 */

/** Read-only web tools, so quantified estimates can cite sources; nothing else. */
export const POLICY_SESSION_TOOLS = ['WebSearch', 'WebFetch'];

/** Stored on the row and shown to staff verbatim, so it is short and plain. */
const ERROR_MAX_CHARS = 400;

/**
 * A failure written for staff. Its message is stored on the analysis and
 * shown on the result page and in the email; anything else that throws is
 * logged in full and reported with a generic message, so stack traces and
 * internal details never reach the page.
 */
class AnalysisFailure extends Error {}

const INTERRUPTED =
  'The analysis was interrupted (the worker restarted before it finished). It was not counted against your plan; start it again.';
const SESSION_FAILED =
  'The analysis session did not complete, even after a retry. This is usually temporary; try again in a few minutes. If it keeps failing, ask your administrator to check the research service.';
const NO_JSON =
  'The analysis finished without a structured result, so there was nothing to project. Try running it again.';
const UNEXPECTED =
  'The analysis failed on our side before it finished. It has been logged; try again in a moment.';

/** The published portrait fields the analysis needs (published_doughnut() shape). */
interface PublishedPortraitDimensions {
  dimensions: {
    slug: string;
    canonical_slug: string | null;
    viz_level: number | null;
    data: DimensionData;
  }[];
}

export const policyAnalyze: Task = async (rawPayload, helpers) => {
  const { analysisId } = rawPayload as PolicyJobPayload;
  const db = getDb();

  // Atomic claim: only the queued → running transition runs the session, so
  // a duplicate job never spends twice. A no-op claim on a row that is still
  // `running` means the worker died mid-session and the queue redelivered
  // the job: settle it failed (mirrors research-apply.ts) so it is not billed
  // and never sits in `running` forever.
  const [analysis] = await db
    .update(policyAnalyses)
    .set({ status: 'running', startedAt: new Date() })
    .where(and(eq(policyAnalyses.id, analysisId), eq(policyAnalyses.status, 'queued')))
    .returning({
      id: policyAnalyses.id,
      tenantId: policyAnalyses.tenantId,
      title: policyAnalyses.title,
      brief: policyAnalyses.brief,
      sourceUrl: policyAnalyses.sourceUrl,
    });
  if (!analysis) {
    const [existing] = await db
      .select({ status: policyAnalyses.status })
      .from(policyAnalyses)
      .where(eq(policyAnalyses.id, analysisId));
    if (!existing) {
      helpers.logger.error(`policy analysis ${analysisId} not found`);
    } else if (existing.status === 'running') {
      helpers.logger.error(`policy analysis ${analysisId} was interrupted mid-session; marking failed`);
      await settleFailed(analysisId, INTERRUPTED, null, null);
      await notifyPolicyRequester(analysisId);
    } else {
      helpers.logger.warn(`policy analysis ${analysisId} is ${existing.status}; skipping`);
    }
    return;
  }

  // Kept outside the try so a failure after the session still records what
  // the session cost and what it said (the transcript is the audit trail).
  let usage: SessionTokenUsage | null = null;
  let transcript: Buffer | null = null;

  try {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, analysis.tenantId));
    if (!tenant) throw new Error(`tenant ${analysis.tenantId} missing`);

    const [regionRow] = await db
      .select({ value: tenantConfig.value })
      .from(tenantConfig)
      .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, 'region')));
    const regionName = (regionRow?.value as { name?: string } | undefined)?.name?.trim() || tenant.name;

    // The public read path: exactly the dimensions and indicators residents
    // see, so a projection names an indicator someone can look up.
    const portrait = await publishedDoughnut<PublishedPortraitDimensions>(db, tenant.slug);
    const published: PublishedDimensionInput[] = (portrait?.dimensions ?? []).map((d) => ({
      slug: frameworkSlug(d.slug, d.canonical_slug),
      viz_level: d.viz_level,
      data: d.data,
    }));

    const prompt = policyAnalysisPrompt({
      regionName,
      title: analysis.title,
      brief: analysis.brief,
      sourceUrl: analysis.sourceUrl,
      dimensions: published,
    });
    const session = await runSessionWithRetry({ prompt, allowedTools: POLICY_SESSION_TOOLS });
    usage = session.usage;
    transcript = session.transcript;
    if (!session.succeeded) throw new AnalysisFailure(SESSION_FAILED);

    let raw: unknown;
    try {
      raw = extractJson(session.resultText);
    } catch {
      throw new AnalysisFailure(NO_JSON);
    }
    const parsed = policyAnalysisOutputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AnalysisFailure(
        `The analysis returned a result that failed validation, so nothing from it was saved (${describeIssue(parsed.error)}). Try running it again.`,
      );
    }

    const projections = projectDimensions(published, parsed.data.impacts);
    await db
      .update(policyAnalyses)
      .set({
        status: 'complete',
        result: parsed.data,
        projections,
        error: null,
        tokenUsage: usage,
        transcript,
        completedAt: new Date(),
      })
      .where(and(eq(policyAnalyses.id, analysisId), eq(policyAnalyses.status, 'running')));
    helpers.logger.info(
      `policy analysis ${analysisId} complete: ${parsed.data.impacts.length} impacts, ${projections.length} dimensions`,
    );
  } catch (err) {
    const message = err instanceof AnalysisFailure ? err.message : UNEXPECTED;
    helpers.logger.error(
      `policy analysis ${analysisId} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    await settleFailed(analysisId, message, usage, transcript);
  }

  // Settled either way: tell the person who asked.
  await notifyPolicyRequester(analysisId);
};

/** Fail a running analysis with a staff-readable reason; keeps whatever the session cost. */
async function settleFailed(
  analysisId: string,
  error: string,
  usage: SessionTokenUsage | null,
  transcript: Buffer | null,
): Promise<void> {
  await getDb()
    .update(policyAnalyses)
    .set({
      status: 'failed',
      error: error.slice(0, ERROR_MAX_CHARS),
      completedAt: new Date(),
      // Only overwrite cost and transcript when this attempt produced them;
      // an interrupted run has nothing new to record.
      ...(usage ? { tokenUsage: usage } : {}),
      ...(transcript ? { transcript } : {}),
    })
    .where(and(eq(policyAnalyses.id, analysisId), eq(policyAnalyses.status, 'running')));
}

/**
 * Impacts name framework dimensions (the schema's 21 slugs). A tenant's
 * custom dimension maps back through canonical_slug, the same resolver
 * planning and rescoring use, so its indicators are offered under the
 * framework slug the model must answer with.
 */
function frameworkSlug(slug: string, canonicalSlug: string | null): string {
  return frameworkDimension(slug, canonicalSlug)?.slug ?? slug;
}

/** First schema problem, phrased for staff ("impacts › #1 › dimension_slug: …"). */
function describeIssue(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'unknown problem';
  const where = issue.path.length
    ? issue.path.map((p) => (typeof p === 'number' ? `#${p + 1}` : p)).join(' › ')
    : 'result';
  // Enum messages list every allowed value (21 slugs); the received value is
  // what staff need to see.
  const what =
    issue.code === 'invalid_enum_value'
      ? `unexpected value “${String(issue.received)}”`
      : issue.message;
  return `${where}: ${what}`.slice(0, 200);
}

// ---- Requester notice ------------------------------------------------------

export interface PolicyNotice {
  tenantName: string;
  tenantSlug: string;
  analysisId: string;
  title: string;
  status: 'complete' | 'failed';
  error: string | null;
  /** Impacts with a direction (not "none"). */
  impacts: number;
  /** Indicator-level projections re-scored against published data. */
  quantified: number;
}

/** Pure: the email to the person who started the analysis. */
export function composePolicyEmail(n: PolicyNotice, appUrl: string): ComposedEmail {
  const link = `${appUrl.replace(/\/+$/, '')}/${n.tenantSlug}/admin/policy/${n.analysisId}`;
  // Titles are staff-entered; keep the subject one line.
  const title = n.title.replace(/\s+/g, ' ').trim();
  if (n.status === 'failed') {
    return {
      subject: `Policy analysis failed — ${title}`,
      text: [
        `The policy analysis “${title}” for ${n.tenantName} did not finish.`,
        ...(n.error ? [`What happened: ${n.error}`] : []),
        'Failed analyses are not counted against your plan.',
        `Details: ${link}`,
      ].join('\n\n'),
    };
  }
  return {
    subject: `Policy analysis ready — ${title}`,
    text: [
      `The policy analysis “${title}” for ${n.tenantName} is ready: ${n.impacts} projected impact${n.impacts === 1 ? '' : 's'} on the doughnut's dimensions, ${n.quantified} quantified against published indicators.`,
      'It is a projection drafted with AI assistance for staff review — not a measurement — and nothing from it is published.',
      `Open it: ${link}`,
    ].join('\n\n'),
  };
}

/**
 * Email the requester once the analysis settles. Only the requester: an
 * analysis is one person's working draft, unlike a research run whose
 * findings wait in a shared review queue. Never throws — the result page is
 * the system of record, email is a nudge.
 */
export async function notifyPolicyRequester(analysisId: string): Promise<void> {
  try {
    const [row] = await getDb()
      .select({
        status: policyAnalyses.status,
        title: policyAnalyses.title,
        error: policyAnalyses.error,
        result: policyAnalyses.result,
        projections: policyAnalyses.projections,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        email: users.email,
      })
      .from(policyAnalyses)
      .innerJoin(tenants, eq(tenants.id, policyAnalyses.tenantId))
      .leftJoin(users, eq(users.id, policyAnalyses.requestedBy))
      .where(eq(policyAnalyses.id, analysisId));
    if (!row?.email || (row.status !== 'complete' && row.status !== 'failed')) return;
    const email = composePolicyEmail(
      {
        tenantName: row.tenantName,
        tenantSlug: row.tenantSlug,
        analysisId,
        title: row.title,
        status: row.status,
        error: row.error,
        impacts: (row.result?.impacts ?? []).filter((i) => i.direction !== 'none').length,
        quantified: (row.projections ?? []).reduce((n, p) => n + p.indicator_changes.length, 0),
      },
      process.env.APP_URL ?? 'http://localhost:3000',
    );
    await send([row.email], email);
  } catch (err) {
    console.error(`[notify] policy analysis ${analysisId}: ${err instanceof Error ? err.message : err}`);
  }
}
