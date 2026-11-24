import { gunzipSync, gzipSync } from 'node:zlib';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { Task } from 'graphile-worker';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  CIVIC_DATA_MCP_SERVER_NAME,
  CIVIC_DATA_MCP_TOOL_NAMES,
  createCivicDataTools,
} from '@deep-fryer/civic-data';
import { frameworkDimension, type PortraitConfig } from '@deep-fryer/contract';
import {
  PROVIDER_META,
  emptyUsage,
  parseResearchProvider,
  priceSessionUsage,
  providerForModel,
  resolveProviderEnvKey,
  type ContentSupported,
  type FindingPayload,
  type FindingTriageVerification,
  type FindingVerification,
  type IndicatorEvidence,
  type IndicatorFindingPayload,
  type PlannedSession,
  type RegionBriefCache,
  type ResearchPlan,
  type ResearchProvider,
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
  DEFAULT_SESSION_MODEL,
  deterministicChecks,
  dimensionNameFromPrompt,
  isValidRegionBriefCache,
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
  type SessionMcpServer,
  type SessionResult,
} from '../session.js';
import { SourceCache } from '../source-cache.js';
import {
  createMessagesClient,
  DEFAULT_TRIAGE_MODEL,
  runFindingTriage,
  type FindingTriageResult,
  type MessagesApiClient,
} from '../messages.js';
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
/**
 * Advisory-lock namespace (first key of pg_try_advisory_lock(int, int)) that
 * guarantees at most one live worker executes a given research run at once,
 * while allowing crash redelivery to resume cleanly once the dead worker's
 * connection drops and Postgres releases the session-level lock. Distinct from
 * the other namespaces (61_001..61_005).
 */
export const LOCK_RESEARCH_APPLY = 61_006;

/**
 * Pure: resolve the active model provider for each stage of a research run
 * from explicit env overrides (`RESEARCH_PROVIDER`, `VERIFIER_PROVIDER`) or
 * the plan's frozen model IDs (`providerForModel`).
 */
export function resolveRunProviders(
  plan: Pick<ResearchPlan, 'models'>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): {
  researchProvider: ResearchProvider;
  verifierProvider: ResearchProvider;
  escalationProvider: ResearchProvider;
  triageProvider: ResearchProvider;
  triageModel: string;
} {
  const researchModel = plan.models?.session_model ?? env.ANTHROPIC_MODEL ?? DEFAULT_SESSION_MODEL;
  const researchProvider =
    parseResearchProvider(env.RESEARCH_PROVIDER) ?? providerForModel(researchModel, 'anthropic');
  const verifierModel = plan.models?.verifier_model ?? env.VERIFIER_MODEL ?? 'claude-opus-5';
  const verifierProvider =
    parseResearchProvider(env.VERIFIER_PROVIDER) ?? providerForModel(verifierModel, 'anthropic');
  const escalationModel = plan.models?.escalation_model ?? undefined;
  const escalationProvider = escalationModel
    ? providerForModel(escalationModel, researchProvider)
    : researchProvider;
  const triageModel =
    env.TRIAGE_MODEL?.trim() ||
    (researchProvider === 'anthropic'
      ? DEFAULT_TRIAGE_MODEL
      : PROVIDER_META[researchProvider].defaultFastModel);
  const triageProvider = providerForModel(triageModel, researchProvider);
  return {
    researchProvider,
    verifierProvider,
    escalationProvider,
    triageProvider,
    triageModel,
  };
}

/**
 * Mount `@deep-fryer/civic-data` connectors as an in-process SDK MCP server
 * (`civic_data`) backed by the portrait's `TenantStorage` so every successful
 * federal/municipal API query is auto-archived into `evidence/<hash>.txt`.
 */
export function createCivicDataMcpServer(
  storage: TenantStorage,
  env: Record<string, string | undefined> = process.env,
): SessionMcpServer {
  const registry = createCivicDataTools({ storage, env });
  return createSdkMcpServer({
    name: registry.serverName,
    version: registry.version,
    tools: registry.tools.map((def) =>
      tool(def.name, def.description, def.inputSchema, async (args) => {
        const res = await def.handler(args);
        return {
          content: res.content,
          ...(res.isError ? { isError: res.isError } : {}),
        };
      }),
    ),
  });
}

function hasRecordedUsage(usage: SessionTokenUsage | undefined): usage is SessionTokenUsage {
  if (!usage) return false;
  return Boolean(
    usage.model ||
      (usage.by_model && Object.keys(usage.by_model).length > 0) ||
      usage.input_tokens > 0 ||
      usage.output_tokens > 0 ||
      (usage.cache_read_tokens ?? 0) > 0 ||
      (usage.cache_write_tokens ?? 0) > 0,
  );
}

/** Error raised when Phase 0 fails or yields an empty brief, failing the run loudly. */
export class Phase0RegionBriefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Phase0RegionBriefError';
  }
}

type ReservableClient = {
  reserve: () => Promise<{
    <T extends readonly unknown[] = readonly Record<string, unknown>[]>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T>;
    release: () => void;
  }>;
};

/**
 * Acquire a session-level Postgres advisory lock on `runId` using a dedicated
 * reserved connection so the lock is held for the entire run duration, never
 * leaks onto another pooled connection, and is automatically released by
 * Postgres if the worker process crashes.
 */
export async function acquireRunExecutionLock(
  db: DbExecutor & { $client?: unknown },
  runId: string,
): Promise<{ acquired: boolean; release: () => Promise<void> }> {
  const client = db.$client as Partial<ReservableClient> | undefined;
  if (typeof client?.reserve === 'function') {
    const reserved = await client.reserve();
    try {
      const rows = await reserved<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${LOCK_RESEARCH_APPLY}::int, hashtext(${runId})) AS locked
      `;
      if (!rows[0]?.locked) {
        reserved.release();
        return { acquired: false, release: async () => {} };
      }
      let released = false;
      return {
        acquired: true,
        release: async () => {
          if (released) return;
          released = true;
          try {
            await reserved`
              SELECT pg_advisory_unlock(${LOCK_RESEARCH_APPLY}::int, hashtext(${runId}))
            `;
          } finally {
            reserved.release();
          }
        },
      };
    } catch (err) {
      reserved.release();
      throw err;
    }
  }
  return { acquired: true, release: async () => {} };
}

/**
 * Atomically merge stage/session usage keys into `research_runs.token_usage`
 * via Postgres `coalesce(token_usage, '{}'::jsonb) || $patch::jsonb` so live
 * `RunCostSummary` polling sees spend as sessions finish and worker restarts
 * never lose spent-dollar telemetry.
 */
export async function persistTokenUsagePatch(
  db: DbExecutor,
  runId: string,
  patch: RunTokenUsage,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db
    .update(researchRuns)
    .set({
      tokenUsage: sql`coalesce(${researchRuns.tokenUsage}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
    })
    .where(eq(researchRuns.id, runId));
}

export interface ExistingSessionSnapshot {
  id: string;
  kind: string;
  dimensionId: string | null;
  planSessionIndex: number | null;
  status: string;
  transcript: Buffer | null;
  startedAt: Date | null;
}

export interface ResumeState {
  /** 0-based indices into `plan.sessions` already complete with persisted outputs (skip on resume). */
  completedPlanIndices: Set<number>;
  /** Existing session rows still in `queued` or `running` from an interrupted worker (mark failed/superseded). */
  interruptedSessionIds: string[];
  /** Recovered Phase-0 region brief if Phase 0 already completed before the crash, else null. */
  recoveredRegionBrief: string | null;
}

/**
 * Pure: extract a completed session's final result text from a gzipped (or raw
 * UTF-8) JSONL transcript when present (used as a fallback to recover Phase 0's
 * region brief during crash resume if the tenant cache was overwritten).
 */
export function extractRegionBriefFromTranscript(transcript: Buffer | null | undefined): string | null {
  if (!transcript || transcript.length === 0) return null;
  try {
    const text = decodeTranscriptBuffer(transcript);
    let found: string | null = null;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const frame = JSON.parse(trimmed) as { type?: unknown; result?: unknown };
        if (frame.type === 'result' && typeof frame.result === 'string' && frame.result.trim()) {
          found = frame.result;
        }
      } catch {
        // Skip non-JSON lines.
      }
    }
    return found;
  } catch {
    return null;
  }
}

/**
 * Pure: inspect existing `research_sessions` rows and persisted findings counts
 * for a run to determine which `planSessionIndex` entries can be safely skipped
 * on crash resume, which interrupted `running`/`queued` rows should be marked
 * superseded/retried, and whether Phase 0's region brief is already available.
 */
export function planSessionResumeState(input: {
  runId: string;
  plan: Pick<ResearchPlan, 'sessions' | 'config_hash' | 'cached_region_brief'>;
  existingSessions: readonly ExistingSessionSnapshot[];
  findingCountBySessionId: ReadonlyMap<string, number>;
  dimIdBySlug: ReadonlyMap<string, string>;
  tenantRegionBriefCache: RegionBriefCache | null | undefined;
}): ResumeState {
  const interruptedSessionIds: string[] = [];
  const completeByPlanIndex = new Map<number, ExistingSessionSnapshot>();
  const legacyCompleteByKey = new Map<string, ExistingSessionSnapshot[]>();

  const sorted = [...input.existingSessions].sort(
    (a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0) || a.id.localeCompare(b.id),
  );

  for (const row of sorted) {
    if (row.status === 'queued' || row.status === 'running') {
      interruptedSessionIds.push(row.id);
      continue;
    }
    if (row.status !== 'complete') continue;
    if (
      typeof row.planSessionIndex === 'number' &&
      row.planSessionIndex >= 0 &&
      row.planSessionIndex < input.plan.sessions.length
    ) {
      completeByPlanIndex.set(row.planSessionIndex, row);
    } else {
      const key = `${row.kind}:${row.dimensionId ?? ''}`;
      const list = legacyCompleteByKey.get(key) ?? [];
      list.push(row);
      legacyCompleteByKey.set(key, list);
    }
  }

  const completedPlanIndices = new Set<number>();
  let recoveredRegionBrief: string | null = null;

  for (const [index, spec] of input.plan.sessions.entries()) {
    const dimId = spec.dimension_slug ? input.dimIdBySlug.get(spec.dimension_slug) : undefined;
    const key = `${spec.kind}:${dimId ?? ''}`;
    const matched = completeByPlanIndex.get(index) ?? legacyCompleteByKey.get(key)?.shift();
    if (!matched) continue;

    if (spec.kind === 'region_context') {
      const cache = input.tenantRegionBriefCache;
      const briefFromCache =
        cache &&
        typeof cache.brief === 'string' &&
        cache.brief.trim() &&
        (cache.run_id === input.runId || cache.config_hash === input.plan.config_hash)
          ? cache.brief
          : null;
      const briefFromPlan = input.plan.cached_region_brief?.trim() ? input.plan.cached_region_brief : null;
      const briefFromTranscript = extractRegionBriefFromTranscript(matched.transcript);
      const brief = briefFromCache ?? briefFromPlan ?? briefFromTranscript;
      if (brief) {
        completedPlanIndices.add(index);
        recoveredRegionBrief = brief;
      }
      continue;
    }

    const findingCount = input.findingCountBySessionId.get(matched.id) ?? 0;
    const expectedSlugs = plannedSlugsFromPrompt(spec.prompt);
    if (findingCount > 0 || expectedSlugs.length === 0) {
      completedPlanIndices.add(index);
    }
  }

  return { completedPlanIndices, interruptedSessionIds, recoveredRegionBrief };
}

export interface Phase0Deps {
  createSessionRow: (planSessionIndex: number) => Promise<{ id: string }>;
  runRegionSession: (spec: PlannedSession) => Promise<SessionResult>;
  recordUsage: (patch: RunTokenUsage) => Promise<void>;
  updateSessionRow: (
    rowId: string,
    update: { status: 'complete' | 'failed'; transcript: Buffer; completedAt: Date },
  ) => Promise<void>;
  saveRegionBriefCache: (cache: RegionBriefCache) => Promise<void>;
  onFailure?: (result: SessionResult) => void;
  onKeyFailure?: (rowId: string, err: OrgKeyUnavailableError) => Promise<void>;
  now?: () => Date;
}

/**
 * Resolve the region brief for a run:
 * - If Phase 0 is in `plan.sessions` and already completed on resume, reuse `recoveredRegionBrief`.
 * - If Phase 0 is in `plan.sessions` and not yet completed, execute it, persist its usage
 *   immediately, fail loudly if it errors or returns empty text, and cache the brief on the tenant.
 * - If Phase 0 was omitted from `plan.sessions` (targeted re-run), validate and reuse
 *   `plan.cached_region_brief` or a valid `tenantRegionBriefCache`, failing loudly if absent.
 */
export async function resolvePhase0RegionBrief(
  input: {
    runId: string;
    plan: ResearchPlan;
    tenantRegionBriefCache: RegionBriefCache | null | undefined;
    resumeState: ResumeState;
  },
  deps: Phase0Deps,
): Promise<{ brief: string; skipped: boolean }> {
  const now = deps.now ?? (() => new Date());
  const regionIndex = input.plan.sessions.findIndex((s) => s.kind === 'region_context');

  if (regionIndex === -1) {
    if (input.plan.cached_region_brief?.trim()) {
      return { brief: input.plan.cached_region_brief, skipped: true };
    }
    if (isValidRegionBriefCache(input.tenantRegionBriefCache, input.plan.config_hash, now())) {
      return { brief: input.tenantRegionBriefCache.brief, skipped: true };
    }
    throw new Phase0RegionBriefError(
      'No Phase 0 (region_context) session was planned and no valid cached region brief is available; aborting run.',
    );
  }

  if (input.resumeState.completedPlanIndices.has(regionIndex) && input.resumeState.recoveredRegionBrief) {
    return { brief: input.resumeState.recoveredRegionBrief, skipped: true };
  }

  const regionSpec = input.plan.sessions[regionIndex]!;
  const row = await deps.createSessionRow(regionIndex);
  let result: SessionResult;
  try {
    result = await deps.runRegionSession(regionSpec);
  } catch (err) {
    if (err instanceof OrgKeyUnavailableError && deps.onKeyFailure) {
      await deps.onKeyFailure(row.id, err);
    }
    throw err;
  }

  if (!result.succeeded) deps.onFailure?.(result);
  await deps.recordUsage({ [row.id]: result.usage });

  const briefText = result.resultText.trim();
  const phase0Ok = result.succeeded && briefText.length > 0;
  const emptyMsg =
    'Phase 0 (region_context) returned an empty region brief; aborting run instead of running dimension sessions without context.';
  const failedMsg =
    'Phase 0 (region_context) failed; aborting run instead of running dimension sessions without context.';

  await deps.updateSessionRow(row.id, {
    status: phase0Ok ? 'complete' : 'failed',
    transcript: phase0Ok
      ? result.transcript
      : result.succeeded
        ? appendSessionErrorFrame(result.transcript, emptyMsg)
        : result.transcript,
    completedAt: now(),
  });

  if (!phase0Ok) {
    throw new Phase0RegionBriefError(result.succeeded ? emptyMsg : failedMsg);
  }

  await deps.saveRegionBriefCache({
    brief: result.resultText,
    config_hash: input.plan.config_hash,
    cached_at: now().toISOString(),
    run_id: input.runId,
  });

  return { brief: result.resultText, skipped: false };
}

export const researchApply: Task = async (rawPayload, helpers) => {
  const { runId, unmetered } = rawPayload as ApplyJobPayload;
  const db = getDb();

  // Prevent duplicate simultaneous execution across workers while allowing
  // crash redelivery to resume cleanly once the dead worker's connection drops.
  const lock = await acquireRunExecutionLock(db, runId);
  if (!lock.acquired) {
    helpers.logger.warn(`run ${runId} is already executing in another worker; skipping duplicate delivery`);
    return;
  }

  try {
    // Atomic claim: planned → running executes a newly applied run. If the run
    // is already `running` and we hold the per-run advisory lock, the previous
    // worker crashed mid-run — resume from checkpointed completed sessions
    // instead of blindly discarding finished work!
    const claimable = and(
      eq(researchRuns.id, runId),
      eq(researchRuns.status, 'planned'),
      unmetered ? undefined : isNotNull(researchRuns.appliedAt),
    );
    let [run] = await db.update(researchRuns).set({ status: 'running' }).where(claimable).returning();
    let resuming = false;
    if (!run) {
      const [existing] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
      if (!existing) {
        helpers.logger.error(`run ${runId} not found`);
        return;
      }
      if (existing.status === 'planned') {
        helpers.logger.warn(`run ${runId} is planned but not applied (its apply was undone); skipping`);
        return;
      }
      if (existing.status === 'running') {
        run = existing;
        resuming = true;
        helpers.logger.warn(`run ${runId} was interrupted mid-run; resuming from completed sessions`);
      } else {
        helpers.logger.warn(`run ${runId} is ${existing.status}; skipping`);
        return;
      }
    }

    const usage: RunTokenUsage = { ...(run.tokenUsage ?? {}) };
    const recordUsage = async (patch: RunTokenUsage) => {
      if (Object.keys(patch).length === 0) return;
      Object.assign(usage, patch);
      await persistTokenUsagePatch(db, runId, patch);
    };

    const finish = async (status: 'complete' | 'failed') => {
      await db
        .update(researchRuns)
        .set({
          status,
          completedAt: new Date(),
          tokenUsage: sql`coalesce(${researchRuns.tokenUsage}, '{}'::jsonb) || ${JSON.stringify(usage)}::jsonb`,
        })
        .where(eq(researchRuns.id, runId));
    };

    try {
      const plan = run.plan;
      const providers = resolveRunProviders(plan, process.env);

      // Keep run provenance synced with the actual resolved research provider
      // (covers runs applied before provider routing or unmetered runs).
      let currentExecution = run.execution;
      if (!currentExecution || currentExecution.provider !== providers.researchProvider) {
        currentExecution = {
          provider: providers.researchProvider,
          endpoint_host:
            currentExecution?.endpoint_host ??
            (run.funding === 'organization_key'
              ? PROVIDER_META[providers.researchProvider].firstPartyHost
              : null),
          executor: 'shared_worker' as const,
          host_region: currentExecution?.host_region ?? (process.env.DF_HOST_REGION?.trim() || null),
        };
        await db
          .update(researchRuns)
          .set({ execution: currentExecution })
          .where(eq(researchRuns.id, runId));
      }

      // First, before anything else can fail or spend: resolve whose key each
      // provider in this run uses, as the gate decided when the run was applied.
      const orgKeyByProvider = new Map<ResearchProvider, string | null>();
      const resolveKeyForProvider = async (provider: ResearchProvider): Promise<string | null> => {
        if (orgKeyByProvider.has(provider)) return orgKeyByProvider.get(provider)!;
        const resolved = await sessionApiKey(db, run.tenantId, run.funding, process.env.DF_SECRETS_KEY, provider);
        orgKeyByProvider.set(provider, resolved);
        return resolved;
      };
      const apiKey = await resolveKeyForProvider(providers.researchProvider);
      const verifierApiKey = await resolveKeyForProvider(providers.verifierProvider);
      const escalationApiKey = plan.models?.escalation_model
        ? await resolveKeyForProvider(providers.escalationProvider)
        : apiKey;
      if (apiKey) {
        // The hint (last four characters) is what the billing page shows; never more.
        helpers.logger.info(
          `run ${runId}: running on the organization's own ${PROVIDER_META[providers.researchProvider].displayName} API key (…${keyHint(apiKey)})`,
        );
      }
      const keyOption = apiKey ? { apiKey } : {};
      const escalationKeyOption = escalationApiKey ? { apiKey: escalationApiKey } : {};

      // A model id the API did not find (model_not_found) is logged for the
      // operator, once per model per run: on the deployment's key it is always
      // a model setting to fix, and on the organization's key it may be one
      // (org-key.ts KEY_REJECTED_ERRORS). Staff read the reason on the run.
      const modelsNotFound = new Set<string>();
      const reportModelNotFound = (model: string | undefined, provider: ResearchProvider = providers.researchProvider) => {
        const id = model ?? '(model not named)';
        if (modelsNotFound.has(id)) return;
        modelsNotFound.add(id);
        helpers.logger.error(`run ${runId}: ${modelNotFoundLog(id, Boolean(apiKey), provider)}`);
      };
      const noteFailure = (report: { apiError?: string; apiErrorText?: string; usage: SessionTokenUsage }) => {
        if (report.apiError === 'model_not_found') {
          const modelId = modelNamedIn(report.apiErrorText) ?? report.usage.model;
          reportModelNotFound(modelId, providerForModel(modelId, providers.researchProvider));
        }
      };
      const noteKeyFailure = (err: OrgKeyUnavailableError) => {
        if (err.rejection === 'model_not_found') reportModelNotFound(err.model, err.provider ?? providers.researchProvider);
      };

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, run.tenantId));
      if (!tenant) throw new Error(`tenant ${run.tenantId} missing`);

      const config = run.configSnapshot;
      const runStartedAt = new Date();
      const storage = await tenantStorage(tenant.slug);
      // One shared SourceCache per run so Playwright renders and PDF text
      // extraction are deduplicated across Phase 0, dimension sessions,
      // recaptures, and evidence promotion.
      const sourceCache = new SourceCache();
      // Deterministic federal & municipal civic-data connectors mounted as
      // both an Anthropic SDK MCP server (`civic_data`) and provider-agnostic
      // ToolExecutor definitions for OpenAI / Google Gemini sessions.
      const civicDataRegistry = createCivicDataTools({ storage, env: process.env });
      const civicDataMcpOptions = {
        extraMcpServers: {
          [CIVIC_DATA_MCP_SERVER_NAME]: createSdkMcpServer({
            name: civicDataRegistry.serverName,
            version: civicDataRegistry.version,
            tools: civicDataRegistry.tools.map((def) =>
              tool(def.name, def.description, def.inputSchema, async (args) => {
                const res = await def.handler(args);
                return {
                  content: res.content,
                  ...(res.isError ? { isError: res.isError } : {}),
                };
              }),
            ),
          }),
        },
        civicDataTools: civicDataRegistry.tools,
        extraAllowedTools: [...CIVIC_DATA_MCP_TOOL_NAMES],
      };
      // Optional direct structured-message triage setup (Anthropic, OpenAI, or Gemini).
      // Never falls back to the deployment key on organization-key-funded runs.
      const triageOrgKey =
        run.funding === 'organization_key'
          ? await resolveKeyForProvider(providers.triageProvider).catch(() => null)
          : null;
      let triageClient: MessagesApiClient | null = null;
      let triageEnabled = false;
      if (providers.triageProvider === 'anthropic') {
        if (triageOrgKey || (run.funding !== 'organization_key' && resolveProviderEnvKey('anthropic'))) {
          try {
            triageClient = createMessagesClient({ apiKey: triageOrgKey });
            triageEnabled = true;
          } catch {
            triageClient = null;
          }
        }
      } else {
        triageEnabled = Boolean(
          triageOrgKey || (run.funding !== 'organization_key' && resolveProviderEnvKey(providers.triageProvider)),
        );
      }
      // A finding's captured text, through its tenant's archive only (the
      // schema already limits the path to evidence/<name>.txt).
      const readEvidenceText = async (textPath: string) => (await storage.get(textPath)).toString('utf8');

      const tenantDims = await db
        .select()
        .from(dimensions)
        .where(eq(dimensions.tenantId, tenant.id));
      const dimBySlug = new Map(tenantDims.map((d) => [d.slug, d]));
      const dimIdBySlug = new Map(tenantDims.map((d) => [d.slug, d.id]));

      // Load any existing sessions & finding counts for idempotent crash-resume.
      const existingSessions = resuming
        ? await db
            .select({
              id: researchSessions.id,
              kind: researchSessions.kind,
              dimensionId: researchSessions.dimensionId,
              planSessionIndex: researchSessions.planSessionIndex,
              status: researchSessions.status,
              transcript: researchSessions.transcript,
              startedAt: researchSessions.startedAt,
            })
            .from(researchSessions)
            .where(eq(researchSessions.runId, runId))
        : [];
      const existingSessionIds = existingSessions.map((s) => s.id);
      const findingCountRows = existingSessionIds.length
        ? await db
            .select({
              sessionId: findings.sessionId,
              count: sql<number>`count(*)::int`,
            })
            .from(findings)
            .where(inArray(findings.sessionId, existingSessionIds))
            .groupBy(findings.sessionId)
        : [];
      const findingCountBySessionId = new Map(findingCountRows.map((r) => [r.sessionId, r.count]));
      const resumeState = planSessionResumeState({
        runId,
        plan,
        existingSessions,
        findingCountBySessionId,
        dimIdBySlug,
        tenantRegionBriefCache: tenant.regionBriefCache,
      });

      if (resumeState.interruptedSessionIds.length > 0) {
        await db
          .update(researchSessions)
          .set({
            status: 'failed',
            transcript: sessionErrorTranscript('Session was interrupted by a worker restart and retried on resume.'),
            completedAt: new Date(),
          })
          .where(inArray(researchSessions.id, resumeState.interruptedSessionIds));
      }

      // Phase 0: region context (run, resume, or reuse validated cached brief; fail loud on failure/empty).
      const phase0 = await resolvePhase0RegionBrief(
        {
          runId,
          plan,
          tenantRegionBriefCache: tenant.regionBriefCache,
          resumeState,
        },
        {
          createSessionRow: async (planSessionIndex) => {
            const [row] = await db
              .insert(researchSessions)
              .values({
                runId,
                kind: 'region_context',
                planSessionIndex,
                status: 'running',
                startedAt: new Date(),
              })
              .returning();
            if (!row) throw new Error('session insert failed');
            return row;
          },
          runRegionSession: (regionSpec) =>
            runSessionWithRetry({
              prompt: regionSpec.prompt,
              allowedTools: regionSpec.tool_allowlist,
              provider: providers.researchProvider,
              sourceCache,
              ...civicDataMcpOptions,
              // Never orchestrated: the region session has WebSearch, so with
              // RESEARCH_SUBAGENT_MODEL set it would otherwise get scouts and a
              // delegation note telling it to capture evidence — and it has no
              // capture tool, and writes a brief, not findings.
              orchestrate: false,
              ...plannedResearchOptions(plan),
              ...keyOption,
            }),
          recordUsage,
          updateSessionRow: async (rowId, update) => {
            await db.update(researchSessions).set(update).where(eq(researchSessions.id, rowId));
          },
          saveRegionBriefCache: async (cache) => {
            await db.update(tenants).set({ regionBriefCache: cache }).where(eq(tenants.id, tenant.id));
          },
          onFailure: noteFailure,
          onKeyFailure: async (rowId, err) => {
            noteKeyFailure(err);
            await recordKeyFailure(db, rowId, err, recordUsage);
          },
        },
      );
      const regionBrief = phase0.brief;

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
      const indexedDimensionSpecs = plan.sessions
        .map((spec, planSessionIndex) => ({ spec, planSessionIndex }))
        .filter(({ spec, planSessionIndex }) =>
          spec.kind === 'dimension' && !resumeState.completedPlanIndices.has(planSessionIndex),
        );

      // Set once Anthropic refuses the organization's key (OrgKeyUnavailableError
      // from a research or verifier session): from then on no session or
      // verifier starts on it, and the run fails with this reason below.
      let keyFailure: OrgKeyUnavailableError | null = null;

      const processDimension = async ({
        spec,
        planSessionIndex,
      }: (typeof indexedDimensionSpecs)[number]) => {
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
            planSessionIndex,
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
            provider: providers.researchProvider,
            storage,
            sourceCache,
            ...civicDataMcpOptions,
            submitFindingsContext,
            ...plannedResearchOptions(plan),
            ...(initialScout !== undefined ? { scoutModel: initialScout } : {}),
            ...keyOption,
          });
        } catch (err) {
          if (!(err instanceof OrgKeyUnavailableError)) throw err;
          keyFailure ??= err;
          noteKeyFailure(err);
          await recordKeyFailure(db, row.id, err, recordUsage);
          return;
        }
        if (!result.succeeded) noteFailure(result);
        trackCaptures(result.capturedSnapshotPaths);
        await recordUsage({ [row.id]: result.usage });

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
                const captured = await captureEvidence(storage, url, pdfUrl, { sourceCache });
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
                provider: providers.researchProvider,
                storage,
                sourceCache,
                ...civicDataMcpOptions,
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
                provider: providers.escalationProvider,
                storage,
                sourceCache,
                ...civicDataMcpOptions,
                submitFindingsContext,
                ...plannedEscalationOptions(plan),
                maxTurns,
                ...escalationKeyOption,
              });
              trackCaptures(res.capturedSnapshotPaths);
              return res;
            },
            runVerifier: (payload) =>
              runVerifier(payload, config.region.name, verifierApiKey, storage, plan, providers.verifierProvider),
            ...(triageEnabled
              ? {
                  runTriage: async (payload: IndicatorFindingPayload) => {
                    const textPath = payload.evidence.text_path;
                    if (!textPath) return null;
                    let sourceText: string;
                    try {
                      sourceText = await readEvidenceText(textPath);
                    } catch {
                      return null;
                    }
                    if (!sourceText.trim()) return null;
                    const fwInd = frameworkDimension(dimension.slug, dimension.canonicalSlug)?.indicators.find(
                      (ind) => ind.slug === payload.indicator_slug,
                    );
                    return runFindingTriage(
                      {
                        ...(triageClient ? { client: triageClient } : {}),
                        provider: providers.triageProvider,
                        model: providers.triageModel,
                        apiKey: triageOrgKey,
                        isOrganizationKey: run.funding === 'organization_key',
                        regionName: config.region.name,
                        regionDefinition: config.region.definition,
                        indicatorDefinition: fwInd?.name,
                        portraitScale: config.scale_policy.default_accepted[0],
                      },
                      payload,
                      sourceText,
                    );
                  },
                }
              : {}),
            onFailure: noteFailure,
            onKeyFailure: noteKeyFailure,
            warn: (msg) => helpers.logger.warn(msg),
          },
        );

        if (evaluated.keyFailure) keyFailure ??= evaluated.keyFailure;
        const evalUsagePatch: RunTokenUsage = {
          [`verifier:${row.id}`]: evaluated.verifierUsage,
        };
        if (evaluated.triageUsage) evalUsagePatch[`triage:${row.id}`] = evaluated.triageUsage;
        if (evaluated.correctionUsage) evalUsagePatch[`correction:${row.id}`] = evaluated.correctionUsage;
        if (evaluated.escalationUsage) evalUsagePatch[`escalation:${row.id}`] = evaluated.escalationUsage;
        await recordUsage(evalUsagePatch);

        const combinedTranscript = combineStageTranscripts([
          { stage: 'initial', transcript: result.transcript },
          ...(evaluated.correctionTranscript ? [{ stage: 'correction' as const, transcript: evaluated.correctionTranscript }] : []),
          ...(evaluated.escalationTranscript ? [{ stage: 'escalation' as const, transcript: evaluated.escalationTranscript }] : []),
        ]);
        // If initial output was unparseable but correction/escalation recovered findings, keep session status aligned.
        const recoveredOutput = !parseOk && evaluated.records.some((r) => r.verification.schema_ok);
        const sessionStatus = (result.succeeded && parseOk) || recoveredOutput ? 'complete' : 'failed';

        // Checkpoint atomically: findings + session completion commit together so
        // crash-resume never sees a `complete` session with partial findings.
        await db.transaction(async (tx) => {
          for (const record of evaluated.records) {
            await tx.insert(findings).values({
              sessionId: row.id,
              dimensionId: dimension.id,
              indicatorSlug: record.indicatorSlug,
              payload: record.payload,
              verification: record.verification,
            });
          }
          await tx
            .update(researchSessions)
            .set({
              status: sessionStatus,
              transcript: combinedTranscript,
              completedAt: new Date(),
            })
            .where(eq(researchSessions.id, row.id));
        });
      };

      // Hard per-run dollar circuit breaker (MAX_RUN_USD, default $150): checked
      // between sessions using live priceSessionUsage(foldedUsage) so runaway
      // retry or escalation loops halt cleanly with all completed findings preserved.
      const maxRunBudget = resolveMaxRunUsd(process.env.MAX_RUN_USD);
      if (!maxRunBudget.valid) {
        helpers.logger.warn(
          `MAX_RUN_USD=${JSON.stringify(process.env.MAX_RUN_USD)} is not a positive dollar amount; defaulting to $${DEFAULT_MAX_RUN_USD}`,
        );
      }

      // Bounded pool: next session starts as soon as a slot frees. A refused
      // key, budget circuit-breaker trip, or any other error stops new sessions
      // from starting; the ones already running finish (and record themselves)
      // before settling, so the run is never settled while a session still writes.
      const poolResult = await runDimensionPoolWithBudget({
        items: indexedDimensionSpecs,
        concurrency: concurrency.value,
        getUsage: () => usage,
        maxRunUsd: maxRunBudget.value,
        shouldStop: () => Boolean(keyFailure),
        onBudgetExceeded: (check) => {
          helpers.logger.warn(`run ${runId}: ${check.note}`);
        },
        runItem: processDimension,
      });
      if (poolResult.error) throw poolResult.error;
      if (keyFailure) throw keyFailure;

      let budgetCapNote = poolResult.budgetCapNote;
      if (!budgetCapNote) {
        const postDimBudget = checkRunBudget(usage, maxRunBudget.value);
        if (postDimBudget.exceeded) {
          budgetCapNote = postDimBudget.note;
          helpers.logger.warn(`run ${runId}: ${budgetCapNote}`);
        }
      }

      if (budgetCapNote && currentExecution) {
        currentExecution = { ...currentExecution, budget_cap_note: budgetCapNote };
        await db
          .update(researchRuns)
          .set({ execution: currentExecution })
          .where(eq(researchRuns.id, runId));
      }

      // Independent post-run recommendations stay in the staff plane. They
      // share the run's funding/model policy and report their own usage; an
      // audit service/persistence failure must not discard completed research.
      // When the hard MAX_RUN_USD circuit breaker tripped, skip launching new
      // paid post-run audit sessions so spend stops immediately.
      if (budgetCapNote) {
        helpers.logger.warn(`run ${runId}: skipping automatic post-run audit after MAX_RUN_USD circuit breaker`);
      } else {
        try {
          const auditUsage = await auditResearchRun(run, helpers, {
            apiKey: verifierApiKey,
            verifierModel: plan.models?.verifier_model,
            provider: providers.verifierProvider,
            ...(plan.caps ? { maxTurns: plan.caps.audit_max_turns } : {}),
            ...(plan.models?.page_reader_model ? { pageReaderModel: plan.models.page_reader_model } : {}),
          });
          await recordUsage(auditUsage);
        } catch {
          helpers.logger.warn(`run ${runId}: automatic audit could not finish; findings remain available for human review`);
        }
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
  } finally {
    await lock.release();
  }
};

/** How many dimension sessions run at once when RESEARCH_SESSION_CONCURRENCY is unset or unusable. */
export const DEFAULT_SESSION_CONCURRENCY = 3;

/** Hard per-run dollar circuit breaker ceiling when MAX_RUN_USD is unset (P2.2). */
export const DEFAULT_MAX_RUN_USD = 150;

/**
 * Pure: parse `MAX_RUN_USD` into a positive dollar limit, falling back to
 * `DEFAULT_MAX_RUN_USD` ($150) with `valid: false` on malformed values.
 */
export function resolveMaxRunUsd(raw: string | undefined = process.env.MAX_RUN_USD): {
  value: number;
  valid: boolean;
} {
  if (raw === undefined || raw.trim() === '') {
    return { value: DEFAULT_MAX_RUN_USD, valid: true };
  }
  const trimmed = raw.trim();
  const parsed = /^\d+(?:\.\d+)?$/.test(trimmed) ? Number.parseFloat(trimmed) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? { value: parsed, valid: true }
    : { value: DEFAULT_MAX_RUN_USD, valid: false };
}

/**
 * Pure: fold every recorded session/stage usage record in `RunTokenUsage` via
 * `mergeUsage` and price the live cumulative spend via `priceSessionUsage`.
 */
export function foldedRunSpendUsd(usage: RunTokenUsage): { dollars: number; unpriced: string[] } {
  const values = Object.values(usage);
  if (values.length === 0) return { dollars: 0, unpriced: [] };
  let folded = values[0]!;
  for (let i = 1; i < values.length; i++) {
    folded = mergeUsage(folded, values[i]!);
  }
  return priceSessionUsage(folded);
}

export interface RunBudgetCheck {
  exceeded: boolean;
  spentUsd: number;
  limitUsd: number;
  note: string | null;
}

/**
 * Pure: evaluate whether live folded run spend has reached or exceeded the
 * configured `MAX_RUN_USD` circuit breaker.
 */
export function checkRunBudget(usage: RunTokenUsage, limitUsd: number = DEFAULT_MAX_RUN_USD): RunBudgetCheck {
  const { dollars } = foldedRunSpendUsd(usage);
  if (dollars >= limitUsd) {
    return {
      exceeded: true,
      spentUsd: dollars,
      limitUsd,
      note: `Run halted early: live spend ($${dollars.toFixed(2)}) reached MAX_RUN_USD budget cap ($${limitUsd.toFixed(2)}). All completed sessions and findings were preserved.`,
    };
  }
  return { exceeded: false, spentUsd: dollars, limitUsd, note: null };
}

/**
 * Execute planned dimension items under a bounded concurrency pool while
 * checking `checkRunBudget` before launching each next item. When the budget
 * cap is reached, no further items are started, in-flight items finish cleanly,
 * and `budgetCapNote` carries the explicit circuit-breaker explanation.
 */
export async function runDimensionPoolWithBudget<T>(options: {
  items: readonly T[];
  concurrency: number;
  getUsage: () => RunTokenUsage;
  maxRunUsd: number;
  shouldStop?: () => boolean;
  onBudgetExceeded?: (check: RunBudgetCheck) => void;
  runItem: (item: T) => Promise<void>;
}): Promise<{
  completedCount: number;
  skippedCount: number;
  budgetCapNote: string | null;
  error: unknown;
}> {
  let cursor = 0;
  let completedCount = 0;
  let budgetCapNote: string | null = null;
  let poolError: { error: unknown } | null = null;
  const workers = Math.max(1, Math.min(options.concurrency, options.items.length));

  if (options.items.length === 0) {
    return { completedCount: 0, skippedCount: 0, budgetCapNote: null, error: null };
  }

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (!poolError && !budgetCapNote && !options.shouldStop?.() && cursor < options.items.length) {
        const budget = checkRunBudget(options.getUsage(), options.maxRunUsd);
        if (budget.exceeded) {
          if (!budgetCapNote) {
            budgetCapNote = budget.note;
            options.onBudgetExceeded?.(budget);
          }
          break;
        }
        const item = options.items[cursor++]!;
        try {
          await options.runItem(item);
          completedCount++;
        } catch (error) {
          poolError ??= { error };
        }
      }
    }),
  );

  const finalError = poolError as { error: unknown } | null;
  return {
    completedCount,
    skippedCount: Math.max(0, options.items.length - cursor),
    budgetCapNote,
    error: finalError ? finalError.error : null,
  };
}

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

/** Append a `session_error` JSONL frame to an existing gzipped/raw transcript so the reason stays visible alongside prior output. */
function appendSessionErrorFrame(transcript: Buffer, message: string): Buffer {
  const existing = decodeTranscriptBuffer(transcript).trim();
  const errorLine = JSON.stringify({ type: 'session_error', message });
  return gzipSync(existing ? `${existing}\n${errorLine}` : errorLine);
}

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
  recordUsage: (patch: RunTokenUsage) => Promise<void>,
): Promise<void> {
  if (err.usage) await recordUsage({ [rowId]: err.usage });
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
  const startedIndices = new Set<number>();
  const startedLegacy = new Map<string, number>();
  for (const row of (
      await db
        .select({
          kind: researchSessions.kind,
          dimensionId: researchSessions.dimensionId,
          planSessionIndex: researchSessions.planSessionIndex,
        })
        .from(researchSessions)
        .where(eq(researchSessions.runId, run.id))
    )) {
    if (typeof row.planSessionIndex === 'number') {
      startedIndices.add(row.planSessionIndex);
    } else {
      const key = `${row.kind}:${row.dimensionId ?? ''}`;
      startedLegacy.set(key, (startedLegacy.get(key) ?? 0) + 1);
    }
  }
  const rows = run.plan.sessions.flatMap((spec, planSessionIndex) => {
    const dimensionId = spec.dimension_slug ? idBySlug.get(spec.dimension_slug) : undefined;
    if (spec.kind === 'dimension' && !dimensionId) return [];
    if (startedIndices.has(planSessionIndex)) return [];
    // Dense dimensions have several planned sessions with the same slug.
    // Consume one legacy started row per spec when planSessionIndex is null.
    const key = `${spec.kind}:${dimensionId ?? ''}`;
    const count = startedLegacy.get(key) ?? 0;
    if (count > 0) {
      startedLegacy.set(key, count - 1);
      return [];
    }
    return [
      {
        runId: run.id,
        kind: spec.kind,
        dimensionId: dimensionId ?? null,
        planSessionIndex,
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
  /** Optional advisory frame/construct triage run concurrently with `runVerifier` (never clears flags or breaks verification). */
  runTriage?: (payload: IndicatorFindingPayload) => Promise<FindingTriageResult | null>;
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
  triageUsage?: SessionTokenUsage;
  correctionUsage?: SessionTokenUsage;
  escalationUsage?: SessionTokenUsage;
  correctionTranscript?: Buffer;
  escalationTranscript?: Buffer;
  keyFailure: OrgKeyUnavailableError | null;
}> {
  let keyFailure = input.initialKeyFailure;
  let verifierUsage = emptyUsage();
  let triageUsage: SessionTokenUsage | undefined;
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
    triage?: FindingTriageVerification;
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

  // Helper to verify one finding (and optionally run advisory triage in parallel),
  // folding verifier and triage usage and honoring key refusals. Triage is strictly
  // advisory: errors never break verification and never clear verifier flags.
  const verifyPayload = async (
    payload: FindingPayload | null,
    missing?: boolean,
  ): Promise<{ verdict: Verdict | null; triage?: FindingTriageVerification }> => {
    if (payload?.kind === 'indicator') {
      if (keyFailure) {
        return {
          verdict: { content_supported: 'uncertain', verifier_note: `verifier did not run: ${keyFailure.message}` },
        };
      }
      const runTriageSafely = async (): Promise<FindingTriageResult | null> => {
        if (!deps.runTriage) return null;
        try {
          return await deps.runTriage(payload);
        } catch (err) {
          deps.warn?.(
            `session ${input.sessionId}: advisory triage failed for ${payload.indicator_slug}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }
      };

      const [verifierOutcome, triageResult] = await Promise.all([
        deps.runVerifier(payload).then(
          (value) => ({ ok: true as const, value }),
          (err: unknown) => ({ ok: false as const, err }),
        ),
        runTriageSafely(),
      ]);

      if (triageResult && hasRecordedUsage(triageResult.usage)) {
        triageUsage = triageUsage ? mergeUsage(triageUsage, triageResult.usage) : triageResult.usage;
      }
      const triage: FindingTriageVerification | undefined =
        triageResult?.status === 'scored' && triageResult.assessment
          ? {
              advisory_only: true,
              severity: triageResult.severity,
              flags: triageResult.flags,
              assessment: triageResult.assessment,
              ...(triageResult.model ? { model: triageResult.model } : {}),
            }
          : undefined;

      if (!verifierOutcome.ok) {
        const err = verifierOutcome.err;
        if (!(err instanceof OrgKeyUnavailableError)) throw err;
        keyFailure ??= err;
        deps.onKeyFailure?.(err);
        if (err.usage) verifierUsage = mergeUsage(verifierUsage, err.usage);
        return {
          verdict: { content_supported: 'uncertain', verifier_note: `verifier did not run: ${err.message}` },
          ...(triage ? { triage } : {}),
        };
      }

      const verified = verifierOutcome.value;
      verifierUsage = mergeUsage(verifierUsage, verified.usage);
      if (verified.failure) deps.onFailure?.(verified.failure);
      return {
        verdict: verified.verdict,
        ...(triage ? { triage } : {}),
      };
    }
    if (payload?.kind === 'gap') {
      return {
        verdict: {
          content_supported: 'uncertain',
          verifier_note: 'data gap — nothing to fetch; review the search trail',
        },
      };
    }
    return {
      verdict: {
        content_supported: 'fail',
        verifier_note: missing
          ? 'planned indicator was omitted from initial session output'
          : 'output did not conform to the finding schema',
      },
    };
  };

  // Stage 3: independent verifier (+ optional advisory triage) on every finding with bounded concurrency (4).
  await runWithConcurrency(entries, VERIFIER_CONCURRENCY, async (entry) => {
    const out = await verifyPayload(entry.payload, entry.missing);
    entry.verdict = out.verdict;
    entry.triage = out.triage;
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
          const { verdict, triage } = await verifyPayload(gated.payload);
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
              ...(triage ? { triage } : {}),
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
        ...(entry.triage ? { triage: entry.triage } : {}),
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
    ...(triageUsage ? { triageUsage } : {}),
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
  provider?: ResearchProvider,
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
  const resolvedProvider = provider ?? providerForModel(model, 'anthropic');
  let result: SessionResult;
  try {
    result = await runSession({
      prompt,
      allowedTools: VERIFIER_TOOLS,
      provider: resolvedProvider,
      // Zero-subprocess direct Anthropic Messages runner (<= 4 read_exhibit turns,
      // prompt caching, strict JSON) eliminates ~10k-token CLI overhead per finding.
      ...(resolvedProvider === 'anthropic' ? { direct: true } : {}),
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
    if (err instanceof OrgKeyUnavailableError) throw err;
    // A thrown session still spent what it streamed (SessionRunError).
    if (!(err instanceof SessionRunError)) return { verdict: null, usage: emptyUsage() };
    const refused = apiKey ? rejectedKeyError(err, model, err.usage, resolvedProvider) : null;
    if (refused) throw refused;
    return { verdict: null, usage: err.usage, failure: err };
  }
  if (!result.succeeded) {
    const refused = apiKey ? rejectedKeyError(result, model, result.usage, resolvedProvider) : null;
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
