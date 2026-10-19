import type { Task } from 'graphile-worker';
import type { ZodError } from 'zod';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { framework, frameworkDimension } from '@deep-fryer/contract';
import {
  POLICY_DIMENSION_SLUGS,
  POLICY_OUTPUT_LIMITS,
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
import { policyJobKey, type PolicyJobPayload } from '@deep-fryer/research';
import { portraitFeatures } from '../features.js';
import { OrgKeyUnavailableError, isKeyRejectedError, modelNamedIn, modelNotFoundLog, sessionApiKey } from '../org-key.js';
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
 * Billing: the research gate decided who pays when the analysis was queued
 * (apps/web/lib/policy-actions.ts, under the subscription lock) and stored it
 * on the row as `funding`. A plan-funded analysis was counted as one research
 * session then; settling it as failed releases that session, because
 * researchSessionsUsed() skips failed analyses — so every failure path below
 * must end in status 'failed', never leave the row queued or running. The
 * one path this task cannot see — a job that never runs at all — is the
 * policy_sweep task's (policySweep, below). The session runs on the key
 * `funding` names (org-key.ts sessionApiKey), not on whatever is on file now.
 *
 * Exports for the worker's task list (apps/worker/src/index.ts):
 * policyAnalyze as POLICY_TASK, and policySweep as POLICY_SWEEP_TASK on the
 * POLICY_SWEEP_CRONTAB schedule (both names from @deep-fryer/research).
 */

/**
 * The session's whole tool surface: read-only web tools, so quantified
 * estimates can cite sources. runSession makes this list the set of tools
 * that exist in the session (no shell, no file access) and withholds the
 * worker's secrets from the session's environment — the brief is untrusted
 * text an editor pasted, often from a third-party document.
 */
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

/**
 * The deployment's own key was refused (dead, out of credit, or not allowed the model). Such
 * refusals are not retried (org-key.ts KEY_REJECTED_ERRORS), so SESSION_FAILED's "even after a
 * retry" and "usually temporary" would be untrue; this is for the operator, not the requester.
 */
const DEPLOYMENT_KEY_REFUSED =
  'The analysis did not run: the research service’s Anthropic account refused the request. This is not temporary — ask your administrator to check the research service’s API key and model settings. It was not counted against your research sessions.';
const NO_JSON =
  'The analysis finished without a structured result, so there was nothing to project. Try running it again.';
/**
 * Shown with a result read from malformed output (session.ts extractJson
 * `salvaged`): only part of the answer could be read, so parts of the
 * analysis may be missing. Listed first among the adjustments on the result
 * page, where staff read how the answer was fitted to the format.
 */
export const PARTIAL_OUTPUT_NOTE =
  'The analysis returned malformed JSON and only part of it could be read, so parts of the analysis may be missing. Consider running it again.';
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
      funding: policyAnalyses.funding,
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

  // Staff may have turned policy analysis off after this was queued (SPEC-v7
  // §3.3): settle it failed before any session starts, which also releases
  // the research session it reserved (failed analyses are not counted).
  if (!(await portraitFeatures(db, analysis.tenantId)).policy_analysis) {
    helpers.logger.warn(`policy analysis ${analysisId}: the feature is off for this portrait; not running`);
    await settleFailed(analysisId, FEATURE_OFF, null, null);
    await notifyPolicyRequester(analysisId);
    return;
  }

  // Kept outside the try so a failure after the session still records what
  // the session cost and what it said (the transcript is the audit trail).
  let usage: SessionTokenUsage | null = null;
  let transcript: Buffer | null = null;

  try {
    // Whose key the session runs on (SPEC-v7 §4), as the research gate
    // decided when the analysis was created and stored in `funding`: the
    // organization's own Anthropic API key for a key-funded analysis, the
    // deployment's for a plan-funded one — even if a key has been added since,
    // because the analysis was counted against the plan. A key-funded analysis
    // whose key was removed since, or cannot be decrypted, fails with a reason
    // staff can act on — never a silent fall back to the deployment's key,
    // because it was not checked against the plan's allowance (packages/db
    // billing gateResearchSpend).
    let apiKey: string | null;
    try {
      apiKey = await sessionApiKey(db, analysis.tenantId, analysis.funding);
    } catch (err) {
      if (err instanceof OrgKeyUnavailableError) throw new AnalysisFailure(err.message);
      throw err;
    }

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, analysis.tenantId));
    if (!tenant) throw new Error(`tenant ${analysis.tenantId} missing`);

    const [regionRow] = await db
      .select({ value: tenantConfig.value })
      .from(tenantConfig)
      .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, 'region')));
    const regionName = (regionRow?.value as { name?: string } | undefined)?.name?.trim() || tenant.name;

    // The public read path: exactly the dimensions and indicators residents
    // see, so a projection names an indicator someone can look up. A custom
    // dimension with no framework mapping has no valid dimension_slug, so it
    // is neither offered to the model nor projected.
    const portrait = await publishedDoughnut<PublishedPortraitDimensions>(db, tenant.slug);
    const published: PublishedDimensionInput[] = (portrait?.dimensions ?? []).flatMap((d) => {
      const fw = frameworkDimension(d.slug, d.canonical_slug);
      return fw ? [{ slug: fw.slug, viz_level: d.viz_level, data: d.data }] : [];
    });

    const prompt = policyAnalysisPrompt({
      regionName,
      title: analysis.title,
      brief: analysis.brief,
      sourceUrl: analysis.sourceUrl,
      dimensions: published,
    });
    // Not orchestrated: a policy prompt ends with its own output contract,
    // and research's delegation note must not follow it.
    let session: Awaited<ReturnType<typeof runSessionWithRetry>>;
    try {
      session = await runSessionWithRetry({
        prompt,
        allowedTools: POLICY_SESSION_TOOLS,
        orchestrate: false,
        ...(apiKey ? { apiKey } : {}),
      });
    } catch (err) {
      // Anthropic refused the organization's own key (revoked, out of
      // credit, model not allowed): the session is not retried, and staff
      // read why, with what the session had spent kept on the row.
      if (err instanceof OrgKeyUnavailableError) {
        usage = err.usage ?? null;
        // A model id the API did not find may be the deployment's model
        // setting rather than the key: the operator reads this, staff the reason.
        if (err.rejection === 'model_not_found') {
          helpers.logger.error(`policy analysis ${analysisId}: ${modelNotFoundLog(err.model ?? '(model not named)', true)}`);
        }
        throw new AnalysisFailure(err.message);
      }
      throw err;
    }
    usage = session.usage;
    transcript = session.transcript;
    if (!session.succeeded) {
      if (session.apiError === 'model_not_found') {
        const model = modelNamedIn(session.apiErrorText) ?? session.usage.model ?? '(model not named)';
        helpers.logger.error(`policy analysis ${analysisId}: ${modelNotFoundLog(model, Boolean(apiKey))}`);
      }
      throw new AnalysisFailure(isKeyRejectedError(session.apiError) ? DEPLOYMENT_KEY_REFUSED : SESSION_FAILED);
    }

    let raw: unknown;
    let salvaged: boolean;
    try {
      ({ value: raw, salvaged } = extractJson(session.resultText, { kind: 'object' }));
    } catch {
      throw new AnalysisFailure(NO_JSON);
    }
    // Recoverable slips (a cited http:// page, a summary a little over the
    // limit) are fixed and noted for staff rather than failing an analysis
    // that already spent minutes of web research; what remains invalid fails.
    // A result read from malformed output is noted first (PARTIAL_OUTPUT_NOTE).
    const fitted = fitToContract(raw);
    if (salvaged) fitted.adjustments.unshift(PARTIAL_OUTPUT_NOTE);
    const parsed = policyAnalysisOutputSchema.safeParse(fitted.value);
    if (!parsed.success) {
      throw new AnalysisFailure(
        salvaged
          ? `The analysis returned malformed JSON, and the part that could be read failed validation, so nothing from it was saved (${describeIssue(parsed.error)}). Try running it again.`
          : `The analysis returned a result that failed validation, so nothing from it was saved (${describeIssue(parsed.error)}). Try running it again.`,
      );
    }

    const projections = projectDimensions(published, parsed.data.impacts);
    await db
      .update(policyAnalyses)
      .set({
        status: 'complete',
        result: parsed.data,
        projections,
        adjustments: fitted.adjustments.length ? fitted.adjustments : null,
        error: null,
        tokenUsage: usage,
        transcript,
        completedAt: new Date(),
      })
      .where(and(eq(policyAnalyses.id, analysisId), eq(policyAnalyses.status, 'running')));
    helpers.logger.info(
      `policy analysis ${analysisId} complete: ${parsed.data.impacts.length} impacts, ${projections.length} dimensions, ${fitted.adjustments.length} adjustments`,
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

/** Why an analysis queued before its feature was switched off did not run. */
export const FEATURE_OFF =
  'Policy analysis is turned off for this portrait, so this analysis did not run. It was not counted against your research sessions.';

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

// ---- Fitting the answer to the contract --------------------------------------

const L = POLICY_OUTPUT_LIMITS;
const SLUGS = new Set<string>(POLICY_DIMENSION_SLUGS);
const count = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const chars = (k: number) => `${k.toLocaleString('en-US')} characters`;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Shorten text to at most `max` characters (after trimming, as the schema
 * measures), ending on a whole word with an ellipsis so the cut is visible.
 */
function shorten(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * A dimension as the model named it, as one of the 21 framework slugs: the
 * slug itself, or the same slug or name written loosely ("income_work",
 * "Income & Work"). Null when it is no framework dimension at all.
 */
function resolveSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (SLUGS.has(value)) return value;
  const loose = (s: string) => s.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const wanted = loose(value);
  const hit = framework.dimensions.find((d) => loose(d.slug) === wanted || loose(d.name) === wanted);
  return hit?.slug ?? null;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Bring a model answer inside the output contract where that can be done
 * without inventing anything, before policyAnalysisOutputSchema checks it
 * (SPEC-v5 §2: the result is schema-validated). The schema is all-or-nothing,
 * and a whole analysis — minutes of web research, sometimes two sessions —
 * should not fail because one cited page was http:// or the summary ran a
 * sentence long. Every change is recorded as one plain sentence for staff
 * (stored as the analysis's `adjustments`, shown with the result):
 *
 * - sources that are not https links are left out; past the 12th, dropped;
 *   an over-long title is shortened, a missing one becomes the link's host;
 * - an impact on something that is not one of the 21 dimensions is set
 *   aside (a loosely written slug or name is matched first);
 * - an indicator name too long to be a published one, or a projected
 *   value/year that is not a usable number, is dropped — the impact stays,
 *   direction only;
 * - over-long summary, rationale, and list items are shortened at a word;
 *   impacts and list items past the limit are dropped.
 *
 * Anything else (a missing summary, an unknown direction) is left for the
 * schema to reject: guessing those would put words in the analysis.
 */
export function fitToContract(raw: unknown): { value: unknown; adjustments: string[] } {
  if (!isObject(raw)) return { value: raw, adjustments: [] };
  const notes: string[] = [];
  const out: Json = { ...raw };

  if (typeof out.summary === 'string' && out.summary.trim().length > L.summaryChars) {
    out.summary = shorten(out.summary, L.summaryChars);
    notes.push(`The summary was shortened to ${chars(L.summaryChars)}.`);
  }

  if (Array.isArray(out.impacts)) {
    const setAside: string[] = [];
    let insecure = 0;
    let extraSources = 0;
    let titles = 0;
    let rationales = 0;
    let unusable = 0;
    const impacts: unknown[] = [];
    for (const item of out.impacts) {
      if (!isObject(item)) {
        impacts.push(item);
        continue;
      }
      const impact: Json = { ...item };
      const slug = resolveSlug(impact.dimension_slug);
      if (!slug) {
        setAside.push(String(impact.dimension_slug ?? 'no dimension'));
        continue;
      }
      impact.dimension_slug = slug;

      if (typeof impact.rationale === 'string' && impact.rationale.trim().length > L.rationaleChars) {
        impact.rationale = shorten(impact.rationale, L.rationaleChars);
        rationales++;
      }

      if (Array.isArray(impact.sources)) {
        const kept: Json[] = [];
        for (const s of impact.sources) {
          if (!isObject(s) || !isHttpsUrl(s.url)) {
            insecure++;
            continue;
          }
          const url = s.url.trim();
          let title = typeof s.title === 'string' ? s.title.trim() : '';
          if (!title) title = new URL(url).hostname;
          if (title.length > L.sourceTitleChars) {
            title = shorten(title, L.sourceTitleChars);
            titles++;
          }
          kept.push({ title, url });
        }
        extraSources += Math.max(0, kept.length - L.sourcesPerImpact);
        impact.sources = kept.slice(0, L.sourcesPerImpact);
      }

      // A projection the schema could not accept is dropped as a whole, so
      // the impact stays and reads as direction only.
      if (typeof impact.projected_value === 'string' && impact.projected_value.trim() !== '') {
        const value = Number(impact.projected_value);
        if (Number.isFinite(value)) impact.projected_value = value;
      }
      const badIndicator =
        impact.indicator !== undefined &&
        (typeof impact.indicator !== 'string' || !impact.indicator.trim() || impact.indicator.trim().length > L.indicatorChars);
      const badValue =
        impact.projected_value !== undefined &&
        (typeof impact.projected_value !== 'number' || !Number.isFinite(impact.projected_value));
      if (badIndicator || badValue) {
        delete impact.indicator;
        delete impact.projected_value;
        delete impact.projected_year;
        unusable++;
      } else if (impact.projected_year !== undefined) {
        const year = Number(impact.projected_year);
        if (Number.isInteger(year) && year >= L.minYear && year <= L.maxYear) impact.projected_year = year;
        else {
          delete impact.projected_year;
          unusable++;
        }
      }
      impacts.push(impact);
    }

    for (const slug of setAside) {
      notes.push(`An impact on “${slug.slice(0, 80)}”, which is not one of the doughnut's 21 dimensions, was set aside.`);
    }
    if (impacts.length > L.impacts) {
      notes.push(`${count(impacts.length - L.impacts, 'impact')} beyond the ${L.impacts} allowed ${impacts.length - L.impacts === 1 ? 'was' : 'were'} left out.`);
    }
    out.impacts = impacts.slice(0, L.impacts);
    if (rationales) notes.push(`${count(rationales, 'rationale')} ${rationales === 1 ? 'was' : 'were'} shortened to ${chars(L.rationaleChars)}.`);
    if (insecure) notes.push(`${count(insecure, 'cited source')} ${insecure === 1 ? 'was' : 'were'} left out because ${insecure === 1 ? 'it was not an https link' : 'they were not https links'}.`);
    if (extraSources) notes.push(`${count(extraSources, 'source')} beyond the ${L.sourcesPerImpact} allowed per impact ${extraSources === 1 ? 'was' : 'were'} left out.`);
    if (titles) notes.push(`${count(titles, 'source title')} ${titles === 1 ? 'was' : 'were'} shortened to ${chars(L.sourceTitleChars)}.`);
    if (unusable) notes.push(`${count(unusable, 'projection')} with an unusable indicator name, value, or year ${unusable === 1 ? 'was' : 'were'} kept as direction only (or without a year).`);
  }

  for (const key of ['assumptions', 'risks'] as const) {
    const list = out[key];
    if (!Array.isArray(list)) continue;
    let shortened = 0;
    const items = list.map((item) => {
      if (typeof item !== 'string' || item.trim().length <= L.listItemChars) return item;
      shortened++;
      return shorten(item, L.listItemChars);
    });
    if (shortened) notes.push(`${count(shortened, key.slice(0, -1))} ${shortened === 1 ? 'was' : 'were'} shortened to ${chars(L.listItemChars)}.`);
    if (items.length > L.listItems) {
      const extra = items.length - L.listItems;
      notes.push(`${count(extra, key.slice(0, -1))} beyond the ${L.listItems} allowed ${extra === 1 ? 'was' : 'were'} left out.`);
    }
    out[key] = items.slice(0, L.listItems);
  }

  return { value: out, adjustments: notes };
}

// ---- The safety net ------------------------------------------------------------

/** A queued analysis this old with no runnable job is settled by the sweep. */
export const POLICY_SWEEP_AFTER_MS = 30 * 60_000;

const ORPHANED =
  'The analysis never started: its job left the queue without running. It was not counted against your plan; start it again.';

/**
 * policy_sweep (crontab POLICY_SWEEP_CRONTAB): settle analyses stuck in
 * `queued` that no job can run any more. An analysis and its job are created
 * in one transaction (apps/web/lib/policy-actions.ts), so a queued analysis
 * without a job means the job was removed afterwards (an operator cleared
 * the queue) or failed for good (graphile-worker keeps such a job with
 * attempts = max_attempts and stops retrying it). Either way the analysis
 * would hold a research session forever; settling it failed releases the
 * session, and the requester is told.
 *
 * A job that is merely waiting — the worker is stopped, busy, or does not
 * register this task yet — still counts as runnable, so its analysis is left
 * alone: the result page says it is taking longer than usual, and staff can
 * cancel it there.
 */
export const policySweep: Task = async (_payload, helpers) => {
  const db = getDb();
  const cutoff = new Date(Date.now() - POLICY_SWEEP_AFTER_MS);
  const stale = await db
    .select({ id: policyAnalyses.id })
    .from(policyAnalyses)
    .where(and(eq(policyAnalyses.status, 'queued'), lt(policyAnalyses.createdAt, cutoff)));
  if (!stale.length) return;

  // Runnable: waiting for its next attempt, or locked by a worker right now.
  const keys = stale.map((a) => policyJobKey(a.id));
  const live = await db.execute<{ key: string }>(
    sql`select key from graphile_worker.jobs
         where key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
           and (locked_at is not null or attempts < max_attempts)`,
  );
  const liveKeys = new Set(live.map((j) => j.key));
  const orphaned = stale.filter((a) => !liveKeys.has(policyJobKey(a.id))).map((a) => a.id);
  if (!orphaned.length) return;

  // Still conditional on `queued`: a worker that claims one meanwhile wins.
  const settled = await db
    .update(policyAnalyses)
    .set({ status: 'failed', error: ORPHANED, completedAt: new Date() })
    .where(and(inArray(policyAnalyses.id, orphaned), eq(policyAnalyses.status, 'queued')))
    .returning({ id: policyAnalyses.id });
  for (const { id } of settled) {
    helpers.logger.warn(`policy analysis ${id} had no runnable job; settled as failed`);
    await notifyPolicyRequester(id);
  }
};

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
