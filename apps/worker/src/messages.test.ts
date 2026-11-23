import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  isFlagged,
  priceSessionUsage,
  type FindingPayload,
  type FindingVerification,
} from '@deep-fryer/core';
import { triageExpandsFlagged } from '@deep-fryer/research';
import {
  DEFAULT_TRIAGE_MODEL,
  messageUsageToSessionUsage,
  runFindingTriage,
  runStructuredMessage,
  type MessagesApiClient,
  type RawMessageResponse,
} from './messages.js';

const INDICATOR_FINDING: Extract<FindingPayload, { kind: 'indicator' }> = {
  kind: 'indicator',
  indicator_slug: 'cost-burdened-renters',
  name: 'Cost-burdened renter households',
  value: 61.2,
  unit: '% of renter households',
  year: 2024,
  target: 0,
  level_pct: 38.8,
  scoring: {
    threshold_ref: 'housing-cost-burden',
    function: 'lower_is_better',
    inputs: { value: 61.2, target: 0 },
    worked_math: '61.2 - 0 = 61.2',
  },
  source: 'NYC Rent Guidelines Board',
  source_url: 'https://rentguidelinesboard.cityofnewyork.us/report-2024.pdf',
  source_tier: 1,
  evidence: {
    snapshot_path: 'evidence/a1.png',
    text_path: 'evidence/a1.txt',
    captured_at: '2026-10-01T00:00:00Z',
  },
  confidence: 'high',
  geographic_scale: 'county',
};

const GAP_FINDING: Extract<FindingPayload, { kind: 'gap' }> = {
  kind: 'gap',
  indicator_slug: 'aragonite-saturation',
  reason: 'No local coastal monitoring station.',
  scales_tried: ['city', 'county'],
  searched_at: '2026-10-01T00:00:00Z',
};

function makeClient(response: RawMessageResponse | (() => Promise<RawMessageResponse>)): {
  client: MessagesApiClient;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn().mockImplementation(async () =>
    typeof response === 'function' ? response() : response,
  );
  return { client: { messages: { create } }, create };
}

describe('messageUsageToSessionUsage', () => {
  it('maps Anthropic Messages usage into SessionTokenUsage and prices accurately with core priceSessionUsage', () => {
    const usage = messageUsageToSessionUsage(
      'claude-haiku-5-5',
      {
        input_tokens: 4_000,
        output_tokens: 120,
        cache_read_input_tokens: 1_000,
        cache_creation_input_tokens: 500,
      },
      'end_turn',
    );

    expect(usage.model).toBe('claude-haiku-5-5');
    expect(usage.input_tokens).toBe(4_000);
    expect(usage.output_tokens).toBe(120);
    expect(usage.cache_read_tokens).toBe(1_000);
    expect(usage.cache_write_tokens).toBe(500);
    expect(usage.num_turns).toBe(1);
    expect(usage.by_model?.['claude-haiku-5-5']).toEqual({
      input_tokens: 4_000,
      output_tokens: 120,
      cache_read_tokens: 1_000,
      cache_write_tokens: 500,
      web_search_requests: 0,
    });

    const priced = priceSessionUsage(usage);
    expect(priced.unpriced).toEqual([]);
    // (4000*0.1 + 120*0.5 + 1000*0.01 + 500*0.125) / 1e6 = 0.0005325
    expect(priced.dollars).toBeCloseTo(0.0005325, 8);
  });

  it('attributes long_prompt when prompt tokens exceed 100,000', () => {
    const usage = messageUsageToSessionUsage('claude-haiku-5-5', {
      input_tokens: 90_000,
      output_tokens: 200,
      cache_read_input_tokens: 20_000,
      cache_creation_input_tokens: 0,
    });
    expect(usage.by_model?.['claude-haiku-5-5']?.long_prompt).toEqual({
      input_tokens: 90_000,
      output_tokens: 200,
      cache_read_tokens: 20_000,
      cache_write_tokens: 0,
    });
  });
});

describe('runStructuredMessage', () => {
  const schema = z.object({ ok: z.boolean(), count: z.number().int() }).strict();

  it('validates clean JSON and fenced JSON responses with exact token metering', async () => {
    const { client, create } = makeClient({
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '```json\n{"ok": true, "count": 3}\n```' }],
      usage: { input_tokens: 800, output_tokens: 40, cache_read_input_tokens: 200 },
    });

    const res = await runStructuredMessage({
      client,
      model: 'claude-haiku-5-5',
      system: 'Return JSON',
      user: 'Count items',
      schema,
      maxTokens: 256,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({ ok: true, count: 3 });
      expect(res.usage.input_tokens).toBe(800);
      expect(res.usage.output_tokens).toBe(40);
      expect(res.usage.cache_read_tokens).toBe(200);
    }
  });

  it('returns ok: false on malformed JSON while preserving recorded token usage', async () => {
    const { client } = makeClient({
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Sure! Here is the answer: {not valid json' }],
      usage: { input_tokens: 1_200, output_tokens: 55 },
    });

    const res = await runStructuredMessage({
      client,
      model: 'claude-haiku-5-5',
      system: 'Return JSON',
      user: 'Count items',
      schema,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Invalid JSON/i);
      expect(res.usage.input_tokens).toBe(1_200);
      expect(res.usage.output_tokens).toBe(55);
    }
  });

  it('returns ok: false on Zod schema mismatch while preserving token usage', async () => {
    const { client } = makeClient({
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"ok": true, "count": "not-a-number"}' }],
      usage: { input_tokens: 900, output_tokens: 30 },
    });

    const res = await runStructuredMessage({
      client,
      model: 'claude-haiku-5-5',
      system: 'Return JSON',
      user: 'Count items',
      schema,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Schema validation failed/i);
      expect(res.usage.input_tokens).toBe(900);
      expect(res.usage.output_tokens).toBe(30);
    }
  });

  it('aborts and returns an error cleanly when timeoutMs elapses', async () => {
    const client: MessagesApiClient = {
      messages: {
        create: (_body, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
          }),
      },
    };

    const res = await runStructuredMessage({
      client,
      model: 'claude-haiku-5-5',
      system: 'Return JSON',
      user: 'Slow request',
      schema,
      timeoutMs: 25,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/timed out/i);
      expect(res.usage.input_tokens).toBe(0);
    }
  });
});

describe('runFindingTriage', () => {
  it('skips gap findings with zero API calls', async () => {
    const { client, create } = makeClient({
      content: [{ type: 'text', text: '{}' }],
    });

    const res = await runFindingTriage(
      { client, regionName: 'The Bronx' },
      GAP_FINDING,
      'Some archived text.',
    );

    expect(res.status).toBe('skipped');
    expect(res.advisoryOnly).toBe(true);
    expect(res.assessment).toBeNull();
    expect(res.severity).toBe('none');
    expect(create).not.toHaveBeenCalled();
  });

  it('returns no_text without calling the API when archived source text is missing', async () => {
    const { client, create } = makeClient({
      content: [{ type: 'text', text: '{}' }],
    });

    const res = await runFindingTriage(
      { client, regionName: 'The Bronx' },
      INDICATOR_FINDING,
      '   ',
    );

    expect(res.status).toBe('no_text');
    expect(res.valueFound).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('scores an indicator finding via direct Messages API, surfaces advisory flags, and never suppresses verifier flags', async () => {
    const { client, create } = makeClient({
      model: DEFAULT_TRIAGE_MODEL,
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            construct_match: 'match',
            epistemic_type: 'measured',
            geography_match: 'match',
            is_primary_source: 'secondary_republisher',
            reason: 'RGB report republishes 2024 Census ACS renter cost-burden table.',
          }),
        },
      ],
      usage: { input_tokens: 1_800, output_tokens: 75 },
    });

    const sourceText =
      'NYC Rent Guidelines Board 2024 Housing Supply Report. Citing US Census ACS: 61.2% of Bronx renter households are cost-burdened.';

    const triage = await runFindingTriage(
      {
        client,
        regionName: 'The Bronx',
        regionDefinition: 'Bronx County, New York',
        portraitScale: 'county',
      },
      INDICATOR_FINDING,
      sourceText,
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(triage.status).toBe('scored');
    expect(triage.advisoryOnly).toBe(true);
    expect(triage.valueFound).toBe(true);
    expect(triage.severity).toBe('medium');
    expect(triage.flags).toContain('tier_overclaimed');
    expect(triage.usage.input_tokens).toBe(1_800);
    expect(triage.usage.output_tokens).toBe(75);

    // Zero auto-approval / strictly flag-expanding check: even if triage returned all clean,
    // an existing verifier fail remains flagged.
    const failedVerification: FindingVerification = {
      schema_ok: true,
      url_ok: true,
      recency_ok: true,
      scale_ok: true,
      content_supported: 'fail',
    };
    expect(isFlagged(failedVerification)).toBe(true);
    expect(
      triageExpandsFlagged(isFlagged(failedVerification), {
        construct_match: 'match',
        epistemic_type: 'measured',
        geography_match: 'match',
        is_primary_source: 'primary',
        reason: 'Looks clean to triage.',
      }),
    ).toBe(true);
  });

  it('runs cleanly under Promise.all alongside an independent verifier without blocking on triage failure', async () => {
    const failingClient: MessagesApiClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('529 Overloaded')),
      },
    };
    const mockVerifier = async () => ({
      content_supported: 'pass' as const,
      verifier_note: 'Confirmed against archived exhibit.',
    });

    const [verifierResult, triageResult] = await Promise.all([
      mockVerifier(),
      runFindingTriage(
        { client: failingClient, regionName: 'The Bronx' },
        INDICATOR_FINDING,
        'Bronx renter cost burden: 61.2% in 2024.',
      ),
    ]);

    expect(verifierResult.content_supported).toBe('pass');
    expect(triageResult.status).toBe('unavailable');
    expect(triageResult.advisoryOnly).toBe(true);
    expect(triageResult.assessment).toBeNull();
    expect(triageResult.error).toContain('529 Overloaded');
  });
});
