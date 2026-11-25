import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { priceSessionUsage } from '@deep-fryer/core';
import { createCivicDataTools } from '@deep-fryer/civic-data';
import {
  OrgKeyUnavailableError,
  classifyProviderHttpError,
  orgKeyRejected,
} from '../org-key.js';
import { runFindingTriage } from '../messages.js';
import {
  executeComputeDerivedIndicator,
  runSession,
  runSessionWithRetry,
  validateAndScoreSubmittedFindings,
  type VerifiedDerivation,
} from '../session.js';
import { resolveRunProviders } from '../tasks/research-apply.js';
import {
  ToolExecutor,
  runGoogleSession,
  runGoogleStructuredMessage,
  runOpenAiSession,
  runOpenAiStructuredMessage,
  runOpenAiWebSearch,
  runProviderSession,
  runProviderStructuredMessage,
  sanitizeSchemaForGemini,
  supportsZeroTemperature,
  usesResponsesApi,
  zodToJsonSchema,
} from './index.js';

describe('ToolExecutor & schema conversion', () => {
  it('converts Zod schemas into OpenAI tools and Gemini functionDeclarations and executes safely', async () => {
    const schema = z.object({
      url: z.string().describe('Target URL'),
      limit: z.number().int().optional().describe('Optional cap'),
      note: z.string().nullable().optional(),
    });
    const executor = new ToolExecutor([
      {
        name: 'fetch_table',
        description: 'Fetch a structured table',
        parameters: zodToJsonSchema(schema),
        execute: async (args) => JSON.stringify({ echoed: args }),
      },
      {
        name: 'boom_tool',
        description: 'Throws on execution',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          throw new Error('upstream timeout');
        },
      },
    ]);

    const openAiTools = executor.toOpenAiTools();
    expect(openAiTools).toHaveLength(2);
    expect(openAiTools[0]!.type).toBe('function');
    expect(openAiTools[0]!.function.name).toBe('fetch_table');
    expect(openAiTools[0]!.function.parameters).not.toHaveProperty('$schema');

    const geminiDecls = executor.toGeminiFunctionDeclarations();
    expect(geminiDecls[0]!.name).toBe('fetch_table');
    expect(geminiDecls[0]!.parameters).not.toHaveProperty('additionalProperties');
    expect(geminiDecls[0]!.parameters).not.toHaveProperty('$schema');
    const noteProp = (geminiDecls[0]!.parameters.properties as Record<string, Record<string, unknown>>).note;
    expect(noteProp).toMatchObject({ type: 'string', nullable: true });

    expect(await executor.execute('fetch_table', '{"url":"https://example.gov","limit":10}')).toEqual({
      output: JSON.stringify({ echoed: { url: 'https://example.gov', limit: 10 } }),
      isError: false,
    });
    expect((await executor.execute('fetch_table', '{bad json')).isError).toBe(true);
    expect((await executor.execute('missing_tool', {})).isError).toBe(true);
    const failed = await executor.execute('boom_tool', {});
    expect(failed.isError).toBe(true);
    expect(failed.output).toContain('upstream timeout');
  });

  it('sanitizes complex JSON schemas for Gemini', () => {
    const cleaned = sanitizeSchemaForGemini({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['pass', 'fail'] },
        val: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      },
      required: ['status', 'missing_field'],
    });
    expect(cleaned).not.toHaveProperty('$schema');
    expect(cleaned).not.toHaveProperty('additionalProperties');
    expect(cleaned.required).toEqual(['status']);
    expect((cleaned.properties as Record<string, unknown>).val).toEqual({ type: 'number', nullable: true });
  });
});

describe('OpenAI provider adapter', () => {
  it('executes a multi-turn tool-calling loop, meters cached tokens accurately, and returns final text', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    let callNum = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      callNum++;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      requests.push({ url: String(url), body });
      if (callNum === 1) {
        return new Response(
          JSON.stringify({
            model: 'gpt-4.1',
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'lookup_metric', arguments: JSON.stringify({ slug: 'rent-burden' }) },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 200 } },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          model: 'gpt-4.1',
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: '{"value":42}' },
            },
          ],
          usage: { prompt_tokens: 1500, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 500 } },
        }),
        { status: 200 },
      );
    });

    const executor = new ToolExecutor([
      {
        name: 'lookup_metric',
        description: 'Look up a civic metric',
        parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
        execute: async (args) => JSON.stringify({ slug: args.slug, value: 42 }),
      },
    ]);

    const res = await runOpenAiSession({
      model: 'gpt-4.1',
      prompt: 'Find rent burden.',
      apiKey: 'sk-test-openai-key',
      isOrganizationKey: true,
      baseUrl: 'https://custom-gateway.example.net/v1',
      maxTurns: 5,
      tools: executor,
      fetch: fetchMock,
    });

    expect(res.succeeded).toBe(true);
    expect(res.resultText).toBe('{"value":42}');
    // Organization keys are always pinned to the first-party API host, never custom gateways.
    expect(requests[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(requests).toHaveLength(2);
    // Turn 1: 800 uncached + 200 cached; Turn 2: 1000 uncached + 500 cached -> 1800 input, 700 cache_read, 130 output.
    expect(res.usage.input_tokens).toBe(1800);
    expect(res.usage.cache_read_tokens).toBe(700);
    expect(res.usage.output_tokens).toBe(130);
    expect(res.usage.num_turns).toBe(2);
    expect(res.usage.model).toBe('gpt-4.1');
    const priced = priceSessionUsage(res.usage);
    expect(priced.unpriced).toEqual([]);
    expect(priced.dollars).toBeGreaterThan(0);
    // Never leak API key into transcript.
    expect(res.transcriptLines.join('\n')).not.toContain('sk-test-openai-key');
  });

  it('stops cleanly on maxTurns exhaustion and throws OrgKeyUnavailableError on 401/429 quota for org keys', async () => {
    const loopFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: 'gpt-5-mini',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'c1', type: 'function', function: { name: 'noop', arguments: '{}' } }],
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
        { status: 200 },
      ),
    );
    const maxRes = await runOpenAiSession({
      model: 'gpt-5-mini',
      prompt: 'loop',
      apiKey: 'sk-test',
      maxTurns: 2,
      tools: new ToolExecutor([
        { name: 'noop', description: 'noop', parameters: { type: 'object', properties: {} }, execute: async () => '{}' },
      ]),
      fetch: loopFetch,
    });
    expect(maxRes.succeeded).toBe(false);
    expect(maxRes.usage.result_subtype).toBe('error_max_turns');
    expect(loopFetch).toHaveBeenCalledTimes(2);

    const quotaFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }),
          { status: 429 },
        ),
    );
    const err = await runOpenAiSession({
      model: 'gpt-5',
      prompt: 'hi',
      apiKey: 'sk-org-key',
      isOrganizationKey: true,
      maxTurns: 3,
      fetch: quotaFetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgKeyUnavailableError);
    expect((err as OrgKeyUnavailableError).provider).toBe('openai');
    expect((err as OrgKeyUnavailableError).rejection).toBe('billing_error');
  });

  it('runs structured JSON-schema messages with Zod validation', async () => {
    const schema = z.object({ verdict: z.enum(['pass', 'fail']), score: z.number() });
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { response_format?: { type?: string } };
      expect(body.response_format?.type).toBe('json_schema');
      return new Response(
        JSON.stringify({
          model: 'gpt-4.1-mini',
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ verdict: 'pass', score: 95 }) } }],
          usage: { prompt_tokens: 200, completion_tokens: 20 },
        }),
        { status: 200 },
      );
    });

    const out = await runOpenAiStructuredMessage({
      model: 'gpt-4.1-mini',
      system: 'Return JSON',
      user: 'Judge this',
      schema,
      apiKey: 'sk-openai-test',
      fetch: fetchMock,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data).toEqual({ verdict: 'pass', score: 95 });
      expect(out.usage.by_model?.['gpt-4.1-mini']?.input_tokens).toBe(200);
    }
  });
});

describe('Google Gemini provider adapter', () => {
  it('executes a multi-turn functionCall/functionResponse loop with x-goog-api-key header and exact usageMetadata', async () => {
    const calls: Array<{ url: string; headerKey: string | null }> = [];
    let turn = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      turn++;
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), headerKey: headers.get('x-goog-api-key') });
      if (turn === 1) {
        return new Response(
          JSON.stringify({
            modelVersion: 'gemini-2.5-pro',
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  role: 'model',
                  parts: [{ functionCall: { name: 'get_stat', args: { area: 'Santa Cruz' } } }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 1200,
              cachedContentTokenCount: 300,
              candidatesTokenCount: 40,
              thoughtsTokenCount: 60,
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          modelVersion: 'gemini-2.5-pro',
          candidates: [
            {
              finishReason: 'STOP',
              content: { role: 'model', parts: [{ text: '[{"indicator_slug":"rent","value":38}]' }] },
            },
          ],
          usageMetadata: {
            promptTokenCount: 1600,
            cachedContentTokenCount: 400,
            candidatesTokenCount: 70,
            thoughtsTokenCount: 30,
          },
        }),
        { status: 200 },
      );
    });

    const executor = new ToolExecutor([
      {
        name: 'get_stat',
        description: 'Get local stat',
        parameters: { type: 'object', properties: { area: { type: 'string' } }, required: ['area'] },
        execute: async (args) => JSON.stringify({ area: args.area, value: 38 }),
      },
    ]);

    const res = await runGoogleSession({
      model: 'gemini-2.5-pro',
      prompt: 'Check Santa Cruz rent.',
      apiKey: 'AIzaTestSecretKey',
      isOrganizationKey: true,
      maxTurns: 4,
      tools: executor,
      fetch: fetchMock,
    });

    expect(res.succeeded).toBe(true);
    expect(res.resultText).toBe('[{"indicator_slug":"rent","value":38}]');
    expect(calls[0]!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    );
    expect(calls[0]!.url).not.toContain('AIzaTestSecretKey');
    expect(calls[0]!.headerKey).toBe('AIzaTestSecretKey');
    // Turn 1: 900 in + 300 cached, 100 out; Turn 2: 1200 in + 400 cached, 100 out
    expect(res.usage.input_tokens).toBe(2100);
    expect(res.usage.cache_read_tokens).toBe(700);
    expect(res.usage.output_tokens).toBe(200);
    expect(res.usage.num_turns).toBe(2);
    expect(priceSessionUsage(res.usage).unpriced).toEqual([]);
  });

  it('runs Gemini structured JSON outputs and classifies invalid key errors', async () => {
    const schema = z.object({ supported: z.boolean(), note: z.string() });
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        generationConfig?: { responseMimeType?: string; responseSchema?: Record<string, unknown> };
      };
      expect(body.generationConfig?.responseMimeType).toBe('application/json');
      expect(body.generationConfig?.responseSchema).toBeDefined();
      return new Response(
        JSON.stringify({
          modelVersion: 'gemini-2.5-flash',
          candidates: [
            {
              finishReason: 'STOP',
              content: { role: 'model', parts: [{ text: '{"supported":true,"note":"Matches table 3"}' }] },
            },
          ],
          usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 25 },
        }),
        { status: 200 },
      );
    });

    const out = await runGoogleStructuredMessage({
      model: 'gemini-2.5-flash',
      system: 'Return JSON',
      user: 'Check exhibit',
      schema,
      apiKey: 'AIzaKey',
      fetch: fetchMock,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data).toEqual({ supported: true, note: 'Matches table 3' });
      expect(out.usage.input_tokens).toBe(300);
      expect(out.usage.output_tokens).toBe(25);
    }

    const badKeyFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'API key not valid.' } }),
          { status: 400 },
        ),
    );
    const err = await runGoogleSession({
      model: 'gemini-2.5-pro',
      prompt: 'hi',
      apiKey: 'AIzaBadKey',
      isOrganizationKey: true,
      maxTurns: 2,
      fetch: badKeyFetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgKeyUnavailableError);
    expect((err as OrgKeyUnavailableError).provider).toBe('google');
    expect((err as OrgKeyUnavailableError).rejection).toBe('authentication_failed');
  });
});

describe('router, session integration, triage, and org-key classification', () => {
  it('routes runProviderSession and runProviderStructuredMessage by model ID', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: 'gpt-5-mini',
          choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 50, completion_tokens: 10 },
        }),
        { status: 200 },
      ),
    );
    const sess = await runProviderSession({
      model: 'gpt-5-mini',
      prompt: 'hello',
      apiKey: 'sk-test',
      maxTurns: 2,
      fetch: fetchMock,
    });
    expect(sess.succeeded).toBe(true);

    const structured = await runProviderStructuredMessage({
      model: 'gpt-5-mini',
      system: 'sys',
      user: 'usr',
      schema: z.object({ ok: z.boolean() }),
      apiKey: 'sk-test',
      fetch: fetchMock,
    });
    expect(structured.ok).toBe(true);
  });

  it('wires read_exhibit (guarding paths) and civicDataTools into runSession / runSessionWithRetry for non-Anthropic models', async () => {
    let step = 0;
    const seenToolNames: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      step++;
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        tools?: Array<{ function: { name: string } }>;
        messages?: Array<{ role: string; content: string }>;
      };
      if (step === 1) {
        for (const t of body.tools ?? []) seenToolNames.push(t.function.name);
        return new Response(
          JSON.stringify({
            model: 'gpt-4.1',
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'c1',
                      type: 'function',
                      function: { name: 'read_exhibit', arguments: JSON.stringify({ filename: 'archived-source-excerpt.txt' }) },
                    },
                    {
                      id: 'c2',
                      type: 'function',
                      function: { name: 'read_exhibit', arguments: JSON.stringify({ filename: '../../etc/passwd' }) },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 120, completion_tokens: 30 },
          }),
          { status: 200 },
        );
      }
      const toolMsgs = (body.messages ?? []).filter((m) => m.role === 'tool');
      expect(toolMsgs[0]!.content).toContain('Unemployment rate was 4.2%');
      expect(toolMsgs[1]!.content).toContain('Only this finding');
      return new Response(
        JSON.stringify({
          model: 'gpt-4.1',
          choices: [{ finish_reason: 'stop', message: { content: '{"content_supported":"pass"}' } }],
          usage: { prompt_tokens: 200, completion_tokens: 20 },
        }),
        { status: 200 },
      );
    });

    const civic = createCivicDataTools();
    const res = await runSessionWithRetry({
      prompt: 'Verify the exhibit',
      model: 'gpt-4.1',
      allowedTools: ['Read', 'mcp__civic_data__resolve_us_fips'],
      civicDataTools: civic.tools,
      archivedExhibits: {
        pdfExcerpt: Buffer.from('Unemployment rate was 4.2% in 2024.', 'utf8'),
      },
      apiKey: 'sk-org-key',
      maxTurns: 4,
      providerFetch: fetchMock,
    });
    expect(res.succeeded).toBe(true);
    expect(res.resultText).toContain('"pass"');
    expect(seenToolNames).toContain('read_exhibit');
    expect(seenToolNames).toContain('resolve_us_fips');

    // Direct runSession works with Google Gemini too.
    const gemFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          modelVersion: 'gemini-2.5-flash',
          candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'done' }] } }],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 5 },
        }),
        { status: 200 },
      ),
    );
    const gemRes = await runSession({
      prompt: 'Quick summary',
      model: 'gemini-2.5-flash',
      allowedTools: [],
      apiKey: 'AIzaKey',
      maxTurns: 2,
      providerFetch: gemFetch,
    });
    expect(gemRes.succeeded).toBe(true);
    expect(gemRes.resultText).toBe('done');
  });

  it('routes advisory runFindingTriage to OpenAI and Google Gemini', async () => {
    const assessment = {
      construct_match: 'match',
      epistemic_type: 'measured',
      geography_match: 'match',
      is_primary_source: 'primary',
      reason: 'Exact local measurement matches source.',
    };
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          modelVersion: 'gemini-2.5-flash',
          candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(assessment) }] } }],
          usageMetadata: { promptTokenCount: 250, candidatesTokenCount: 40 },
        }),
        { status: 200 },
      ),
    );
    const triage = await runFindingTriage(
      {
        model: 'gemini-2.5-flash',
        apiKey: 'AIzaTest',
        regionName: 'Santa Cruz',
        fetch: fetchMock,
      },
      {
        kind: 'indicator',
        indicator_slug: 'unemployment',
        name: 'Unemployment rate',
        value: 4.2,
        unit: '%',
        year: 2024,
        target: 4,
        level_pct: 5,
        scoring: { threshold_ref: 'jobs.unemployment', function: 'lower_is_better', inputs: {}, worked_math: '4.2 vs 4' },
        source: 'BLS',
        source_url: 'https://www.bls.gov/eag/eag.ca_santacruz_msa.htm',
        source_tier: 1,
        evidence: { snapshot_path: 'evidence/a.png', text_path: 'evidence/a.txt', captured_at: '2026-10-20T00:00:00Z' },
        confidence: 'high',
        geographic_scale: 'city',
      },
      'Santa Cruz unemployment rate was 4.2% in 2024 according to BLS.',
    );
    expect(triage.status).toBe('scored');
    expect(triage.advisoryOnly).toBe(true);
    expect(triage.model).toBe('gemini-2.5-flash');
    expect(triage.usage.input_tokens).toBe(250);
  });

  it('classifies HTTP key/billing/quota rejections across OpenAI, Google, and Anthropic and resolves run providers', () => {
    expect(classifyProviderHttpError('openai', 401, 'invalid api key')).toBe('authentication_failed');
    expect(classifyProviderHttpError('openai', 429, '{"error":{"code":"insufficient_quota"}}')).toBe('billing_error');
    expect(classifyProviderHttpError('openai', 404, 'The model `gpt-99` does not exist')).toBe('model_not_found');
    expect(classifyProviderHttpError('openai', 500, 'internal error')).toBeNull();

    expect(classifyProviderHttpError('google', 400, 'API key not valid.')).toBe('authentication_failed');
    expect(classifyProviderHttpError('google', 429, 'Quota exceeded for quota metric')).toBe('billing_error');
    expect(classifyProviderHttpError('google', 403, 'PERMISSION_DENIED')).toBe('oauth_org_not_allowed');
    expect(classifyProviderHttpError('google', 404, 'models/gemini-bad is not found')).toBe('model_not_found');

    const openaiErr = orgKeyRejected('billing_error', 'gpt-5', undefined, 'openai');
    expect(openaiErr.message).toContain('OpenAI');
    expect(openaiErr.message).toContain('OpenAI Platform');
    expect(openaiErr.message.length).toBeLessThanOrEqual(400);

    const googleErr = orgKeyRejected('authentication_failed', 'gemini-2.5-pro', undefined, 'google');
    expect(googleErr.message).toContain('Google Gemini');
    expect(googleErr.message.length).toBeLessThanOrEqual(400);

    expect(
      resolveRunProviders(
        { models: { session_model: 'gpt-5', subagent_model: null, verifier_model: 'gemini-2.5-pro' } },
        {},
      ),
    ).toMatchObject({
      researchProvider: 'openai',
      verifierProvider: 'google',
      triageProvider: 'openai',
      triageModel: 'gpt-4.1-mini',
    });

    expect(
      resolveRunProviders(
        { models: { session_model: 'custom-model', subagent_model: null, verifier_model: 'custom-judge' } },
        { RESEARCH_PROVIDER: 'google', VERIFIER_PROVIDER: 'openai' },
      ),
    ).toMatchObject({
      researchProvider: 'google',
      verifierProvider: 'openai',
    });
  });

  it('omits temperature:0 for gpt-6*/gpt-5.* reasoning models and filters blocked sources in runOpenAiWebSearch', async () => {
    expect(supportsZeroTemperature('gpt-4.1-mini')).toBe(true);
    expect(supportsZeroTemperature('gpt-5.6-luna')).toBe(false);
    expect(supportsZeroTemperature('gpt-6-luna')).toBe(false);
    expect(supportsZeroTemperature('gpt-6.1-terra')).toBe(false);
    expect(supportsZeroTemperature('gpt-6.2-sol')).toBe(false);
    expect(supportsZeroTemperature('gpt-6.2-astra')).toBe(false);

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: 'gpt-6-luna',
          status: 'completed',
          output: [
            { type: 'web_search_call' },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    results: [
                      {
                        title: 'California Doughnut Report (blocked)',
                        url: 'https://zenodo.org/records/15832541',
                        snippet: 'Blocked report',
                      },
                      {
                        title: 'HUD 2024 AHAR Part 1',
                        url: 'https://www.huduser.gov/portal/sites/default/files/pdf/2024-AHAR-Part-1.pdf',
                        snippet: 'California PIT homelessness total: 187,084',
                      },
                    ],
                  }),
                },
              ],
            },
          ],
          usage: {
            input_tokens: 10000,
            output_tokens: 400,
            input_tokens_details: { cached_tokens: 0, cache_write_tokens: 2000 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const out = await runOpenAiWebSearch({
      query: 'HUD 2024 PIT California homelessness',
      apiKey: 'sk-test-key',
      fetch: fetchMock,
      isBlocked: (url) => (url.includes('zenodo.org/records/15832541') ? 'blocked CA report' : null),
    });

    expect(out.ok).toBe(true);
    expect(out.filteredCount).toBe(1);
    expect(out.searchRequests).toBe(1);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.url).toContain('huduser.gov');
    expect(out.usage.by_model?.['gpt-6-luna']?.web_search_requests).toBe(1);
    expect(out.usage.by_model?.['gpt-6-luna']?.input_tokens).toBe(8000);
    expect(out.usage.by_model?.['gpt-6-luna']?.cache_write_tokens).toBe(2000);
    expect(priceSessionUsage(out.usage).unpriced).toEqual([]);
  });

  it('routes gpt-6* models through /v1/responses with parallel function calls and previous_response_id', async () => {
    expect(usesResponsesApi('gpt-6-luna')).toBe(true);
    expect(usesResponsesApi('gpt-6.1-terra')).toBe(true);
    expect(usesResponsesApi('gpt-6.2-sol')).toBe(true);
    expect(usesResponsesApi('gpt-6.2-astra')).toBe(true);
    expect(usesResponsesApi('gpt-4.1-mini')).toBe(false);

    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    let callNum = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      callNum++;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      requests.push({ url: String(url), body });
      if (callNum === 1) {
        return new Response(
          JSON.stringify({
            id: 'resp_turn_1',
            model: 'gpt-6-luna',
            status: 'completed',
            output: [
              { type: 'function_call', call_id: 'call_a', name: 'lookup', arguments: '{"k":"a"}' },
              { type: 'function_call', call_id: 'call_b', name: 'lookup', arguments: '{"k":"b"}' },
            ],
            usage: { input_tokens: 500, output_tokens: 40, input_tokens_details: { cached_tokens: 100 } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          id: 'resp_turn_2',
          model: 'gpt-6-luna',
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"ok":true}' }],
            },
          ],
          usage: { input_tokens: 700, output_tokens: 20, input_tokens_details: { cached_tokens: 400 } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const tools = new ToolExecutor([
      {
        name: 'lookup',
        description: 'Lookup key',
        parameters: { type: 'object', properties: { k: { type: 'string' } } },
        execute: async (args) => JSON.stringify({ got: args.k }),
      },
    ]);

    const res = await runOpenAiSession({
      provider: 'openai',
      model: 'gpt-6-luna',
      prompt: 'Look up a and b',
      apiKey: 'sk-test-key',
      maxTurns: 4,
      tools,
      fetch: fetchMock,
    });

    expect(res.succeeded).toBe(true);
    expect(res.resultText).toBe('{"ok":true}');
    expect(requests).toHaveLength(2);
    expect(requests[0]!.url).toContain('/responses');
    expect(requests[1]!.body.previous_response_id).toBe('resp_turn_1');
    expect(requests[1]!.body.input).toEqual([
      { type: 'function_call_output', call_id: 'call_a', output: '{"got":"a"}' },
      { type: 'function_call_output', call_id: 'call_b', output: '{"got":"b"}' },
    ]);
    expect(res.usage.input_tokens).toBe(700);
    expect(res.usage.cache_read_tokens).toBe(500);
    expect(res.usage.output_tokens).toBe(60);
  });

  it('verifies derived indicator operands on captured exhibits and accepts verified derivations in submit_findings', async () => {
    const exhibits: Record<string, string> = {
      'evidence/pit.txt': 'California January 2024 Point-in-Time count total: 187,084 people.',
      'evidence/pop.txt': 'ACS 2024 1-Year Table B01003 California total population: 39,431,263.',
    };
    const readText = async (p: string) => {
      if (!(p in exhibits)) throw new Error('missing');
      return exhibits[p]!;
    };
    const derivations: VerifiedDerivation[] = [];

    // Rejects hallucinated operand not on exhibit
    const bad = JSON.parse(
      await executeComputeDerivedIndicator(
        {
          operation: 'ratio_pct',
          numerator_operands: [{ label: 'Fake', value: 999999, text_path: 'evidence/pit.txt' }],
          denominator_operands: [{ label: 'CA Pop', value: 39431263, text_path: 'evidence/pop.txt' }],
          decimals: 4,
        },
        readText,
        derivations,
      ),
    ) as { verified: boolean; errors?: string[] };
    expect(bad.verified).toBe(false);
    expect(derivations).toHaveLength(0);

    // Accepts verified operands and computes 0.4745%
    const ok = JSON.parse(
      await executeComputeDerivedIndicator(
        {
          operation: 'ratio_pct',
          numerator_operands: [{ label: 'CA PIT', value: 187084, text_path: 'evidence/pit.txt' }],
          denominator_operands: [{ label: 'CA Pop', value: 39431263, text_path: 'evidence/pop.txt' }],
          decimals: 4,
        },
        readText,
        derivations,
      ),
    ) as { verified: boolean; computed_value: number; worked_math: string };
    expect(ok.verified).toBe(true);
    expect(ok.computed_value).toBe(0.4745);
    expect(derivations).toHaveLength(1);

    const finding = {
      kind: 'indicator',
      indicator_slug: 'homelessness',
      name: 'Homelessness share',
      value: 0.4745,
      unit: '%',
      year: 2024,
      target: 0,
      level_pct: 47.45,
      scoring: {
        threshold_ref: 'homelessness',
        function: 'lower_is_better',
        inputs: { value: 0.4745, target: 0 },
        worked_math: ok.worked_math,
      },
      source: 'HUD 2024 AHAR Part 1',
      source_url: 'https://www.huduser.gov/portal/sites/default/files/pdf/2024-AHAR-Part-1.pdf',
      source_tier: 2,
      evidence: {
        snapshot_path: 'evidence/pit.png',
        text_path: 'evidence/pit.txt',
        captured_at: '2026-11-24T00:00:00Z',
      },
      confidence: 'high',
      geographic_scale: 'state',
    };

    // Without derivations, literal checkValueOnPage rejects 0.4745
    const rejected = await validateAndScoreSubmittedFindings([finding], undefined, readText, []);
    expect(rejected.accepted).toBe(false);

    // With verified derivation, submit_findings accepts 0.4745 cleanly
    const accepted = await validateAndScoreSubmittedFindings([finding], undefined, readText, derivations);
    expect(accepted.accepted).toBe(true);
    expect(accepted.findings).toHaveLength(1);
  });

  it('attaches archived PNG exhibits as multimodal input_image blocks in OpenAI Responses verifier sessions', async () => {
    const requests: Array<Record<string, unknown>> = [];
    let callNum = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      callNum++;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      requests.push(body);
      if (callNum === 1) {
        return new Response(
          JSON.stringify({
            id: 'resp_v1',
            model: 'gpt-6.2-sol',
            status: 'completed',
            output: [
              {
                type: 'function_call',
                call_id: 'call_img',
                name: 'read_exhibit',
                arguments: '{"filename":"archived-snapshot.png"}',
              },
            ],
            usage: { input_tokens: 200, output_tokens: 20 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          id: 'resp_v2',
          model: 'gpt-6.2-sol',
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"content_supported":"pass","verifier_note":"Visible on PNG."}' }],
            },
          ],
          usage: { input_tokens: 400, output_tokens: 30 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await runSession({
      prompt: 'Verify exhibit',
      allowedTools: ['Read'],
      provider: 'openai',
      model: 'gpt-6.2-sol',
      apiKey: 'sk-test-key',
      archivedExhibits: {
        snapshot: Buffer.from('fake-png-bytes'),
      },
      orchestrate: false,
      maxTurns: 4,
      providerFetch: fetchMock,
      semaphore: null,
    });

    expect(res.succeeded).toBe(true);
    expect(requests).toHaveLength(2);
    const turn2Input = requests[1]!.input as Array<Record<string, unknown>>;
    const visionMsg = turn2Input.find((item) => item.role === 'user');
    expect(visionMsg).toBeDefined();
    const content = visionMsg!.content as Array<Record<string, unknown>>;
    expect(content.some((c) => c.type === 'input_image' && String(c.image_url).startsWith('data:image/png;base64,'))).toBe(true);
  });
});
