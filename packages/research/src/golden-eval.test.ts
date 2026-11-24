import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SessionTokenUsage } from '@deep-fryer/core';
import {
  loadCaliforniaGolden,
  renderGoldenScorecardMarkdown,
  scoreFindingAgainstGolden,
  scoreGoldenRun,
  selectCaliforniaGoldenDimensions,
} from './golden-eval.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('loadCaliforniaGolden', () => {
  const dataset = loadCaliforniaGolden(REPO_ROOT);

  it('loads all 42 verified California 2025 indicators across 21 canonical dimensions', () => {
    expect(dataset.indicators).toHaveLength(42);
    expect(dataset.dimensionSlugs).toHaveLength(21);
    expect(dataset.report.doi).toBe('10.5281/zenodo.17540639');
    expect(dataset.report.tablePages).toEqual([84, 85]);

    const socialCount = dataset.indicators.filter((i) => i.ring === 'social').length;
    const ecoCount = dataset.indicators.filter((i) => i.ring === 'ecological').length;
    expect(socialCount).toBe(24);
    expect(ecoCount).toBe(18);
  });

  it('preserves report-verified native values separately from shortfall/overshoot scores', () => {
    const housing = dataset.byDimension['housing']!;
    expect(housing).toHaveLength(2);

    const homelessness = housing.find((i) => i.slug === 'homelessness')!;
    expect(homelessness.value).toBe('0.47%');
    expect(homelessness.numericValue).toBe(0.47);
    expect(homelessness.unit).toBe('%');
    expect(homelessness.year).toBe(2024);
    expect(homelessness.target).toBe('0%');
    expect(homelessness.score).toBe(35.9);
    expect(homelessness.page).toBe(84);
    expect(homelessness.source).toContain('HUD');

    const costBurden = housing.find((i) => i.slug === 'housing-cost-burden')!;
    expect(costBurden.value).toBe('55%');
    expect(costBurden.numericValue).toBe(55);
    expect(costBurden.year).toBe(2018);
    expect(costBurden.score).toBe(55);

    const air = dataset.byDimension['air-pollution']!;
    expect(air).toHaveLength(2);
    expect(air.map((i) => i.slug).sort()).toEqual(['ozone-pollution', 'particulate-matter']);
    expect(air[0]!.value).toBe('60%');
    expect(air[0]!.year).toBe(2023);
    expect(air[0]!.page).toBe(85);

    const ghg = dataset.byDimension['climate-change']!.find((i) => i.slug === 'greenhouse-gas-footprint')!;
    expect(ghg.value).toBe('19.6');
    expect(ghg.numericValue).toBe(19.6);
    expect(ghg.unit).toBe('Tonnes CO2 eq');
    expect(ghg.score).toBe(1890);
  });

  it('resolves both canonical and California-native dimension slugs', () => {
    const selected = selectCaliforniaGoldenDimensions(dataset, ['housing', 'income-and-work', 'air-pollution']);
    expect(selected.dimensionSlugs).toEqual(['housing', 'income-work', 'air-pollution']);
    expect(selected.indicators).toHaveLength(6);
  });
});

describe('scoreFindingAgainstGolden & scoreGoldenRun', () => {
  const dataset = loadCaliforniaGolden(REPO_ROOT);
  const housing = dataset.byDimension['housing']!;
  const air = dataset.byDimension['air-pollution']!;
  const homelessness = housing.find((i) => i.slug === 'homelessness')!;
  const costBurden = housing.find((i) => i.slug === 'housing-cost-burden')!;
  const pm25 = air.find((i) => i.slug === 'particulate-matter')!;
  const ozone = air.find((i) => i.slug === 'ozone-pollution')!;
  const ods = dataset.byDimension['ozone-depletion']!.find((i) => i.slug === 'ozone-depleting-substances')!;

  it('classifies exact (<=2%), including safe unit normalization and newer_primary_data', () => {
    // 47.2 per 10,000 residents == 0.472% vs golden 0.47% -> +0.43% relative error -> exact!
    const score = scoreFindingAgainstGolden(
      {
        indicator_slug: 'homelessness-rate',
        kind: 'indicator',
        value: 47.2,
        unit: 'per 10,000 residents',
        year: 2025,
        source_name: 'HUD 2025 Point-in-Time Count',
        source_url: 'https://files.hudexchange.info/reports/published/CoC_PopSub_State_CA_2025.pdf',
      },
      homelessness,
    );
    expect(score.matchBand).toBe('exact');
    expect(score.matched).toBe(true);
    expect(score.unitsCompatible).toBe(true);
    expect(score.normalizedResearchedValue).toBeCloseTo(0.472, 4);
    expect(score.relativeErrorPct).toBeLessThanOrEqual(2);
    expect(score.yearDelta).toBe(1);
    expect(score.newerPrimaryData).toBe(true);
    expect(score.temporalNote).toBe('newer_primary_data');
    expect(score.sourceLeakDetected).toBe(false);
  });

  it('classifies close (<=10%), directional (<=25%), divergent (>25%), and categorical exact', () => {
    // Close: 53.0% vs 55% (-3.64% error) + newer 2023 ACS data (+5y vs 2018 report figure)
    const closeScore = scoreFindingAgainstGolden(
      {
        indicator_slug: 'housing-cost-burden',
        kind: 'indicator',
        value: 53,
        unit: '% of renter households',
        year: 2023,
        source_name: 'U.S. Census Bureau ACS 2023',
        source_url: 'https://data.census.gov/table/ACSDT1Y2023.B25070',
      },
      costBurden,
    );
    expect(closeScore.matchBand).toBe('close');
    expect(closeScore.matched).toBe(true);
    expect(closeScore.newerPrimaryData).toBe(true);
    expect(closeScore.yearDelta).toBe(5);

    // Directional: 48% vs 60% (-20% error)
    const dirScore = scoreFindingAgainstGolden(
      {
        indicator_slug: 'particulate-matter',
        kind: 'indicator',
        value: 48,
        unit: '%',
        year: 2023,
        source_name: 'CARB',
        source_url: 'https://www.arb.ca.gov/adam/select8/sc8start.php',
      },
      pm25,
    );
    expect(dirScore.matchBand).toBe('directional');
    expect(dirScore.matched).toBe(true);

    // Divergent: 20% vs 60% (-66.7% error), NOT falsely downgraded to directional just because target is 0%!
    const divScore = scoreFindingAgainstGolden(
      {
        indicator_slug: 'ozone-pollution',
        kind: 'indicator',
        value: 20,
        unit: '%',
        year: 2023,
        source_name: 'CARB',
        source_url: 'https://www.arb.ca.gov/adam/select8/sc8start.php',
      },
      ozone,
    );
    expect(divScore.matchBand).toBe('divergent');
    expect(divScore.matched).toBe(false);
    expect(divScore.relativeErrorPct).toBeCloseTo(66.6667, 2);

    // Directional via same-side-of-target when units differ (e.g. µg/m³ exceeding threshold vs % basins)
    const unitMismatchDir = scoreFindingAgainstGolden(
      {
        indicator_slug: 'pm25-annual',
        kind: 'indicator',
        value: 11.4,
        unit: 'µg/m³',
        year: 2024,
        level_pct: 26.7,
        source_name: 'U.S. EPA AirData',
        source_url: 'https://www.epa.gov/outdoor-air-quality-data',
      },
      pm25,
    );
    expect(unitMismatchDir.unitsCompatible).toBe(false);
    expect(unitMismatchDir.sameSideOfTarget).toBe(true);
    expect(unitMismatchDir.matchBand).toBe('directional');

    // Categorical Yes/No exact match
    const catScore = scoreFindingAgainstGolden(
      {
        indicator_slug: 'ozone-depleting-substances',
        kind: 'indicator',
        value: 'Yes',
        unit: 'Yes/No',
        year: 2024,
        source_name: 'CARB',
        source_url: 'https://ww2.arb.ca.gov/our-work/programs/compliance-offset-program',
      },
      ods,
    );
    expect(catScore.matchBand).toBe('exact');
    expect(catScore.matched).toBe(true);
  });

  it('classifies gap_or_missing and automatic-fail source_leak accurately and renders scorecard markdown', () => {
    const usage: SessionTokenUsage = {
      input_tokens: 40_000,
      output_tokens: 6_000,
      model: 'claude-sonnet-5',
      by_model: {
        'claude-sonnet-5': {
          input_tokens: 40_000,
          output_tokens: 6_000,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          web_search_requests: 0,
        },
      },
    };

    const targetIndicators = [...housing, ...air];
    const scorecard = scoreGoldenRun(
      [
        {
          indicator_slug: 'housing-cost-burden',
          dimensionSlug: 'housing',
          kind: 'indicator',
          value: 54.5,
          unit: '%',
          year: 2023,
          source_name: 'U.S. Census Bureau ACS',
          source_url: 'https://data.census.gov/table/ACSDT1Y2023.B25070',
        },
        {
          indicator_slug: 'homelessness',
          dimensionSlug: 'housing',
          kind: 'gap',
        },
        {
          indicator_slug: 'particulate-matter',
          dimensionSlug: 'air-pollution',
          kind: 'indicator',
          value: 60,
          unit: '%',
          year: 2023,
          source_name: 'California Doughnut Economics Report 2025',
          source_url: 'https://zenodo.org/records/17540639',
        },
        // ozone-pollution intentionally omitted -> gap_or_missing
      ],
      targetIndicators,
      {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        strategy: 'hybrid@1',
        usage,
        runId: 'test-ca-run',
        generatedAt: '2026-11-24T00:00:00Z',
      },
    );

    expect(scorecard.totalIndicators).toBe(4);
    expect(scorecard.exactCount).toBe(1);
    expect(scorecard.gapOrMissingCount).toBe(2);
    expect(scorecard.sourceLeakCount).toBe(1);
    expect(scorecard.newerPrimaryDataCount).toBe(1);
    expect(scorecard.clean).toBe(false);
    expect(scorecard.totalTokens).toBe(46_000);
    expect(scorecard.estimatedCostUsd).not.toBeNull();

    const md = renderGoldenScorecardMarkdown(scorecard);
    expect(md).toContain('# California 2025 Golden-Test Benchmark Scorecard');
    expect(md).toContain('| Indicator | Golden CA Report Value (Year) | Researched Value (Year) | Relative Diff | Match Band | Source Leak? | Tokens / USD Cost |');
    expect(md).toContain('`[newer_primary_data]`');
    expect(md).toContain('`source_leak`');
    expect(md).toContain('**YES (FAIL)**');
    expect(md).toContain('Source-Leak Audit Failures');
  });
});
