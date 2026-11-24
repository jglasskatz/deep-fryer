import { describe, expect, it, vi } from 'vitest';
import { defaultPortraitConfig } from '@deep-fryer/contract';
import { isFlagged, type IndicatorFindingPayload, type SessionTokenUsage } from '@deep-fryer/core';
import type { TenantStorage } from '../storage.js';
import { createCivicDataMcpServer, evaluateDimensionFindings } from './research-apply.js';

const config = defaultPortraitConfig('City of Santa Cruz', 'City of Santa Cruz municipal boundary');

const sampleIndicator: IndicatorFindingPayload = {
  kind: 'indicator',
  indicator_slug: 'rent-burden',
  name: 'Rent-burdened households',
  value: 48.2,
  unit: '%',
  year: 2024,
  target: 25,
  level_pct: 52,
  scoring: {
    threshold_ref: 'housing:rent-burden',
    function: 'lower_is_better',
    inputs: { value: 48.2, target: 25, zero_at: 75 },
    worked_math: '(75 - 48.2) / (75 - 25) * 100 = 53.6',
  },
  source: 'US Census Bureau ACS',
  source_url: 'https://data.census.gov/table/ACSDP5Y2024.DP04',
  source_tier: 1,
  evidence: {
    snapshot_path: 'evidence/abc123.png',
    text_path: 'evidence/abc123.txt',
    captured_at: '2026-11-24T00:00:00.000Z',
  },
  confidence: 'high',
  geographic_scale: 'city',
};

const sampleUsage = (model: string, input: number, output: number): SessionTokenUsage => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  model,
  by_model: {
    [model]: {
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      web_search_requests: 0,
    },
  },
});

describe('P1 cross-track hooks in research-apply', () => {
  it('mounts @deep-fryer/civic-data as an in-process SDK MCP server', () => {
    const storage: TenantStorage = {
      put: vi.fn(async (p) => p),
      get: vi.fn(async () => Buffer.from('')),
      describe: () => 'memory:test',
    };
    const server = createCivicDataMcpServer(storage, {});
    expect(server).toBeDefined();
    expect(server.name).toBe('civic_data');
  });

  it('runs advisory triage concurrently with runVerifier, records triageUsage, and never clears verifier flags', async () => {
    const events: string[] = [];
    const triageUsage = sampleUsage('claude-haiku-5-5', 420, 90);
    const verifierUsage = sampleUsage('claude-opus-5', 1000, 200);

    const out = await evaluateDimensionFindings(
      {
        sessionId: 'sess-1',
        config,
        dimensionSlug: 'housing',
        dimensionName: 'Housing',
        regionBrief: 'Santa Cruz municipal boundary.',
        plan: {},
        rawFindings: [sampleIndicator],
        salvaged: false,
        initialKeyFailure: null,
      },
      {
        deterministicChecks: async () => ({
          payload: sampleIndicator,
          checks: { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true, home_page_link: false },
        }),
        checkValueOnPage: async () => 'found',
        runCorrectionSession: vi.fn(),
        runEscalationSession: vi.fn(),
        runVerifier: async () => {
          events.push('verifier:start');
          await new Promise((r) => setTimeout(r, 10));
          events.push('verifier:end');
          return {
            verdict: { content_supported: 'fail', verifier_note: 'Source reports county total, not city.' },
            usage: verifierUsage,
          };
        },
        runTriage: async () => {
          events.push('triage:start');
          await new Promise((r) => setTimeout(r, 5));
          events.push('triage:end');
          return {
            status: 'scored',
            advisoryOnly: true,
            assessment: {
              construct_match: 'match',
              epistemic_type: 'measured',
              geography_match: 'match',
              is_primary_source: 'primary',
              reason: 'Matches claimed indicator.',
            },
            severity: 'none',
            flags: [],
            valueFound: true,
            usage: triageUsage,
            model: 'claude-haiku-5-5',
          };
        },
      },
    );

    // Concurrency check: both started before verifier finished.
    expect(events.slice(0, 2).sort()).toEqual(['triage:start', 'verifier:start']);
    expect(out.triageUsage?.input_tokens).toBe(420);
    expect(out.triageUsage?.output_tokens).toBe(90);
    expect(out.records).toHaveLength(1);
    const verification = out.records[0]!.verification;
    // Triage NEVER clears a verifier fail flag!
    expect(verification.content_supported).toBe('fail');
    expect(isFlagged(verification)).toBe(true);
    expect(verification.triage).toMatchObject({
      advisory_only: true,
      severity: 'none',
      flags: [],
      model: 'claude-haiku-5-5',
    });
  });

  it('swallows triage exceptions without breaking verification', async () => {
    const warnings: string[] = [];
    const out = await evaluateDimensionFindings(
      {
        sessionId: 'sess-2',
        config,
        dimensionSlug: 'housing',
        dimensionName: 'Housing',
        regionBrief: 'Santa Cruz municipal boundary.',
        plan: {},
        rawFindings: [sampleIndicator],
        salvaged: false,
        initialKeyFailure: null,
      },
      {
        deterministicChecks: async () => ({
          payload: sampleIndicator,
          checks: { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true, home_page_link: false },
        }),
        checkValueOnPage: async () => 'found',
        runCorrectionSession: vi.fn(),
        runEscalationSession: vi.fn(),
        runVerifier: async () => ({
          verdict: { content_supported: 'pass', verifier_note: 'Confirmed.' },
          usage: sampleUsage('claude-opus-5', 800, 120),
        }),
        runTriage: async () => {
          throw new Error('triage network timeout');
        },
        warn: (msg) => warnings.push(msg),
      },
    );

    expect(out.records).toHaveLength(1);
    expect(out.records[0]!.verification.content_supported).toBe('pass');
    expect(out.records[0]!.verification.triage).toBeUndefined();
    expect(out.triageUsage).toBeUndefined();
    expect(warnings.some((w) => w.includes('triage network timeout'))).toBe(true);
  });
});
