import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ASK_MODEL,
  RagServiceUnavailableError,
  generateGroundedAnswer,
  resolveAskConfig,
  resolveAskModel,
} from './rag-answer';

describe('resolveAskConfig', () => {
  it('honors ASK_PORTRAIT_PROVIDER and ASK_PORTRAIT_MODEL explicitly', () => {
    const cfg = resolveAskConfig({
      ASK_PORTRAIT_PROVIDER: 'openai',
      ASK_PORTRAIT_MODEL: 'gpt-4.1-mini',
      OPENAI_API_KEY: 'sk-openai',
      ANTHROPIC_API_KEY: 'sk-ant',
    });
    expect(cfg).toEqual({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: 'sk-openai' });
    expect(resolveAskModel({ ASK_PORTRAIT_MODEL: 'gemini-2.5-flash', GEMINI_API_KEY: 'AIza1' })).toBe(
      'gemini-2.5-flash',
    );
  });

  it('infers provider from ASK_PORTRAIT_MODEL when ASK_PORTRAIT_PROVIDER is unset', () => {
    expect(
      resolveAskConfig({
        ASK_PORTRAIT_MODEL: 'gemini-2.5-flash',
        GEMINI_API_KEY: 'AIzaTest',
        ANTHROPIC_API_KEY: 'sk-ant-test',
      }),
    ).toEqual({ provider: 'google', model: 'gemini-2.5-flash', apiKey: 'AIzaTest' });
  });

  it('falls back to the first configured key among Anthropic, OpenAI, and Google Gemini', () => {
    expect(resolveAskConfig({ OPENAI_API_KEY: 'sk-only-openai' })).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      apiKey: 'sk-only-openai',
    });
    expect(resolveAskConfig({ GEMINI_API_KEY: 'AIza-only-gemini' })).toEqual({
      provider: 'google',
      model: 'gemini-2.5-flash',
      apiKey: 'AIza-only-gemini',
    });
    expect(resolveAskConfig({ ANTHROPIC_API_KEY: 'sk-ant-only' })).toEqual({
      provider: 'anthropic',
      model: DEFAULT_ASK_MODEL,
      apiKey: 'sk-ant-only',
    });
  });
});

describe('generateGroundedAnswer', () => {
  it('throws 503 RagServiceUnavailableError without leaking env vars when no key is configured', async () => {
    const err = await generateGroundedAnswer({
      system: 'sys',
      user: 'usr',
      env: {},
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RagServiceUnavailableError);
    expect((err as RagServiceUnavailableError).status).toBe(503);
    expect((err as Error).message).not.toMatch(/API_KEY|OPENAI|GEMINI|ANTHROPIC/);
  });

  it('routes grounded Q&A through OpenAI Chat Completions preserving citations', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer sk-openai-test');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Rent burden is 42% [1].' } }],
        }),
        { status: 200 },
      );
    });

    const answer = await generateGroundedAnswer({
      system: 'Cite only provided sources.',
      user: 'What is rent burden?',
      env: { OPENAI_API_KEY: 'sk-openai-test' },
      fetch: fetchMock,
    });
    expect(answer).toBe('Rent burden is 42% [1].');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('routes grounded Q&A through Google Gemini using x-goog-api-key header', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      );
      const headers = new Headers(init?.headers);
      expect(headers.get('x-goog-api-key')).toBe('AIzaTestKey');
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Air quality index is 38 [1].' }] } }],
        }),
        { status: 200 },
      );
    });

    const answer = await generateGroundedAnswer({
      system: 'Cite only provided sources.',
      user: 'How is air quality?',
      env: { GEMINI_API_KEY: 'AIzaTestKey' },
      fetch: fetchMock,
    });
    expect(answer).toBe('Air quality index is 38 [1].');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
