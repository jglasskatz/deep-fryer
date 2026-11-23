import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic Messages API adapter for grounded portrait Q&A.
 *
 * Uses `ANTHROPIC_API_KEY` and defaults to `ANTHROPIC_SMALL_FAST_MODEL`
 * (`claude-haiku-4-5-20251001`) or `ANTHROPIC_MODEL` for fast, low-cost,
 * strictly grounded synthesis. Never reveals secret values or env var names
 * in user-facing error messages.
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

export function resolveAskModel(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.ASK_PORTRAIT_MODEL?.trim() ||
    env.ANTHROPIC_SMALL_FAST_MODEL?.trim() ||
    env.ANTHROPIC_MODEL?.trim() ||
    DEFAULT_ASK_MODEL
  );
}

export async function generateGroundedAnswer(input: {
  system: string;
  user: string;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new RagServiceUnavailableError(
      'Ask this portrait is not configured on this server yet. Please try again later.',
      503,
    );
  }

  const client = new Anthropic({
    apiKey,
    authToken: null,
    maxRetries: 1,
    timeout: ASK_TIMEOUT_MS,
  });

  try {
    const response = await client.messages.create({
      model: resolveAskModel(),
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
