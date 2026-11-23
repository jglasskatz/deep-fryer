import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  PROVIDER_META,
  configuredDeploymentProviders,
  parseResearchProvider,
  providerForModel,
  resolveProviderEnvKey,
  type ResearchProvider,
} from '@deep-fryer/core';

/**
 * Model-agnostic grounded Q&A adapter (`ask_portrait`).
 *
 * Supports Anthropic, OpenAI, and Google Gemini using zero extra npm
 * dependencies (`@anthropic-ai/sdk` for Anthropic, native `fetch` for OpenAI
 * and Google Gemini). Picks the provider from:
 *   1. `ASK_PORTRAIT_PROVIDER` (explicit override),
 *   2. `providerForModel(ASK_PORTRAIT_MODEL)` when `ASK_PORTRAIT_MODEL` is set,
 *   3. Otherwise, the first configured key among `ANTHROPIC_API_KEY`,
 *      `OPENAI_API_KEY`, and `GEMINI_API_KEY` / `GOOGLE_API_KEY`.
 *
 * Never reveals secret values or env var names in user-facing error messages.
 */

export const DEFAULT_ASK_MODEL = 'claude-haiku-4-5-20251001';
const ASK_TIMEOUT_MS = 25_000;
const ASK_MAX_TOKENS = 700;

export class RagServiceUnavailableError extends Error {
  readonly status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = 'RagServiceUnavailableError';
    this.status = status;
  }
}

export interface AskProviderConfig {
  provider: ResearchProvider;
  model: string;
  apiKey: string | null;
}

/**
 * Pure: resolve provider, model, and API key for `ask_portrait` from `env`.
 */
export function resolveAskConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AskProviderConfig {
  const explicitProvider = parseResearchProvider(env.ASK_PORTRAIT_PROVIDER);
  const explicitModel = env.ASK_PORTRAIT_MODEL?.trim() || undefined;

  let provider: ResearchProvider;
  if (explicitProvider) {
    provider = explicitProvider;
  } else if (explicitModel) {
    provider = providerForModel(explicitModel, configuredDeploymentProviders(env)[0] ?? 'anthropic');
  } else {
    provider = configuredDeploymentProviders(env)[0] ?? 'anthropic';
  }

  let model: string;
  if (explicitModel) {
    model = explicitModel;
  } else if (provider === 'anthropic') {
    model =
      env.ANTHROPIC_SMALL_FAST_MODEL?.trim() ||
      env.ANTHROPIC_MODEL?.trim() ||
      DEFAULT_ASK_MODEL;
  } else {
    model = PROVIDER_META[provider].defaultFastModel;
  }

  const apiKey = resolveProviderEnvKey(provider, env);
  return { provider, model, apiKey };
}

export function resolveAskModel(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return resolveAskConfig(env).model;
}

function supportsZeroTemperature(model: string): boolean {
  const lower = model.trim().toLowerCase();
  return !/^(?:o[134](?:$|-)|gpt-5(?:$|-))/.test(lower);
}

async function generateOpenAiAnswer(input: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  baseUrl?: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const base = (input.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const res = await input.fetchImpl(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      max_completion_tokens: ASK_MAX_TOKENS,
      ...(supportsZeroTemperature(input.model) ? { temperature: 0 } : {}),
    }),
    signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.warn(`[ask-portrait] OpenAI API error HTTP ${res.status}`);
    throw new RagServiceUnavailableError(
      'The Q&A service could not answer right now. Please try again in a moment.',
      503,
    );
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = (body.choices?.[0]?.message?.content ?? '').trim();
  if (!text) {
    throw new RagServiceUnavailableError('The assistant returned an empty response. Please try again.', 502);
  }
  return text;
}

async function generateGoogleAnswer(input: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  baseUrl?: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const base = (input.baseUrl?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const modelId = input.model.trim().replace(/^models\//, '');
  const res = await input.fetchImpl(`${base}/models/${encodeURIComponent(modelId)}:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': input.apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: 'user', parts: [{ text: input.user }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: ASK_MAX_TOKENS,
      },
    }),
    signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.warn(`[ask-portrait] Google Gemini API error HTTP ${res.status}`);
    throw new RagServiceUnavailableError(
      'The Q&A service could not answer right now. Please try again in a moment.',
      503,
    );
  }
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('\n')
    .trim();
  if (!text) {
    throw new RagServiceUnavailableError('The assistant returned an empty response. Please try again.', 502);
  }
  return text;
}

export async function generateGroundedAnswer(input: {
  system: string;
  user: string;
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
}): Promise<string> {
  const env = input.env ?? process.env;
  const { provider, model, apiKey } = resolveAskConfig(env);
  if (!apiKey) {
    throw new RagServiceUnavailableError(
      'Ask this portrait is not configured on this server yet. Please try again later.',
      503,
    );
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;

  try {
    if (provider === 'openai') {
      return await generateOpenAiAnswer({
        apiKey,
        model,
        system: input.system,
        user: input.user,
        baseUrl: env.OPENAI_BASE_URL,
        fetchImpl,
      });
    }
    if (provider === 'google') {
      return await generateGoogleAnswer({
        apiKey,
        model,
        system: input.system,
        user: input.user,
        baseUrl: env.GEMINI_BASE_URL,
        fetchImpl,
      });
    }

    const client = new Anthropic({
      apiKey,
      authToken: null,
      maxRetries: 1,
      timeout: ASK_TIMEOUT_MS,
      ...(input.fetch ? { fetch: input.fetch } : {}),
    });

    const response = await client.messages.create({
      model,
      max_tokens: ASK_MAX_TOKENS,
      temperature: 0,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!text) {
      throw new RagServiceUnavailableError('The assistant returned an empty response. Please try again.', 502);
    }
    return text;
  } catch (err) {
    if (err instanceof RagServiceUnavailableError) throw err;
    if (err instanceof Anthropic.APIError) {
      console.warn(`[ask-portrait] Anthropic API error ${err.status ?? 'no-status'} (${err.type ?? 'unknown'})`);
      throw new RagServiceUnavailableError(
        'The Q&A service could not answer right now. Please try again in a moment.',
        503,
      );
    }
    console.error(`[ask-portrait] unexpected error: ${err instanceof Error ? err.name : typeof err}`);
    throw new RagServiceUnavailableError('The Q&A service is temporarily unavailable.', 503);
  }
}
