import { gzipSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createSdkMcpServer,
  query,
  tool,
  type SDKAssistantMessageError,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  LONG_PROMPT_THRESHOLD_TOKENS,
  baseModelId,
  emptyUsage,
  mergeUsage,
  type ModelTokenUsage,
  type RefusalFallbackEvent,
  type SessionTokenUsage,
} from '@deep-fryer/core';
import { DEFAULT_SESSION_MAX_TURNS, DEFAULT_SESSION_MODEL } from '@deep-fryer/research';
import { captureEvidence } from './evidence.js';
import { rejectedKeyError } from './org-key.js';
import type { TenantStorage } from './storage.js';

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

/**
 * Transient transport failures ("Connection closed mid-response", overloaded,
 * 5xx) and turn-cap exhaustion kill an entire session. The SDK surfaces some
 * of these as THROWN errors, not unsuccessful results — so the retry must
 * catch throws, and a double failure must return a failed result rather than
 * propagate, or one bad session kills the surrounding 21-session run. Usage
 * from both attempts is folded with mergeUsage — the spend was real either
 * way, and a thrown attempt contributes what it had streamed (SessionRunError).
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
  const attempt = async (): Promise<SessionResult> => {
    try {
      return await runSession(input);
    } catch (err) {
      // The message is stored in the transcript: an organization's key must
      // not ride along if a subprocess error ever echoed its environment.
      const message = redactSecret(err instanceof Error ? err.message : String(err), input.apiKey);
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
  const model = input.model ?? MODEL();
  const first = await attempt();
  if (first.succeeded) return first;
  // Built on either key, thrown only on the organization's: on the
  // deployment's key a refusal is returned as a failed session, as before.
  const rejectedFirst = rejectedKeyError(first, model, first.usage);
  if (rejectedFirst) {
    if (input.apiKey) throw rejectedFirst;
    return first;
  }
  const second = await attempt();
  const usage = mergeUsage(first.usage, second.usage);
  // The key can also die between the attempts (credit running out mid-run).
  const refused = !second.succeeded && input.apiKey ? rejectedKeyError(second, model, usage) : null;
  if (refused) throw refused;
  return { ...second, usage };
}

const MODEL = () => process.env.ANTHROPIC_MODEL ?? DEFAULT_SESSION_MODEL;

/**
 * Orchestrated mode: when RESEARCH_SUBAGENT_MODEL is set (e.g. 'claude-sonnet-5'),
 * researcher sessions get a source-scout subagent on that model and the Task
 * tool to dispatch it. The main session stays the single synthesizer — scouts
 * gather, they never conclude. Verifier sessions are excluded by construction
 * (their allowlist has no WebSearch).
 */
const SCOUT_MODEL = () => process.env.RESEARCH_SUBAGENT_MODEL;

const SCOUT_AGENT = (model: string) => ({
  'source-scout': {
    description:
      'Fast scout for breadth work. Dispatch it for every initial source sweep (one scout per tier or portal), to check whether a portal/publisher has a candidate dataset before you descend a tier, and to skim a candidate page for the exact figure. It reports raw material only — you evaluate and synthesize.',
    prompt:
      'You are a source scout for a civic research orchestrator. Execute exactly the search or fetch task you were given and report raw material: for each candidate source — URL, publisher, publication date, the exact quoted text containing any relevant figure (with enough surrounding text to locate it), the geography and year the figure covers, and your best guess at its source tier. Report dead ends honestly ("portal has no dataset for X"). Do NOT synthesize, conclude, score, or recommend which source to accept. Never state a figure you did not see verbatim on a fetched page.',
    tools: ['WebSearch', 'WebFetch'],
    model,
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
 * filesystem, notebooks, background processes. No session ever needs them —
 * every session's work is web research plus our in-process MCP tools — and
 * each one would let text the model read (a fetched page, a pasted policy
 * brief) steer it into the worker's environment. The `tools` option below
 * already leaves them out; listing them as disallowed as well means a
 * future change to the base tool set cannot quietly bring one back.
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
 */
export function sessionEnv(
  source: NodeJS.ProcessEnv = process.env,
  options: { apiKey?: string } = {},
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

/**
 * One research session = one Agent SDK session in a scratch workspace
 * (SPEC.md §8 Apply). The full message stream is retained as the audit
 * transcript (gzipped JSONL). In production each session additionally runs
 * inside an ephemeral container behind the egress allowlist proxy — that
 * isolation lives in the deploy layer (see apps/worker/README.md); the tool
 * surface and the subprocess environment are restricted here, so a session
 * is contained even where that deploy layer is missing.
 */
export async function runSession(input: {
  prompt: string;
  /**
   * The session's entire tool surface: built-in tools by name (WebSearch,
   * WebFetch) plus our MCP tools (mcp__evidence__…). Nothing outside it
   * exists in the session, and nothing outside it may run.
   */
  allowedTools: string[];
  storage?: TenantStorage;
  maxTurns?: number;
  model?: string;
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
}): Promise<SessionResult> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'df-session-'));
  const transcriptLines: string[] = [];
  let resultText = '';
  let succeeded = false;
  const meter = new SessionMeter();

  const mcpServers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};
  if (input.storage) {
    const storage = input.storage;
    mcpServers.evidence = createSdkMcpServer({
      name: 'evidence',
      version: '1.0.0',
      tools: [
        tool(
          'capture_evidence',
          'Capture an evidence snapshot of a source you have decided to accept: a full-page screenshot, plus the PDF when the source is a document. Returns storage paths for the finding\'s evidence field.',
          {
            url: z.string().describe('The exact URL the value was read from'),
            pdf_url: z.string().optional().describe('Direct PDF URL when the source is a document'),
          },
          async (args) => {
            try {
              const result = await captureEvidence(storage, args.url, args.pdf_url);
              return { content: [{ type: 'text', text: JSON.stringify(result) }] };
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
      ],
    });
  }

  const scoutModel = SCOUT_MODEL();
  const orchestrated =
    input.orchestrate !== false && Boolean(scoutModel) && input.allowedTools.includes('WebSearch');

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
  const allowed = orchestrated ? [...input.allowedTools, ...DISPATCH_TOOLS] : input.allowedTools;
  const builtIn = allowed.filter((t) => !t.startsWith('mcp__'));

  try {
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
          env: sessionEnv(process.env, { apiKey: input.apiKey }),
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
