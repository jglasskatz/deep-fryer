import { gzipSync } from 'node:zlib';
import type { Task } from 'graphile-worker';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  emptyUsage,
  type ContentSupported,
  type FindingPayload,
  type RunTokenUsage,
  type SessionTokenUsage,
} from '@deep-fryer/core';
import { keyHint } from '@deep-fryer/core/secrets';
import {
  dimensions,
  findings,
  getDb,
  researchRuns,
  researchSessions,
  tenants,
  type DbExecutor,
  type ResearchRun,
} from '@deep-fryer/db';
import {
  deterministicChecks,
  mergeVerification,
  renderVerifierPrompt,
  REGION_BRIEF_PLACEHOLDER,
  VERIFIER_MAX_TURNS,
  VERIFIER_TOOLS,
  type ApplyJobPayload,
} from '@deep-fryer/research';
import { closeEvidenceBrowser } from '../evidence.js';
import {
  OrgKeyUnavailableError,
  modelNamedIn,
  modelNotFoundLog,
  rejectedKeyError,
  sessionApiKey,
} from '../org-key.js';
import {
  extractJson,
  mergeUsage,
  runSession,
  runSessionWithRetry,
  SessionRunError,
  type SessionResult,
} from '../session.js';
import { tenantStorage } from '../storage.js';
import { loadFindingExhibits } from '../archived-exhibits.js';
import type { TenantStorage } from '../storage.js';
import { notifyRunFinished } from '../notify.js';
import { settledRunStatus } from './run-status.js';
import { auditResearchRun } from '../research-audit.js';

/**
 * Apply (SPEC.md §8): phase-0 region-context session first, its brief
 * injected into every dimension session; findings gated by deterministic
 * checks plus an independent verifier session; failures surface as
 * red-flagged findings, never dropped. Failed runs stay failed — reruns are
 * user-directed from review, not automatic.
 *
 * Paying for it (SPEC-v7 §4): the research gate decided who pays when the
 * run was applied and stored it on the run (`funding`, migration 0012); the
 * worker follows that decision, not whatever key is on file now
 * (org-key.ts sessionApiKey). A key-funded run runs every session — research
 * and verifier alike — on the organization's own Anthropic API key; a
 * plan-funded run runs on the deployment's ANTHROPIC_API_KEY, even if the
 * organization has added a key since (the run was counted against the plan).
 * The key is resolved once, before the first session, so a run never mixes
 * the two. A key-funded run whose key was removed after it was queued, or
 * cannot be decrypted, fails (OrgKeyUnavailableError) with the reason on
 * every planned session, rather than quietly spending the deployment's key on
 * a run the plan's allowance never covered. So does a run whose key Anthropic
 * starts refusing part-way (revoked, out of credit, a model the key may not
 * use; session.ts runSessionWithRetry): the session that met the refusal
 * records the reason, no further session or verifier starts on the key, and
 * every session that had not started is recorded as failed with that reason.
 */
export const researchApply: Task = async (rawPayload, helpers) => {
  const { runId, unmetered } = rawPayload as ApplyJobPayload;
  const db = getDb();

  // Atomic claim: only the transition planned → running executes the plan,
  // and only for a run the research gate applied (applied_at set). applied_at
  // is what puts a run in a billing period (packages/db researchSessionsUsed),
  // so a run without it would spend sessions no allowance counts. That
  // happens when the web app's enqueue failed after the job was in fact
  // written — the connection dropped before the reply — and applyRun cleared
  // applied_at again: the job is stale, and running it would be research
  // nobody was charged for. The run stays planned, to be applied again. The
  // one exception is an operator's measurement run, unapplied on purpose and
  // marked so on its job (ApplyJobPayload.unmetered).
  // A no-op claim otherwise means a duplicate/stale job or a crash-interrupted
  // run redelivered by the queue — the latter is settled as failed below so
  // it can never sit in `running` forever.
  const claimable = and(
    eq(researchRuns.id, runId),
    eq(researchRuns.status, 'planned'),
    unmetered ? undefined : isNotNull(researchRuns.appliedAt),
  );
  const [run] = await db.update(researchRuns).set({ status: 'running' }).where(claimable).returning();
  if (!run) {
    const [existing] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
    if (!existing) {
      helpers.logger.error(`run ${runId} not found`);
    } else if (existing.status === 'planned') {
      helpers.logger.warn(`run ${runId} is planned but not applied (its apply was undone); skipping`);
    } else if (existing.status === 'running') {
      helpers.logger.error(`run ${runId} was interrupted mid-run; marking failed`);
      await db
        .update(researchSessions)
        .set({ status: 'failed', completedAt: new Date() })
        .where(
          and(
            eq(researchSessions.runId, runId),
            inArray(researchSessions.status, ['queued', 'running']),
          ),
        );
      await db
        .update(researchRuns)
        .set({ status: 'failed', completedAt: new Date() })
        .where(and(eq(researchRuns.id, runId), eq(researchRuns.status, 'running')));
    } else {
      helpers.logger.warn(`run ${runId} is ${existing.status}; skipping`);
    }
    return;
  }

  const usage: RunTokenUsage = {};

  const finish = async (status: 'complete' | 'failed') => {
    await db
      .update(researchRuns)
      .set({ status, completedAt: new Date(), tokenUsage: usage })
      .where(eq(researchRuns.id, runId));
  };

  try {
    // First, before anything else can fail or spend: whose key this run uses,
    // as the gate decided when the run was applied.
    const apiKey = await sessionApiKey(db, run.tenantId, run.funding);
    if (apiKey) {
      // The hint (last four characters) is what the billing page shows; never more.
      helpers.logger.info(`run ${runId}: running on the organization's own Anthropic API key (…${keyHint(apiKey)})`);
    }
    const keyOption = apiKey ? { apiKey } : {};

    // A model id the API did not find (model_not_found) is logged for the
    // operator, once per model per run: on the deployment's key it is always
    // a model setting to fix, and on the organization's key it may be one
    // (org-key.ts KEY_REJECTED_ERRORS). Staff read the reason on the run.
    const modelsNotFound = new Set<string>();
    const reportModelNotFound = (model: string | undefined) => {
      const id = model ?? '(model not named)';
      if (modelsNotFound.has(id)) return;
      modelsNotFound.add(id);
      helpers.logger.error(`run ${runId}: ${modelNotFoundLog(id, Boolean(apiKey))}`);
    };
    const noteFailure = (report: { apiError?: string; apiErrorText?: string; usage: SessionTokenUsage }) => {
      if (report.apiError === 'model_not_found') reportModelNotFound(modelNamedIn(report.apiErrorText) ?? report.usage.model);
    };
    const noteKeyFailure = (err: OrgKeyUnavailableError) => {
      if (err.rejection === 'model_not_found') reportModelNotFound(err.model);
    };

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, run.tenantId));
    if (!tenant) throw new Error(`tenant ${run.tenantId} missing`);

    const plan = run.plan;
    const config = run.configSnapshot;
    const storage = await tenantStorage(tenant.slug);

    const tenantDims = await db
      .select()
      .from(dimensions)
      .where(eq(dimensions.tenantId, tenant.id));
    const dimBySlug = new Map(tenantDims.map((d) => [d.slug, d]));

    // Phase 0: region context.
    const regionSpec = plan.sessions.find((s) => s.kind === 'region_context');
    let regionBrief = '(no region brief produced)';
    if (regionSpec) {
      const [row] = await db
        .insert(researchSessions)
        .values({ runId, kind: 'region_context', status: 'running', startedAt: new Date() })
        .returning();
      if (!row) throw new Error('session insert failed');
      let result: SessionResult;
      try {
        result = await runSessionWithRetry({
          prompt: regionSpec.prompt,
          allowedTools: regionSpec.tool_allowlist,
          // Never orchestrated: the region session has WebSearch, so with
          // RESEARCH_SUBAGENT_MODEL set it would otherwise get scouts and a
          // delegation note telling it to capture evidence — and it has no
          // capture tool, and writes a brief, not findings.
          orchestrate: false,
          ...(plan.models ? { model: plan.models.session_model } : {}),
          ...keyOption,
        });
      } catch (err) {
        if (err instanceof OrgKeyUnavailableError) {
          noteKeyFailure(err);
          await recordKeyFailure(db, row.id, err, usage);
        }
        throw err;
      }
      if (!result.succeeded) noteFailure(result);
      usage[row.id] = result.usage;
      await db
        .update(researchSessions)
        .set({
          status: result.succeeded ? 'complete' : 'failed',
          transcript: result.transcript,
          completedAt: new Date(),
        })
        .where(eq(researchSessions.id, row.id));
      if (result.succeeded && result.resultText.trim()) {
        regionBrief = result.resultText;
      }
    }

    // Dimension sessions are independent once the region brief exists (each
    // has its own session row, insert-only findings, per-session usage keys,
    // and evidence captures run in isolated browser contexts), so they run
    // under a bounded pool. RESEARCH_SESSION_CONCURRENCY=1 restores the old
    // serial behavior; the practical ceiling is API throughput.
    const concurrency = sessionConcurrency(process.env.RESEARCH_SESSION_CONCURRENCY);
    if (!concurrency.valid) {
      helpers.logger.warn(
        `RESEARCH_SESSION_CONCURRENCY=${JSON.stringify(process.env.RESEARCH_SESSION_CONCURRENCY)} is not a whole number of at least 1; running ${concurrency.value} sessions at a time`,
      );
    }
    const dimensionSpecs = plan.sessions.filter((s) => s.kind === 'dimension');

    // Set once Anthropic refuses the organization's key (OrgKeyUnavailableError
    // from a research or verifier session): from then on no session or
    // verifier starts on it, and the run fails with this reason below.
    let keyFailure: OrgKeyUnavailableError | null = null;

    const processDimension = async (spec: (typeof dimensionSpecs)[number]) => {
      const dimension = spec.dimension_slug ? dimBySlug.get(spec.dimension_slug) : undefined;
      if (!dimension) {
        helpers.logger.error(`dimension ${spec.dimension_slug} not found; skipping session`);
        return;
      }
      const [row] = await db
        .insert(researchSessions)
        .values({
          runId,
          dimensionId: dimension.id,
          kind: 'dimension',
          status: 'running',
          startedAt: new Date(),
        })
        .returning();
      if (!row) throw new Error('session insert failed');

      const prompt = spec.prompt.split(REGION_BRIEF_PLACEHOLDER).join(regionBrief);
      let result: SessionResult;
      try {
        result = await runSessionWithRetry({
          prompt,
          allowedTools: spec.tool_allowlist,
          storage,
          ...(plan.models ? { model: plan.models.session_model, scoutModel: plan.models.subagent_model } : {}),
          ...keyOption,
        });
      } catch (err) {
        if (!(err instanceof OrgKeyUnavailableError)) throw err;
        keyFailure ??= err;
        noteKeyFailure(err);
        await recordKeyFailure(db, row.id, err, usage);
        return;
      }
      if (!result.succeeded) noteFailure(result);
      usage[row.id] = result.usage;

      let rawFindings: unknown[] = [];
      let parseOk = true;
      // Salvaged: the output was malformed and only a fragment of it read
      // (session.ts extractJson). The session is NOT failed for it — its
      // findings go to review and it was paid for, and a failed session is
      // free (packages/db billing counts only non-failed ones) — but every
      // finding it did return is flagged partial_output, so staff know the
      // session may have said more than was recorded.
      let salvaged = false;
      try {
        const parsed = extractJson(result.resultText);
        rawFindings = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
        salvaged = parsed.salvaged;
        if (salvaged) {
          helpers.logger.warn(
            `session ${row.id}: output was malformed JSON; ${rawFindings.length} finding(s) salvaged and flagged partial_output`,
          );
        }
      } catch {
        parseOk = false;
        helpers.logger.error(`session ${row.id}: output was not parseable JSON`);
      }

      // Every verifier session of this dimension, folded whole (cache tokens
      // and per-model usage included) and filed under `verifier:<session id>`.
      let verifierUsage = emptyUsage();
      for (const raw of rawFindings) {
        const { payload, checks } = await deterministicChecks(raw, config, dimension.slug);

        let verdict: { content_supported: ContentSupported; verifier_note?: string; narrative_supported?: ContentSupported } | null;
        if (payload?.kind === 'indicator') {
          if (keyFailure) {
            // The key was refused (here or in a concurrent session): starting
            // a verifier on it would only be refused again.
            verdict = { content_supported: 'uncertain', verifier_note: `verifier did not run: ${keyFailure.message}` };
          } else {
            try {
              const verified = await runVerifier(payload, config.region.name, apiKey, storage, plan.models?.verifier_model);
              verifierUsage = mergeUsage(verifierUsage, verified.usage);
              verdict = verified.verdict;
              if (verified.failure) noteFailure(verified.failure);
            } catch (err) {
              if (!(err instanceof OrgKeyUnavailableError)) throw err;
              keyFailure ??= err;
              noteKeyFailure(err);
              if (err.usage) verifierUsage = mergeUsage(verifierUsage, err.usage);
              verdict = { content_supported: 'uncertain', verifier_note: `verifier did not run: ${err.message}` };
            }
          }
        } else if (payload?.kind === 'gap') {
          verdict = {
            content_supported: 'uncertain',
            verifier_note: 'data gap — nothing to fetch; review the search trail',
          };
        } else {
          verdict = {
            content_supported: 'fail',
            verifier_note: 'output did not conform to the finding schema',
          };
        }

        const indicatorSlug =
          payload?.indicator_slug ??
          (typeof raw === 'object' && raw !== null && 'indicator_slug' in raw
            ? String((raw as { indicator_slug: unknown }).indicator_slug)
            : 'unknown');

        if (payload?.kind === 'indicator' && payload.narrative_draft && !verdict?.narrative_supported) {
          verdict = { content_supported: verdict?.content_supported ?? 'uncertain', ...verdict, narrative_supported: 'uncertain' };
        }
        await db.insert(findings).values({
          sessionId: row.id,
          dimensionId: dimension.id,
          indicatorSlug,
          payload: (payload ?? raw) as FindingPayload,
          verification: mergeVerification(salvaged ? { ...checks, partial_output: true } : checks, verdict),
        });
      }
      usage[`verifier:${row.id}`] = verifierUsage;

      await db
        .update(researchSessions)
        .set({
          status: result.succeeded && parseOk ? 'complete' : 'failed',
          transcript: result.transcript,
          completedAt: new Date(),
        })
        .where(eq(researchSessions.id, row.id));
    };

    // Bounded pool: next session starts as soon as a slot frees. A refused
    // key, or any other error, stops new sessions from starting; the ones
    // already running finish (and record themselves) before the error is
    // rethrown, so the run is never settled while a session still writes.
    let cursor = 0;
    let poolError: { error: unknown } | null = null;
    await Promise.all(
      Array.from({ length: Math.min(concurrency.value, dimensionSpecs.length) }, async () => {
        while (!keyFailure && !poolError && cursor < dimensionSpecs.length) {
          const spec = dimensionSpecs[cursor++]!;
          try {
            await processDimension(spec);
          } catch (error) {
            poolError ??= { error };
          }
        }
      }),
    );
    if (poolError) throw (poolError as { error: unknown }).error;
    if (keyFailure) throw keyFailure;

    // Independent post-run recommendations stay in the staff plane. They
    // share the run's funding/model policy and report their own usage; an
    // audit service/persistence failure must not discard completed research.
    try {
      Object.assign(usage, await auditResearchRun(run, helpers, { apiKey, verifierModel: plan.models?.verifier_model }));
    } catch {
      helpers.logger.warn(`run ${runId}: automatic audit could not finish; findings remain available for human review`);
    }

    const settled = settledRunStatus(
      (
        await db
          .select({ status: researchSessions.status })
          .from(researchSessions)
          .where(eq(researchSessions.runId, runId))
      ).map((r) => r.status),
    );
    await finish(settled);
    if (settled === 'complete') helpers.logger.info(`run ${runId} complete`);
    else helpers.logger.error(`run ${runId} failed: no session succeeded`);
  } catch (err) {
    helpers.logger.error(`run ${runId} failed: ${err instanceof Error ? err.message : err}`);
    if (err instanceof OrgKeyUnavailableError) await failPlannedSessions(db, run, err.message);
    await db
      .update(researchSessions)
      .set({ status: 'failed', completedAt: new Date() })
      .where(
        and(
          eq(researchSessions.runId, runId),
          inArray(researchSessions.status, ['queued', 'running']),
        ),
      );
    await finish('failed');
  } finally {
    await closeEvidenceBrowser().catch(() => {});
  }
  // Settled either way: tell the people who review it.
  await notifyRunFinished(runId);
};

/** How many dimension sessions run at once when RESEARCH_SESSION_CONCURRENCY is unset or unusable. */
export const DEFAULT_SESSION_CONCURRENCY = 3;

/**
 * Pure: RESEARCH_SESSION_CONCURRENCY read as the dimension pool's size. Only
 * a whole number of at least 1 (surrounding spaces allowed) is taken; any
 * other value — "three", "2.5", "0", an empty string — falls back to
 * DEFAULT_SESSION_CONCURRENCY with `valid: false`, so the caller warns the
 * operator. A bare Number() would turn "three" into NaN, which makes a pool
 * of no workers: every dimension session silently skipped, and the run
 * settled complete on the region session alone.
 */
export function sessionConcurrency(raw: string | undefined): { value: number; valid: boolean } {
  if (raw === undefined) return { value: DEFAULT_SESSION_CONCURRENCY, valid: true };
  const trimmed = raw.trim();
  const value = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : NaN;
  return Number.isSafeInteger(value) && value >= 1
    ? { value, valid: true }
    : { value: DEFAULT_SESSION_CONCURRENCY, valid: false };
}

/** A failed session's transcript that is just the reason, as session.ts runSessionWithRetry records a thrown session. */
const sessionErrorTranscript = (message: string) => gzipSync(JSON.stringify({ type: 'session_error', message }));

/**
 * The session in row `rowId` stopped because Anthropic refused the
 * organization's key: record what it spent before the refusal (the error's
 * usage) and fail the row with the reason as its transcript, so staff read
 * why — not the CLI's error frames.
 */
async function recordKeyFailure(
  db: DbExecutor,
  rowId: string,
  err: OrgKeyUnavailableError,
  usage: RunTokenUsage,
): Promise<void> {
  if (err.usage) usage[rowId] = err.usage;
  await db
    .update(researchSessions)
    .set({ status: 'failed', transcript: sessionErrorTranscript(err.message), completedAt: new Date() })
    .where(eq(researchSessions.id, rowId));
}

/**
 * A key-funded run that could not start — the organization's key was removed
 * after the run was queued, or is on file but unreadable — still tells staff
 * why. Each planned session gets a failed row whose transcript is the reason,
 * in the shape a session that errored records (session.ts
 * runSessionWithRetry: `{"type":"session_error",…}`). So the run page lists
 * every dimension as failed, the run-finished email counts them, owners who
 * download a transcript read the message, and — failed sessions being free,
 * and key-funded ones never counted — nothing is counted against the plan.
 *
 * A run whose key was refused part-way already has rows for the sessions
 * that started: those keep their own record, any still open is failed with
 * the reason, and only the planned sessions that never started get a new row.
 */
async function failPlannedSessions(db: DbExecutor, run: ResearchRun, message: string): Promise<void> {
  const dims = await db
    .select({ id: dimensions.id, slug: dimensions.slug })
    .from(dimensions)
    .where(eq(dimensions.tenantId, run.tenantId));
  const idBySlug = new Map(dims.map((d) => [d.slug, d.id]));
  const transcript = sessionErrorTranscript(message);
  const now = new Date();
  await db
    .update(researchSessions)
    .set({ status: 'failed', transcript, completedAt: now })
    .where(and(eq(researchSessions.runId, run.id), inArray(researchSessions.status, ['queued', 'running'])));
  const started = new Map<string, number>();
  for (const row of (
      await db
        .select({ kind: researchSessions.kind, dimensionId: researchSessions.dimensionId })
        .from(researchSessions)
        .where(eq(researchSessions.runId, run.id))
    )) {
    const key = `${row.kind}:${row.dimensionId ?? ''}`;
    started.set(key, (started.get(key) ?? 0) + 1);
  }
  const rows = run.plan.sessions.flatMap((spec) => {
    const dimensionId = spec.dimension_slug ? idBySlug.get(spec.dimension_slug) : undefined;
    if (spec.kind === 'dimension' && !dimensionId) return [];
    // Dense dimensions have several planned sessions with the same slug.
    // Consume one started row per spec, instead of collapsing them in a Set.
    const key = `${spec.kind}:${dimensionId ?? ''}`;
    const count = started.get(key) ?? 0;
    if (count > 0) {
      started.set(key, count - 1);
      return [];
    }
    return [
      {
        runId: run.id,
        kind: spec.kind,
        dimensionId: dimensionId ?? null,
        status: 'failed' as const,
        transcript,
        startedAt: now,
        completedAt: now,
      },
    ];
  });
  if (rows.length) await db.insert(researchSessions).values(rows);
}

/** A verifier's answer, as merged into a finding's verification. */
type Verdict = { content_supported: ContentSupported; verifier_note?: string; narrative_supported?: ContentSupported };

/**
 * One verifier session on one indicator finding: the verdict (null when the
 * session failed or answered outside its contract) and what the session
 * used, folded by the caller into the dimension's `verifier:<id>` record.
 * `failure` is the failed session's error report, for the caller's operator
 * log (a model_not_found on the deployment's key is a VERIFIER_MODEL to fix).
 *
 * Throws OrgKeyUnavailableError, carrying the usage, when Anthropic refused
 * the organization's key (org-key.ts keyRejection): every remaining
 * verifier would be refused the same way, so the run stops instead.
 *
 * A verdict the CLI obtained from another model after the judge refused
 * (the SDK's model_refusal_fallback; the bundled CLI arms one for
 * claude-opus-5) says so in its note, so staff see that this finding was
 * judged by a different model than every other.
 */
async function runVerifier(
  payload: Extract<FindingPayload, { kind: 'indicator' }>,
  regionName: string,
  apiKey: string | null,
  storage: TenantStorage,
  plannedModel?: string,
): Promise<{
  verdict: Verdict | null;
  usage: SessionTokenUsage;
  failure?: { apiError?: string; apiErrorText?: string; usage: SessionTokenUsage };
}> {
  const archive = await loadFindingExhibits(storage, payload);
  const prompt = renderVerifierPrompt({
    indicator_name: payload.name,
    claimed_value: String(payload.value),
    unit: payload.unit,
    year: String(payload.year),
    geography: `${regionName} (${payload.geographic_scale} scale)`,
    source_name: payload.source,
    source_url: payload.source_url,
    archived_exhibits: archive.names,
    archive_note: archive.note,
    narrative_draft: payload.narrative_draft,
  });
  // The adversarial reviewer runs on the strongest model regardless of the
  // researcher's model — a constant, maximally-skeptical judge, so strategy
  // comparisons measure the researcher, never the leniency of its grader.
  const model = plannedModel ?? process.env.VERIFIER_MODEL ?? 'claude-opus-5';
  let result: SessionResult;
  try {
    result = await runSession({
      prompt,
      allowedTools: VERIFIER_TOOLS,
      archivedExhibits: archive.exhibits,
      orchestrate: false,
      maxTurns: VERIFIER_MAX_TURNS,
      model,
      // Verifiers are part of the run's spend: the same key as its researchers,
      // which is the run's stored funding (the deployment's key when apiKey is null).
      ...(apiKey ? { apiKey } : {}),
    });
  } catch (err) {
    // A thrown session still spent what it streamed (SessionRunError).
    if (!(err instanceof SessionRunError)) return { verdict: null, usage: emptyUsage() };
    const refused = apiKey ? rejectedKeyError(err, model, err.usage) : null;
    if (refused) throw refused;
    return { verdict: null, usage: err.usage, failure: err };
  }
  if (!result.succeeded) {
    const refused = apiKey ? rejectedKeyError(result, model, result.usage) : null;
    if (refused) throw refused;
    return { verdict: null, usage: result.usage, failure: result };
  }
  try {
    const parsed = extractJson(result.resultText).value as {
      content_supported?: string;
      verifier_note?: string;
      narrative_supported?: string;
    };
    if (
      parsed.content_supported === 'pass' ||
      parsed.content_supported === 'fail' ||
      parsed.content_supported === 'uncertain'
    ) {
      const fallbacks = result.usage.refusal_fallbacks ?? [];
      const judges = fallbacks.map((f) => f.fallback_model).join(', ');
      const judgedBy = fallbacks.length
        ? ` [Verdict given by ${judges} after ${fallbacks[0]!.original_model} refused (refusal fallback).]`
        : '';
      return {
        verdict: {
          content_supported: parsed.content_supported,
          verifier_note: [parsed.verifier_note, judgedBy.trim(), archive.note].filter(Boolean).join(' ') || undefined,
          ...(payload.narrative_draft ? {
            narrative_supported: archive.note
              ? 'uncertain' as const
              : ['pass', 'fail', 'uncertain'].includes(parsed.narrative_supported ?? '')
                ? parsed.narrative_supported as ContentSupported : 'uncertain' as const,
          } : {}),
        },
        usage: result.usage,
      };
    }
    return { verdict: null, usage: result.usage };
  } catch {
    return { verdict: null, usage: result.usage };
  }
}
