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
  sanitizeSchemaForGemini,
  zodToJsonSchema,
  type ProviderSessionInput,
  type ProviderSessionOutput,
  type ProviderStructuredMessageInput,
  type ProviderStructuredMessageResult,
} from './types.js';

/**
 * Native-fetch Google Gemini (`generateContent`) runtime adapter.
 *
 * Supports bounded multi-turn function calling (`runGoogleSession`) and
 * single-shot JSON-schema structured outputs (`runGoogleStructuredMessage`)
 * with zero extra npm dependencies, exact `usageMetadata` -> `SessionTokenUsage`
 * metering (including cached and thinking tokens), and `OrgKeyUnavailableError`
 * classification. Sends the API key via `x-goog-api-key` header, never in URLs.
 */

export const GOOGLE_FIRST_PARTY_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GOOGLE_TIMEOUT_MS = 60_000;
const DEFAULT_STRUCTURED_MAX_TOKENS = 1024;
const DEFAULT_STRUCTURED_TIMEOUT_MS = 20_000;

interface GeminiFunctionCallPart {
  functionCall: {
    name: string;
    args?: Record<string, unknown>;
  };
}

interface GeminiFunctionResponsePart {
  functionResponse: {
    name: string;
    response: Record<string, unknown>;
  };
}

interface GeminiTextPart {
  text: string;
}

type GeminiPart = GeminiTextPart | GeminiFunctionCallPart | GeminiFunctionResponsePart | Record<string, unknown>;

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiUsageMetadata {
  promptTokenCount?: number | null;
  candidatesTokenCount?: number | null;
  cachedContentTokenCount?: number | null;
  thoughtsTokenCount?: number | null;
  totalTokenCount?: number | null;
}

interface GeminiGenerateContentResponse {
  modelVersion?: string;
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: GeminiPart[];
    };
    finishReason?: string | null;
  }>;
  usageMetadata?: GeminiUsageMetadata | null;
}

/** Map one Gemini `usageMetadata` object into `SessionTokenUsage`. */
export function googleUsageToSessionUsage(
  model: string,
  meta: GeminiUsageMetadata | null | undefined,
  options: { stopReason?: string | null; resultSubtype?: string; terminalReason?: string; numTurns?: number } = {},
): SessionTokenUsage {
  const totalPrompt = nonNegativeInt(meta?.promptTokenCount);
  const cachedTokens = Math.min(totalPrompt, nonNegativeInt(meta?.cachedContentTokenCount));
  const inputTokens = Math.max(0, totalPrompt - cachedTokens);
  // Gemini bills thinking tokens at the output token rate.
  const outputTokens = nonNegativeInt(meta?.candidatesTokenCount) + nonNegativeInt(meta?.thoughtsTokenCount);

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

function normalizeGeminiModel(model: string): string {
  return model.trim().replace(/^models\//, '');
}

function resolveGoogleEndpoint(
  model: string,
  baseUrl: string | undefined,
  isOrganizationKey: boolean,
): string {
  const rawBase = isOrganizationKey
    ? GOOGLE_FIRST_PARTY_BASE_URL
    : baseUrl?.trim() || process.env.GEMINI_BASE_URL?.trim() || GOOGLE_FIRST_PARTY_BASE_URL;
  return `${rawBase.replace(/\/+$/, '')}/models/${encodeURIComponent(normalizeGeminiModel(model))}:generateContent`;
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
    controller.abort(new Error(`Google Gemini request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const onAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timer);
      throw new Error('Google Gemini request aborted');
    }
    callerSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new Error(`Google Gemini request timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', onAbort);
  }
}

function extractGeminiText(parts: readonly GeminiPart[]): string {
  return parts
    .filter((p): p is GeminiTextPart => typeof (p as GeminiTextPart).text === 'string')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

function extractGeminiFunctionCalls(parts: readonly GeminiPart[]): GeminiFunctionCallPart['functionCall'][] {
  const calls: GeminiFunctionCallPart['functionCall'][] = [];
  for (const part of parts) {
    const fc = (part as GeminiFunctionCallPart).functionCall;
    if (fc && typeof fc.name === 'string' && fc.name) {
      calls.push({ name: fc.name, args: fc.args ?? {} });
    }
  }
  return calls;
}

function parseToolResponseObject(output: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(output);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { text: output };
  }
}

/**
 * Execute a bounded multi-turn Google Gemini (`generateContent`) tool-calling session.
 */
export async function runGoogleSession(input: ProviderSessionInput): Promise<ProviderSessionOutput> {
  const apiKey = input.apiKey?.trim() || (input.isOrganizationKey ? null : resolveProviderEnvKey('google'));
  if (!apiKey) {
    return {
      resultText: '',
      transcriptLines: [JSON.stringify({ type: 'session_error', message: 'GEMINI_API_KEY is not configured' })],
      usage: emptyUsage(),
      succeeded: false,
      apiError: 'authentication_failed',
      apiErrorText: 'GEMINI_API_KEY is not configured',
    };
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  const endpoint = resolveGoogleEndpoint(input.model, input.baseUrl, Boolean(input.isOrganizationKey));
  const timeoutMs = input.timeoutMs ?? DEFAULT_GOOGLE_TIMEOUT_MS;
  const maxTurns = Math.max(1, input.maxTurns);
  const declarations =
    input.tools && input.tools.size > 0 ? input.tools.toGeminiFunctionDeclarations() : [];

  const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: input.prompt }] }];
  const transcriptLines: string[] = [
    JSON.stringify({ type: 'system', subtype: 'init', provider: 'google', model: input.model }),
  ];

  let totalUsage = emptyUsage();
  let lastText = '';
  let lastStopReason: string | null = null;

  for (let turn = 1; turn <= maxTurns; turn++) {
    const generationConfig: Record<string, unknown> = { temperature: 0 };
    if (input.responseJsonSchema && declarations.length === 0) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = sanitizeSchemaForGemini(input.responseJsonSchema.schema);
    }

    const body: Record<string, unknown> = {
      ...(input.systemPrompt?.trim()
        ? { systemInstruction: { parts: [{ text: input.systemPrompt }] } }
        : {}),
      contents,
      ...(declarations.length > 0 ? { tools: [{ functionDeclarations: declarations }] } : {}),
      generationConfig,
    };

    const res = await fetchWithTimeout(
      fetchImpl,
      endpoint,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
      input.signal,
    );

    if (!res.ok) {
      const rawErr = redactProviderSecret(await res.text().catch(() => ''), apiKey).slice(0, 1000);
      const rejection = classifyProviderHttpError('google', res.status, rawErr);
      transcriptLines.push(
        JSON.stringify({ type: 'api_error', provider: 'google', status: res.status, error: rejection ?? 'http_error', text: rawErr }),
      );
      if (rejection && input.isOrganizationKey) {
        throw orgKeyRejected(rejection, input.model, totalUsage, 'google');
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

    const payload = (await res.json()) as GeminiGenerateContentResponse;
    const recordedModel = normalizeGeminiModel(payload.modelVersion?.trim() || input.model);
    const candidate = payload.candidates?.[0];
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    lastStopReason = candidate?.finishReason ?? null;

    const turnUsage = googleUsageToSessionUsage(recordedModel, payload.usageMetadata, {
      numTurns: 1,
      stopReason: lastStopReason,
    });
    totalUsage = mergeUsage(totalUsage, turnUsage);

    const textContent = extractGeminiText(parts);
    const functionCalls = extractGeminiFunctionCalls(parts);
    if (textContent) lastText = textContent;

    transcriptLines.push(
      redactProviderSecret(
        JSON.stringify({
          type: 'assistant',
          provider: 'google',
          turn,
          model: recordedModel,
          content: textContent,
          function_calls: functionCalls,
          finish_reason: lastStopReason,
        }),
        apiKey,
      ),
    );

    contents.push({ role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] });

    if (functionCalls.length === 0) {
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

    const responseParts: Array<Record<string, unknown>> = [];
    for (const call of functionCalls) {
      const executed = input.tools
        ? await input.tools.execute(call.name, call.args ?? {})
        : { output: JSON.stringify({ error: `No tools registered in this session (called ${call.name}).` }), isError: true };

      transcriptLines.push(
        redactProviderSecret(
          JSON.stringify({
            type: 'tool_result',
            provider: 'google',
            name: call.name,
            is_error: executed.isError,
            output: executed.output.slice(0, 4000),
          }),
          apiKey,
        ),
      );

      responseParts.push({
        functionResponse: {
          name: call.name,
          response: parseToolResponseObject(executed.output),
        },
      });
      if ('images' in executed && Array.isArray(executed.images)) {
        for (const img of executed.images) {
          responseParts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.base64,
            },
          });
        }
      }
    }

    contents.push({ role: 'user', parts: responseParts as GeminiPart[] });
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
 * Single-shot structured JSON call on Google Gemini (`generateContent` with
 * `responseMimeType: 'application/json'` and `responseSchema`), validated
 * against a strict Zod schema with exact `SessionTokenUsage` accounting.
 */
export async function runGoogleStructuredMessage<T>(
  input: ProviderStructuredMessageInput<T>,
): Promise<ProviderStructuredMessageResult<T>> {
  const apiKey = input.apiKey?.trim() || (input.isOrganizationKey ? null : resolveProviderEnvKey('google'));
  if (!apiKey) {
    return {
      ok: false,
      error: 'Google Gemini API key is not configured for structured message calls',
      model: input.model,
      usage: emptyUsage(),
    };
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  const endpoint = resolveGoogleEndpoint(input.model, input.baseUrl, Boolean(input.isOrganizationKey));
  const timeoutMs = input.timeoutMs ?? DEFAULT_STRUCTURED_TIMEOUT_MS;
  const maxTokens = input.maxTokens ?? DEFAULT_STRUCTURED_MAX_TOKENS;
  const responseSchema = sanitizeSchemaForGemini(zodToJsonSchema(input.schema));

  let res: Response;
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      endpoint,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: 'user', parts: [{ text: input.user }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: maxTokens,
            responseMimeType: 'application/json',
            responseSchema,
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
    const rejection = classifyProviderHttpError('google', res.status, rawErr);
    if (rejection && input.isOrganizationKey) {
      throw orgKeyRejected(rejection, input.model, emptyUsage(), 'google');
    }
    return {
      ok: false,
      error: `Google Gemini API error HTTP ${res.status}${rawErr ? `: ${rawErr}` : ''}`,
      model: input.model,
      usage: emptyUsage(),
    };
  }

  const payload = (await res.json()) as GeminiGenerateContentResponse;
  const recordedModel = normalizeGeminiModel(payload.modelVersion?.trim() || input.model);
  const candidate = payload.candidates?.[0];
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const usage = googleUsageToSessionUsage(recordedModel, payload.usageMetadata, {
    numTurns: 1,
    resultSubtype: 'success',
    stopReason: candidate?.finishReason ?? null,
  });
  const rawText = extractGeminiText(parts);

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
