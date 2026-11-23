import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { defaultPortraitConfig } from '@deep-fryer/contract';
import type { GapFindingPayload, IndicatorFindingPayload, SessionTokenUsage } from '@deep-fryer/core';
import {
  DEFAULT_CORRECTION_MAX_TURNS,
  deterministicChecks,
  planStrategy,
  valueOnPage,
} from '@deep-fryer/research';
import { orgKeyRejected } from '../org-key.js';
import {
  combineStageTranscripts,
  evaluateDimensionFindings,
  plannedEscalationOptions,
  plannedInitialScoutModel,
  runWithConcurrency,
  type DimensionFindingPipelineDeps,
} from './research-apply.js';

const config = defaultPortraitConfig('City of Santa Cruz', 'City of Santa Cruz municipal boundary');

const usageOf = (model: string, input: number, output: number): SessionTokenUsage => ({
  input_tokens: input,
  output_tokens: output,
  model,
  by_model: {
    [model]: { input_tokens: input, output_tokens: output, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 },
  },
});

const indicator = (
  slug: string,
  name: string,
  overrides: Partial<IndicatorFindingPayload> = {},
): IndicatorFindingPayload => ({
  kind: 'indicator',
  indicator_slug: slug,
  name,
  value: 42.5,
  unit: '%',
  year: new Date().getUTCFullYear() - 1,
  target: 30,
  level_pct: 41.7,
  scoring: {
    threshold_ref: `housing.${slug}`,
    function: 'lower_is_better',
    inputs: { value: 42.5, target: 30 },
    worked_math: '(42.5 - 30) / 30 * 100 = 41.7',
  },
  source: 'City Housing Office',
  source_url: `https://stats.example.gov/housing/${slug}.pdf`,
  source_tier: 1,
  evidence: {
    snapshot_path: `evidence/${slug}.png`,
    text_path: `evidence/${slug}.txt`,
    captured_at: '2026-10-01T00:00:00Z',
  },
  confidence: 'high',
  geographic_scale: 'city',
  ...overrides,
});

const gap = (slug: string, reason = 'No local source found'): GapFindingPayload => ({
  kind: 'gap',
  indicator_slug: slug,
  reason,
  scales_tried: ['city'],
  tiers_tried: [1],
  searched_at: '2026-10-01T00:00:00Z',
});

describe('Research Routine v2 — pre-verifier self-correction and hybrid escalation', () => {
  it('runs at most 1 bounded self-correction pass before verifier when value_on_page is not_found or home_page_link is true', async () => {
    const events: string[] = [];
    const files: Record<string, string> = {
      'evidence/bad-val.txt': 'General overview page with no percentages.',
      'evidence/bad-val-fixed.txt': 'Table 2 reports 42.5% of renter households were cost-burdened.',
      'evidence/good.txt': 'In 2025, 42.5% of renter households were severely burdened.',
    };

    const initialFlagged = indicator('bad-val', 'Cost-burdened renters', {
      source_url: 'https://stats.example.gov/housing', // home/section page AND value not in text
    });
    const initialClean = indicator('good', 'Severe cost burden');
    const fixedFinding = indicator('bad-val', 'Cost-burdened renters', {
      source_url: 'https://stats.example.gov/housing/table-2.pdf',
      evidence: {
        snapshot_path: 'evidence/bad-val-fixed.png',
        text_path: 'evidence/bad-val-fixed.txt',
        captured_at: '2026-10-01T00:01:00Z',
      },
    });

    const correctionPrompts: { prompt: string; maxTurns: number }[] = [];
    const deps: DimensionFindingPipelineDeps = {
      deterministicChecks: (raw, cfg, slug) => deterministicChecks(raw, cfg, slug, async () => true),
      checkValueOnPage: async (payload) =>
        payload.kind === 'gap' ? undefined : valueOnPage(payload.value, files[payload.evidence.text_path ?? '']),
      runCorrectionSession: vi.fn(async (req) => {
        events.push('correction');
        correctionPrompts.push(req);
        return {
          resultText: JSON.stringify([fixedFinding]),
          succeeded: true,
          transcript: Buffer.from('c'),
          usage: usageOf('claude-sonnet-5', 2500, 400),
        };
      }),
      runEscalationSession: vi.fn(async () => {
        events.push('escalation');
        throw new Error('standard strategy must not escalate');
      }),
      runVerifier: vi.fn(async (payload: IndicatorFindingPayload) => {
        events.push(`verify:${payload.indicator_slug}:${payload.source_url}`);
        return {
          verdict: { content_supported: 'pass' as const, verifier_note: 'Confirmed 42.5%.' },
          usage: usageOf('claude-opus-5', 1000, 100),
        };
      }),
    };

    const plan = planStrategy('standard@1');
    const out = await evaluateDimensionFindings(
      {
        sessionId: 'sess-1',
        config,
        dimensionSlug: 'housing',
        dimensionName: 'Housing',
        regionBrief: 'Santa Cruz brief.',
        plan,
        rawFindings: [initialFlagged, initialClean],
        salvaged: false,
        initialKeyFailure: null,
      },
      deps,
    );

    // Self-correction happened ONCE, strictly BEFORE any verifier call.
    expect(events[0]).toBe('correction');
    expect(events.slice(1)).toEqual([
      'verify:bad-val:https://stats.example.gov/housing/table-2.pdf',
      'verify:good:https://stats.example.gov/housing/good.pdf',
    ]);
    expect(correctionPrompts).toHaveLength(1);
    expect(correctionPrompts[0]!.maxTurns).toBe(DEFAULT_CORRECTION_MAX_TURNS);
    expect(correctionPrompts[0]!.prompt).toContain('VALUE NOT FOUND ON CAPTURED PAGE');
    expect(correctionPrompts[0]!.prompt).toContain('HOME OR SECTION PAGE LINK');
    expect(correctionPrompts[0]!.prompt).not.toContain('Severe cost burden');

    // Metering recorded correction usage separately and folded verifier usage.
    expect(out.correctionUsage).toEqual(usageOf('claude-sonnet-5', 2500, 400));
    expect(out.verifierUsage.input_tokens).toBe(2000);
    expect(out.escalationUsage).toBeUndefined();

    // Re-checked deterministic gates now pass on the corrected finding!
    const correctedRec = out.records.find((r) => r.indicatorSlug === 'bad-val')!;
    expect(correctedRec.verification).toMatchObject({
      value_on_page: 'found',
      home_page_link: false,
      content_supported: 'pass',
    });
  });

  it('caps self-correction to 1 pass even when the corrected finding remains flagged, and re-captures if source_url changed without fresh snapshot', async () => {
    const files: Record<string, string> = {
      'evidence/f1.txt': 'No matching value here.',
      'evidence/recaptured.txt': 'Updated PDF reports 42.5% for 2025.',
    };
    const initial = indicator('f1', 'Rent burden');
    const returnedWithOldEvidence = indicator('f1', 'Rent burden', {
      source_url: 'https://stats.example.gov/housing/new-report.pdf',
      // Intentionally reused old snapshot_path to verify automatic re-capture!
      evidence: initial.evidence,
    });

    const recaptureEvidence = vi.fn(async () => ({
      snapshot_path: 'evidence/recaptured.png',
      text_path: 'evidence/recaptured.txt',
      captured_at: '2026-10-01T00:05:00Z',
    }));
    const runCorrectionSession = vi.fn(async () => ({
      resultText: JSON.stringify([returnedWithOldEvidence]),
      succeeded: true,
      transcript: Buffer.from('c'),
      usage: usageOf('claude-sonnet-5', 800, 120),
    }));

    const out = await evaluateDimensionFindings(
      {
        sessionId: 'sess-2',
        config,
        dimensionSlug: 'housing',
        dimensionName: 'Housing',
        regionBrief: 'Brief.',
        plan: planStrategy('standard@1'),
        rawFindings: [initial],
        salvaged: false,
        initialKeyFailure: null,
      },
      {
        deterministicChecks: (raw, cfg, slug) => deterministicChecks(raw, cfg, slug, async () => true),
        checkValueOnPage: async (payload) =>
          payload.kind === 'gap' ? undefined : valueOnPage(payload.value, files[payload.evidence.text_path ?? '']),
        recaptureEvidence,
        runCorrectionSession,
        runEscalationSession: vi.fn(),
        runVerifier: vi.fn(async () => ({
          verdict: { content_supported: 'pass' as const },
          usage: usageOf('claude-opus-5', 500, 50),
        })),
      },
    );

    expect(runCorrectionSession).toHaveBeenCalledTimes(1);
    expect(recaptureEvidence).toHaveBeenCalledWith(
      'https://stats.example.gov/housing/new-report.pdf',
      'https://stats.example.gov/housing/new-report.pdf',
    );
    expect(out.records[0]!.verification.value_on_page).toBe('found');
    expect((out.records[0]!.payload as IndicatorFindingPayload).evidence.snapshot_path).toBe('evidence/recaptured.png');
  });

  it('stops verifier and escalation immediately if organization key is refused during self-correction', async () => {
    const refusal = orgKeyRejected('billing_error', 'claude-sonnet-5', usageOf('claude-sonnet-5', 120, 0));
    const runVerifier = vi.fn();
    const runEscalationSession = vi.fn();

    const out = await evaluateDimensionFindings(
      {
        sessionId: 'sess-3',
        config,
        dimensionSlug: 'housing',
        dimensionName: 'Housing',
        regionBrief: 'Brief.',
        plan: planStrategy('hybrid@1'),
        rawFindings: [indicator('f1', 'Rent burden', { source_url: 'https://stats.example.gov/housing' })],
        salvaged: false,
        initialKeyFailure: null,
      },
      {
        deterministicChecks: (raw, cfg, slug) => deterministicChecks(raw, cfg, slug, async () => true),
        checkValueOnPage: async () => 'found',
        runCorrectionSession: vi.fn(async () => {
          throw refusal;
        }),
        runEscalationSession,
        runVerifier,
      },
    );

    expect(out.keyFailure).toBe(refusal);
    expect(out.correctionUsage).toEqual(usageOf('claude-sonnet-5', 120, 0));
    expect(runVerifier).not.toHaveBeenCalled();
    expect(runEscalationSession).not.toHaveBeenCalled();
    expect(out.records[0]!.verification.content_supported).toBe('uncertain');
    expect(out.records[0]!.verification.verifier_note).toContain('verifier did not run');
  });

  it('hybrid strategy: runs Sonnet without scouts initially and selectively escalates ONLY gaps and failed verifications to Opus + Sonnet scouts', async () => {
    const hybridPlan = planStrategy('hybrid@1');
    // Initial pass uses Sonnet without scouts; escalation pass uses Opus with Sonnet scouts + 40 turn cap.
    expect(plannedInitialScoutModel(hybridPlan)).toBeNull();
    expect(plannedEscalationOptions(hybridPlan)).toEqual({
      model: 'claude-opus-5',
      scoutModel: 'claude-sonnet-5',
      maxTurns: 40,
      pageReaderModel: 'claude-haiku-4-5-20251001',
    });

    const passedInd = indicator('passed', 'Passed indicator');
    const uncertainInd = indicator('uncertain', 'Uncertain indicator');
    const failedInd = indicator('failed', 'Failed indicator');
    const gapInd = gap('missing', 'Not in tier-1');

    const escalatedMissing = indicator('missing', 'Recovered indicator', {
      value: 1.09,
      unit: 'Ω',
      geographic_scale: 'regional',
      source: 'NOAA Regional Ocean Study',
      source_url: 'https://noaa.gov/studies/lis-aragonite-2024.pdf',
      source_tier: 3,
    });
    const escalatedFailed = gap('failed', 'Verified no compliant figure exists after deep search');

    const escalationCalls: { prompt: string; maxTurns: number }[] = [];
    const runVerifier = vi.fn(async (payload: IndicatorFindingPayload) => {
      if (payload.indicator_slug === 'passed') {
        return { verdict: { content_supported: 'pass' as const }, usage: usageOf('claude-opus-5', 400, 40) };
      }
      if (payload.indicator_slug === 'uncertain') {
        return { verdict: { content_supported: 'uncertain' as const }, usage: usageOf('claude-opus-5', 400, 40) };
      }
      if (payload.indicator_slug === 'failed') {
        return {
          verdict: { content_supported: 'fail' as const, verifier_note: 'Number contradicted by table.' },
          usage: usageOf('claude-opus-5', 400, 40),
        };
      }
      if (payload.indicator_slug === 'missing') {
        return { verdict: { content_supported: 'pass' as const, verifier_note: 'Confirmed Ω = 1.09.' }, usage: usageOf('claude-opus-5', 600, 60) };
      }
      throw new Error(`unexpected verify: ${payload.indicator_slug}`);
    });

    const out = await evaluateDimensionFindings(
      {
        sessionId: 'sess-hybrid',
        config,
        dimensionSlug: 'ocean-acidification',
        dimensionName: 'Ocean acidification',
        regionBrief: 'Coastal brief.',
        plan: hybridPlan,
        rawFindings: [passedInd, uncertainInd, failedInd, gapInd],
        salvaged: false,
        initialKeyFailure: null,
      },
      {
        deterministicChecks: (raw, cfg, slug) => deterministicChecks(raw, cfg, slug, async () => true),
        checkValueOnPage: async (payload) => (payload.kind === 'gap' ? undefined : 'found'),
        runCorrectionSession: vi.fn(),
        runEscalationSession: vi.fn(async (req) => {
          escalationCalls.push(req);
          return {
            resultText: JSON.stringify([escalatedMissing, escalatedFailed]),
            succeeded: true,
            transcript: Buffer.from('esc'),
            usage: usageOf('claude-opus-5', 4000, 700),
          };
        }),
        runVerifier,
      },
    );

    expect(escalationCalls).toHaveLength(1);
    expect(escalationCalls[0]!.maxTurns).toBe(40);
    expect(escalationCalls[0]!.prompt).toContain('missing');
    expect(escalationCalls[0]!.prompt).toContain('failed');
    expect(escalationCalls[0]!.prompt).not.toContain('passed');
    expect(escalationCalls[0]!.prompt).not.toContain('uncertain');

    expect(out.escalationUsage).toEqual(usageOf('claude-opus-5', 4000, 700));
    // Initial 3 indicator verifiers (3 × 400) + 1 escalated indicator verifier (600) = 1800 input tokens.
    expect(out.verifierUsage.input_tokens).toBe(1800);

    const bySlug = Object.fromEntries(out.records.map((r) => [r.indicatorSlug, r]));
    expect(bySlug.passed!.verification.content_supported).toBe('pass');
    expect(bySlug.uncertain!.verification.content_supported).toBe('uncertain');
    // Gap upgraded to verified indicator!
    expect(bySlug.missing!.payload.kind).toBe('indicator');
    expect(bySlug.missing!.verification.content_supported).toBe('pass');
    // Verification-failed claim replaced with honest gap!
    expect(bySlug.failed!.payload.kind).toBe('gap');
  });

  it('hybrid strategy skips escalation completely when every indicator already passes verification', async () => {
    const runEscalationSession = vi.fn();
    const out = await evaluateDimensionFindings(
      {
        sessionId: 'sess-clean',
        config,
        dimensionSlug: 'housing',
        dimensionName: 'Housing',
        regionBrief: 'Brief.',
        plan: planStrategy('hybrid@1'),
        rawFindings: [indicator('ok', 'Rent burden')],
        salvaged: false,
        initialKeyFailure: null,
      },
      {
        deterministicChecks: (raw, cfg, slug) => deterministicChecks(raw, cfg, slug, async () => true),
        checkValueOnPage: async () => 'found',
        runCorrectionSession: vi.fn(),
        runEscalationSession,
        runVerifier: vi.fn(async () => ({
          verdict: { content_supported: 'pass' as const },
          usage: usageOf('claude-opus-5', 300, 30),
        })),
      },
    );

    expect(runEscalationSession).not.toHaveBeenCalled();
    expect(out.escalationUsage).toBeUndefined();
    expect(out.records[0]!.verification.content_supported).toBe('pass');
  });

  it('P0.1/P0.2/P0.4: escalates omitted planned slugs, recaptures changed escalation URLs, tags stage provenance, preserves transcripts, and rescores wrong LLM math', async () => {
    const files: Record<string, string> = {
      'evidence/ok.txt': 'Renter cost burden is 54.0% in 2025.',
      'evidence/esc-recaptured.txt': 'Eviction rate was 4.2 per 1,000 in 2025.',
    };
    const initialWithBadMath = indicator('cost-burdened-renters', 'Cost-burdened renters', {
      value: 54.0,
      target: 30,
      level_pct: -123, // hallucinated mental arithmetic — must be overwritten to +80!
      scoring: {
        threshold_ref: 'housing.cost-burdened-renters',
        function: 'lower_is_better',
        inputs: { value: 54, target: 30 },
        worked_math: 'bad math',
      },
      evidence: { snapshot_path: 'evidence/ok.png', text_path: 'evidence/ok.txt', captured_at: '2026-10-01T00:00:00Z' },
    });
    const escalatedOmitted = indicator('evictions', 'Eviction filings', {
      value: 4.2,
      source_url: 'https://courts.example.gov/evictions-2025.pdf',
      evidence: { snapshot_path: 'evidence/esc-recaptured.png', text_path: 'evidence/esc-recaptured.txt', captured_at: '2026-10-01T00:02:00Z' },
    });

    const correctionPrompts: string[] = [];
    const escalationPrompts: string[] = [];
    const out = await evaluateDimensionFindings(
      {
        sessionId: 'sess-p0',
        config,
        dimensionSlug: 'housing',
        dimensionName: 'Housing',
        regionBrief: 'Santa Cruz brief.',
        plan: planStrategy('hybrid@1'),
        // 'evictions' was planned but omitted by initial pass!
        rawFindings: [initialWithBadMath],
        plannedSlugs: ['cost-burdened-renters', 'evictions'],
        salvaged: false,
        initialKeyFailure: null,
      },
      {
        deterministicChecks: (raw, cfg, slug) => deterministicChecks(raw, cfg, slug, async () => true),
        checkValueOnPage: async (payload) =>
          payload.kind === 'gap' ? undefined : valueOnPage(payload.value, files[payload.evidence.text_path ?? '']),
        runCorrectionSession: vi.fn(async ({ prompt }) => {
          correctionPrompts.push(prompt);
          // Correction fails to recover 'evictions' (returns empty JSON) -> hybrid must still escalate it!
          return {
            resultText: '[]',
            succeeded: true,
            transcript: gzipSync('{"type":"correction_frame"}'),
            usage: usageOf('claude-sonnet-5', 500, 50),
          };
        }),
        runEscalationSession: vi.fn(async ({ prompt }) => {
          escalationPrompts.push(prompt);
          return {
            resultText: '',
            // Uses in-session submittedFindings directly (no extractJson needed)!
            submittedFindings: [escalatedOmitted],
            succeeded: true,
            transcript: gzipSync('{"type":"escalation_frame"}'),
            usage: usageOf('claude-opus-5', 2000, 300),
          };
        }),
        runVerifier: vi.fn(async () => ({
          verdict: { content_supported: 'pass' as const },
          usage: usageOf('claude-opus-5', 400, 40),
        })),
      },
    );

    expect(correctionPrompts).toHaveLength(1);
    expect(correctionPrompts[0]).toContain('MISSING PLANNED INDICATOR');
    expect(correctionPrompts[0]).toContain('evictions');
    expect(escalationPrompts).toHaveLength(1);
    expect(escalationPrompts[0]).toContain('Housing');
    expect(escalationPrompts[0]).toContain('OMITTED this planned indicator');
    expect(escalationPrompts[0]).toContain('evictions');

    const bySlug = Object.fromEntries(out.records.map((r) => [r.indicatorSlug, r]));
    // Deterministic computeScoring fixed the wrong LLM math (-123 -> 80)!
    expect((bySlug['cost-burdened-renters']!.payload as IndicatorFindingPayload).level_pct).toBe(80);
    // Escalated indicator recorded stage & model provenance!
    expect(bySlug.evictions!.verification.produced_by_stage).toBe('escalation');
    expect(bySlug.evictions!.verification.produced_by_model).toBe('claude-opus-5');
    expect(bySlug.evictions!.verification.content_supported).toBe('pass');

    // Combined stage transcripts include initial + correction + escalation with stage markers.
    expect(out.correctionTranscript).toBeDefined();
    expect(out.escalationTranscript).toBeDefined();
    const combined = gunzipSync(
      combineStageTranscripts([
        { stage: 'initial', transcript: gzipSync('{"type":"initial_frame"}') },
        { stage: 'correction', transcript: out.correctionTranscript! },
        { stage: 'escalation', transcript: out.escalationTranscript! },
      ]),
    ).toString('utf8');
    expect(combined).toContain('{"type":"stage_marker","stage":"initial"}');
    expect(combined).toContain('{"type":"initial_frame"}');
    expect(combined).toContain('{"type":"stage_marker","stage":"correction"}');
    expect(combined).toContain('{"type":"correction_frame"}');
    expect(combined).toContain('{"type":"stage_marker","stage":"escalation"}');
    expect(combined).toContain('{"type":"escalation_frame"}');
  });

  it('recaptures evidence on escalated candidates when Opus changed source_url without calling capture_evidence', async () => {
    const initialFail = indicator('rent', 'Rent burden', {
      source_url: 'https://old.example.gov/wrong.pdf',
      evidence: { snapshot_path: 'evidence/old.png', text_path: 'evidence/old.txt', captured_at: '2026-10-01T00:00:00Z' },
    });
    const escalatedNewUrlOldSnap = indicator('rent', 'Rent burden', {
      source_url: 'https://new.example.gov/right.pdf',
      evidence: initialFail.evidence, // forgot to re-capture
    });
    const recaptureEvidence = vi.fn(async () => ({
      snapshot_path: 'evidence/fresh-esc.png',
      text_path: 'evidence/fresh-esc.txt',
      captured_at: '2026-10-01T00:05:00Z',
    }));
    const runVerifier = vi.fn(async (p: IndicatorFindingPayload) => ({
      verdict: { content_supported: p.source_url.includes('new.example.gov') ? ('pass' as const) : ('fail' as const) },
      usage: usageOf('claude-opus-5', 300, 30),
    }));

    const out = await evaluateDimensionFindings(
      {
        sessionId: 'sess-esc-recap',
        config,
        dimensionSlug: 'housing',
        dimensionName: 'Housing',
        regionBrief: 'Brief.',
        plan: planStrategy('hybrid@1'),
        rawFindings: [initialFail],
        salvaged: false,
        initialKeyFailure: null,
      },
      {
        deterministicChecks: (raw, cfg, slug) => deterministicChecks(raw, cfg, slug, async () => true),
        checkValueOnPage: async () => 'found',
        recaptureEvidence,
        runCorrectionSession: vi.fn(),
        runEscalationSession: vi.fn(async () => ({
          resultText: JSON.stringify([escalatedNewUrlOldSnap]),
          succeeded: true,
          transcript: Buffer.from('esc'),
          usage: usageOf('claude-opus-5', 1000, 200),
        })),
        runVerifier,
      },
    );

    expect(recaptureEvidence).toHaveBeenCalledWith('https://new.example.gov/right.pdf', 'https://new.example.gov/right.pdf');
    expect((out.records[0]!.payload as IndicatorFindingPayload).evidence.snapshot_path).toBe('evidence/fresh-esc.png');
    expect(out.records[0]!.verification.content_supported).toBe('pass');
  });

  it('runs verifiers with bounded concurrency (<= 4 in-flight at once)', async () => {
    let active = 0;
    let peak = 0;
    const out = await runWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 4, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });
});
