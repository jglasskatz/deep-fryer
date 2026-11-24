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
const DEFAULT_OPENAI_TIMEOUT_MS = 60_000;
const DEFAULT_STRUCTURED_MAX_TOKENS = 1024;
const DEFAULT_STRUCTURED_TIMEOUT_MS = 20_000;

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
  } | null;
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

/** OpenAI reasoning models reject explicit `temperature: 0` on chat/completions. */
function supportsZeroTemperature(model: string): boolean {
  const lower = model.trim().toLowerCase();
  return !/^(?:o[134](?:$|-)|gpt-5(?:$|-))/.test(lower);
}

/** Map one OpenAI Chat Completions `usage` object into `SessionTokenUsage`. */
export function openAiUsageToSessionUsage(
  model: string,
  rawUsage: OpenAiUsagePayload | null | undefined,
  options: { stopReason?: string | null; resultSubtype?: string; terminalReason?: string; numTurns?: number } = {},
): SessionTokenUsage {
  const totalPrompt = nonNegativeInt(rawUsage?.prompt_tokens);
  const cachedTokens = Math.min(totalPrompt, nonNegativeInt(rawUsage?.prompt_tokens_details?.cached_tokens));
  const inputTokens = Math.max(0, totalPrompt - cachedTokens);
  const outputTokens = nonNegativeInt(rawUsage?.completion_tokens);

  const modelUsage: ModelTokenUsage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cachedTokens,
    cache_write_tokens: 0,
    web_search_requests: 0,
  };

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cachedTokens,
    cache_write_tokens: 0,
    model,
    by_model: { [model]: modelUsage },
    num_turns: options.numTurns ?? 1,
    ...(options.resultSubtype ? { result_subtype: options.resultSubtype } : {}),
    ...(options.terminalReason ? { terminal_reason: options.terminalReason } : {}),
    ...(options.stopReason !== undefined ? { stop_reason: options.stopReason } : {}),
  };
}

function resolveOpenAiEndpoint(baseUrl: string | undefined, isOrganizationKey: boolean): string {
  const rawBase = isOrganizationKey
    ? OPENAI_FIRST_PARTY_BASE_URL
    : baseUrl?.trim() || process.env.OPENAI_BASE_URL?.trim() || OPENAI_FIRST_PARTY_BASE_URL;
  return `${rawBase.replace(/\/+$/, '')}/chat/completions`;
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

/**
 * Execute a bounded multi-turn OpenAI Chat Completions tool-calling session.
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
  const maxTokens = input.maxTokens ?? DEFAULT_STRUCTURED_MAX_TOKENS;
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
