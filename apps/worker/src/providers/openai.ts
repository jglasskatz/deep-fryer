import {
  emptyUsage,
  mergeUsage,
  resolveProviderEnvKey,
  type ModelTokenUsage,
  type SessionTokenUsage,
} from '@deep-fryer/core';
import {
  classifyProviderHttpError,
  orgKeyRejected,
} from '../org-key.js';
import {
  nonNegativeInt,
  parseStrictJsonText,
  redactProviderSecret,
  zodToJsonSchema,
  type ProviderSessionInput,
  type ProviderSessionOutput,
  type ProviderStructuredMessageInput,
  type ProviderStructuredMessageResult,
} from './types.js';

/**
 * Native-fetch OpenAI Chat Completions runtime adapter.
 *
 * Supports bounded multi-turn function calling (`runOpenAiSession`) and
 * single-shot JSON-schema structured outputs (`runOpenAiStructuredMessage`)
 * with zero extra npm dependencies, exact cached-token `SessionTokenUsage`
 * metering, and owner-actionable `OrgKeyUnavailableError` classification.
 */

export const OPENAI_FIRST_PARTY_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_TIMEOUT_MS = 120_000;
const DEFAULT_STRUCTURED_MAX_TOKENS = 1024;
const DEFAULT_STRUCTURED_TIMEOUT_MS = 30_000;
export const DEFAULT_OPENAI_SEARCH_MODEL = 'gpt-6-luna';
const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 45_000;

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAiUsagePayload {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_tokens_details?: {
    cached_tokens?: number | null;
    cache_write_tokens?: number | null;
  } | null;
}

interface OpenAiResponsesUsagePayload {
  input_tokens?: number | null;
  output_tokens?: number | null;
  input_tokens_details?: {
    cached_tokens?: number | null;
    cache_write_tokens?: number | null;
  } | null;
}

interface OpenAiResponsesOutputItem {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{
    type?: string;
    text?: string;
    annotations?: Array<{
      type?: string;
      url?: string;
      title?: string;
    }>;
  }>;
}

interface OpenAiResponsesPayload {
  id?: string;
  model?: string;
  status?: string;
  output_text?: string;
  output?: OpenAiResponsesOutputItem[];
  usage?: OpenAiResponsesUsagePayload | null;
}

interface OpenAiChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
  usage?: OpenAiUsagePayload | null;
}

/** OpenAI reasoning models (o1/o3/o4, gpt-5*, gpt-6*) reject explicit `temperature: 0` on chat/completions. */
export function supportsZeroTemperature(model: string): boolean {
  const lower = model.trim().toLowerCase();
  return !/^(?:o[134](?:$|-)|gpt-[56](?:[.-]|$))/.test(lower);
}

/**
 * OpenAI `gpt-6*` and `gpt-5.6*` models require `/v1/responses` to combine
 * reasoning with function tool calling (`/v1/chat/completions` rejects tools
 * unless reasoning is disabled).
 */
export function usesResponsesApi(model: string): boolean {
  const lower = model.trim().toLowerCase();
  return /^(?:gpt-6(?:[.-]|$)|gpt-5\.6(?:[.-]|$))/.test(lower);
}

/** Map one OpenAI Chat Completions `usage` object into `SessionTokenUsage`. */
export function openAiUsageToSessionUsage(
  model: string,
  rawUsage: OpenAiUsagePayload | null | undefined,
  options: { stopReason?: string | null; resultSubtype?: string; terminalReason?: string; numTurns?: number } = {},
): SessionTokenUsage {
  const totalPrompt = nonNegativeInt(rawUsage?.prompt_tokens);
  const cachedTokens = Math.min(totalPrompt, nonNegativeInt(rawUsage?.prompt_tokens_details?.cached_tokens));
  const cacheWriteTokens = Math.min(
    Math.max(0, totalPrompt - cachedTokens),
    nonNegativeInt(rawUsage?.prompt_tokens_details?.cache_write_tokens),
  );
  const inputTokens = Math.max(0, totalPrompt - cachedTokens - cacheWriteTokens);
  const outputTokens = nonNegativeInt(rawUsage?.completion_tokens);

  const modelUsage: ModelTokenUsage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cachedTokens,
    cache_write_tokens: cacheWriteTokens,
    web_search_requests: 0,
  };

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cachedTokens,
    cache_write_tokens: cacheWriteTokens,
    model,
    by_model: { [model]: modelUsage },
    num_turns: options.numTurns ?? 1,
    ...(options.resultSubtype ? { result_subtype: options.resultSubtype } : {}),
    ...(options.terminalReason ? { terminal_reason: options.terminalReason } : {}),
    ...(options.stopReason !== undefined ? { stop_reason: options.stopReason } : {}),
  };
}

function resolveOpenAiBaseUrl(baseUrl: string | undefined, isOrganizationKey: boolean): string {
  const rawBase = isOrganizationKey
    ? OPENAI_FIRST_PARTY_BASE_URL
    : baseUrl?.trim() || process.env.OPENAI_BASE_URL?.trim() || OPENAI_FIRST_PARTY_BASE_URL;
  return rawBase.replace(/\/+$/, '');
}

function resolveOpenAiEndpoint(baseUrl: string | undefined, isOrganizationKey: boolean): string {
  return `${resolveOpenAiBaseUrl(baseUrl, isOrganizationKey)}/chat/completions`;
}

async function fetchWithTimeout(
  fetchImpl: NonNullable<ProviderSessionInput['fetch']>,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`OpenAI request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const onAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timer);
      throw new Error('OpenAI request aborted');
    }
    callerSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', onAbort);
  }
}

const MAX_TOOL_OUTPUT_CHARS = 32_000;

/**
 * Execute a bounded multi-turn OpenAI Responses API (`/v1/responses`) tool-calling
 * session for `gpt-6*` and `gpt-5.6*` reasoning models, preserving server-side
 * reasoning state via `previous_response_id` and exact token/cache metering.
 */
async function runOpenAiResponsesSession(
  input: ProviderSessionInput,
  apiKey: string,
): Promise<ProviderSessionOutput> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const endpoint = `${resolveOpenAiBaseUrl(input.baseUrl, Boolean(input.isOrganizationKey))}/responses`;
  const timeoutMs = input.timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS;
  const maxTurns = Math.max(1, input.maxTurns);
  const toolsSpec =
    input.tools && input.tools.size > 0
      ? input.tools.list().map((t) => ({
          type: 'function' as const,
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }))
      : [];

  const transcriptLines: string[] = [
    JSON.stringify({ type: 'system', subtype: 'init', provider: 'openai', api: 'responses', model: input.model }),
  ];

  let totalUsage = emptyUsage();
  let lastText = '';
  let lastStatus: string | null = null;
  let previousResponseId: string | undefined;
  let nextInput: unknown = [{ role: 'user', content: input.prompt }];

  for (let turn = 1; turn <= maxTurns; turn++) {
    const body: Record<string, unknown> = {
      model: input.model,
      input: nextInput,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      ...(input.systemPrompt?.trim() ? { instructions: input.systemPrompt } : {}),
      ...(toolsSpec.length > 0 ? { tools: toolsSpec, tool_choice: 'auto' } : {}),
      ...(input.responseJsonSchema
        ? {
            text: {
              format: {
                type: 'json_schema',
                name: input.responseJsonSchema.name,
                schema: input.responseJsonSchema.schema,
                strict: false,
              },
            },
          }
        : {}),
    };

    const res = await fetchWithTimeout(
      fetchImpl,
      endpoint,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
      input.signal,
    );

    if (!res.ok) {
      const rawErr = redactProviderSecret(await res.text().catch(() => ''), apiKey).slice(0, 1000);
      const rejection = classifyProviderHttpError('openai', res.status, rawErr);
      transcriptLines.push(
        JSON.stringify({ type: 'api_error', provider: 'openai', api: 'responses', status: res.status, error: rejection ?? 'http_error', text: rawErr }),
      );
      if (rejection && input.isOrganizationKey) {
        throw orgKeyRejected(rejection, input.model, totalUsage, 'openai');
      }
      return {
        resultText: lastText,
        transcriptLines,
        usage: { ...totalUsage, result_subtype: 'error', terminal_reason: 'model_error' },
        succeeded: false,
        apiError: rejection ?? (res.status === 429 ? 'rate_limit' : 'server_error'),
        apiErrorText: rawErr || `HTTP ${res.status}`,
      };
    }

    const payload = (await res.json()) as OpenAiResponsesPayload;
    const recordedModel = payload.model?.trim() || input.model;
    lastStatus = payload.status ?? null;
    if (payload.id) previousResponseId = payload.id;

    const outputItems = Array.isArray(payload.output) ? payload.output : [];
    const turnUsage = responsesUsageToSessionUsage(recordedModel, payload.usage, 0);
    totalUsage = mergeUsage(totalUsage, turnUsage);

    const textParts: string[] = [];
    const functionCalls: Array<{ call_id: string; name: string; arguments: string }> = [];

    for (const item of outputItems) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (typeof part?.text === 'string' && part.text.trim()) {
            textParts.push(part.text);
          }
        }
      } else if (item?.type === 'function_call' && item.call_id && item.name) {
        functionCalls.push({
          call_id: item.call_id,
          name: item.name,
          arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
        });
      }
    }

    const textContent = textParts.join('\n').trim() || (typeof payload.output_text === 'string' ? payload.output_text.trim() : '');
    if (textContent) lastText = textContent;

    transcriptLines.push(
      redactProviderSecret(
        JSON.stringify({
          type: 'assistant',
          provider: 'openai',
          api: 'responses',
          turn,
          model: recordedModel,
          content: textContent,
          tool_calls: functionCalls,
          status: lastStatus,
        }),
        apiKey,
      ),
    );

    if (process.env.DF_TRACE_TURNS === '1') {
      const names = functionCalls.map((c) => c.name).join(', ') || '(final)';
      console.error(`  [openai/responses ${recordedModel} turn ${turn}/${maxTurns}] calls=[${names}] status=${lastStatus}`);
    }

    if (functionCalls.length === 0) {
      const finalUsage: SessionTokenUsage = {
        ...totalUsage,
        model: recordedModel,
        result_subtype: 'success',
        terminal_reason: 'completed',
        stop_reason: lastStatus,
      };
      transcriptLines.push(
        redactProviderSecret(JSON.stringify({ type: 'result', subtype: 'success', result: lastText }), apiKey),
      );
      return {
        resultText: lastText,
        transcriptLines,
        usage: finalUsage,
        succeeded: true,
      };
    }

    if (turn >= maxTurns) break;

    const toolResults = await Promise.all(
      functionCalls.map(async (call) => {
        const executed = input.tools
          ? await input.tools.execute(call.name, call.arguments)
          : { output: JSON.stringify({ error: `No tools registered in this session (called ${call.name}).` }), isError: true };

        const boundedOutput =
          executed.output.length > MAX_TOOL_OUTPUT_CHARS
            ? `${executed.output.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n…[truncated ${executed.output.length - MAX_TOOL_OUTPUT_CHARS} chars]`
            : executed.output;

        return { call, executed, boundedOutput };
      }),
    );

    const toolOutputs: Array<Record<string, unknown>> = [];
    const attachedImages: Array<{ mimeType: string; base64: string; label?: string }> = [];
    for (const { call, executed, boundedOutput } of toolResults) {
      transcriptLines.push(
        redactProviderSecret(
          JSON.stringify({
            type: 'tool_result',
            provider: 'openai',
            api: 'responses',
            tool_call_id: call.call_id,
            name: call.name,
            is_error: executed.isError,
            output: boundedOutput.slice(0, 4000),
          }),
          apiKey,
        ),
      );

      toolOutputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: boundedOutput,
      });
      if ('images' in executed && Array.isArray(executed.images)) {
        for (const img of executed.images) attachedImages.push(img);
      }
    }
    if (attachedImages.length > 0) {
      toolOutputs.push({
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Attached archived visual exhibit(s): ${attachedImages.map((i) => i.label ?? 'exhibit').join(', ')}. Inspect the image(s) directly to verify claimed figures.`,
          },
          ...attachedImages.map((img) => ({
            type: 'input_image',
            image_url: `data:${img.mimeType};base64,${img.base64}`,
          })),
        ],
      });
    }
    if (maxTurns >= 4 && turn === maxTurns - 2 && toolsSpec.length > 0) {
      nextInput = [
        ...toolOutputs,
        {
          role: 'user',
          content:
            'Turn budget notice: only 2 turns remain. Stop searching now; capture any remaining accepted evidence and call submit_findings (or emit your final response) on your next turn.',
        },
      ];
    } else if (maxTurns >= 3 && turn === maxTurns - 1 && toolsSpec.length > 0) {
      nextInput = [
        ...toolOutputs,
        {
          role: 'user',
          content:
            'Final turn notice: this is your LAST turn. Do NOT call search or read tools — emit your final structured output (or call submit_findings if not yet accepted) immediately.',
        },
      ];
    } else {
      nextInput = toolOutputs;
    }
  }

  return {
    resultText: lastText,
    transcriptLines,
    usage: {
      ...totalUsage,
      result_subtype: 'error_max_turns',
      terminal_reason: 'max_turns',
      stop_reason: lastStatus,
    },
    succeeded: false,
  };
}

/**
 * Execute a bounded multi-turn OpenAI tool-calling session (automatically routes
 * `gpt-6*` / `gpt-5.6*` reasoning models to `/v1/responses` and legacy models
 * to `/v1/chat/completions`).
 */
export async function runOpenAiSession(input: ProviderSessionInput): Promise<ProviderSessionOutput> {
  const apiKey = input.apiKey?.trim() || (input.isOrganizationKey ? null : resolveProviderEnvKey('openai'));
  if (!apiKey) {
    return {
      resultText: '',
      transcriptLines: [JSON.stringify({ type: 'session_error', message: 'OPENAI_API_KEY is not configured' })],
      usage: emptyUsage(),
      succeeded: false,
      apiError: 'authentication_failed',
      apiErrorText: 'OPENAI_API_KEY is not configured',
    };
  }

  if (usesResponsesApi(input.model)) {
    return runOpenAiResponsesSession(input, apiKey);
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  const endpoint = resolveOpenAiEndpoint(input.baseUrl, Boolean(input.isOrganizationKey));
  const timeoutMs = input.timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS;
  const maxTurns = Math.max(1, input.maxTurns);
  const toolsSpec = input.tools && input.tools.size > 0 ? input.tools.toOpenAiTools() : [];

  const messages: OpenAiChatMessage[] = [];
  if (input.systemPrompt?.trim()) {
    messages.push({ role: 'system', content: input.systemPrompt });
  }
  messages.push({ role: 'user', content: input.prompt });

  const transcriptLines: string[] = [
    JSON.stringify({ type: 'system', subtype: 'init', provider: 'openai', model: input.model }),
  ];

  let totalUsage = emptyUsage();
  let lastText = '';
  let lastStopReason: string | null = null;

  for (let turn = 1; turn <= maxTurns; turn++) {
    const body: Record<string, unknown> = {
      model: input.model,
      messages,
      ...(supportsZeroTemperature(input.model) ? { temperature: 0 } : {}),
      ...(toolsSpec.length > 0 ? { tools: toolsSpec, tool_choice: 'auto' } : {}),
      ...(input.responseJsonSchema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: input.responseJsonSchema.name,
                schema: input.responseJsonSchema.schema,
                strict: false,
              },
            },
          }
        : {}),
    };

    const res = await fetchWithTimeout(
      fetchImpl,
      endpoint,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
      input.signal,
    );

    if (!res.ok) {
      const rawErr = redactProviderSecret(await res.text().catch(() => ''), apiKey).slice(0, 1000);
      const rejection = classifyProviderHttpError('openai', res.status, rawErr);
      transcriptLines.push(
        JSON.stringify({ type: 'api_error', provider: 'openai', status: res.status, error: rejection ?? 'http_error', text: rawErr }),
      );
      if (rejection && input.isOrganizationKey) {
        throw orgKeyRejected(rejection, input.model, totalUsage, 'openai');
      }
      return {
        resultText: lastText,
        transcriptLines,
        usage: { ...totalUsage, result_subtype: 'error', terminal_reason: 'model_error' },
        succeeded: false,
        apiError: rejection ?? (res.status === 429 ? 'rate_limit' : 'server_error'),
        apiErrorText: rawErr || `HTTP ${res.status}`,
      };
    }

    const payload = (await res.json()) as OpenAiChatCompletionResponse;
    const recordedModel = payload.model?.trim() || input.model;
    const choice = payload.choices?.[0];
    const assistantMsg = choice?.message;
    lastStopReason = choice?.finish_reason ?? null;

    const turnUsage = openAiUsageToSessionUsage(recordedModel, payload.usage, {
      numTurns: 1,
      stopReason: lastStopReason,
    });
    totalUsage = mergeUsage(totalUsage, turnUsage);

    const textContent = typeof assistantMsg?.content === 'string' ? assistantMsg.content : '';
    const toolCalls = Array.isArray(assistantMsg?.tool_calls) ? assistantMsg.tool_calls : [];
    if (textContent.trim()) lastText = textContent;

    transcriptLines.push(
      redactProviderSecret(
        JSON.stringify({
          type: 'assistant',
          provider: 'openai',
          turn,
          model: recordedModel,
          content: textContent,
          tool_calls: toolCalls,
          finish_reason: lastStopReason,
        }),
        apiKey,
      ),
    );

    messages.push({
      role: 'assistant',
      content: textContent || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });

    if (toolCalls.length === 0) {
      const finalUsage: SessionTokenUsage = {
        ...totalUsage,
        model: recordedModel,
        result_subtype: 'success',
        terminal_reason: 'completed',
        stop_reason: lastStopReason,
      };
      transcriptLines.push(
        redactProviderSecret(JSON.stringify({ type: 'result', subtype: 'success', result: lastText }), apiKey),
      );
      return {
        resultText: lastText,
        transcriptLines,
        usage: finalUsage,
        succeeded: true,
      };
    }

    if (turn >= maxTurns) break;

    for (const call of toolCalls) {
      const fnName = call.function?.name ?? '';
      const fnArgs = call.function?.arguments ?? '{}';
      const executed = input.tools
        ? await input.tools.execute(fnName, fnArgs)
        : { output: JSON.stringify({ error: `No tools registered in this session (called ${fnName}).` }), isError: true };

      transcriptLines.push(
        redactProviderSecret(
          JSON.stringify({
            type: 'tool_result',
            provider: 'openai',
            tool_call_id: call.id,
            name: fnName,
            is_error: executed.isError,
            output: executed.output.slice(0, 4000),
          }),
          apiKey,
        ),
      );

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: fnName,
        content: executed.output,
      });
    }
  }

  return {
    resultText: lastText,
    transcriptLines,
    usage: {
      ...totalUsage,
      result_subtype: 'error_max_turns',
      terminal_reason: 'max_turns',
      stop_reason: lastStopReason,
    },
    succeeded: false,
  };
}

/**
 * Single-shot structured JSON call on OpenAI Chat Completions, validated
 * against a strict Zod schema with exact `SessionTokenUsage` accounting.
 */
export async function runOpenAiStructuredMessage<T>(
  input: ProviderStructuredMessageInput<T>,
): Promise<ProviderStructuredMessageResult<T>> {
  const apiKey = input.apiKey?.trim() || (input.isOrganizationKey ? null : resolveProviderEnvKey('openai'));
  if (!apiKey) {
    return {
      ok: false,
      error: 'OpenAI API key is not configured for structured message calls',
      model: input.model,
      usage: emptyUsage(),
    };
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  const endpoint = resolveOpenAiEndpoint(input.baseUrl, Boolean(input.isOrganizationKey));
  const timeoutMs = input.timeoutMs ?? DEFAULT_STRUCTURED_TIMEOUT_MS;
  const baseMaxTokens = input.maxTokens ?? DEFAULT_STRUCTURED_MAX_TOKENS;
  const maxTokens = supportsZeroTemperature(input.model) ? baseMaxTokens : Math.max(baseMaxTokens, 4096);
  const jsonSchema = zodToJsonSchema(input.schema);

  let res: Response;
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      endpoint,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
          ...(supportsZeroTemperature(input.model) ? { temperature: 0 } : {}),
          max_completion_tokens: maxTokens,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'structured_output',
              schema: jsonSchema,
              strict: false,
            },
          },
        }),
      },
      timeoutMs,
      input.signal,
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      model: input.model,
      usage: emptyUsage(),
    };
  }

  if (!res.ok) {
    const rawErr = redactProviderSecret(await res.text().catch(() => ''), apiKey).slice(0, 500);
    const rejection = classifyProviderHttpError('openai', res.status, rawErr);
    if (rejection && input.isOrganizationKey) {
      throw orgKeyRejected(rejection, input.model, emptyUsage(), 'openai');
    }
    return {
      ok: false,
      error: `OpenAI API error HTTP ${res.status}${rawErr ? `: ${rawErr}` : ''}`,
      model: input.model,
      usage: emptyUsage(),
    };
  }

  const payload = (await res.json()) as OpenAiChatCompletionResponse;
  const recordedModel = payload.model?.trim() || input.model;
  const choice = payload.choices?.[0];
  const usage = openAiUsageToSessionUsage(recordedModel, payload.usage, {
    numTurns: 1,
    resultSubtype: 'success',
    stopReason: choice?.finish_reason ?? null,
  });
  const rawText = (choice?.message?.content ?? '').trim();

  const parsed = parseStrictJsonText(rawText);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, rawText, model: recordedModel, usage };
  }

  const validated = input.schema.safeParse(parsed.value);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
    return { ok: false, error: `Schema validation failed: ${issues}`, rawText, model: recordedModel, usage };
  }

  return { ok: true, data: validated.data, rawText, model: recordedModel, usage };
}

export interface OpenAiWebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface OpenAiWebSearchInput {
  query: string;
  maxResults?: number;
  model?: string;
  apiKey?: string | null;
  isOrganizationKey?: boolean;
  baseUrl?: string;
  fetch?: ProviderSessionInput['fetch'];
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Return a non-null reason string to strip a result URL or snippet before it reaches the caller. */
  isBlocked?: (url: string, text?: string) => string | null;
}

export interface OpenAiWebSearchOutput {
  ok: boolean;
  results: OpenAiWebSearchResultItem[];
  filteredCount: number;
  searchRequests: number;
  usage: SessionTokenUsage;
  error?: string;
}

function responsesUsageToSessionUsage(
  model: string,
  rawUsage: OpenAiResponsesUsagePayload | null | undefined,
  webSearchRequests: number,
): SessionTokenUsage {
  const totalInput = nonNegativeInt(rawUsage?.input_tokens);
  const cachedTokens = Math.min(totalInput, nonNegativeInt(rawUsage?.input_tokens_details?.cached_tokens));
  const cacheWriteTokens = Math.min(
    Math.max(0, totalInput - cachedTokens),
    nonNegativeInt(rawUsage?.input_tokens_details?.cache_write_tokens),
  );
  const inputTokens = Math.max(0, totalInput - cachedTokens - cacheWriteTokens);
  const outputTokens = nonNegativeInt(rawUsage?.output_tokens);

  const modelUsage: ModelTokenUsage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cachedTokens,
    cache_write_tokens: cacheWriteTokens,
    web_search_requests: nonNegativeInt(webSearchRequests),
  };

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cachedTokens,
    cache_write_tokens: cacheWriteTokens,
    model,
    by_model: { [model]: modelUsage },
    num_turns: 1,
    result_subtype: 'success',
  };
}

/**
 * Perform a bounded OpenAI Responses API `web_search` call using a fast search
 * scout model (default `gpt-6-luna`), returning structured primary-source URLs
 * and exact token + `web_search_requests` metering. Any URL or snippet flagged
 * by `isBlocked` is stripped before returning to the researcher session.
 */
export async function runOpenAiWebSearch(input: OpenAiWebSearchInput): Promise<OpenAiWebSearchOutput> {
  const apiKey = input.apiKey?.trim() || (input.isOrganizationKey ? null : resolveProviderEnvKey('openai'));
  if (!apiKey) {
    return {
      ok: false,
      results: [],
      filteredCount: 0,
      searchRequests: 0,
      usage: emptyUsage(),
      error: 'OPENAI_API_KEY is not configured for web_search',
    };
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  const endpoint = `${resolveOpenAiBaseUrl(input.baseUrl, Boolean(input.isOrganizationKey))}/responses`;
  const searchModel = input.model?.trim() || DEFAULT_OPENAI_SEARCH_MODEL;
  const maxResults = Math.min(10, Math.max(1, input.maxResults ?? 6));
  const timeoutMs = input.timeoutMs ?? DEFAULT_WEB_SEARCH_TIMEOUT_MS;

  const prompt = [
    `Search the live web for: ${input.query}`,
    `Return ONLY a JSON object with shape {"results":[{"title":"...","url":"https://...","snippet":"..."}]} containing up to ${maxResults} direct, authoritative primary-source URLs (government agencies, statistical bureaus, official PDFs/tables, research institutes) matching the query.`,
    'Include the exact direct URL and any verbatim headline figures/years visible in the search snippet. Do not invent URLs.',
  ].join('\n');

  const body: Record<string, unknown> = {
    model: searchModel,
    tools: [{ type: 'web_search' }],
    input: prompt,
    max_output_tokens: 1800,
    ...(supportsZeroTemperature(searchModel) ? {} : { reasoning: { effort: 'low' } }),
  };

  let res: Response;
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      endpoint,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
      input.signal,
    );
  } catch (err) {
    return {
      ok: false,
      results: [],
      filteredCount: 0,
      searchRequests: 0,
      usage: emptyUsage(),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!res.ok) {
    const rawErr = redactProviderSecret(await res.text().catch(() => ''), apiKey).slice(0, 500);
    const rejection = classifyProviderHttpError('openai', res.status, rawErr);
    if (rejection && input.isOrganizationKey) {
      throw orgKeyRejected(rejection, searchModel, emptyUsage(), 'openai');
    }
    return {
      ok: false,
      results: [],
      filteredCount: 0,
      searchRequests: 0,
      usage: emptyUsage(),
      error: `OpenAI web_search HTTP ${res.status}${rawErr ? `: ${rawErr}` : ''}`,
    };
  }

  const payload = (await res.json()) as OpenAiResponsesPayload;
  const recordedModel = payload.model?.trim() || searchModel;
  const outputItems = Array.isArray(payload.output) ? payload.output : [];
  const searchCalls = outputItems.filter((item) => item?.type === 'web_search_call').length;
  const searchRequests = Math.max(1, searchCalls);
  const usage = responsesUsageToSessionUsage(recordedModel, payload.usage, searchRequests);

  const candidates: OpenAiWebSearchResultItem[] = [];
  const seenUrls = new Set<string>();
  const addCandidate = (title: string, url: string, snippet: string) => {
    const cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) return;
    if (seenUrls.has(cleanUrl)) return;
    seenUrls.add(cleanUrl);
    candidates.push({
      title: title.trim() || cleanUrl,
      url: cleanUrl,
      snippet: snippet.trim().slice(0, 500),
    });
  };

  let rawText = typeof payload.output_text === 'string' ? payload.output_text : '';
  for (const item of outputItems) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (typeof part?.text === 'string' && !rawText) rawText = part.text;
      if (Array.isArray(part?.annotations)) {
        for (const ann of part.annotations) {
          if (ann?.type === 'url_citation' && typeof ann.url === 'string') {
            addCandidate(ann.title ?? '', ann.url, '');
          }
        }
      }
    }
  }

  if (rawText.trim()) {
    const parsed = parseStrictJsonText(rawText);
    if (parsed.ok && parsed.value && typeof parsed.value === 'object') {
      const arr = Array.isArray((parsed.value as { results?: unknown }).results)
        ? ((parsed.value as { results: unknown[] }).results)
        : Array.isArray(parsed.value)
          ? parsed.value
          : [];
      for (const entry of arr) {
        if (!entry || typeof entry !== 'object') continue;
        const obj = entry as Record<string, unknown>;
        if (typeof obj.url === 'string') {
          const existingIdx = candidates.findIndex((c) => c.url === obj.url);
          const item: OpenAiWebSearchResultItem = {
            title: typeof obj.title === 'string' ? obj.title : obj.url,
            url: obj.url,
            snippet: typeof obj.snippet === 'string' ? obj.snippet.slice(0, 500) : '',
          };
          if (existingIdx >= 0) {
            candidates[existingIdx] = item;
          } else {
            addCandidate(item.title, item.url, item.snippet);
          }
        }
      }
    }
  }

  let filteredCount = 0;
  const safeResults: OpenAiWebSearchResultItem[] = [];
  for (const item of candidates) {
    if (input.isBlocked) {
      const reason = input.isBlocked(item.url, `${item.title} ${item.snippet}`);
      if (reason) {
        filteredCount++;
        continue;
      }
    }
    safeResults.push(item);
    if (safeResults.length >= maxResults) break;
  }

  return {
    ok: true,
    results: safeResults,
    filteredCount,
    searchRequests,
    usage,
  };
}
