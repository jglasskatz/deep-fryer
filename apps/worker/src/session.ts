import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createSdkMcpServer,
  query,
  tool,
  type SDKAssistantMessageError,
  type SDKMessage,
  type HookCallback,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CivicDataToolDefinition } from '@deep-fryer/civic-data';
import { frameworkDimension, type PortraitConfig } from '@deep-fryer/contract';
import {
  LONG_PROMPT_THRESHOLD_TOKENS,
  acceptedScales,
  baseModelId,
  computeScoring,
  emptyUsage,
  findingPayloadSchema,
  isHomeOrSectionPage,
  maxDataAgeYears,
  mergeUsage,
  providerForModel,
  resolveThreshold,
  type FindingPayload,
  type IndicatorFindingPayload,
  type ModelTokenUsage,
  type RefusalFallbackEvent,
  type ResearchProvider,
  type SessionTokenUsage,
} from '@deep-fryer/core';
import {
  DEFAULT_SESSION_MAX_TURNS,
  DEFAULT_SESSION_MODEL,
  checkValueOnPage,
  getActiveEgressBlocklist,
  matchBlockedSource,
  valueOnPage,
  withEgressBlocklist,
  type SourceBlocklist,
} from '@deep-fryer/research';
import { buildCapturePreview, captureEvidence } from './evidence.js';
import {
  buildArchivedExhibitMap,
  runDirectAnthropicSession,
  type MessagesApiClient,
} from './messages.js';
import { getSharedSourceCache, readSourceWithCache, type SourceCache } from './source-cache.js';
import { OrgKeyUnavailableError, rejectedKeyError } from './org-key.js';
import {
  ToolExecutor,
  zodToJsonSchema,
  type FetchLike,
  type ProviderToolDefinition,
} from './providers/types.js';
import { runOpenAiSession } from './providers/openai.js';
import { runGoogleSession } from './providers/google.js';
import { getSharedSessionSemaphore, type SessionSemaphore } from './session-semaphore.js';
import type { TenantStorage } from './storage.js';
import { ARCHIVED_PDF, ARCHIVED_PDF_EXCERPT, ARCHIVED_SNAPSHOT, type ArchivedExhibits } from './archived-exhibits.js';

// The fold the retry below uses, exported where the worker's callers look
// for it; it lives in @deep-fryer/core because the measurement code folds
// stored records with the same arithmetic.
export { mergeUsage };

export interface SessionResult {
  resultText: string;
  transcript: Buffer;
  usage: SessionTokenUsage;
  succeeded: boolean;
  /**
   * The last API error the CLI reported on one of the session's own
   * (main-loop) assistant messages — SDKAssistantMessage.error — if any.
   * runSessionWithRetry reads it to tell a refused key, which no retry
   * fixes, from a transient failure.
   */
  apiError?: SDKAssistantMessageError;
  /**
   * The text of that error frame (the CLI's own message, with any
   * organization key redacted). Two dead-key cases arrive as a plain
   * `invalid_request` and only this text tells them apart, and a
   * `model_not_found` frame names the model that was not found
   * (org-key.ts keyRejection, modelNamedIn).
   */
  apiErrorText?: string;
  /** Validated & deterministically scored findings submitted in-session via `submit_findings`. */
  submittedFindings?: FindingPayload[];
  /** Snapshot paths confirmed captured via `capture_evidence` during this session. */
  capturedSnapshotPaths?: string[];
}

export interface SubmitFindingsContext {
  config: PortraitConfig;
  dimensionSlug: string;
  /** Optional `indicator_slug -> threshold_ref` mapping from the planned dimension/framework. */
  thresholdRefs?: Readonly<Record<string, string>>;
}

export interface SubmitFindingError {
  index: number;
  indicator_slug: string;
  errors: string[];
}

/**
 * Pure: deterministically compute `level_pct`, `target`, and `scoring` from
 * `resolveThreshold` whenever an indicator has a finite numeric value and a
 * resolvable threshold ref — never trusting LLM mental arithmetic.
 */
export function rescoreIndicatorPayload(
  payload: IndicatorFindingPayload,
  config: Pick<PortraitConfig, 'threshold_overrides'>,
  dimensionSlug?: string,
  thresholdRefs?: Readonly<Record<string, string>>,
): IndicatorFindingPayload {
  if (typeof payload.value !== 'number' || !Number.isFinite(payload.value)) return payload;
  const fwRef = dimensionSlug
    ? frameworkDimension(dimensionSlug)?.indicators.find((i) => i.slug === payload.indicator_slug)?.threshold_ref
    : undefined;
  const ref = payload.scoring?.threshold_ref || thresholdRefs?.[payload.indicator_slug] || fwRef || '';
  if (!ref) return payload;
  const threshold = resolveThreshold(ref, config.threshold_overrides);
  if (!threshold) return payload;
  const computed = computeScoring(payload.value, ref, threshold);
  return {
    ...payload,
    target: threshold.target,
    level_pct: computed.level_pct,
    scoring: computed.scoring,
  };
}

/**
 * Pure (apart from `readEvidenceText` callback): validate and deterministically
 * score findings submitted via `mcp__evidence__submit_findings` synchronously
 * inside an active research session. Returns concrete validation errors back to
 * the model while its search context is still warm.
 */
export async function validateAndScoreSubmittedFindings(
  rawFindings: readonly unknown[],
  ctx: SubmitFindingsContext | undefined,
  readEvidenceText?: (textPath: string) => Promise<string>,
): Promise<{
  accepted: boolean;
  findings: FindingPayload[];
  errors: SubmitFindingError[];
}> {
  const validFindings: FindingPayload[] = [];
  const errors: SubmitFindingError[] = [];

  const fwDim = ctx ? frameworkDimension(ctx.dimensionSlug) : undefined;
  const maxAge = ctx ? maxDataAgeYears(ctx.config.recency, ctx.dimensionSlug) : undefined;
  const allowedScales = ctx ? acceptedScales(ctx.config.scale_policy, ctx.dimensionSlug) : undefined;
  const currentYear = new Date().getUTCFullYear();

  for (let i = 0; i < rawFindings.length; i++) {
    const raw = rawFindings[i];
    const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
    const slug = typeof obj?.indicator_slug === 'string' && obj.indicator_slug ? obj.indicator_slug : `item-${i}`;
    let candidate: unknown = raw;

    // Deterministically compute scoring from threshold contract before schema validation,
    // allowing researchers to omit `target`/`level_pct`/`scoring` or correcting any math drift.
    if (obj && obj.kind === 'indicator' && typeof obj.value === 'number' && Number.isFinite(obj.value) && ctx) {
      const existingScoring =
        typeof obj.scoring === 'object' && obj.scoring !== null ? (obj.scoring as Record<string, unknown>) : null;
      const existingRef =
        typeof existingScoring?.threshold_ref === 'string' && existingScoring.threshold_ref.trim()
          ? existingScoring.threshold_ref.trim()
          : undefined;
      const fwRef = fwDim?.indicators.find((ind) => ind.slug === slug)?.threshold_ref;
      const ref = existingRef ?? ctx.thresholdRefs?.[slug] ?? fwRef;
      const threshold = ref ? resolveThreshold(ref, ctx.config.threshold_overrides) : undefined;
      if (ref && threshold) {
        const computed = computeScoring(obj.value, ref, threshold);
        candidate = {
          ...obj,
          target: threshold.target,
          level_pct: computed.level_pct,
          scoring: computed.scoring,
        };
      }
    }

    const parsed = findingPayloadSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push({
        index: i,
        indicator_slug: slug,
        errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'finding'}: ${issue.message}`),
      });
      continue;
    }

    const payload = parsed.data as FindingPayload;
    if (payload.kind === 'gap') {
      validFindings.push(payload);
      continue;
    }

    const itemErrors: string[] = [];
    if (isHomeOrSectionPage(payload.source_url)) {
      itemErrors.push(
        `home_page_link: source_url "${payload.source_url}" is a publisher home or top-level section page. Cite the concrete report, data table, or direct PDF URL and call capture_evidence on it.`,
      );
    }
    if (maxAge !== undefined) {
      const age = currentYear - payload.year;
      if (age < 0 || age > maxAge) {
        itemErrors.push(
          `recency_failed: year ${payload.year} is outside the allowed window (last ${maxAge} years; future projections are not observations). Find a compliant year or emit kind: "gap".`,
        );
      }
    }
    if (allowedScales && !allowedScales.includes(payload.geographic_scale)) {
      itemErrors.push(
        `scale_failed: geographic_scale "${payload.geographic_scale}" is not in accepted scales (${allowedScales.join(', ')}). Find a compliant scale or emit kind: "gap".`,
      );
    }
    if (readEvidenceText && payload.evidence.text_path) {
      const valStatus = await checkValueOnPage(payload, readEvidenceText);
      if (valStatus === 'not_found') {
        itemErrors.push(
          `value_not_found: claimed value "${payload.value}" was not found in the captured readable text (${payload.evidence.text_path}). Verify the exact figure on the page, capture the concrete data table/PDF URL, or emit kind: "gap".`,
        );
      }
    }

    if (itemErrors.length > 0) {
      errors.push({ index: i, indicator_slug: payload.indicator_slug, errors: itemErrors });
    } else {
      validFindings.push(payload);
    }
  }

  return {
    accepted: errors.length === 0 && validFindings.length > 0,
    findings: validFindings,
    errors,
  };
}

/**
 * runSession threw part-way (the SDK surfaces transport failures, and the
 * CLI exiting after an API error, as thrown errors). It carries what the
 * session had used by then — the streamed totals with `partial: true` when
 * no result arrived, the result's full record when one did — so a failed
 * attempt's spend is still recorded instead of becoming zeros.
 */
export class SessionRunError extends Error {
  readonly usage: SessionTokenUsage;
  readonly apiError?: SDKAssistantMessageError;
  readonly apiErrorText?: string;

  constructor(cause: unknown, usage: SessionTokenUsage, apiError?: SDKAssistantMessageError, apiErrorText?: string) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'SessionRunError';
    this.usage = usage;
    if (apiError) this.apiError = apiError;
    if (apiErrorText) this.apiErrorText = apiErrorText;
  }
}

/** Hard turn cap for bounded synthesis-only recovery when a session hits `error_max_turns`. */
export const MAX_TURNS_RECOVERY_LIMIT = 6;
const MAX_SYNTHESIS_DIGEST_CHARS = 12_000;

/**
 * Pure: extract a bounded digest of assistant findings/notes from a previous
 * session result & transcript so a `error_max_turns` recovery pass can emit
 * findings already gathered without doing any new web searches.
 */
function extractGatheredNotesDigest(first: SessionResult): string {
  const parts: string[] = [];
  if (first.resultText.trim()) {
    parts.push(first.resultText.trim());
  }
  if (first.transcript && first.transcript.length > 0) {
    try {
      const raw =
        first.transcript.length >= 2 && first.transcript[0] === 0x1f && first.transcript[1] === 0x8b
          ? gunzipSync(first.transcript).toString('utf8')
          : first.transcript.toString('utf8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const frame = JSON.parse(trimmed) as {
            type?: unknown;
            message?: { content?: unknown };
            content?: unknown;
          };
          if (frame.type !== 'assistant') continue;
          const text = messageText(frame.message?.content ?? frame.content).trim();
          if (text) parts.push(text);
        } catch {
          // Ignore non-JSON lines.
        }
      }
    } catch {
      // Ignore corrupt/unreadable transcript buffers.
    }
  }
  const combined = parts.join('\n\n---\n\n').trim();
  if (!combined) return '(no prior assistant notes captured)';
  if (combined.length <= MAX_SYNTHESIS_DIGEST_CHARS) return combined;
  // Keep the most recent gathered notes (end of transcript has the final collected figures/paths).
  return `…[earlier notes truncated]\n${combined.slice(-MAX_SYNTHESIS_DIGEST_CHARS)}`;
}

/**
 * Pure: detect whether a failed session stopped due to turn-cap exhaustion
 * (`error_max_turns`), which should trigger bounded 6-turn synthesis recovery
 * rather than replaying a full 60-turn open-web research prompt.
 */
export function isMaxTurnsExhaustion(result: Pick<SessionResult, 'succeeded' | 'usage'>): boolean {
  if (result.succeeded) return false;
  return (
    result.usage.result_subtype === 'error_max_turns' ||
    result.usage.terminal_reason === 'max_turns'
  );
}

/**
 * Pure: transform a session input that hit `error_max_turns` into a bounded
 * 6-turn synthesis-only recovery prompt with zero web search / fetch tools.
 * Retains only `mcp__evidence__submit_findings` when present so the agent can
 * validate and emit findings already gathered in the first pass.
 */
export function buildSynthesisRecoveryInput(
  input: RunSessionArgs,
  first: SessionResult,
): RunSessionArgs {
  const allAllowed = [...new Set([...input.allowedTools, ...(input.extraAllowedTools ?? [])])];
  const hasSubmitFindings = allAllowed.includes('mcp__evidence__submit_findings');
  const recoveryTools = hasSubmitFindings ? ['mcp__evidence__submit_findings'] : [];
  const capturedPaths = first.capturedSnapshotPaths ?? [];
  const digest = extractGatheredNotesDigest(first);
  const captureNote = capturedPaths.length
    ? `\nCaptured evidence snapshot paths already stored in this session:\n${capturedPaths.map((p) => `- ${p}`).join('\n')}\n`
    : '';

  const recoveryPrompt = [
    '## Synthesis-only recovery (turn limit reached)',
    'Your previous research pass reached its turn limit (`error_max_turns`).',
    'Do NOT perform any further web searches, page fetches, or subagent dispatches — all web/search tools are disabled for this recovery pass.',
    hasSubmitFindings
      ? 'Using ONLY the sources, figures, and captured evidence already gathered below, immediately call `mcp__evidence__submit_findings` and then emit ONLY the final JSON array matching the original output contract.'
      : 'Using ONLY the sources, figures, and captured evidence already gathered below, immediately emit ONLY the final JSON output matching the original output contract.',
    'For any indicator that you did not finish verifying with captured evidence, emit an honest `kind: "gap"` finding describing what was searched — never invent figures or URLs.',
    captureNote,
    '### Notes & evidence already gathered',
    digest,
    '',
    '### Original assignment (for output schema and indicator slugs only — do NOT search again)',
    input.prompt,
  ].join('\n');

  return {
    ...input,
    prompt: recoveryPrompt,
    allowedTools: recoveryTools,
    extraAllowedTools: [],
    extraMcpServers: undefined,
    civicDataTools: undefined,
    orchestrate: false,
    scoutModel: null,
    maxTurns: MAX_TURNS_RECOVERY_LIMIT,
  };
}

/**
 * Transient transport failures ("Connection closed mid-response", overloaded,
 * 5xx) kill a session and are retried once. Turn-cap exhaustion
 * (`error_max_turns`) is NEVER retried with another full 60-turn identical
 * prompt: instead it runs a bounded 6-turn synthesis-only recovery pass
 * (no further web search, only `submit_findings` / JSON emission for findings
 * already gathered). Usage from both attempts is folded with mergeUsage.
 *
 * The exception is a failure the key itself caused (org-key.ts
 * keyRejection: revoked, out of credit, model not found, a disabled
 * organization, API keys turned off). A second attempt would be refused the
 * same way, so there is none. On the deployment's key the failed result is
 * returned as before; on an organization's own key (`apiKey`) it throws
 * OrgKeyUnavailableError with a reason staff can act on, so the run or
 * analysis fails once with that reason instead of starting every remaining
 * session only to be refused again.
 */
export async function runSessionWithRetry(
  input: Parameters<typeof runSession>[0],
): Promise<SessionResult> {
  const model = input.model ?? MODEL();
  const provider = input.provider ?? providerForModel(model, 'anthropic');
  const attempt = async (args: RunSessionArgs): Promise<SessionResult> => {
    try {
      return await runSession(args);
    } catch (err) {
      // Non-Anthropic adapters throw OrgKeyUnavailableError directly on org key refusals; never retry or swallow it.
      if (err instanceof OrgKeyUnavailableError) throw err;
      // The message is stored in the transcript: an organization's key must
      // not ride along if a subprocess error ever echoed its environment.
      const message = redactSecret(err instanceof Error ? err.message : String(err), args.apiKey);
      return {
        resultText: '',
        transcript: gzipSync(JSON.stringify({ type: 'session_error', message })),
        usage: err instanceof SessionRunError ? err.usage : emptyUsage(),
        succeeded: false,
        ...(err instanceof SessionRunError && err.apiError ? { apiError: err.apiError } : {}),
        ...(err instanceof SessionRunError && err.apiErrorText ? { apiErrorText: err.apiErrorText } : {}),
      };
    }
  };
  const first = await attempt(input);
  if (first.succeeded) return first;
  // Built on either key, thrown only on the organization's: on the
  // deployment's key a refusal is returned as a failed session, as before.
  const rejectedFirst = rejectedKeyError(first, model, first.usage, provider);
  if (rejectedFirst) {
    if (input.apiKey) throw rejectedFirst;
    return first;
  }
  // If the first attempt exhausted turns (`error_max_turns`), run a bounded
  // 6-turn synthesis-only recovery pass instead of repeating a full 60-turn search.
  const secondInput = isMaxTurnsExhaustion(first)
    ? buildSynthesisRecoveryInput(input, first)
    : input;
  const second = await attempt(secondInput);
  const usage = mergeUsage(first.usage, second.usage);
  const capturedSnapshotPaths = [
    ...new Set([...(first.capturedSnapshotPaths ?? []), ...(second.capturedSnapshotPaths ?? [])]),
  ];
  const submittedFindings = second.submittedFindings?.length
    ? second.submittedFindings
    : first.submittedFindings;
  // The key can also die between the attempts (credit running out mid-run).
  const refused = !second.succeeded && input.apiKey ? rejectedKeyError(second, model, usage, provider) : null;
  if (refused) throw refused;
  return {
    ...second,
    usage,
    ...(submittedFindings ? { submittedFindings } : {}),
    ...(capturedSnapshotPaths.length ? { capturedSnapshotPaths } : {}),
  };
}

const MODEL = () => process.env.ANTHROPIC_MODEL ?? DEFAULT_SESSION_MODEL;

/**
 * Hard bounds enforced on Anthropic Claude Agent SDK CLI sessions (P2.1):
 * - Every `source-scout` subagent is capped at `SCOUT_MAX_TURNS = 8` turns.
 * - `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION = '8'` caps total subagent dispatches.
 * - `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION = '40'` caps server-side web searches.
 */
export const SCOUT_MAX_TURNS = 8;
export const CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION = '8';
export const CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION = '40';

/**
 * Orchestrated mode: when RESEARCH_SUBAGENT_MODEL is set (e.g. 'claude-sonnet-5'),
 * researcher sessions get a source-scout subagent on that model and the Task
 * tool to dispatch it. The main session stays the single synthesizer — scouts
 * gather, they never conclude. Verifier sessions are excluded by construction
 * (their allowlist has no WebSearch).
 */
const SCOUT_MODEL = () => process.env.RESEARCH_SUBAGENT_MODEL;

export const SCOUT_AGENT = (model: string) => ({
  'source-scout': {
    description:
      'Fast scout for breadth work. Dispatch it for every initial source sweep (one scout per tier or portal), to check whether a portal/publisher has a candidate dataset before you descend a tier, and to skim a candidate page for the exact figure. It reports raw material only — you evaluate and synthesize.',
    prompt:
      'You are a source scout for a civic research orchestrator. Execute exactly the search or fetch task you were given and report raw material: for each candidate source — URL, publisher, publication date, the exact quoted text containing any relevant figure (with enough surrounding text to locate it), the geography and year the figure covers, and your best guess at its source tier. Report dead ends honestly ("portal has no dataset for X"). Do NOT synthesize, conclude, score, or recommend which source to accept. Never state a figure you did not see verbatim on a fetched page.',
    tools: ['WebSearch', 'WebFetch'],
    model,
    maxTurns: SCOUT_MAX_TURNS,
  },
});

const DELEGATION_NOTE = `

## Delegation (execution policy)

A 'source-scout' subagent is available via the Task tool. Dispatch scouts for breadth work — tier sweeps, portal checks, page skims — and reserve your own turns for judgment: source evaluation, tier decisions, value extraction from evidence you capture yourself, scoring math, and composing findings. Every scout dispatch must state: objective, expected report format, and boundaries (per the delegation contract). You remain the single synthesizer; scout reports are raw material, not conclusions. Capture evidence yourself for every accepted source.`;

/**
 * What orchestrated mode adds: the subagent dispatch tool, and TaskOutput,
 * which collects the report of a scout dispatched in the background. The
 * dispatch tool is `Agent` in current Claude Code; older releases (and
 * permission rules written for them) call it `Task`. Both names are listed
 * so orchestrated mode keeps its scouts whichever the bundled CLI
 * recognizes — an unknown name in the tool set matches nothing.
 */
const DISPATCH_TOOLS = ['Agent', 'Task', 'TaskOutput'];

/**
 * Built-in tools that reach the worker's own machine: the shell, the
 * filesystem, notebooks, background processes. Research never needs them —
 * every session's work is web research plus our in-process MCP tools — and
 * each one would let text the model read (a fetched page, a pasted policy
 * brief) steer it into the worker's environment. The `tools` option below
 * already leaves them out; listing them as disallowed as well means a
 * future change to the base tool set cannot quietly bring one back. Only
 * a verifier with archived exhibits may Read, guarded to its fixed files.
 */
const LOCAL_MACHINE_TOOLS = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'LS',
  'REPL',
  'Monitor',
];

/**
 * The environment a session's CLI subprocess runs with. The SDK otherwise
 * hands the subprocess the worker's entire process.env — the owner-role
 * DATABASE_URL (which bypasses row-level security), the S3 keys, SMTP
 * credentials — and a session's input is untrusted text by design. So the
 * subprocess gets only what it needs to reach the model through the egress
 * proxy: the Anthropic/Claude Code configuration, the proxy and CA-bundle
 * settings, and the basics a process needs to start (PATH, HOME, temp dir,
 * locale). Anything not listed here is withheld.
 */
const SESSION_ENV_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'TZ',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CLAUDE_CONFIG_DIR',
];
/** The model client's own configuration namespaces (API key, base URL, CLI knobs). */
const SESSION_ENV_PREFIXES = ['ANTHROPIC_', 'CLAUDE_CODE_', 'CLAUDE_AGENT_SDK_'];

/**
 * The deployment's own credential and routing settings for the model API:
 * a bearer token, an OAuth token, an LLM gateway, custom headers, a cloud
 * provider switch (Bedrock, Vertex, Foundry) with its settings, workload
 * identity federation. When a session runs on an organization's own key
 * (SPEC-v7 §4) these are withheld. Otherwise one of them could take
 * precedence over the organization's key — the deployment would pay for a
 * session the organization was told runs on its key — or carry the key
 * somewhere it was not given to (a gateway is the deployment's, not
 * Anthropic's first-party API, which is what the organization's key is for).
 * Model choice and CLI behavior settings (ANTHROPIC_MODEL, CLAUDE_CODE_…
 * limits) still pass through.
 */
const DEPLOYMENT_CREDENTIAL_KEYS = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_IDENTITY_TOKEN',
  'ANTHROPIC_IDENTITY_TOKEN_FILE',
  'ANTHROPIC_ORGANIZATION_ID',
  'ANTHROPIC_SERVICE_ACCOUNT_ID',
  'ANTHROPIC_WORKSPACE_ID',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
];
const DEPLOYMENT_CREDENTIAL_PREFIXES = [
  'ANTHROPIC_BEDROCK_',
  'ANTHROPIC_VERTEX_',
  'ANTHROPIC_FOUNDRY_',
  'ANTHROPIC_FEDERATION_',
];

/**
 * Pure: the subset of `source` a session subprocess may see (see
 * SESSION_ENV_KEYS). With `apiKey` — an organization's own key, decrypted
 * by org-key.ts for this organization's sessions only — the subprocess
 * authenticates with that key instead of the deployment's ANTHROPIC_API_KEY,
 * and the deployment's other credential and routing settings are withheld
 * (DEPLOYMENT_CREDENTIAL_KEYS). Without it the environment is unchanged.
 *
 * With `pageReaderModel` — the page reader a run's plan recorded — the CLI
 * reads fetched pages through that model instead of the worker's own
 * ANTHROPIC_SMALL_FAST_MODEL, so the run uses what it was planned with.
 */
export function sessionEnv(
  source: NodeJS.ProcessEnv = process.env,
  options: { apiKey?: string; pageReaderModel?: string; subagentModel?: string | null } = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (SESSION_ENV_KEYS.includes(key) || SESSION_ENV_PREFIXES.some((p) => key.startsWith(p))) {
      env[key] = value;
    }
  }
  if (options.apiKey) {
    for (const key of Object.keys(env)) {
      if (DEPLOYMENT_CREDENTIAL_KEYS.includes(key) || DEPLOYMENT_CREDENTIAL_PREFIXES.some((p) => key.startsWith(p))) {
        delete env[key];
      }
    }
    env.ANTHROPIC_API_KEY = options.apiKey;
  }
  // A blank never replaces the worker's pin: the CLI treats '' as unset and
  // would fall back to its own alias.
  if (options.pageReaderModel?.trim()) env.ANTHROPIC_SMALL_FAST_MODEL = options.pageReaderModel.trim();
  // Pin subagent model explicitly so the orchestrator's Agent/Task tool call
  // cannot silently override AgentDefinition.model (P2.1).
  if (options.subagentModel?.trim()) env.CLAUDE_CODE_SUBAGENT_MODEL = options.subagentModel.trim();
  // Enforce hard CLI subagent & web-search caps on every Claude Code session (P2.1).
  if (!env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION?.trim()) {
    env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION = CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION;
  }
  if (!env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION?.trim()) {
    env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION = CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION;
  }
  return env;
}

/**
 * Pure: `text` with every occurrence of `secret` replaced. Transcripts and
 * error messages are stored and shown to staff; an organization's key must
 * never be among them, even if some tool or error echoed it back.
 */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join('[redacted API key]');
}

export type SessionMcpServer = ReturnType<typeof createSdkMcpServer>;

export interface RunSessionArgs {
  prompt: string;
  /**
   * The session's entire tool surface: built-in tools by name (WebSearch,
   * WebFetch) plus our MCP tools (mcp__evidence__…). Nothing outside it
   * exists in the session, and nothing outside it may run.
   */
  allowedTools: string[];
  storage?: TenantStorage;
  /** Shared content-addressed source cache (defaults to the worker process shared cache). */
  sourceCache?: SourceCache;
  /** Archived bytes loaded by the worker, for an independent verifier only. */
  archivedExhibits?: ArchivedExhibits;
  maxTurns?: number;
  model?: string;
  /** A plan's explicit scout model; null disables scouts, undefined keeps legacy env defaults. */
  scoutModel?: string | null;
  /** A plan's page reader (see sessionEnv); undefined keeps the worker's ANTHROPIC_SMALL_FAST_MODEL. */
  pageReaderModel?: string;
  /**
   * Orchestrated mode (scouts via the dispatch tool, see SCOUT_MODEL). When
   * omitted it follows the research rule: on whenever RESEARCH_SUBAGENT_MODEL
   * is set and the session may search the web. Sessions that are not
   * research — a policy analysis, whose prompt ends with its own output
   * contract — pass false so no delegation note is appended after it.
   */
  orchestrate?: boolean;
  /**
   * The organization's own Anthropic API key (SPEC-v7 §4), when it has one:
   * the session runs on it instead of the deployment's ANTHROPIC_API_KEY
   * (see sessionEnv). It goes only into the subprocess environment — never
   * into a log line, and it is redacted from the stored transcript.
   */
  apiKey?: string;
  /** Portrait config & dimension context for synchronous validation/scoring in `submit_findings`. */
  submitFindingsContext?: SubmitFindingsContext;
  /**
   * Optional additional in-process MCP servers mounted alongside `evidence`
   * (e.g. deterministic civic data connectors such as `civic_data`).
   */
  extraMcpServers?: Record<string, SessionMcpServer>;
  /**
   * Optional explicit model provider (`anthropic`, `openai`, `google`).
   * When omitted, inferred from `model` via `providerForModel(model, 'anthropic')`.
   */
  provider?: ResearchProvider;
  /**
   * Optional civic-data tool definitions exposed directly to non-Anthropic
   * providers (`ToolExecutor`) so OpenAI and Gemini sessions share the exact
   * same deterministic connectors as Anthropic MCP sessions.
   */
  civicDataTools?: readonly CivicDataToolDefinition[];
  /** Optional injectable fetch for non-Anthropic provider adapters (used in tests). */
  providerFetch?: FetchLike;
  /**
   * Optional additional allowed tool names merged (deduplicated) into the
   * session's allowlist, subject to the same `Read` and local-tool guards.
   */
  extraAllowedTools?: string[];
  /**
   * When `true` and running on Anthropic, execute via `runDirectAnthropicSession`
   * (`@anthropic-ai/sdk` Messages API with prompt caching, bounded `read_exhibit`
   * loop `<= 4` turns, and strict JSON output) instead of spawning a Claude Code
   * CLI subprocess. Used by verifiers (`runVerifier`) and archive-only post-run
   * auditors (`auditResearchRun`).
   */
  direct?: boolean;
  /** Optional system prompt override for direct Anthropic sessions. */
  directSystemPrompt?: string;
  /** Optional injectable Messages API client for direct Anthropic sessions (tests). */
  anthropicClient?: MessagesApiClient;
  /**
   * Optional concurrency semaphore override; defaults to the worker's shared
   * `MAX_ACTIVE_SESSIONS` semaphore (`null` disables permit acquisition).
   */
  semaphore?: SessionSemaphore | null;
  /**
   * Optional benchmark answer-key source blocklist enforced across egress
   * fetches (`read_source`, `capture_evidence`, `civic_data`) and Anthropic
   * `WebFetch` calls. Defaults to any ambient blocklist set via `withEgressBlocklist`.
   */
  sourceBlocklist?: SourceBlocklist;
}

const READ_SOURCE_SCHEMA = z.object({
  url: z.string().describe('The exact HTTPS URL of the web page or PDF document to read'),
  query: z
    .string()
    .optional()
    .describe('Optional keywords or candidate figure to focus the bounded excerpt around'),
  page_range: z
    .string()
    .optional()
    .describe('Optional 1-indexed PDF page or page range (e.g. "5" or "12-15")'),
});

const CAPTURE_EVIDENCE_SCHEMA = z.object({
  url: z.string().describe('The exact URL the value was read from'),
  pdf_url: z.string().optional().describe('Direct PDF URL when the source is a document'),
  check_value: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Optional candidate value to check immediately against the captured readable text'),
});

const SUBMIT_FINDINGS_SCHEMA = z.object({
  findings: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .describe('Array of indicator or gap finding objects for this dimension'),
});

const READ_EXHIBIT_SCHEMA = z.object({
  filename: z
    .string()
    .describe('Exact archived exhibit filename (e.g. "archived-source-excerpt.txt", "archived-snapshot.png", "archived-source.pdf")'),
});

/**
 * One research session = one Agent SDK session (Anthropic open-web CLI),
 * one direct zero-subprocess Anthropic Messages session (`direct: true`,
 * for verifiers and archive-only auditors), or one native function-calling
 * provider loop (OpenAI, Google Gemini). Bounded globally by the worker's
 * shared `MAX_ACTIVE_SESSIONS` semaphore.
 */
export async function runSession(input: RunSessionArgs): Promise<SessionResult> {
  const semaphore = input.semaphore === undefined ? getSharedSessionSemaphore() : input.semaphore;
  const runBody = () => {
    if (input.sourceBlocklist && input.sourceBlocklist !== getActiveEgressBlocklist()) {
      return withEgressBlocklist(input.sourceBlocklist, () =>
        runSessionUnbounded({ ...input, sourceBlocklist: undefined }),
      );
    }
    return runSessionUnbounded(input);
  };
  return semaphore ? semaphore.run(runBody) : runBody();
}

async function runSessionUnbounded(input: RunSessionArgs): Promise<SessionResult> {
  const effectiveBlocklist = input.sourceBlocklist ?? getActiveEgressBlocklist();
  const effectiveModel = input.model ?? MODEL();
  const provider = input.provider ?? providerForModel(effectiveModel, 'anthropic');
  const effectiveAllowedTools = [
    ...new Set([...input.allowedTools, ...(input.extraAllowedTools ?? [])]),
  ];
  const sourceCache = input.sourceCache ?? getSharedSourceCache();
  let submittedFindings: FindingPayload[] | undefined;
  const capturedSnapshotPaths = new Set<string>();

  if (provider === 'anthropic' && input.direct) {
    const out = await runDirectAnthropicSession({
      prompt: input.prompt,
      model: effectiveModel,
      ...(input.directSystemPrompt ? { systemPrompt: input.directSystemPrompt } : {}),
      archivedExhibits: input.archivedExhibits,
      allowReadExhibit: effectiveAllowedTools.includes('Read'),
      ...(input.maxTurns !== undefined ? { maxTurns: input.maxTurns } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey, isOrganizationKey: true } : {}),
      ...(input.anthropicClient ? { client: input.anthropicClient } : {}),
    });
    return {
      resultText: out.resultText,
      transcript: out.transcript,
      usage: out.usage,
      succeeded: out.succeeded,
      ...(out.apiError ? { apiError: out.apiError as SDKAssistantMessageError } : {}),
      ...(out.apiErrorText ? { apiErrorText: redactErrorText(out.apiErrorText, input.apiKey) } : {}),
    };
  }

  if (provider !== 'anthropic') {
    const storage = input.storage;
    const readEvidenceText = storage
      ? async (textPath: string) => (await storage.get(textPath)).toString('utf8')
      : undefined;
    const toolDefs: ProviderToolDefinition[] = [];
    const mountEvidence =
      Boolean(storage) || effectiveAllowedTools.includes('mcp__evidence__read_source');

    if (mountEvidence) {
      toolDefs.push({
        name: 'read_source',
        description:
          'Render a public HTTPS web page in headless Chromium or extract a PDF text layer (bounded, cached across dimensions and portrait runs). Supply query and/or page_range to focus excerpts on long PDFs.',
        parameters: zodToJsonSchema(READ_SOURCE_SCHEMA),
        execute: async (rawArgs) => {
          const parsed = READ_SOURCE_SCHEMA.safeParse(rawArgs);
          if (!parsed.success) {
            return JSON.stringify({ error: `invalid arguments: ${parsed.error.message}` });
          }
          try {
            const payload = await readSourceWithCache(sourceCache, storage, parsed.data);
            return JSON.stringify(payload);
          } catch (err) {
            return JSON.stringify({
              error: `read_source failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        },
      });

      if (storage && readEvidenceText) {
        toolDefs.push(
          {
            name: 'capture_evidence',
            description:
              'Capture an evidence snapshot of a source you have decided to accept: a full-page screenshot, plus the PDF when the source is a document. Returns storage paths, a bounded preview of extracted readable text, and optional value_on_page check.',
            parameters: zodToJsonSchema(CAPTURE_EVIDENCE_SCHEMA),
            execute: async (rawArgs) => {
              const parsed = CAPTURE_EVIDENCE_SCHEMA.safeParse(rawArgs);
              if (!parsed.success) {
                return JSON.stringify({ error: `invalid arguments: ${parsed.error.message}` });
              }
              try {
                const result = await captureEvidence(storage, parsed.data.url, parsed.data.pdf_url, { sourceCache });
                capturedSnapshotPaths.add(result.snapshot_path);
                let capturedText: string | null = null;
                if (result.text_path) {
                  try {
                    capturedText = await readEvidenceText(result.text_path);
                  } catch {
                    capturedText = null;
                  }
                }
                const preview = buildCapturePreview(capturedText);
                return JSON.stringify({
                  ...result,
                  text_char_count: preview.text_char_count,
                  text_preview: preview.text_preview,
                  ...(parsed.data.check_value !== undefined
                    ? { value_on_page: valueOnPage(parsed.data.check_value, capturedText) }
                    : {}),
                });
              } catch (err) {
                return JSON.stringify({
                  error: `capture failed: ${err instanceof Error ? err.message : String(err)}`,
                });
              }
            },
          },
          {
            name: 'submit_findings',
            description:
              'Validate, deterministically score, and submit your completed findings array for this dimension. Returns concrete validation errors immediately so you can fix them in-session.',
            parameters: zodToJsonSchema(SUBMIT_FINDINGS_SCHEMA),
            execute: async (rawArgs) => {
              const parsed = SUBMIT_FINDINGS_SCHEMA.safeParse(rawArgs);
              if (!parsed.success) {
                return JSON.stringify({ accepted: false, error: `invalid arguments: ${parsed.error.message}` });
              }
              const validation = await validateAndScoreSubmittedFindings(
                parsed.data.findings,
                input.submitFindingsContext,
                readEvidenceText,
              );
              if (validation.accepted) {
                submittedFindings = validation.findings;
                return JSON.stringify({
                  accepted: true,
                  count: validation.findings.length,
                  findings: validation.findings,
                });
              }
              return JSON.stringify({ accepted: false, errors: validation.errors });
            },
          },
        );
      }
    }

    for (const civicDef of input.civicDataTools ?? []) {
      if (effectiveAllowedTools.includes(civicDef.mcpName) || effectiveAllowedTools.includes(civicDef.name)) {
        toolDefs.push({
          name: civicDef.name,
          description: civicDef.description,
          parameters: zodToJsonSchema(civicDef.schema),
          execute: async (args) => {
            const res = await civicDef.handler(args);
            return res.content.map((c) => c.text).join('\n');
          },
        });
      }
    }

    const exhibitMap = buildArchivedExhibitMap(input.archivedExhibits);
    if (exhibitMap.size > 0 && effectiveAllowedTools.includes('Read')) {
      toolDefs.push({
        name: 'read_exhibit',
        description: `Read one of this finding's archived exhibits (available: ${[...exhibitMap.keys()].join(', ')}). Only these fixed files may be read.`,
        parameters: zodToJsonSchema(READ_EXHIBIT_SCHEMA),
        execute: async (rawArgs) => {
          const parsed = READ_EXHIBIT_SCHEMA.safeParse(rawArgs);
          if (!parsed.success) {
            return JSON.stringify({ error: `invalid arguments: ${parsed.error.message}` });
          }
          const name = path.basename(parsed.data.filename.trim());
          const body = exhibitMap.get(name);
          if (!body) {
            return JSON.stringify({
              error: `Only this finding's archived exhibits may be read (available: ${[...exhibitMap.keys()].join(', ')}).`,
            });
          }
          if (name.endsWith('.txt')) {
            return body.toString('utf8');
          }
          return JSON.stringify({
            filename: name,
            bytes: body.byteLength,
            note: 'Binary exhibit stored in archive; inspect archived-source-excerpt.txt for extracted readable text.',
          });
        },
      });
    }

    const executor = new ToolExecutor(toolDefs);
    const providerInput = {
      provider,
      model: effectiveModel,
      prompt: input.prompt,
      apiKey: input.apiKey,
      isOrganizationKey: Boolean(input.apiKey),
      maxTurns: input.maxTurns ?? DEFAULT_SESSION_MAX_TURNS,
      tools: executor,
      fetch: input.providerFetch,
    };
    const out =
      provider === 'openai'
        ? await runOpenAiSession(providerInput)
        : await runGoogleSession(providerInput);

    return {
      resultText: out.resultText,
      transcript: gzipSync(out.transcriptLines.join('\n')),
      usage: out.usage,
      succeeded: out.succeeded,
      ...(out.apiError ? { apiError: out.apiError as SDKAssistantMessageError } : {}),
      ...(out.apiErrorText ? { apiErrorText: redactErrorText(out.apiErrorText, input.apiKey) } : {}),
      ...(submittedFindings ? { submittedFindings } : {}),
      ...(capturedSnapshotPaths.size ? { capturedSnapshotPaths: [...capturedSnapshotPaths] } : {}),
    };
  }

  const workspace = await mkdtemp(path.join(tmpdir(), 'df-session-'));
  const transcriptLines: string[] = [];
  let resultText = '';
  let succeeded = false;
  const meter = new SessionMeter();

  const mcpServers: Record<string, SessionMcpServer> = {
    ...(input.extraMcpServers ?? {}),
  };
  const mountEvidenceServer =
    Boolean(input.storage) || effectiveAllowedTools.includes('mcp__evidence__read_source');
  if (mountEvidenceServer) {
    const storage = input.storage;
    const evidenceTools: NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']> = [
      tool(
        'read_source',
        'Render a public HTTPS web page in headless Chromium or extract a PDF text layer (bounded, cached across dimensions and portrait runs). Prefer this over WebFetch when .gov portals return 403, empty JS shells, or truncated summaries. Supply query and/or page_range to focus excerpts on long PDFs.',
        {
          url: z.string().describe('The exact HTTPS URL of the web page or PDF document to read'),
          query: z
            .string()
            .optional()
            .describe('Optional keywords or candidate figure to focus the bounded excerpt around'),
          page_range: z
            .string()
            .optional()
            .describe('Optional 1-indexed PDF page or page range (e.g. "5" or "12-15")'),
        },
        async (args) => {
          try {
            const payload = await readSourceWithCache(sourceCache, storage, args);
            return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
          } catch (err) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: `read_source failed: ${err instanceof Error ? err.message : String(err)}`,
                  }),
                },
              ],
            };
          }
        },
      ),
    ];

    if (storage) {
      const readEvidenceText = async (textPath: string) => (await storage.get(textPath)).toString('utf8');
      evidenceTools.push(
        tool(
          'capture_evidence',
          'Capture an evidence snapshot of a source you have decided to accept: a full-page screenshot, plus the PDF when the source is a document. Promotes already-cached sources instantly into immutable evidence storage. Returns storage paths, a bounded preview of extracted readable text, and optional value_on_page check.',
          {
            url: z.string().describe('The exact URL the value was read from'),
            pdf_url: z.string().optional().describe('Direct PDF URL when the source is a document'),
            check_value: z
              .union([z.number(), z.string()])
              .optional()
              .describe('Optional candidate value to check immediately against the captured readable text'),
          },
          async (args) => {
            try {
              const result = await captureEvidence(storage, args.url, args.pdf_url, { sourceCache });
              capturedSnapshotPaths.add(result.snapshot_path);
              let capturedText: string | null = null;
              if (result.text_path) {
                try {
                  capturedText = await readEvidenceText(result.text_path);
                } catch {
                  capturedText = null;
                }
              }
              const preview = buildCapturePreview(capturedText);
              const responsePayload = {
                ...result,
                text_char_count: preview.text_char_count,
                text_preview: preview.text_preview,
                ...(args.check_value !== undefined
                  ? { value_on_page: valueOnPage(args.check_value, capturedText) }
                  : {}),
              };
              return { content: [{ type: 'text', text: JSON.stringify(responsePayload) }] };
            } catch (err) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      error: `capture failed: ${err instanceof Error ? err.message : String(err)}`,
                    }),
                  },
                ],
              };
            }
          },
        ),
        tool(
          'submit_findings',
          'Validate, deterministically score, and submit your completed findings array for this dimension. Returns concrete validation errors (schema, home-page link, recency, scale, value_on_page) immediately so you can fix them in-session.',
          {
            findings: z
              .array(z.record(z.string(), z.unknown()))
              .min(1)
              .describe('Array of indicator or gap finding objects for this dimension'),
          },
          async (args) => {
            const validation = await validateAndScoreSubmittedFindings(
              args.findings,
              input.submitFindingsContext,
              readEvidenceText,
            );
            if (validation.accepted) {
              submittedFindings = validation.findings;
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      accepted: true,
                      count: validation.findings.length,
                      findings: validation.findings,
                    }),
                  },
                ],
              };
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    accepted: false,
                    errors: validation.errors,
                  }),
                },
              ],
            };
          },
        ),
      );
    }

    mcpServers.evidence = createSdkMcpServer({
      name: 'evidence',
      version: '1.0.0',
      tools: evidenceTools,
    });
  }

  const scoutModel = input.scoutModel === undefined ? SCOUT_MODEL() : input.scoutModel;
  const orchestrated =
    input.orchestrate !== false && Boolean(scoutModel) && effectiveAllowedTools.includes('WebSearch');

  // The explicit allowlist from the rendered plan is the entire tool surface
  // (SPEC §8). The SDK enforces that with three separate options, and all
  // three are needed:
  // - `tools` is the set of built-in tools that EXIST in the session. Without
  //   it the session gets every Claude Code tool (shell, file reads…), and
  //   `allowedTools` alone only decides which of those run unprompted.
  // - `allowedTools` pre-approves the allowlist, MCP tools included (MCP
  //   tools come from `mcpServers`, so they are not in `tools`).
  // - `permissionMode: 'dontAsk'` denies anything not pre-approved instead of
  //   falling back to default-mode rules (which auto-approve file reads).
  // Orchestrated mode adds only DISPATCH_TOOLS + the scout definition.
  const hasArchive = Boolean(
    input.archivedExhibits?.pdf ||
    input.archivedExhibits?.pdfExcerpt ||
    input.archivedExhibits?.snapshot ||
    input.archivedExhibits?.additional?.length,
  );
  // Even a stale/malicious plan cannot turn on general file reads. Read only
  // exists when trusted archive bytes were supplied, and the hook below
  // independently denies every file except the fixed copies in this workspace.
  const scopedTools = effectiveAllowedTools.filter((tool) => tool !== 'Read' || hasArchive);
  const allowed = orchestrated ? [...scopedTools, ...DISPATCH_TOOLS] : scopedTools;
  const builtIn = allowed.filter((t) => !t.startsWith('mcp__'));

  try {
    const archivePaths = new Set<string>();
    const additional = input.archivedExhibits?.additional ?? [];
    if (
      additional.length > 15 ||
      additional.some(({ filename }) => !/^action-[1-5]-(?:snapshot\.png|source\.pdf|source-excerpt\.txt)$/.test(filename))
    ) {
      throw new Error('invalid fixed action exhibit filename');
    }
    for (const [name, bytes] of [
      [ARCHIVED_PDF, input.archivedExhibits?.pdf],
      [ARCHIVED_PDF_EXCERPT, input.archivedExhibits?.pdfExcerpt],
      [ARCHIVED_SNAPSHOT, input.archivedExhibits?.snapshot],
      ...additional.map(({ filename, body }) => [filename, body] as const),
    ] as const) {
      if (!bytes) continue;
      const target = path.join(workspace, name);
      await writeFile(target, bytes, { flag: 'wx', mode: 0o400 });
      archivePaths.add(await realpath(target));
    }
    const guardArchiveRead: HookCallback = async (hook) => {
      if (hook.hook_event_name !== 'PreToolUse' || hook.tool_name !== 'Read') return {};
      const filePath = (hook.tool_input as { file_path?: unknown } | null)?.file_path;
      let permitted = false;
      if (typeof filePath === 'string') {
        try {
          // Resolve symlinks too. A prefix check would allow sibling sessions
          // and filenames such as archived-snapshot.png/../../secret.
          permitted = archivePaths.has(await realpath(path.resolve(workspace, filePath)));
        } catch { /* nonexistent paths are denied */ }
      }
      return permitted ? {} : {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'Only this finding’s archived snapshot and PDF may be read.',
        },
      };
    };
    const guardBlockedWebFetch: HookCallback = async (hook) => {
      if (hook.hook_event_name !== 'PreToolUse' || hook.tool_name !== 'WebFetch' || !effectiveBlocklist) return {};
      const targetUrl = (hook.tool_input as { url?: unknown } | null)?.url;
      if (typeof targetUrl === 'string') {
        const blocked = matchBlockedSource(targetUrl, effectiveBlocklist);
        if (blocked) {
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: `blocked benchmark answer-key source: ${blocked.reason}`,
            },
          };
        }
      }
      return {};
    };
    const preToolUseHooks = [
      ...(allowed.includes('Read') ? [{ matcher: 'Read', hooks: [guardArchiveRead] }] : []),
      ...(effectiveBlocklist && allowed.includes('WebFetch')
        ? [{ matcher: 'WebFetch', hooks: [guardBlockedWebFetch] }]
        : []),
    ];
    try {
      const q = query({
        prompt: orchestrated ? input.prompt + DELEGATION_NOTE : input.prompt,
        options: {
          model: input.model ?? MODEL(),
          cwd: workspace,
          tools: builtIn,
          allowedTools: allowed,
          disallowedTools: LOCAL_MACHINE_TOOLS.filter((t) => !allowed.includes(t)),
          permissionMode: 'dontAsk',
          ...(preToolUseHooks.length > 0 ? { hooks: { PreToolUse: preToolUseHooks } } : {}),
          env: sessionEnv(process.env, {
            apiKey: input.apiKey,
            pageReaderModel: input.pageReaderModel,
            ...(orchestrated && scoutModel ? { subagentModel: scoutModel } : {}),
          }),
          maxTurns: input.maxTurns ?? DEFAULT_SESSION_MAX_TURNS,
          // The raw API stream events, for SessionMeter: only a call's
          // message_delta carries its final output count (see SessionMeter).
          includePartialMessages: true,
          ...(orchestrated && scoutModel ? { agents: SCOUT_AGENT(scoutModel) } : {}),
          ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
        },
      });

      for await (const message of q) {
        // Stream events (includePartialMessages, below) are metering input
        // only: one per text delta, so storing them would multiply the size of
        // every transcript without adding anything the assistant frames lack.
        if (message.type !== 'stream_event') transcriptLines.push(redactSecret(JSON.stringify(message), input.apiKey));
        meter.observe(message);
        if (message.type === 'result') {
          succeeded = message.subtype === 'success';
          if ('result' in message && typeof message.result === 'string') {
            resultText = message.result;
          }
        }
      }
    } catch (err) {
      // Whatever was streamed before the throw is real spend (SessionRunError).
      throw new SessionRunError(err, meter.usage(), meter.apiError, redactErrorText(meter.apiErrorText, input.apiKey));
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  return {
    resultText,
    transcript: gzipSync(transcriptLines.join('\n')),
    usage: meter.usage(),
    succeeded,
    ...(meter.apiError ? { apiError: meter.apiError } : {}),
    ...(meter.apiErrorText ? { apiErrorText: redactErrorText(meter.apiErrorText, input.apiKey) } : {}),
    ...(submittedFindings ? { submittedFindings } : {}),
    ...(capturedSnapshotPaths.size ? { capturedSnapshotPaths: [...capturedSnapshotPaths] } : {}),
  };
}

/** An error frame's text as SessionResult keeps it: the key redacted, and short (it is matched and quoted, never stored whole). */
const redactErrorText = (text: string | undefined, apiKey: string | undefined) =>
  text === undefined ? undefined : redactSecret(text, apiKey).slice(0, 1000);

/** One API call's usage: what its stream events, or failing those its assistant frames, reported. */
interface CallUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

/** One API call being metered, keyed by its API message id. */
interface MeteredCall {
  model: string;
  /** The session's own call (parent_tool_use_id null), not a subagent's. */
  mainLoop: boolean;
  usage: CallUsage;
  /**
   * The call's message_start arrived as a stream event, so its stream is the
   * authority on its usage and its assistant frames are not read for it.
   */
  streamed: boolean;
}

/** The model the CLI names on messages it made up itself (an API error, a placeholder); no API call stands behind them. */
const SYNTHETIC_MODEL = '<synthetic>';

const callPrompt = (u: CallUsage) => u.input_tokens + u.cache_read_tokens + u.cache_write_tokens;

function addCall(total: CallUsage, u: CallUsage): void {
  total.input_tokens += u.input_tokens;
  total.output_tokens += u.output_tokens;
  total.cache_read_tokens += u.cache_read_tokens;
  total.cache_write_tokens += u.cache_write_tokens;
}

/** Each field of `into` raised to `from`'s where that is larger. */
function maxInto(into: CallUsage, from: CallUsage): void {
  for (const k of Object.keys(from) as (keyof CallUsage)[]) into[k] = Math.max(into[k], from[k]);
}

const zeroCall = (): CallUsage => ({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });

/** An API message's usage (BetaUsage) in our field names; absent fields (synthetic messages, older CLIs) read as 0. */
function callUsage(u: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): CallUsage {
  return {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_read_tokens: u.cache_read_input_tokens ?? 0,
    cache_write_tokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** The text blocks of an assistant message (the CLI's error frames carry their message as one). */
function messageText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((b: { type?: unknown; text?: unknown }) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .join('\n');
}

/**
 * Per-model metering of one session's message stream (docs/haiku-5-5.md
 * §3.1). Field names are the Claude Agent SDK's (sdk.d.ts: SDKSystemMessage,
 * SDKAssistantMessage, SDKPartialAssistantMessage, SDKResultMessage,
 * ModelUsage, SDKModelRefusalFallbackMessage, SDKModelRefusalNoFallbackMessage)
 * and, inside them, the Messages API's (BetaMessage, BetaRawMessageStreamEvent,
 * BetaMessageDeltaUsage).
 *
 * - system `init` names the session's main model.
 * - API calls are metered per call, keyed by the API message id, from the
 *   raw stream (`stream_event`, which runSession asks for with
 *   includePartialMessages): `message_start` names the call's model and its
 *   prompt usage — input, cache read and cache write, final at that point —
 *   and `message_delta` the call's final output count, folded in as the CLI
 *   folds it (output replaced; input and cache fields replaced only by a
 *   positive figure). Streams are tracked per parent_tool_use_id, so a
 *   subagent's stream, if the CLI forwards one, cannot close the main loop's.
 * - Assistant frames are NOT a source of final usage. CLI 0.3.220 emits a
 *   call's frames at each content_block_stop with the usage message_start
 *   gave — output_tokens a single-digit placeholder, stop_reason null — and
 *   only writes the final figures into those objects at message_delta, after
 *   they were already serialized to us. So a frame is read only for a call
 *   no stream reported, keeping the largest figure each frame gave (several
 *   frames repeat one call's usage, so summing would count it once per
 *   block). In 0.3.220 those are the subagents' calls (a scout's): the CLI
 *   forwards their frames but not their stream events. Their prompt figures
 *   are right; their output — in the streamed totals, and in the long-prompt
 *   share below — is a lower bound.
 * - A call whose prompt (input + cache read + cache write) exceeded
 *   LONG_PROMPT_THRESHOLD_TOKENS is also counted in its model's
 *   `long_prompt` share: a two-card model (Haiku 5.5) bills such a call on
 *   its long-prompt card, output included, and only a per-call split can
 *   tell. The CLI's side calls (the page reader behind WebFetch, the
 *   WebSearch side query) stream neither events nor frames, so they are in
 *   the result's totals below but never in the split.
 * - Refusals are counted once per API request: a main-loop stream's
 *   message_delta with stop_reason 'refusal', an assistant frame that says
 *   'refusal', and the CLI's `model_refusal_no_fallback` /
 *   `model_refusal_fallback` notices for the same request (see
 *   countRefusal). A fallback is also recorded as an event, because the turn
 *   was then answered by another model.
 * - The result's `modelUsage` is the authoritative per-model total — it
 *   alone includes the CLI's side calls and web-search requests. Its token
 *   fields become `by_model`; `costUSD`, the SDK's own price, is never
 *   copied (prices come from @deep-fryer/core model-pricing.ts).
 *
 * Before a result arrives, usage() reports the streamed totals marked
 * `partial` — what a session that threw had demonstrably spent: the main
 * loop's calls in full (the last one up to its latest delta), subagent
 * output as the lower bound above.
 */
export class SessionMeter {
  /** The last API error on a main-loop assistant message (SDKAssistantMessage.error). */
  apiError?: SDKAssistantMessageError;
  /** The text of the frame that carried apiError (SessionResult.apiErrorText). */
  apiErrorText?: string;

  private model?: string;
  private readonly calls = new Map<string, MeteredCall>();
  /** The API call each stream is in the middle of, by parent_tool_use_id ('' for the main loop). */
  private readonly openCalls = new Map<string, string>();
  /** Request id of an API call (message id), as its assistant frames name it; stream events do not. */
  private readonly requestOf = new Map<string, string>();
  private readonly refusalKeys = new Set<string>();
  /**
   * The message id of the latest refusal only a stream event has reported,
   * while no frame has named its request: the CLI's notice for that refusal
   * (keyed by request id) is matched to it instead of counted again.
   */
  private unmatchedStreamRefusal?: string;
  private readonly fallbacks: RefusalFallbackEvent[] = [];
  private final: SessionTokenUsage | null = null;

  observe(message: SDKMessage): void {
    if (message.type === 'stream_event') {
      this.observeStream(message);
      return;
    }

    if (message.type === 'system') {
      const m = message as { subtype?: string; model?: unknown; request_id?: unknown; uuid?: unknown };
      if (m.subtype === 'init' && typeof m.model === 'string') this.model = m.model;
      if (m.subtype === 'model_refusal_no_fallback' || m.subtype === 'model_refusal_fallback') {
        const requestId = typeof m.request_id === 'string' ? m.request_id : null;
        if (requestId && !this.refusalKeys.has(requestId) && this.unmatchedStreamRefusal) {
          // The notice follows the refused request's stream: the refusal the
          // stream reported under its message id is this request.
          this.linkRequest(this.unmatchedStreamRefusal, requestId);
        }
        this.refusalKeys.add(requestId ?? `event:${String(m.uuid)}`);
      }
      if (m.subtype === 'model_refusal_fallback') {
        const f = message as { original_model?: unknown; fallback_model?: unknown; api_refusal_category?: unknown };
        this.fallbacks.push({
          original_model: String(f.original_model ?? ''),
          fallback_model: String(f.fallback_model ?? ''),
          category: typeof f.api_refusal_category === 'string' ? f.api_refusal_category : null,
        });
      }
      return;
    }

    if (message.type === 'assistant') {
      const mainLoop = message.parent_tool_use_id === null || message.parent_tool_use_id === undefined;
      if (mainLoop && message.error) {
        this.apiError = message.error;
        this.apiErrorText = messageText(message.message?.content);
      }
      // The API message (BetaMessage). Read defensively: the CLI's own
      // synthetic messages and older CLIs leave fields out.
      const api = message.message;
      if (!api?.id) return;
      if (typeof message.request_id === 'string') this.linkRequest(api.id, message.request_id);
      if (api.stop_reason === 'refusal') this.countRefusal(api.id);
      const model = api.model;
      if (!model || model === SYNTHETIC_MODEL || !api.usage) return;
      const frame = callUsage(api.usage);
      const seen = this.calls.get(api.id);
      if (!seen) this.calls.set(api.id, { model, mainLoop, usage: frame, streamed: false });
      else if (!seen.streamed) maxInto(seen.usage, frame);
      return;
    }

    if (message.type === 'result') {
      const usage: SessionTokenUsage = {
        input_tokens: message.usage?.input_tokens ?? 0,
        output_tokens: message.usage?.output_tokens ?? 0,
      };
      const cacheRead = message.usage?.cache_read_input_tokens;
      const cacheWrite = message.usage?.cache_creation_input_tokens;
      if (typeof cacheRead === 'number') usage.cache_read_tokens = cacheRead;
      if (typeof cacheWrite === 'number') usage.cache_write_tokens = cacheWrite;
      if (this.model) usage.model = this.model;

      const byModel: Record<string, ModelTokenUsage> = {};
      for (const [id, m] of Object.entries(message.modelUsage ?? {})) {
        byModel[id] = {
          input_tokens: m.inputTokens ?? 0,
          output_tokens: m.outputTokens ?? 0,
          cache_read_tokens: m.cacheReadInputTokens ?? 0,
          cache_write_tokens: m.cacheCreationInputTokens ?? 0,
          web_search_requests: m.webSearchRequests ?? 0,
        };
      }
      const streamed = this.streamedByModel();
      if (Object.keys(byModel).length === 0) {
        // A result without modelUsage (an older CLI): the streamed totals are all there is.
        Object.assign(byModel, streamed);
      } else {
        // modelUsage keys a model as the CLI requested it (often undated); the
        // API names it on the message (often dated). Same model, so the
        // long-prompt share joins its total; a streamed model with no matching
        // key keeps its tokens in whichever total the CLI filed them under,
        // and only loses the split.
        for (const [id, m] of Object.entries(streamed)) {
          if (!m.long_prompt) continue;
          const key = Object.keys(byModel).find((k) => baseModelId(k) === baseModelId(id));
          if (!key) continue;
          const target = byModel[key]!;
          const long = target.long_prompt ?? zeroCall();
          addCall(long, m.long_prompt);
          target.long_prompt = long;
        }
      }
      if (Object.keys(byModel).length) usage.by_model = byModel;

      usage.num_turns = message.num_turns;
      usage.result_subtype = message.subtype;
      if (message.terminal_reason) usage.terminal_reason = message.terminal_reason;
      usage.stop_reason = message.stop_reason ?? null;
      this.final = usage;
    }
  }

  /** One raw API stream event (SDKPartialAssistantMessage). */
  private observeStream(message: Extract<SDKMessage, { type: 'stream_event' }>): void {
    const stream = message.parent_tool_use_id ?? '';
    const event = message.event;
    if (event.type === 'message_start') {
      const api = event.message;
      if (!api?.id || !api.model || api.model === SYNTHETIC_MODEL) return;
      const start = callUsage(api.usage ?? {});
      const seen = this.calls.get(api.id);
      if (seen) {
        // A frame of this call arrived first: the stream takes over from here.
        maxInto(seen.usage, start);
        seen.streamed = true;
      } else {
        this.calls.set(api.id, { model: api.model, mainLoop: stream === '', usage: start, streamed: true });
      }
      this.openCalls.set(stream, api.id);
      return;
    }
    const id = this.openCalls.get(stream);
    if (event.type === 'message_stop') {
      this.openCalls.delete(stream);
      return;
    }
    if (event.type !== 'message_delta' || !id) return;
    const call = this.calls.get(id);
    if (!call) return;
    // The delta's usage is cumulative for the call. The CLI folds it the same
    // way into the total it reports in modelUsage: output_tokens always
    // replaces (message_start's is a placeholder), and the prompt fields only
    // when the delta gives a positive figure (they are final at message_start
    // and a delta usually repeats them, or sends null).
    const u = event.usage;
    if (typeof u?.output_tokens === 'number') call.usage.output_tokens = u.output_tokens;
    if (typeof u?.input_tokens === 'number' && u.input_tokens > 0) call.usage.input_tokens = u.input_tokens;
    if (typeof u?.cache_read_input_tokens === 'number' && u.cache_read_input_tokens > 0) {
      call.usage.cache_read_tokens = u.cache_read_input_tokens;
    }
    if (typeof u?.cache_creation_input_tokens === 'number' && u.cache_creation_input_tokens > 0) {
      call.usage.cache_write_tokens = u.cache_creation_input_tokens;
    }
    if (event.delta?.stop_reason === 'refusal') {
      this.countRefusal(id);
      if (!this.requestOf.has(id)) this.unmatchedStreamRefusal = id;
    }
  }

  /**
   * Count a refusal of API call `messageId` once. Its key is the call's
   * request id when a frame has named it — the key the CLI's notices use —
   * and the message id until then (linkRequest moves it over).
   */
  private countRefusal(messageId: string): void {
    this.refusalKeys.add(this.requestOf.get(messageId) ?? `message:${messageId}`);
  }

  /** API call `messageId` was request `requestId`: a refusal counted under the message id moves to the request id. */
  private linkRequest(messageId: string, requestId: string): void {
    this.requestOf.set(messageId, requestId);
    if (this.refusalKeys.delete(`message:${messageId}`)) this.refusalKeys.add(requestId);
    if (this.unmatchedStreamRefusal === messageId) this.unmatchedStreamRefusal = undefined;
  }

  /** The session's usage: the result's record once it has arrived, else the streamed totals, marked partial. */
  usage(): SessionTokenUsage {
    const outcome: Pick<SessionTokenUsage, 'refusals' | 'refusal_fallbacks'> = { refusals: this.refusalKeys.size };
    if (this.fallbacks.length) outcome.refusal_fallbacks = [...this.fallbacks];
    if (this.final) return { ...this.final, ...outcome };

    // The main loop's own calls make up the top-level fields, as they do in
    // a result's `usage`; subagent calls are in by_model only.
    const main = zeroCall();
    for (const call of this.calls.values()) if (call.mainLoop) addCall(main, call.usage);
    const usage: SessionTokenUsage = {
      input_tokens: main.input_tokens,
      output_tokens: main.output_tokens,
      cache_read_tokens: main.cache_read_tokens,
      cache_write_tokens: main.cache_write_tokens,
      ...(this.model ? { model: this.model } : {}),
      ...outcome,
      partial: true,
    };
    const streamed = this.streamedByModel();
    if (Object.keys(streamed).length) usage.by_model = streamed;
    return usage;
  }

  /** Streamed per-model totals, each with its long-prompt share when it has one. */
  private streamedByModel(): Record<string, ModelTokenUsage> {
    const out: Record<string, ModelTokenUsage> = {};
    for (const call of this.calls.values()) {
      const m = (out[call.model] ??= { ...zeroCall(), web_search_requests: 0 });
      addCall(m, call.usage);
      if (callPrompt(call.usage) > LONG_PROMPT_THRESHOLD_TOKENS) {
        m.long_prompt ??= zeroCall();
        addCall(m.long_prompt, call.usage);
      }
    }
    return out;
  }
}

/**
 * Extract the first JSON value from a session's result text.
 *
 * Models wrap their answer in prose as often as not: a sentence before it,
 * a ```json fence around it, a "Note: …" after it. So this looks inside
 * fenced blocks first, then in the whole text, and at each `{` or `[` it
 * reads one balanced JSON value (respecting strings and escapes) and parses
 * just that — trailing text is ignored rather than failing the parse.
 *
 * `kind` narrows what counts: a caller whose contract is an object passes
 * 'object', so a bracketed aside in the prose ("the [3] largest effects")
 * is skipped instead of being returned as the answer.
 *
 * `salvaged` says the value is a fragment of a larger value that did not
 * parse: it starts inside the span of an earlier opener in the same text
 * that was balanced but not JSON, or never closed. That is how malformed
 * output reads — a trailing comma in the second finding makes the outer
 * array unparseable and the first finding the first value that parses; a
 * reply cut off mid-array leaves the array unclosed — and the caller must
 * not treat the fragment as the whole answer (research-apply flags such
 * findings partial_output; policy-analyze notes it for staff). A value
 * after a failed span (prose in braces before the answer) is not salvaged.
 * An unclosed bracket in prose before the answer also reads as salvage;
 * that errs toward a review flag, which is the safe side.
 */
export function extractJson(
  text: string,
  opts: { kind?: 'object' | 'array' | 'any' } = {},
): { value: unknown; salvaged: boolean } {
  const kind = opts.kind ?? 'any';
  const openers = kind === 'object' ? '{' : kind === 'array' ? '[' : '{[';
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1] ?? '');
  for (const candidate of [...fenced, text]) {
    // The end of the furthest-reaching span, in this candidate, of an opener
    // that did not read as JSON; a value starting before it is inside one.
    let failedUntil = -1;
    for (let i = 0; i < candidate.length; i++) {
      if (!openers.includes(candidate[i]!)) continue;
      const end = balancedEnd(candidate, i);
      if (end < 0) {
        failedUntil = candidate.length;
        continue;
      }
      try {
        return { value: JSON.parse(candidate.slice(i, end + 1)), salvaged: i < failedUntil };
      } catch {
        // Balanced but not JSON (prose in braces, or a malformed value);
        // try the next opener, remembering where this one's span ends.
        failedUntil = Math.max(failedUntil, end);
      }
    }
  }
  throw new Error('no JSON found in session output');
}

/**
 * Index of the bracket that closes the value opened at `start`, or -1 when
 * the text ends first. Brackets inside JSON strings do not count.
 */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
