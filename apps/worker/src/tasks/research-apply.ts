import { gunzipSync, gzipSync } from 'node:zlib';
import type { Task } from 'graphile-worker';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { frameworkDimension, type PortraitConfig } from '@deep-fryer/contract';
import {
  emptyUsage,
  type ContentSupported,
  type FindingPayload,
  type FindingVerification,
  type IndicatorEvidence,
  type IndicatorFindingPayload,
  type ResearchPlan,
  type RunTokenUsage,
  type SessionTokenUsage,
  type ValueOnPage,
} from '@deep-fryer/core';
import { keyHint } from '@deep-fryer/core/secrets';
import {
  dimensions,
  findings,
  getDb,
  logSafeError,
  researchRuns,
  researchSessions,
  tenants,
  type DbExecutor,
  type ResearchRun,
} from '@deep-fryer/db';
import {
  checkValueOnPage,
  correctionReasons,
  DEFAULT_ESCALATION_MAX_TURNS,
  deterministicChecks,
  dimensionNameFromPrompt,
  mergeVerification,
  plannedSlugsFromPrompt,
  plannedThresholdRefsFromPrompt,
  planPreVerifierCorrection,
  renderHybridEscalationPrompt,
  renderVerifierPrompt,
  REGION_BRIEF_PLACEHOLDER,
  selectEscalationCandidates,
  shouldAcceptCorrection,
  shouldAcceptEscalation,
  VERIFIER_MAX_TURNS,
  VERIFIER_TOOLS,
  type ApplyJobPayload,
  type DeterministicGateChecks,
} from '@deep-fryer/research';
import { captureEvidence, closeEvidenceBrowser } from '../evidence.js';
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
  rescoreIndicatorPayload,
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
    const runStartedAt = new Date();
    const storage = await tenantStorage(tenant.slug);
    // A finding's captured text, through its tenant's archive only (the
    // schema already limits the path to evidence/<name>.txt).
    const readEvidenceText = async (textPath: string) => (await storage.get(textPath)).toString('utf8');

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
          ...plannedResearchOptions(plan),
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
      const dimensionName =
        dimensionNameFromPrompt(spec.prompt) ??
        frameworkDimension(dimension.slug, dimension.canonicalSlug)?.name ??
        dimension.slug;
      const plannedSlugs = plannedSlugsFromPrompt(spec.prompt);
      const thresholdRefs = plannedThresholdRefsFromPrompt(spec.prompt);
      const submitFindingsContext = { config, dimensionSlug: dimension.slug, thresholdRefs };
      const capturedSnapshotPaths = new Set<string>();
      const trackCaptures = (paths?: readonly string[]) => {
        for (const p of paths ?? []) capturedSnapshotPaths.add(p);
      };

      let result: SessionResult;
      try {
        const initialScout = plannedInitialScoutModel(plan);
        result = await runSessionWithRetry({
          prompt,
          allowedTools: spec.tool_allowlist,
          storage,
          submitFindingsContext,
          ...plannedResearchOptions(plan),
          ...(initialScout !== undefined ? { scoutModel: initialScout } : {}),
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
      trackCaptures(result.capturedSnapshotPaths);
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
      if (result.submittedFindings?.length) {
        rawFindings = result.submittedFindings;
      } else {
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
      }

      const initialScout = plannedInitialScoutModel(plan);
      const evaluated = await evaluateDimensionFindings(
        {
          sessionId: row.id,
          config,
          dimensionSlug: dimension.slug,
          dimensionName,
          regionBrief,
          plan,
          rawFindings,
          plannedSlugs,
          thresholdRefs,
          initialModel: result.usage.model,
          salvaged,
          initialKeyFailure: keyFailure,
        },
        {
          deterministicChecks: (raw, cfg, slug) =>
            deterministicChecks(raw, cfg, slug, undefined, {
              runStartedAt,
              capturedSnapshotPaths,
            }),
          checkValueOnPage: (payload) => checkValueOnPage(payload, readEvidenceText),
          recaptureEvidence: async (url, pdfUrl) => {
            try {
              const captured = await captureEvidence(storage, url, pdfUrl);
              capturedSnapshotPaths.add(captured.snapshot_path);
              return captured;
            } catch {
              return null;
            }
          },
          runCorrectionSession: async ({ prompt: correctionPrompt, maxTurns }) => {
            const res = await runSessionWithRetry({
              prompt: correctionPrompt,
              allowedTools: spec.tool_allowlist,
              storage,
              submitFindingsContext,
              ...plannedResearchOptions(plan),
              maxTurns,
              ...(initialScout !== undefined ? { scoutModel: initialScout } : {}),
              ...keyOption,
            });
            trackCaptures(res.capturedSnapshotPaths);
            return res;
          },
          runEscalationSession: async ({ prompt: escalationPrompt, maxTurns }) => {
            const res = await runSessionWithRetry({
              prompt: escalationPrompt,
              allowedTools: spec.tool_allowlist,
              storage,
              submitFindingsContext,
              ...plannedEscalationOptions(plan),
              maxTurns,
              ...keyOption,
            });
            trackCaptures(res.capturedSnapshotPaths);
            return res;
          },
          runVerifier: (payload) => runVerifier(payload, config.region.name, apiKey, storage, plan),
          onFailure: noteFailure,
          onKeyFailure: noteKeyFailure,
          warn: (msg) => helpers.logger.warn(msg),
        },
      );

      if (evaluated.keyFailure) keyFailure ??= evaluated.keyFailure;
      if (evaluated.correctionUsage) usage[`correction:${row.id}`] = evaluated.correctionUsage;
      if (evaluated.escalationUsage) usage[`escalation:${row.id}`] = evaluated.escalationUsage;
      usage[`verifier:${row.id}`] = evaluated.verifierUsage;

      for (const record of evaluated.records) {
        await db.insert(findings).values({
          sessionId: row.id,
          dimensionId: dimension.id,
          indicatorSlug: record.indicatorSlug,
          payload: record.payload,
          verification: record.verification,
        });
      }

      const combinedTranscript = combineStageTranscripts([
        { stage: 'initial', transcript: result.transcript },
        ...(evaluated.correctionTranscript ? [{ stage: 'correction' as const, transcript: evaluated.correctionTranscript }] : []),
        ...(evaluated.escalationTranscript ? [{ stage: 'escalation' as const, transcript: evaluated.escalationTranscript }] : []),
      ]);
      // If initial output was unparseable but correction/escalation recovered findings, keep session status aligned.
      const recoveredOutput = !parseOk && evaluated.records.some((r) => r.verification.schema_ok);
      await db
        .update(researchSessions)
        .set({
          status: (result.succeeded && parseOk) || recoveredOutput ? 'complete' : 'failed',
          transcript: combinedTranscript,
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
      Object.assign(usage, await auditResearchRun(run, helpers, {
        apiKey,
        verifierModel: plan.models?.verifier_model,
        ...(plan.caps ? { maxTurns: plan.caps.audit_max_turns } : {}),
        ...(plan.models?.page_reader_model ? { pageReaderModel: plan.models.page_reader_model } : {}),
      }));
    } catch {
      helpers.logger.warn(`run ${runId}: automatic audit could not finish; findings remain available for human review`);
    }

    const settled = settledRunStatus(
      await db
        .select({ kind: researchSessions.kind, status: researchSessions.status })
        .from(researchSessions)
        .where(eq(researchSessions.runId, runId)),
    );
    await finish(settled);
    if (settled === 'complete') helpers.logger.info(`run ${runId} complete`);
    else helpers.logger.error(`run ${runId} failed: no session succeeded`);
  } catch (err) {
    // Never the error's own message: a failed query's carries its SQL and bound values.
    helpers.logger.error(`run ${runId} failed: ${logSafeError(err)}`);
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

/** Maximum concurrent independent verifier calls per dimension. */
export const VERIFIER_CONCURRENCY = 4;

/**
 * Pure: execute `worker` across `items` with at most `limit` in-flight calls,
 * preserving result order.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: poolSize }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index]!, index);
      }
    }),
  );
  return results;
}

/**
 * Pure: decode a gzipped (or raw UTF-8 in tests) JSONL transcript buffer to text.
 */
function decodeTranscriptBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return gunzipSync(buf).toString('utf8');
  }
  return buf.toString('utf8');
}

/**
 * Pure: concatenate JSONL transcripts across `initial + correction + escalation`
 * with explicit stage marker lines so the stored audit transcript always
 * contains the session that produced the published figure. When only `initial`
 * ran, returns its original Buffer unchanged.
 */
export function combineStageTranscripts(
  stages: readonly { stage: 'initial' | 'correction' | 'escalation'; transcript: Buffer }[],
): Buffer {
  if (stages.length === 0) return gzipSync('');
  if (stages.length === 1 && stages[0]!.stage === 'initial') {
    return stages[0]!.transcript;
  }
  const lines: string[] = [];
  for (const { stage, transcript } of stages) {
    lines.push(JSON.stringify({ type: 'stage_marker', stage }));
    const text = decodeTranscriptBuffer(transcript).trim();
    if (text) lines.push(text);
  }
  return gzipSync(lines.join('\n'));
}

/** A verifier's answer, as merged into a finding's verification. */
type Verdict = {
  content_supported: ContentSupported;
  verifier_note?: string;
  narrative_supported?: ContentSupported;
  fail_reason?: string;
  suggested_disposition?: 'approve' | 'edit' | 're_research' | 'reject';
};

/**
 * Pure: what a research session (region context or dimension) takes from its
 * run's plan — the researcher model, the turn cap and the page reader it
 * recorded. Whatever a historic plan did not record is left out, so the
 * session runner's own defaults apply, as they did when it was planned.
 */
export function plannedResearchOptions(plan: Pick<ResearchPlan, 'models' | 'caps'>): {
  model?: string;
  maxTurns?: number;
  pageReaderModel?: string;
} {
  return {
    ...(plan.models ? { model: plan.models.session_model } : {}),
    ...(plan.caps ? { maxTurns: plan.caps.session_max_turns } : {}),
    ...(plan.models?.page_reader_model ? { pageReaderModel: plan.models.page_reader_model } : {}),
  };
}

/**
 * Pure: scout model for a dimension's initial research pass. On a hybrid plan
 * (`escalation_model` set), `subagent_model` is reserved for the Opus
 * escalation pass so the initial Sonnet pass runs without subagent overhead.
 */
export function plannedInitialScoutModel(plan: Pick<ResearchPlan, 'models'>): string | null | undefined {
  if (!plan.models) return undefined;
  if (plan.models.escalation_model) return null;
  return plan.models.subagent_model;
}

/**
 * Pure: session options for a hybrid strategy's selective Opus escalation pass.
 */
export function plannedEscalationOptions(plan: Pick<ResearchPlan, 'models' | 'caps'>): {
  model?: string;
  scoutModel?: string | null;
  maxTurns: number;
  pageReaderModel?: string;
} {
  return {
    ...(plan.models?.escalation_model ? { model: plan.models.escalation_model } : {}),
    ...(plan.models ? { scoutModel: plan.models.subagent_model } : {}),
    maxTurns: plan.caps?.escalation_max_turns ?? DEFAULT_ESCALATION_MAX_TURNS,
    ...(plan.models?.page_reader_model ? { pageReaderModel: plan.models.page_reader_model } : {}),
  };
}

export interface DimensionFindingPipelineDeps {
  deterministicChecks: (
    raw: unknown,
    config: PortraitConfig,
    dimensionSlug: string,
  ) => Promise<{ payload: FindingPayload | null; checks: DeterministicGateChecks }>;
  checkValueOnPage: (payload: FindingPayload) => Promise<ValueOnPage | undefined>;
  recaptureEvidence?: (url: string, pdfUrl?: string) => Promise<IndicatorEvidence | null>;
  runCorrectionSession: (input: { prompt: string; maxTurns: number }) => Promise<SessionResult>;
  runEscalationSession: (input: { prompt: string; maxTurns: number }) => Promise<SessionResult>;
  runVerifier: (payload: IndicatorFindingPayload) => Promise<{
    verdict: Verdict | null;
    usage: SessionTokenUsage;
    failure?: { apiError?: string; apiErrorText?: string; usage: SessionTokenUsage };
  }>;
  onFailure?: (report: { apiError?: string; apiErrorText?: string; usage: SessionTokenUsage }) => void;
  onKeyFailure?: (err: OrgKeyUnavailableError) => void;
  warn?: (message: string) => void;
}

function slugOf(payload: FindingPayload | null, raw: unknown): string {
  return (
    payload?.indicator_slug ??
    (typeof raw === 'object' && raw !== null && 'indicator_slug' in raw
      ? String((raw as { indicator_slug: unknown }).indicator_slug)
      : 'unknown')
  );
}

/**
 * Best-effort evidence recapture when a correction or escalation candidate
 * updated `source_url` without re-calling `capture_evidence` (reusing the old
 * `snapshot_path`).
 */
async function maybeRecaptureEvidence(
  candidate: unknown,
  previousPayload: FindingPayload | null,
  recaptureEvidence?: (url: string, pdfUrl?: string) => Promise<IndicatorEvidence | null>,
): Promise<unknown> {
  if (
    !recaptureEvidence ||
    typeof candidate !== 'object' ||
    candidate === null ||
    (candidate as { kind?: unknown }).kind !== 'indicator'
  ) {
    return candidate;
  }
  const candObj = candidate as { source_url?: unknown; evidence?: { snapshot_path?: unknown } };
  if (typeof candObj.source_url !== 'string') return candidate;
  const prevUrl = previousPayload?.kind === 'indicator' ? previousPayload.source_url : undefined;
  const prevSnap = previousPayload?.kind === 'indicator' ? previousPayload.evidence.snapshot_path : undefined;
  if (prevUrl !== undefined && candObj.source_url !== prevUrl && candObj.evidence?.snapshot_path === prevSnap) {
    const pdfUrl = candObj.source_url.toLowerCase().endsWith('.pdf') ? candObj.source_url : undefined;
    const freshEvidence = await recaptureEvidence(candObj.source_url, pdfUrl);
    if (freshEvidence) {
      return { ...(candidate as Record<string, unknown>), evidence: freshEvidence };
    }
  }
  return candidate;
}

/**
 * Runs deterministic gates, at most 1 bounded pre-verifier self-correction pass
 * for findings failing deterministic gates or omitted planned indicators,
 * bounded-concurrency independent verification, and — on hybrid plans —
 * selective Opus escalation ONLY for indicators that ended in a `gap`, were
 * omitted, or failed verification.
 *
 * Extracted from `researchApply` so every stage, turn cap, metering bucket,
 * transcript capture, provenance tag, and organization-key refusal path is
 * unit-testable without Postgres.
 */
export async function evaluateDimensionFindings(
  input: {
    sessionId: string;
    config: PortraitConfig;
    dimensionSlug: string;
    dimensionName: string;
    regionBrief: string;
    plan: Pick<ResearchPlan, 'models' | 'caps'>;
    rawFindings: readonly unknown[];
    /** Planned indicator slugs for this dimension chunk; omitted slugs seed synthetic missing entries. */
    plannedSlugs?: readonly string[];
    /** Optional threshold_ref map by slug for deterministic computeScoring(). */
    thresholdRefs?: Readonly<Record<string, string>>;
    /** Model reported by the initial session's usage record (for provenance metadata). */
    initialModel?: string;
    salvaged: boolean;
    initialKeyFailure: OrgKeyUnavailableError | null;
  },
  deps: DimensionFindingPipelineDeps,
): Promise<{
  records: { indicatorSlug: string; payload: FindingPayload; verification: FindingVerification }[];
  verifierUsage: SessionTokenUsage;
  correctionUsage?: SessionTokenUsage;
  escalationUsage?: SessionTokenUsage;
  correctionTranscript?: Buffer;
  escalationTranscript?: Buffer;
  keyFailure: OrgKeyUnavailableError | null;
}> {
  let keyFailure = input.initialKeyFailure;
  let verifierUsage = emptyUsage();
  let correctionUsage: SessionTokenUsage | undefined;
  let escalationUsage: SessionTokenUsage | undefined;
  let correctionTranscript: Buffer | undefined;
  let escalationTranscript: Buffer | undefined;

  interface WorkingEntry {
    raw: unknown;
    payload: FindingPayload | null;
    checks: DeterministicGateChecks;
    indicatorSlug: string;
    salvaged: boolean;
    verdict: Verdict | null;
    missing?: boolean;
    producedByStage: 'initial' | 'correction' | 'escalation';
    producedByModel?: string;
  }

  const runGates = async (raw: unknown) => {
    const det = await deps.deterministicChecks(raw, input.config, input.dimensionSlug);
    const scoredPayload =
      det.payload?.kind === 'indicator'
        ? rescoreIndicatorPayload(det.payload, input.config, input.dimensionSlug, input.thresholdRefs)
        : det.payload;
    const valCheck = scoredPayload ? await deps.checkValueOnPage(scoredPayload) : undefined;
    const checks: DeterministicGateChecks = valCheck ? { ...det.checks, value_on_page: valCheck } : det.checks;
    return { payload: scoredPayload, checks };
  };

  // Stage 1: cheap deterministic gates on every initial finding, plus seed
  // synthetic missing entries for any planned slugs omitted by the initial pass.
  const entries: WorkingEntry[] = [];
  const seenSlugs = new Set<string>();
  for (const raw of input.rawFindings) {
    const { payload, checks } = await runGates(raw);
    const indicatorSlug = slugOf(payload, raw);
    if (indicatorSlug && indicatorSlug !== 'unknown') seenSlugs.add(indicatorSlug);
    entries.push({
      raw,
      payload,
      checks,
      indicatorSlug,
      salvaged: input.salvaged,
      verdict: null,
      producedByStage: 'initial',
      producedByModel: input.initialModel,
    });
  }
  for (const plannedSlug of input.plannedSlugs ?? []) {
    if (!plannedSlug || seenSlugs.has(plannedSlug)) continue;
    seenSlugs.add(plannedSlug);
    entries.push({
      raw: null,
      payload: null,
      checks: { schema_ok: false, url_ok: false, recency_ok: false, scale_ok: false },
      indicatorSlug: plannedSlug,
      salvaged: input.salvaged,
      verdict: null,
      missing: true,
      producedByStage: 'initial',
      producedByModel: input.initialModel,
    });
  }

  // Stage 2: at most 1 bounded pre-verifier deterministic self-correction pass
  // for findings failing deterministic gates or omitted planned indicators.
  const flagged = entries.flatMap((entry) => {
    if (entry.payload?.kind !== 'indicator') return [];
    const reasons = correctionReasons(entry.payload, entry.checks);
    return reasons.length > 0 ? [{ payload: entry.payload, checks: entry.checks, reasons }] : [];
  });
  const missingPlanned = entries
    .filter((entry) => entry.missing)
    .map((entry) => ({
      slug: entry.indicatorSlug,
      ...(input.thresholdRefs?.[entry.indicatorSlug] ? { threshold_ref: input.thresholdRefs[entry.indicatorSlug] } : {}),
    }));
  const correctionPlan = planPreVerifierCorrection({
    config: input.config,
    dimensionSlug: input.dimensionSlug,
    dimensionName: input.dimensionName,
    regionBrief: input.regionBrief,
    flagged,
    missing: missingPlanned,
    sessionMaxTurns: input.plan.caps?.session_max_turns,
  });

  if (correctionPlan && !keyFailure) {
    let correctionResult: SessionResult | null = null;
    try {
      correctionResult = await deps.runCorrectionSession({
        prompt: correctionPlan.prompt,
        maxTurns: correctionPlan.maxTurns,
      });
    } catch (err) {
      if (!(err instanceof OrgKeyUnavailableError)) throw err;
      keyFailure ??= err;
      deps.onKeyFailure?.(err);
      if (err.usage) correctionUsage = err.usage;
    }

    if (correctionResult) {
      correctionUsage = correctionResult.usage;
      correctionTranscript = correctionResult.transcript;
      if (!correctionResult.succeeded) deps.onFailure?.(correctionResult);
      let correctedRaw: unknown[] = [];
      let correctionSalvaged = false;
      if (correctionResult.submittedFindings?.length) {
        correctedRaw = correctionResult.submittedFindings;
      } else {
        try {
          const parsed = extractJson(correctionResult.resultText);
          correctedRaw = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
          correctionSalvaged = parsed.salvaged;
        } catch {
          deps.warn?.(`session ${input.sessionId}: pre-verifier self-correction output was not parseable JSON; keeping initial findings`);
        }
      }

      const flaggedSlugSet = new Set(correctionPlan.flaggedSlugs);
      const candidatesBySlug = new Map<string, unknown>();
      for (const candidate of correctedRaw) {
        const slug = slugOf(null, candidate);
        if (flaggedSlugSet.has(slug) && !candidatesBySlug.has(slug)) {
          candidatesBySlug.set(slug, candidate);
        }
      }

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        if (!flaggedSlugSet.has(entry.indicatorSlug)) continue;
        if (!entry.missing && entry.payload?.kind !== 'indicator') continue;
        let candidate = candidatesBySlug.get(entry.indicatorSlug);
        if (!candidate) continue;

        candidate = await maybeRecaptureEvidence(candidate, entry.payload, deps.recaptureEvidence);

        const gated = await runGates(candidate);
        const accepted = entry.missing
          ? gated.payload !== null
          : shouldAcceptCorrection({ payload: entry.payload as IndicatorFindingPayload, checks: entry.checks }, gated);
        if (accepted) {
          entries[i] = {
            raw: candidate,
            payload: gated.payload,
            checks: gated.checks,
            indicatorSlug: slugOf(gated.payload, candidate),
            salvaged: entry.salvaged || correctionSalvaged,
            verdict: null,
            missing: false,
            producedByStage: 'correction',
            producedByModel: correctionResult.usage.model ?? entry.producedByModel,
          };
        }
      }
    }
  }

  // Helper to verify one finding, folding verifier usage and honoring key refusals.
  const verifyPayload = async (payload: FindingPayload | null, missing?: boolean): Promise<Verdict | null> => {
    if (payload?.kind === 'indicator') {
      if (keyFailure) {
        return { content_supported: 'uncertain', verifier_note: `verifier did not run: ${keyFailure.message}` };
      }
      try {
        const verified = await deps.runVerifier(payload);
        verifierUsage = mergeUsage(verifierUsage, verified.usage);
        if (verified.failure) deps.onFailure?.(verified.failure);
        return verified.verdict;
      } catch (err) {
        if (!(err instanceof OrgKeyUnavailableError)) throw err;
        keyFailure ??= err;
        deps.onKeyFailure?.(err);
        if (err.usage) verifierUsage = mergeUsage(verifierUsage, err.usage);
        return { content_supported: 'uncertain', verifier_note: `verifier did not run: ${err.message}` };
      }
    }
    if (payload?.kind === 'gap') {
      return {
        content_supported: 'uncertain',
        verifier_note: 'data gap — nothing to fetch; review the search trail',
      };
    }
    return {
      content_supported: 'fail',
      verifier_note: missing
        ? 'planned indicator was omitted from initial session output'
        : 'output did not conform to the finding schema',
    };
  };

  // Stage 3: independent verifier on every finding with bounded concurrency (4).
  await runWithConcurrency(entries, VERIFIER_CONCURRENCY, async (entry) => {
    entry.verdict = await verifyPayload(entry.payload, entry.missing);
  });

  // Stage 4: selective hybrid escalation (only when escalation_model is set on the plan).
  if (input.plan.models?.escalation_model && !keyFailure) {
    const escalationCandidates = selectEscalationCandidates(
      entries.map((e) => ({
        indicatorSlug: e.indicatorSlug,
        payload: e.payload,
        checks: e.checks,
        verdict: e.verdict,
        missing: e.missing,
      })),
    );
    if (escalationCandidates.length > 0) {
      const escalationPrompt = renderHybridEscalationPrompt({
        config: input.config,
        dimensionSlug: input.dimensionSlug,
        dimensionName: input.dimensionName,
        regionBrief: input.regionBrief,
        candidates: escalationCandidates,
      });
      const maxTurns = input.plan.caps?.escalation_max_turns ?? DEFAULT_ESCALATION_MAX_TURNS;

      let escResult: SessionResult | null = null;
      try {
        escResult = await deps.runEscalationSession({ prompt: escalationPrompt, maxTurns });
      } catch (err) {
        if (!(err instanceof OrgKeyUnavailableError)) throw err;
        keyFailure ??= err;
        deps.onKeyFailure?.(err);
        if (err.usage) escalationUsage = err.usage;
      }

      if (escResult) {
        escalationUsage = escResult.usage;
        escalationTranscript = escResult.transcript;
        if (!escResult.succeeded) deps.onFailure?.(escResult);
        let escRaw: unknown[] = [];
        let escSalvaged = false;
        if (escResult.submittedFindings?.length) {
          escRaw = escResult.submittedFindings;
        } else {
          try {
            const parsed = extractJson(escResult.resultText);
            escRaw = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
            escSalvaged = parsed.salvaged;
          } catch {
            deps.warn?.(`session ${input.sessionId}: hybrid escalation output was not parseable JSON; keeping initial findings`);
          }
        }

        const escalatedSlugSet = new Set(escalationCandidates.map((c) => c.indicatorSlug));
        const escBySlug = new Map<string, unknown>();
        for (const candidate of escRaw) {
          const slug = slugOf(null, candidate);
          if (escalatedSlugSet.has(slug) && !escBySlug.has(slug)) {
            escBySlug.set(slug, candidate);
          }
        }

        const toEvaluate: { index: number; entry: WorkingEntry; candidate: unknown }[] = [];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]!;
          if (!escalatedSlugSet.has(entry.indicatorSlug)) continue;
          const candidate = escBySlug.get(entry.indicatorSlug);
          if (!candidate) continue;
          toEvaluate.push({ index: i, entry, candidate });
        }

        await runWithConcurrency(toEvaluate, VERIFIER_CONCURRENCY, async ({ index, entry, candidate }) => {
          const prepared = await maybeRecaptureEvidence(candidate, entry.payload, deps.recaptureEvidence);
          const gated = await runGates(prepared);
          const verdict = await verifyPayload(gated.payload);
          if (
            shouldAcceptEscalation(
              {
                indicatorSlug: entry.indicatorSlug,
                payload: entry.payload,
                checks: entry.checks,
                verdict: entry.verdict,
                missing: entry.missing,
              },
              {
                indicatorSlug: slugOf(gated.payload, prepared),
                payload: gated.payload,
                checks: gated.checks,
                verdict,
              },
            )
          ) {
            entries[index] = {
              raw: prepared,
              payload: gated.payload,
              checks: gated.checks,
              indicatorSlug: slugOf(gated.payload, prepared),
              salvaged: escSalvaged,
              verdict,
              missing: false,
              producedByStage: 'escalation',
              producedByModel: escResult!.usage.model ?? input.plan.models?.escalation_model ?? undefined,
            };
          }
        });
      }
    }
  }

  // Stage 5: finalize records for persistence (skip unpopulated synthetic missing placeholders).
  const records = entries
    .filter((entry) => !(entry.missing && entry.raw === null))
    .map((entry) => {
      let verdict = entry.verdict;
      if (entry.payload?.kind === 'indicator' && entry.payload.narrative_draft && !verdict?.narrative_supported) {
        verdict = { content_supported: verdict?.content_supported ?? 'uncertain', ...verdict, narrative_supported: 'uncertain' };
      }
      const baseChecks: DeterministicGateChecks = {
        ...(entry.salvaged ? { ...entry.checks, partial_output: true } : entry.checks),
        ...(entry.producedByStage !== 'initial'
          ? {
              produced_by_stage: entry.producedByStage,
              ...(entry.producedByModel ? { produced_by_model: entry.producedByModel } : {}),
            }
          : {}),
      };
      return {
        indicatorSlug: entry.indicatorSlug,
        payload: (entry.payload ?? entry.raw) as FindingPayload,
        verification: mergeVerification(baseChecks, verdict),
      };
    });

  return {
    records,
    verifierUsage,
    ...(correctionUsage ? { correctionUsage } : {}),
    ...(escalationUsage ? { escalationUsage } : {}),
    ...(correctionTranscript ? { correctionTranscript } : {}),
    ...(escalationTranscript ? { escalationTranscript } : {}),
    keyFailure,
  };
}

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
  plan: Pick<ResearchPlan, 'models' | 'caps'>,
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
  const model = plan.models?.verifier_model ?? process.env.VERIFIER_MODEL ?? 'claude-opus-5';
  let result: SessionResult;
  try {
    result = await runSession({
      prompt,
      allowedTools: VERIFIER_TOOLS,
      archivedExhibits: archive.exhibits,
      orchestrate: false,
      // The plan's cap, never today's constant: a planned run keeps the
      // limits it was planned with. Plans that recorded none use the constant.
      maxTurns: plan.caps?.verifier_max_turns ?? VERIFIER_MAX_TURNS,
      model,
      ...(plan.models?.page_reader_model ? { pageReaderModel: plan.models.page_reader_model } : {}),
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
      fail_reason?: string;
      suggested_disposition?: string;
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
      const failReason =
        typeof parsed.fail_reason === 'string' && parsed.fail_reason.trim()
          ? parsed.fail_reason.trim().slice(0, 200)
          : undefined;
      const suggestedDisposition =
        parsed.suggested_disposition === 'approve' ||
        parsed.suggested_disposition === 'edit' ||
        parsed.suggested_disposition === 're_research' ||
        parsed.suggested_disposition === 'reject'
          ? parsed.suggested_disposition
          : undefined;
      return {
        verdict: {
          content_supported: parsed.content_supported,
          verifier_note: [parsed.verifier_note, judgedBy.trim(), archive.note].filter(Boolean).join(' ') || undefined,
          ...(failReason ? { fail_reason: failReason } : {}),
          ...(suggestedDisposition ? { suggested_disposition: suggestedDisposition } : {}),
          ...(payload.narrative_draft ? {
            narrative_supported: archive.actionArchiveNote
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
