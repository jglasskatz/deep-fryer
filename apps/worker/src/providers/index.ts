import {
  providerForModel,
  type ResearchProvider,
} from '@deep-fryer/core';
import {
  createMessagesClient,
  runStructuredMessage,
  type MessagesApiClient,
} from '../messages.js';
import { runGoogleSession, runGoogleStructuredMessage } from './google.js';
import { runOpenAiSession, runOpenAiStructuredMessage } from './openai.js';
import type {
  ProviderSessionInput,
  ProviderSessionOutput,
  ProviderStructuredMessageInput,
  ProviderStructuredMessageResult,
} from './types.js';

export * from './types.js';
export * from './openai.js';
export * from './google.js';

/**
 * Resolve which provider handles `model`, honoring an explicit provider hint
 * when given or inferring from the model ID (`claude-*` -> anthropic,
 * `gpt-*`/`o1*`/`o3*`/`o4*`/`chatgpt-*` -> openai, `gemini-*` -> google).
 */
export function resolveProviderForSession(
  model: string,
  explicitProvider?: ResearchProvider,
): ResearchProvider {
  return explicitProvider ?? providerForModel(model, 'anthropic');
}

/**
 * Route a non-Anthropic provider session (`openai` or `google`) to its native
 * tool-calling adapter. Anthropic sessions stay on the Claude Agent SDK path
 * inside `apps/worker/src/session.ts` (or via an injected `anthropicRunner`).
 */
export async function runProviderSession(
  input: ProviderSessionInput & {
    anthropicRunner?: (input: ProviderSessionInput) => Promise<ProviderSessionOutput>;
  },
): Promise<ProviderSessionOutput> {
  const provider = resolveProviderForSession(input.model, input.provider);
  if (provider === 'openai') return runOpenAiSession(input);
  if (provider === 'google') return runGoogleSession(input);
  if (input.anthropicRunner) return input.anthropicRunner(input);
  throw new Error('Anthropic sessions must be executed via runSession (Claude Agent SDK).');
}

/**
 * Route a single-shot structured JSON call (e.g. advisory finding triage or
 * structured verification) to Anthropic, OpenAI, or Google Gemini based on
 * `providerForModel(model, explicitProvider)`.
 */
export async function runProviderStructuredMessage<T>(
  input: ProviderStructuredMessageInput<T> & {
    /** Optional injected Anthropic Messages client (tests or shared worker client). */
    anthropicClient?: MessagesApiClient;
  },
): Promise<ProviderStructuredMessageResult<T>> {
  const provider = resolveProviderForSession(input.model, input.provider);
  if (provider === 'openai') return runOpenAiStructuredMessage(input);
  if (provider === 'google') return runGoogleStructuredMessage(input);

  const client =
    input.anthropicClient ??
    createMessagesClient({
      apiKey: input.apiKey,
      timeoutMs: input.timeoutMs,
    });
  return runStructuredMessage({
    client,
    model: input.model,
    system: input.system,
    user: input.user,
    schema: input.schema,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
}
