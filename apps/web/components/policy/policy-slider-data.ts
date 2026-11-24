import type { Ring } from '@deep-fryer/core';

export interface PolicyBaselineDimension {
  slug: string;
  name: string;
  ring: Ring;
  /** Canonical viz_level (-100..150) from the published/researched portrait, or null when unscored/gap. */
  level: number | null;
  /** True when the portrait has a real observation without a scoring target (neutral slate vs pale gap). */
  unscored?: boolean;
}

export type PolicyImpactDirection = 'improves' | 'mixed';
export type PolicyMetricAlignment = 'direct' | 'proxy';

export interface PolicyDimensionImpact {
  slug: string;
  direction: PolicyImpactDirection;
  /**
   * Whether the cited study measures the portrait's exact Doughnut indicator
   * (`direct`) or only an upstream output / adjacent metric (`proxy`).
   * Only `direct` matches may shift a wedge's numeric level; `proxy` impacts
   * hold the wedge at its baseline level so output counts are never mistaken
   * for a measured Doughnut outcome.
   */
  metricAlignment: PolicyMetricAlignment;
  /**
   * Post-policy viz_level on the renderer scale (computed on the exact same
   * Doughnut metric & threshold), or null when `metricAlignment === 'proxy'`
   * or the baseline dimension is unscored.
   */
  afterLevel: number | null;
  note: string;
}

export interface PolicySliderItem {
  id:
    | 'sc-water-rationing'
    | 'nyc-clean-heat'
    | 'sc-adu-reform'
    | 'nyc-right-to-counsel'
    | 'nyc-universal-school-meals';
  city: 'santa-cruz' | 'nyc';
  place: string;
  title: string;
  shortLabel: string;
  year: string;
  jurisdiction: string;
  mechanism: string;
  /** Exact Doughnut indicator & threshold this policy is evaluated against. */
  doughnutMetric: string;
  /** Whether at least one wedge moves on a direct Doughnut-indicator measurement. */
  metricAlignment: PolicyMetricAlignment;
  baselineMetric: string;
  observedShift: string;
  evidenceGrade: string;
  evidenceKind: string;
  caveat: string;
  source: {
    title: string;
    url: string;
  };
  baseline: readonly PolicyBaselineDimension[];
  impacts: readonly PolicyDimensionImpact[];
  /** Human-readable interpolation summary for the live slider readout. */
  sliderReadout: {
    before: string;
    after: string;
  };
}

/**
 * Colours used on the canonical DoughnutRenderer for policy comparisons:
 * - At 0% ("Before"), impacted wedges carry selection blue so the visitor
 *   immediately sees which slice(s) the policy touches on the baseline chart.
 * - Above 0% (moving toward "With policy"), impacted wedges switch to forest
 *   green (directional improvement) or warm amber (mixed / unquantified tradeoff).
 */
export const POLICY_SLIDER_COLOURS = {
  focus: '#0066cc',
  improves: '#2e7d32',
  mixed: '#b7791f',
  withinTarget: '#8cd755',
  unscored: '#777777',
} as const;

/**
 * Baseline portrait dimensions for City of Santa Cruz, scored against the shared
 * framework thresholds in packages/contract/framework/thresholds.json:
 * - Income & Work: 17.0% poverty (ACS 2024) vs 8% target → +112.5% → viz 150
 * - Housing: 1,024 PIT unhoused (~162.6/10k) vs 10/10k target → viz 150
 * - Social Equity: 0.4936 Gini (ACS 2024) vs 0.40 target → +23.4% → viz 46.8
 * - Networks: 95.5% broadband (ACS 2024) vs 95% target → -0.5% → viz -1
 * - Extreme Heat: 16.8% residents in top-2 CDC EJI 2024 Climate Burden quintiles
 *   (RPL_EJI_CBM >= 0.60, county proxy) vs 0% HVI target → +16.8% → viz 33.6
 * - Nitrogen & Phosphorus remains a genuine city-level data gap (null).
 */
export const SANTA_CRUZ_BASELINE: readonly PolicyBaselineDimension[] = [
  { slug: 'food', name: 'Food', ring: 'social', level: 75 },
  { slug: 'health', name: 'Health', ring: 'social', level: -25 },
  { slug: 'education', name: 'Education', ring: 'social', level: -25 },
  { slug: 'income-work', name: 'Income & Work', ring: 'social', level: 150 },
  { slug: 'housing', name: 'Housing', ring: 'social', level: 150 },
  { slug: 'water-sanitation', name: 'Water & Sanitation', ring: 'social', level: -50 },
  { slug: 'energy', name: 'Energy', ring: 'social', level: 0 },
  { slug: 'social-equity', name: 'Social Equity', ring: 'social', level: 46.8 },
  { slug: 'peace-justice', name: 'Peace & Justice', ring: 'social', level: 50 },
  { slug: 'political-voice', name: 'Political Voice', ring: 'social', level: -50 },
  { slug: 'gender-equality', name: 'Gender Equality', ring: 'social', level: 50 },
  { slug: 'networks', name: 'Networks', ring: 'social', level: -1 },
  { slug: 'climate-change', name: 'Climate Change', ring: 'ecological', level: 50 },
  { slug: 'ocean-acidification', name: 'Ocean Acidification', ring: 'ecological', level: 50 },
  { slug: 'chemical-pollution', name: 'Chemical Pollution', ring: 'ecological', level: 0 },
  { slug: 'nitrogen-phosphorus-loading', name: 'Nitrogen & Phosphorus', ring: 'ecological', level: null },
  { slug: 'freshwater-withdrawals', name: 'Freshwater Withdrawals', ring: 'ecological', level: 50 },
  { slug: 'land-conversion', name: 'Land Conversion', ring: 'ecological', level: -50 },
  { slug: 'biodiversity-loss', name: 'Biodiversity Loss', ring: 'ecological', level: 0 },
  { slug: 'air-pollution', name: 'Air Pollution', ring: 'ecological', level: -50 },
  { slug: 'extreme-heat', name: 'Extreme Heat', ring: 'ecological', level: 33.6 },
  { slug: 'waste-materials', name: 'Waste & Materials', ring: 'ecological', level: 0 },
];

/**
 * Verified 2025 California Doughnut Report dimensions (all 21 dimensions from
 * site/imports/california/doughnut.json + report-audit.json, mapped via pctToVizLevel).
 */
export const CALIFORNIA_BASELINE: readonly PolicyBaselineDimension[] = [
  { slug: 'food', name: 'Food', ring: 'social', level: 52.2 },
  { slug: 'health', name: 'Health', ring: 'social', level: 85.5 },
  { slug: 'education', name: 'Education', ring: 'social', level: 74 },
  { slug: 'income-and-work', name: 'Income & Work', ring: 'social', level: 24.7 },
  { slug: 'water-and-sanitation', name: 'Water & Sanitation', ring: 'social', level: 2.8 },
  { slug: 'energy', name: 'Energy', ring: 'social', level: 26.6 },
  { slug: 'connectivity-and-transportation', name: 'Connectivity', ring: 'social', level: 56.9 },
  { slug: 'housing', name: 'Housing', ring: 'social', level: 90.9 },
  { slug: 'equity', name: 'Equity', ring: 'social', level: 52.9 },
  { slug: 'social-cohesion', name: 'Social Cohesion', ring: 'social', level: 113 },
  { slug: 'political-voice', name: 'Political Voice', ring: 'social', level: 56 },
  { slug: 'peace-and-justice', name: 'Peace & Justice', ring: 'social', level: 132.5 },
  { slug: 'climate-change', name: 'Climate Change', ring: 'ecological', level: 150 },
  { slug: 'ocean-acidification', name: 'Ocean Acidification', ring: 'ecological', level: 150 },
  { slug: 'chemical-pollution', name: 'Chemical Pollution', ring: 'ecological', level: 78 },
  { slug: 'nitrogen-and-phosphorus', name: 'Nitrogen & Phosphorus', ring: 'ecological', level: 150 },
  { slug: 'freshwater-use', name: 'Freshwater Use', ring: 'ecological', level: 119.5 },
  { slug: 'land-use-change', name: 'Land Use Change', ring: 'ecological', level: 150 },
  { slug: 'biodiversity-loss', name: 'Biodiversity Loss', ring: 'ecological', level: 150 },
  { slug: 'air-pollution', name: 'Air Pollution', ring: 'ecological', level: 110 },
  { slug: 'ozone-depletion', name: 'Ozone Depletion', ring: 'ecological', level: 0 },
];

/**
 * Baseline portrait dimensions from site/data/portraits.json (New York City).
 * Scores and unscored/gap states match the public snapshot exactly.
 */
export const NYC_BASELINE: readonly PolicyBaselineDimension[] = [
  { slug: 'food', name: 'Food', ring: 'social', level: 150 },
  { slug: 'health', name: 'Health', ring: 'social', level: 136 },
  { slug: 'education', name: 'Education', ring: 'social', level: 72 },
  { slug: 'income-work', name: 'Income & Work', ring: 'social', level: 150 },
  { slug: 'water-sanitation', name: 'Water & Sanitation', ring: 'social', level: null },
  { slug: 'energy', name: 'Energy', ring: 'social', level: null },
  { slug: 'networks', name: 'Networks', ring: 'social', level: 50.2 },
  { slug: 'housing', name: 'Housing', ring: 'social', level: 150 },
  { slug: 'gender-equality', name: 'Gender Equality', ring: 'social', level: -8 },
  { slug: 'social-equity', name: 'Social Equity', ring: 'social', level: 77.5 },
  { slug: 'political-voice', name: 'Political Voice', ring: 'social', level: 81.14 },
  { slug: 'peace-justice', name: 'Peace & Justice', ring: 'social', level: 118.6 },
  { slug: 'climate-change', name: 'Climate Change', ring: 'ecological', level: 150 },
  { slug: 'ocean-acidification', name: 'Ocean Acidification', ring: 'ecological', level: 113.67 },
  { slug: 'chemical-pollution', name: 'Chemical Pollution', ring: 'ecological', level: null, unscored: true },
  { slug: 'nitrogen-phosphorus-loading', name: 'Nitrogen & Phosphorus', ring: 'ecological', level: null },
  { slug: 'freshwater-withdrawals', name: 'Freshwater Withdrawals', ring: 'ecological', level: 150 },
  { slug: 'land-conversion', name: 'Land Conversion', ring: 'ecological', level: 44 },
  { slug: 'biodiversity-loss', name: 'Biodiversity Loss', ring: 'ecological', level: null, unscored: true },
  { slug: 'air-pollution', name: 'Air Pollution', ring: 'ecological', level: 50.2 },
  { slug: 'extreme-heat', name: 'Extreme Heat', ring: 'ecological', level: 148 },
];

/**
 * Five curated retrospective policy case studies from site/policy-view/policy-data.json,
 * strictly enforcing Doughnut-metric alignment:
 * - Only studies that measure a change in the exact Doughnut indicator (`metricAlignment: 'direct'`)
 *   move a wedge's numeric level.
 * - Studies that only report upstream outputs or adjacent metrics (`metricAlignment: 'proxy'`, e.g.,
 *   ADU permits instead of homelessness, or lunch uptake instead of household food insecurity) keep
 *   the Doughnut wedge locked at baseline and disclose the metric gap explicitly.
 */
export const POLICY_SLIDER_CASES: readonly PolicySliderItem[] = [
  {
    id: 'sc-water-rationing',
    city: 'santa-cruz',
    place: 'Santa Cruz, CA',
    title: 'Drought water rationing',
    shortLabel: 'SC · Water rationing',
    year: '2014 response',
    jurisdiction: 'City of Santa Cruz Water Department service area',
    mechanism:
      'Stage 3 emergency mandatory 25% cut with spray-irrigation hour limits, runoff bans, and hard-surface hosing restrictions.',
    doughnutMetric: 'Residential water use (gal/person/day) · target ≤ 55 gpcd (CA AB 1668)',
    metricAlignment: 'direct',
    baselineMetric: '~64 gal/person/day residential (2013 service-area baseline; 95% surface-water dependent)',
    observedShift: '47 gal/person/day residential (−26% average monthly water use, Jun–Nov 2014 vs Jun–Nov 2013)',
    evidenceGrade: 'Descriptive',
    evidenceKind: 'Administrative before–after',
    caveat:
      'Direct match on residential gpcd, but utility service-area scope (not city limits) with no untreated control: drought, publicity, restrictions, and rates cannot be separated, and ecological streamflow closure was not measured.',
    source: {
      title: 'Santa Cruz County HSA, Water Resources Management Status Report for 2014 (Jan 27, 2015, Attachment 2, PDF p. 13)',
      url: 'https://www2.santacruzcountyca.gov/BDS/GovStream2/ASP/Display/PdfFinder.asp?Filename=024.pdf&MeetingDate=20150127&MeetingID=648&Type=Minutes',
    },
    baseline: SANTA_CRUZ_BASELINE,
    impacts: [
      {
        slug: 'freshwater-withdrawals',
        direction: 'improves',
        metricAlignment: 'direct',
        afterLevel: -29,
        note: 'Directly measured on the Doughnut metric: residential demand dropped to 47 gpcd (−26%), pulling below the 55 gpcd CA AB 1668 boundary (level_pct = −14.5% → viz −29).',
      },
      {
        slug: 'water-sanitation',
        direction: 'mixed',
        metricAlignment: 'proxy',
        afterLevel: null,
        note: 'Wedge held at baseline: affordability and fixed fee pressures on lower-income households were not measured.',
      },
    ],
    sliderReadout: {
      before: '~64 gpcd pre-rationing baseline (overshoot)',
      after: '47 gpcd measured residential demand (−26%)',
    },
  },
  {
    id: 'nyc-clean-heat',
    city: 'nyc',
    place: 'New York City, NY',
    title: 'Clean Heat oil phaseout',
    shortLabel: 'NYC · Clean Heat',
    year: '2011–2015',
    jurisdiction: 'NYC DEP residual heating oil rule across 2,151 census tracts (5,300+ No. 6 conversions)',
    mechanism:
      'Phase out heavy No. 6 residual heating oil in multifamily boilers in favor of cleaner heating fuels.',
    doughnutMetric: 'Annual mean PM2.5 (µg/m³) · target ≤ 5.0 µg/m³ (WHO 2021)',
    metricAlignment: 'direct',
    baselineMetric: '6.26 µg/m³ annual mean PM2.5 (NYC portrait; level_pct +25.2% → viz 50.2)',
    observedShift:
      '−0.12 µg/m³ ambient PM2.5 (95% CI −0.15 to −0.09) per 10 converted buildings/tract (high-conversion tracts ≈ −0.36 µg/m³ → ~5.9 µg/m³)',
    evidenceGrade: 'Adjusted observational',
    evidenceKind: 'Spatial-lag regression (2011–2016)',
    caveat:
      'Direct match on ambient PM2.5 (µg/m³), though the per-10-building tract coefficient is not a total citywide causal average. Indoor PM2.5 was unchanged in a 48-apartment study (p = .99) and avoided deaths are modeled, not counted.',
    source: {
      title: 'Zhang, He et al. (2021), Environmental Health Perspectives 129(12):127701',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8653771/',
    },
    baseline: NYC_BASELINE,
    impacts: [
      {
        slug: 'air-pollution',
        direction: 'improves',
        metricAlignment: 'direct',
        afterLevel: 36,
        note: 'Directly measured on the Doughnut PM2.5 metric: −0.12 µg/m³ per 10 converted buildings/tract (illustrative high-conversion tract ~5.9 µg/m³ vs 5.0 µg/m³ target → viz 36).',
      },
      {
        slug: 'health',
        direction: 'mixed',
        metricAlignment: 'proxy',
        afterLevel: null,
        note: 'Wedge held at baseline: ambient PM2.5 associations did not measure counted local mortality or uninsured rates.',
      },
    ],
    sliderReadout: {
      before: '6.26 µg/m³ annual mean PM2.5 baseline',
      after: '−0.12 µg/m³ PM2.5 per 10 converted buildings/tract',
    },
  },
  {
    id: 'sc-adu-reform',
    city: 'santa-cruz',
    place: 'Santa Cruz County, CA',
    title: 'ADU permitting reform',
    shortLabel: 'SC · ADU reform',
    year: '2018–2021 + state laws',
    jurisdiction: 'Unincorporated Santa Cruz County (excludes City of Santa Cruz)',
    mechanism:
      'Ministerial review, eased setbacks and parking rules, fee relief, and pre-approved ADU designs to lower infill development barriers.',
    doughnutMetric: 'Homelessness rate (1,024 PIT unhoused) & renter cost burden · target ≤ 10/10k & ≤ 30%',
    metricAlignment: 'proxy',
    baselineMetric: '1,024 PIT unhoused in City of Santa Cruz (severe shortfall) · 28 county ADU permits (2017)',
    observedShift: '28 → 103 annual ADU permits (2017–2024) — Doughnut homelessness/rent-burden metric NOT measured',
    evidenceGrade: 'Descriptive',
    evidenceKind: 'Administrative output only',
    caveat:
      'Permitting output is NOT an evaluation of the Doughnut housing metric: more ADU permits do not show whether homelessness or renter cost burden fell, and permits cover unincorporated county rather than city limits. The Housing wedge is intentionally held at baseline.',
    source: {
      title: 'Santa Cruz County, 2024 General Plan Annual Report (Feb 2025, Table 1, PDF p. 13)',
      url: 'https://www2.santacruzcountyca.gov/planning/plnmeetings/PLNSupMaterial/PC/agendas/2025/20250226/006.pdf',
    },
    baseline: SANTA_CRUZ_BASELINE,
    impacts: [
      {
        slug: 'housing',
        direction: 'improves',
        metricAlignment: 'proxy',
        afterLevel: null,
        note: 'Wedge held at baseline (150): annual ADU permits rose 28 → 103, but no study measures an effect on Santa Cruz’s Doughnut housing metric (homelessness rate or rent burden).',
      },
    ],
    sliderReadout: {
      before: '1,024 PIT unhoused baseline · 28 ADU permits (2017)',
      after: '103 ADU permits (2024) · Doughnut housing wedge unchanged',
    },
  },
  {
    id: 'nyc-right-to-counsel',
    city: 'nyc',
    place: 'New York City, NY',
    title: 'Tenant Right to Counsel',
    shortLabel: 'NYC · Right to Counsel',
    year: '2017 law (Local Law 136)',
    jurisdiction: 'NYC Office of Civil Justice contracts in NY State Housing Court (ZIP-code rollout)',
    mechanism:
      'Publicly funded legal counsel for tenants at or below 200% of federal poverty guidelines facing eviction proceedings.',
    doughnutMetric: 'Homelessness rate (101.9/10k) & cost-burdened renters (51.6%) · target ≤ 10/10k & ≤ 30%',
    metricAlignment: 'proxy',
    baselineMetric: '101.9 unhoused per 10,000 residents · 51.6% renter households cost-burdened (NYC baseline)',
    observedShift:
      '−1.0 pp eviction probability across housing-court cases (−8.4 pp IV among represented compliers) — homelessness & rent burden NOT measured',
    evidenceGrade: 'Quasi-experimental',
    evidenceKind: 'Program-rollout estimate (2016–2019)',
    caveat:
      'Strong causal evidence on court evictions, but NOT measured on the portrait’s Doughnut housing metrics (homelessness rate or renter cost burden), and NYC Comptroller (May 2025) found representation fell from 71% to 42% (31% in the Bronx). Wedges stay at baseline.',
    source: {
      title: 'Cassidy & Currie (2023), Journal of Public Economics 222:104844; NYC Comptroller (May 2025)',
      url: 'https://doi.org/10.1016/j.jpubeco.2023.104844',
    },
    baseline: NYC_BASELINE,
    impacts: [
      {
        slug: 'housing',
        direction: 'improves',
        metricAlignment: 'proxy',
        afterLevel: null,
        note: 'Wedge held at baseline (150): reduced court eviction probability (−1.0 pp rollout / −8.4 pp IV), but homelessness rate and renter cost burden were not measured.',
      },
      {
        slug: 'peace-justice',
        direction: 'improves',
        metricAlignment: 'proxy',
        afterLevel: null,
        note: 'Wedge held at baseline: +12.4 pp legal representation in housing court, not measured on violent-crime/justice Doughnut metrics.',
      },
      {
        slug: 'social-equity',
        direction: 'mixed',
        metricAlignment: 'proxy',
        afterLevel: null,
        note: 'Wedge held at baseline: post-2021 representation gaps concentrated in the Bronx; Gini inequality was not measured.',
      },
    ],
    sliderReadout: {
      before: '101.9/10k unhoused · 51.6% rent-burdened baseline',
      after: '−1.0 pp court eviction prob. · Doughnut wedges unchanged',
    },
  },
  {
    id: 'nyc-universal-school-meals',
    city: 'nyc',
    place: 'New York City, NY',
    title: 'Universal school meals',
    shortLabel: 'NYC · School meals',
    year: '2017 citywide (2010–2013 eval)',
    jurisdiction: 'NYC public schools (federal CEP reimbursement framework)',
    mechanism:
      'Remove lunch prices and means-testing stigma to raise school meal participation and learning readiness.',
    doughnutMetric: 'Food insecurity rate (16.8%) & adult HS attainment · target ≤ 5% & ≥ 95%',
    metricAlignment: 'proxy',
    baselineMetric: '16.8% food insecurity · 64.0% poor / 45.6% non-poor middle-school reference lunch uptake',
    observedShift:
      '+5.4 pp poor / +11.0 pp non-poor lunch uptake; +0.032 to +0.083 SD math scores — household food insecurity NOT measured',
    evidenceGrade: 'Quasi-experimental',
    evidenceKind: 'Student fixed-effects DiD (2010–2013)',
    caveat:
      'Evaluated 2010–2013 middle-school meal uptake and test scores rather than the portrait’s Doughnut metrics (household food insecurity or adult HS attainment). Wedges are intentionally held at baseline.',
    source: {
      title: 'Schwartz & Rothbart (2020), Journal of Policy Analysis and Management 39(2):376–410',
      url: 'https://doi.org/10.1002/pam.22175',
    },
    baseline: NYC_BASELINE,
    impacts: [
      {
        slug: 'food',
        direction: 'improves',
        metricAlignment: 'proxy',
        afterLevel: null,
        note: 'Wedge held at baseline (150): lunch participation rose +5.4 pp (poor) / +11.0 pp (non-poor), but household food insecurity (16.8%) was not measured.',
      },
      {
        slug: 'education',
        direction: 'improves',
        metricAlignment: 'proxy',
        afterLevel: null,
        note: 'Wedge held at baseline (72): math scores rose +0.032 to +0.083 SD, not measured on the portrait’s HS attainment indicator.',
      },
    ],
    sliderReadout: {
      before: '16.8% food insecurity · 64.0% poor lunch uptake',
      after: '+5.4 pp lunch uptake · Doughnut wedges unchanged',
    },
  },
];

export interface InterpolatedRendererLevel {
  slug: string;
  type: 'inner' | 'outer';
  name: string;
  level: number | 'NaN';
  colour: string | null;
  impacted: boolean;
}

/** Clamp a slider progress value to [0, 100]. */
export function clampSliderProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

/**
 * Compute the canonical DoughnutRenderer level entries for a policy at a given
 * slider position (0 = Before / baseline portrait, 100 = With policy).
 *
 * Unscored dimensions (level === null) never acquire an invented numeric score;
 * impacted scored social dimensions start interpolating from their visible inner
 * cap (100) so dragging moves the wedge smoothly across the full 0..100 range.
 */
export function interpolatePolicyLevels(
  policy: PolicySliderItem,
  progress: number,
): InterpolatedRendererLevel[] {
  const clamped = clampSliderProgress(progress);
  const t = clamped / 100;
  const impactBySlug = new Map(policy.impacts.map((impact) => [impact.slug, impact]));

  return policy.baseline.map((dim) => {
    const type = dim.ring === 'social' ? 'inner' : 'outer';
    const impact = impactBySlug.get(dim.slug);

    if (!impact) {
      const colour =
        dim.level === 0
          ? POLICY_SLIDER_COLOURS.withinTarget
          : dim.level === null && dim.unscored
            ? POLICY_SLIDER_COLOURS.unscored
            : null;
      return {
        slug: dim.slug,
        type,
        name: dim.name,
        level: dim.level ?? 'NaN',
        colour,
        impacted: false,
      };
    }

    const highlight =
      clamped === 0
        ? POLICY_SLIDER_COLOURS.focus
        : impact.metricAlignment === 'proxy'
          ? POLICY_SLIDER_COLOURS.mixed
          : impact.direction === 'improves'
            ? POLICY_SLIDER_COLOURS.improves
            : POLICY_SLIDER_COLOURS.mixed;

    // Only direct Doughnut-indicator matches may move a wedge's numeric level.
    // Proxy / output-only impacts stay pinned to their baseline level.
    if (impact.metricAlignment !== 'direct' || dim.level === null || impact.afterLevel === null) {
      return {
        slug: dim.slug,
        type,
        name: dim.name,
        level: dim.level ?? 'NaN',
        colour: highlight,
        impacted: true,
      };
    }

    const startLevel = dim.ring === 'social' ? Math.min(100, dim.level) : dim.level;
    const interpolated = Math.round(startLevel + (impact.afterLevel - startLevel) * t);

    return {
      slug: dim.slug,
      type,
      name: dim.name,
      level: clamped === 0 ? dim.level : interpolated,
      colour: highlight,
      impacted: true,
    };
  });
}
