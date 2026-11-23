import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import {
  LONG_PROMPT_THRESHOLD_TOKENS,
  emptyUsage,
  type FindingPayload,
  type GeographicScale,
  type ModelTokenUsage,
  type SessionTokenUsage,
} from '@deep-fryer/core';
import {
  extractValuePassages,
  renderTriagePrompt,
  triageAssessmentSchema,
  triageFlags,
  triageSeverity,
  type TriageAssessment,
  type TriageContext,
  type TriageFlag,
  type TriageSeverity,
} from '@deep-fryer/research';

/**
 * Direct, zero-subprocess Anthropic Messages API runner for lightweight
 * structured classification tasks such as frame/construct finding triage.
 *
 * Avoids the Claude Code CLI subprocess, tempdir, MCP server, and ~10k-token
 * coding-agent prompt overhead while keeping exact per-model `SessionTokenUsage`
 * accounting compatible with `@deep-fryer/core`'s `priceSessionUsage`.
 */

export const DEFAULT_TRIAGE_MODEL = 'claude-haiku-5-5';
export const DEFAULT_MESSAGE_MAX_TOKENS = 512;
export const DEFAULT_MESSAGE_TIMEOUT_MS = 20_000;

const FIRST_PARTY_ANTHROPIC_API = 'https://api.anthropic.com';

export interface RawMessageContentBlock {
  type: string;
  text?: string;
}

export interface RawMessageUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface RawMessageResponse {
  model?: string;
  stop_reason?: string | null;
  content: readonly RawMessageContentBlock[];
  usage?: RawMessageUsage | null;
}

export interface MessageCreateParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
}

export interface MessageCreateOptions {
  signal?: AbortSignal;
  timeout?: number;
}

/** Minimal structural client satisfied by both `Anthropic` and test doubles. */
export interface MessagesApiClient {
  messages: {
    create(
      body: MessageCreateParams,
      options?: MessageCreateOptions,
    ): Promise<RawMessageResponse>;
  };
}

export interface CreateMessagesClientOptions {
  apiKey?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Create a direct `@anthropic-ai/sdk` client pinned to the first-party API.
 * Sets `authToken: null` so an ambient `ANTHROPIC_AUTH_TOKEN` can never be
 * mixed with an explicit organization or deployment key.
 */
export function createMessagesClient(options: CreateMessagesClientOptions = {}): Anthropic {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API key is not configured for direct Messages calls');
  }
  return new Anthropic({
    apiKey,
    authToken: null,
    baseURL: FIRST_PARTY_ANTHROPIC_API,
    maxRetries: options.maxRetries ?? 1,
    timeout: options.timeoutMs ?? DEFAULT_MESSAGE_TIMEOUT_MS,
  });
}

function nonNegativeInt(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Convert an Anthropic Messages API `usage` payload into the repository's
 * canonical `SessionTokenUsage` format, including cache tokens and two-card
 * `long_prompt` attribution (`LONG_PROMPT_THRESHOLD_TOKENS`).
 */
export function messageUsageToSessionUsage(
  model: string,
  rawUsage: RawMessageUsage | null | undefined,
  stopReason?: string | null,
): SessionTokenUsage {
  const inputTokens = nonNegativeInt(rawUsage?.input_tokens);
  const outputTokens = nonNegativeInt(rawUsage?.output_tokens);
  const cacheReadTokens = nonNegativeInt(rawUsage?.cache_read_input_tokens);
  const cacheWriteTokens = nonNegativeInt(rawUsage?.cache_creation_input_tokens);

  const modelUsage: ModelTokenUsage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_write_tokens: cacheWriteTokens,
    web_search_requests: 0,
  };

  if (inputTokens + cacheReadTokens + cacheWriteTokens > LONG_PROMPT_THRESHOLD_TOKENS) {
    modelUsage.long_prompt = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      cache_write_tokens: cacheWriteTokens,
    };
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_write_tokens: cacheWriteTokens,
    model,
    by_model: { [model]: modelUsage },
    num_turns: 1,
    result_subtype: 'success',
    stop_reason: stopReason ?? null,
  };
}

function extractResponseText(content: readonly RawMessageContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!)
    .join('\n')
    .trim();
}

/**
 * Parse a JSON response strictly: accepts raw JSON or a single fenced JSON
 * block, rejecting arbitrary prose with embedded fragments.
 */
function parseStrictJson(rawText: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = rawText.trim();
  if (!trimmed) return { ok: false, error: 'Model returned empty text' };

  const fenceMatch = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : trimmed;

  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON output: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface RunStructuredMessageInput<T> {
  client: MessagesApiClient;
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type StructuredMessageResult<T> =
  | { ok: true; data: T; rawText: string; model: string; usage: SessionTokenUsage }
  | { ok: false; error: string; rawText?: string; model: string; usage: SessionTokenUsage };

/**
 * Run a single direct Anthropic Messages API call and validate its JSON reply
 * against a strict Zod schema, enforcing a timeout and recording exact
 * `SessionTokenUsage` even when validation fails.
 */
export async function runStructuredMessage<T>(
  input: RunStructuredMessageInput<T>,
): Promise<StructuredMessageResult<T>> {
  const maxTokens = input.maxTokens ?? DEFAULT_MESSAGE_MAX_TOKENS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_MESSAGE_TIMEOUT_MS;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Messages request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const onCallerAbort = () => controller.abort(input.signal?.reason);
  if (input.signal) {
    if (input.signal.aborted) {
      clearTimeout(timer);
      return { ok: false, error: 'Messages request aborted', model: input.model, usage: emptyUsage() };
    }
    input.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let response: RawMessageResponse;
  try {
    response = await input.client.messages.create(
      {
        model: input.model,
        max_tokens: maxTokens,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
        temperature: 0,
      },
      { signal: controller.signal, timeout: timeoutMs },
    );
  } catch (err) {
    const message = timedOut
      ? `Messages request timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    return {
      ok: false,
      error: message,
      model: input.model,
      usage: emptyUsage(),
    };
  } finally {
    clearTimeout(timer);
    if (input.signal) input.signal.removeEventListener('abort', onCallerAbort);
  }

  const recordedModel = response.model ?? input.model;
  const usage = messageUsageToSessionUsage(recordedModel, response.usage, response.stop_reason);
  const rawText = extractResponseText(response.content);

  const jsonParsed = parseStrictJson(rawText);
  if (!jsonParsed.ok) {
    return {
      ok: false,
      error: jsonParsed.error,
      rawText,
      model: recordedModel,
      usage,
    };
  }

  const validated = input.schema.safeParse(jsonParsed.value);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    return {
      ok: false,
      error: `Schema validation failed: ${issues}`,
      rawText,
      model: recordedModel,
      usage,
    };
  }

  return {
    ok: true,
    data: validated.data,
    rawText,
    model: recordedModel,
    usage,
  };
}

// ---------------------------------------------------------------------------
// Standalone finding triage helper (ready for Promise.all alongside runVerifier)
// ---------------------------------------------------------------------------

export interface FindingTriageDeps {
  /** Optional injected SDK client (for tests or shared worker client). */
  client?: MessagesApiClient;
  /** Optional API key used when `client` is not supplied. */
  apiKey?: string | null;
  /** Classifier model id; defaults to `TRIAGE_MODEL` env or `claude-haiku-5-5`. */
  model?: string;
  regionName: string;
  regionDefinition?: string;
  indicatorDefinition?: string;
  portraitScale?: GeographicScale;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface FindingTriageResult {
  status: 'scored' | 'skipped' | 'no_text' | 'unavailable';
  /** Strictly advisory invariant: triage never approves or suppresses verifier flags. */
  advisoryOnly: true;
  assessment: TriageAssessment | null;
  severity: TriageSeverity;
  flags: TriageFlag[];
  valueFound: boolean | null;
  usage: SessionTokenUsage;
  model?: string;
  error?: string;
}

/**
 * Run lightweight frame/construct triage on one finding against its archived
 * readable source text. Designed as a standalone helper ready to run under
 * `Promise.all` alongside `runVerifier`:
 *
 * - Never sees or modifies the verifier's input or verdict.
 * - Strictly advisory / flag-expanding: never auto-approves or suppresses flags.
 * - Never throws on API, timeout, or schema errors — returns `unavailable`
 *   with recorded token usage so the finding always proceeds cleanly.
 */
export async function runFindingTriage(
  deps: FindingTriageDeps,
  finding: FindingPayload,
  sourceText: string | null | undefined,
): Promise<FindingTriageResult> {
  if (finding.kind === 'gap') {
    return {
      status: 'skipped',
      advisoryOnly: true,
      assessment: null,
      severity: 'none',
      flags: [],
      valueFound: null,
      usage: emptyUsage(),
    };
  }

  if (!sourceText || !sourceText.trim()) {
    return {
      status: 'no_text',
      advisoryOnly: true,
      assessment: null,
      severity: 'none',
      flags: [],
      valueFound: false,
      usage: emptyUsage(),
    };
  }

  let client: MessagesApiClient;
  if (deps.client) {
    client = deps.client;
  } else {
    try {
      client = createMessagesClient({
        apiKey: deps.apiKey,
        timeoutMs: deps.timeoutMs,
      });
    } catch (err) {
      return {
        status: 'unavailable',
        advisoryOnly: true,
        assessment: null,
        severity: 'none',
        flags: [],
        valueFound: null,
        usage: emptyUsage(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const extracted = extractValuePassages({
    sourceText,
    value: finding.value,
    indicatorName: finding.name,
    indicatorSlug: finding.indicator_slug,
    unit: finding.unit,
  });

  const { system, user } = renderTriagePrompt({
    finding,
    regionName: deps.regionName,
    regionDefinition: deps.regionDefinition,
    indicatorDefinition: deps.indicatorDefinition,
    extracted,
  });

  const model = deps.model ?? process.env.TRIAGE_MODEL ?? DEFAULT_TRIAGE_MODEL;
  const res = await runStructuredMessage({
    client,
    model,
    system,
    user,
    schema: triageAssessmentSchema,
    maxTokens: deps.maxTokens ?? DEFAULT_MESSAGE_MAX_TOKENS,
    timeoutMs: deps.timeoutMs ?? DEFAULT_MESSAGE_TIMEOUT_MS,
    signal: deps.signal,
  });

  if (!res.ok) {
    return {
      status: 'unavailable',
      advisoryOnly: true,
      assessment: null,
      severity: 'none',
      flags: [],
      valueFound: extracted.valueFound,
      usage: res.usage,
      model: res.model,
      error: res.error,
    };
  }

  const context: TriageContext = {
    claimedSourceTier: finding.source_tier,
    claimedScale: finding.geographic_scale,
    ...(deps.portraitScale ? { portraitScale: deps.portraitScale } : {}),
  };

  return {
    status: 'scored',
    advisoryOnly: true,
    assessment: res.data,
    severity: triageSeverity(res.data, context),
    flags: triageFlags(res.data, context),
    valueFound: extracted.valueFound,
    usage: res.usage,
    model: res.model,
  };
}
