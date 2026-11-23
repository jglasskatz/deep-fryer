import { describe, expect, it } from 'vitest';
import { defaultPortraitConfig } from '@deep-fryer/contract';
import type { GapFindingPayload, IndicatorFindingPayload } from '@deep-fryer/core';
import {
  renderHybridEscalationPrompt,
  selectEscalationCandidates,
  shouldAcceptEscalation,
  type EvaluatedFindingSnapshot,
} from './hybrid.js';

const config = defaultPortraitConfig('City of Santa Cruz', 'City of Santa Cruz municipal boundary');

const indicator = (slug: string, name: string): IndicatorFindingPayload => ({
  kind: 'indicator',
  indicator_slug: slug,
  name,
  value: 42,
  unit: '%',
  year: 2024,
  target: 30,
  level_pct: 40,
  scoring: {
    threshold_ref: `housing.${slug}`,
    function: 'lower_is_better',
    inputs: { value: 42, target: 30 },
    worked_math: '(42 - 30) / 30 * 100 = 40',
  },
  source: 'City Housing Report',
  source_url: `https://stats.example.gov/housing/${slug}.pdf`,
  source_tier: 1,
  evidence: { snapshot_path: `evidence/${slug}.png`, captured_at: '2026-10-01T00:00:00Z' },
  confidence: 'high',
  geographic_scale: 'city',
});

const gap = (slug: string, extra: Partial<GapFindingPayload> = {}): GapFindingPayload => ({
  kind: 'gap',
  indicator_slug: slug,
  reason: 'No municipal figure published',
  scales_tried: ['city'],
  tiers_tried: [1],
  searched_at: '2026-10-01T00:00:00Z',
  ...extra,
});

describe('hybrid escalation selection and prompt rendering', () => {
  it('selects ONLY gaps and verification-failed findings, leaving passed and uncertain findings untouched', () => {
    const evaluated: EvaluatedFindingSnapshot[] = [
      { indicatorSlug: 'passed-ind', payload: indicator('passed-ind', 'Passed'), verdict: { content_supported: 'pass' } },
      { indicatorSlug: 'uncertain-ind', payload: indicator('uncertain-ind', 'Uncertain'), verdict: { content_supported: 'uncertain' } },
      { indicatorSlug: 'gap-ind', payload: gap('gap-ind'), verdict: { content_supported: 'uncertain' } },
      {
        indicatorSlug: 'failed-ind',
        payload: indicator('failed-ind', 'Failed'),
        verdict: { content_supported: 'fail', verifier_note: 'Source states 31%, not 42%.' },
      },
      { indicatorSlug: 'unknown', payload: null, verdict: { content_supported: 'fail' } },
    ];

    const selected = selectEscalationCandidates(evaluated);
    expect(selected.map((c) => [c.indicatorSlug, c.reason])).toEqual([
      ['gap-ind', 'gap'],
      ['failed-ind', 'verification_failed'],
    ]);
  });

  it('renders a targeted Opus deep-discovery prompt naming ONLY the escalated indicators and their prior failure context', () => {
    const candidates = selectEscalationCandidates([
      { indicatorSlug: 'passed-ind', payload: indicator('passed-ind', 'Passed'), verdict: { content_supported: 'pass' } },
      { indicatorSlug: 'gap-ind', payload: gap('gap-ind', { nearest_data: '2018 county report' }), verdict: { content_supported: 'uncertain' } },
      {
        indicatorSlug: 'failed-ind',
        payload: indicator('failed-ind', 'Failed Rent'),
        verdict: { content_supported: 'fail', verifier_note: 'Page shows 31%, not 42%.' },
      },
    ]);

    const prompt = renderHybridEscalationPrompt({
      config,
      dimensionSlug: 'housing',
      dimensionName: 'Housing',
      regionBrief: 'Coastal city.',
      candidates,
    });

    expect(prompt).toContain('gap-ind');
    expect(prompt).toContain('2018 county report');
    expect(prompt).toContain('failed-ind');
    expect(prompt).toContain('Page shows 31%, not 42%.');
    expect(prompt).not.toContain('passed-ind');
  });

  it('accepts verified upgrades and honest gaps for failed findings, while refusing to replace an honest gap with a failed fabrication', () => {
    const initialGap: EvaluatedFindingSnapshot = {
      indicatorSlug: 'aragonite-saturation',
      payload: gap('aragonite-saturation'),
      verdict: { content_supported: 'uncertain' },
    };
    const initialFail: EvaluatedFindingSnapshot = {
      indicatorSlug: 'rent-burden',
      payload: indicator('rent-burden', 'Rent burden'),
      verdict: { content_supported: 'fail' },
    };

    // Gap -> verified indicator: accept.
    expect(
      shouldAcceptEscalation(initialGap, {
        indicatorSlug: 'aragonite-saturation',
        payload: indicator('aragonite-saturation', 'Aragonite'),
        verdict: { content_supported: 'pass' },
      }),
    ).toBe(true);

    // Gap -> verification-failed indicator: REJECT (never overwrite honest gap with fabrication).
    expect(
      shouldAcceptEscalation(initialGap, {
        indicatorSlug: 'aragonite-saturation',
        payload: indicator('aragonite-saturation', 'Aragonite'),
        verdict: { content_supported: 'fail' },
      }),
    ).toBe(false);

    // Failed indicator -> honest gap: ACCEPT (gaps outrank guesses).
    expect(
      shouldAcceptEscalation(initialFail, {
        indicatorSlug: 'rent-burden',
        payload: gap('rent-burden'),
        verdict: { content_supported: 'uncertain' },
      }),
    ).toBe(true);

    // Failed indicator -> verified indicator: ACCEPT.
    expect(
      shouldAcceptEscalation(initialFail, {
        indicatorSlug: 'rent-burden',
        payload: indicator('rent-burden', 'Rent burden'),
        verdict: { content_supported: 'pass' },
      }),
    ).toBe(true);

    // Failed indicator -> another failed indicator: REJECT (no improvement).
    expect(
      shouldAcceptEscalation(initialFail, {
        indicatorSlug: 'rent-burden',
        payload: indicator('rent-burden', 'Rent burden'),
        verdict: { content_supported: 'fail' },
      }),
    ).toBe(false);

    // Gap -> uncertain indicator: REJECT (must pass verification to replace an honest gap).
    expect(
      shouldAcceptEscalation(initialGap, {
        indicatorSlug: 'aragonite-saturation',
        payload: indicator('aragonite-saturation', 'Aragonite'),
        checks: { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true },
        verdict: { content_supported: 'uncertain' },
      }),
    ).toBe(false);

    // Gap -> pass indicator that violates recency/scale/url deterministic gates: REJECT!
    for (const badChecks of [
      { schema_ok: true, url_ok: false, recency_ok: true, scale_ok: true },
      { schema_ok: true, url_ok: true, recency_ok: false, scale_ok: true },
      { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: false },
    ]) {
      expect(
        shouldAcceptEscalation(initialGap, {
          indicatorSlug: 'aragonite-saturation',
          payload: indicator('aragonite-saturation', 'Aragonite'),
          checks: badChecks,
          verdict: { content_supported: 'pass' },
        }),
      ).toBe(false);
    }

    // Gap -> pass indicator with passing deterministic gates: ACCEPT.
    expect(
      shouldAcceptEscalation(initialGap, {
        indicatorSlug: 'aragonite-saturation',
        payload: indicator('aragonite-saturation', 'Aragonite'),
        checks: { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true },
        verdict: { content_supported: 'pass' },
      }),
    ).toBe(true);
  });

  it('selects omitted/missing planned indicators for escalation with reason "missing"', () => {
    const selected = selectEscalationCandidates([
      { indicatorSlug: 'omitted-ind', payload: null, verdict: { content_supported: 'fail' }, missing: true },
    ]);
    expect(selected.map((c) => [c.indicatorSlug, c.reason])).toEqual([['omitted-ind', 'missing']]);
    const prompt = renderHybridEscalationPrompt({
      config,
      dimensionSlug: 'housing',
      dimensionName: 'Housing',
      regionBrief: 'Coastal city.',
      candidates: selected,
    });
    expect(prompt).toContain('OMITTED this planned indicator');
    expect(prompt).toContain('omitted-ind');
  });
});
