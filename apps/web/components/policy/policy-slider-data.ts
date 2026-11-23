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

export interface PolicyDimensionImpact {
  slug: string;
  direction: PolicyImpactDirection;
  /**
   * Illustrative post-policy viz_level on the renderer scale, or null when the
   * baseline dimension is unscored (we never invent a score for an unscored wedge).
   */
  afterLevel: number | null;
  note: string;
}

export interface PolicySliderItem {
  id:
    | 'sc-water-rationing'
    | 'sc-adu-reform'
    | 'nyc-right-to-counsel'
    | 'nyc-clean-heat'
    | 'nyc-universal-school-meals';
  city: 'santa-cruz' | 'nyc';
  place: string;
  title: string;
  shortLabel: string;
  year: string;
  jurisdiction: string;
  mechanism: string;
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
 * Baseline portrait dimensions from site/data/portraits.json (City of Santa Cruz).
 * Scores and unscored/gap states match the public snapshot exactly.
 */
export const SANTA_CRUZ_BASELINE: readonly PolicyBaselineDimension[] = [
  { slug: 'food', name: 'Food', ring: 'social', level: 75 },
  { slug: 'health', name: 'Health', ring: 'social', level: -25 },
  { slug: 'education', name: 'Education', ring: 'social', level: -25 },
  { slug: 'income-work', name: 'Income & Work', ring: 'social', level: null, unscored: true },
  { slug: 'housing', name: 'Housing', ring: 'social', level: null, unscored: true },
  { slug: 'water-sanitation', name: 'Water & Sanitation', ring: 'social', level: -50 },
  { slug: 'energy', name: 'Energy', ring: 'social', level: 0 },
  { slug: 'social-equity', name: 'Social Equity', ring: 'social', level: null, unscored: true },
  { slug: 'peace-justice', name: 'Peace & Justice', ring: 'social', level: 50 },
  { slug: 'political-voice', name: 'Political Voice', ring: 'social', level: -50 },
  { slug: 'gender-equality', name: 'Gender Equality', ring: 'social', level: 50 },
  { slug: 'networks', name: 'Networks', ring: 'social', level: null, unscored: true },
  { slug: 'climate-change', name: 'Climate Change', ring: 'ecological', level: 50 },
  { slug: 'ocean-acidification', name: 'Ocean Acidification', ring: 'ecological', level: 50 },
  { slug: 'chemical-pollution', name: 'Chemical Pollution', ring: 'ecological', level: 0 },
  { slug: 'nitrogen-phosphorus-loading', name: 'Nitrogen & Phosphorus', ring: 'ecological', level: null },
  { slug: 'freshwater-withdrawals', name: 'Freshwater Withdrawals', ring: 'ecological', level: 50 },
  { slug: 'land-conversion', name: 'Land Conversion', ring: 'ecological', level: -50 },
  { slug: 'biodiversity-loss', name: 'Biodiversity Loss', ring: 'ecological', level: 0 },
  { slug: 'air-pollution', name: 'Air Pollution', ring: 'ecological', level: -50 },
  { slug: 'extreme-heat', name: 'Extreme Heat', ring: 'ecological', level: null, unscored: true },
  { slug: 'waste-materials', name: 'Waste & Materials', ring: 'ecological', level: 0 },
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
 * pairing real Santa Cruz and New York City baselines with source-checked outcomes and
 * explicit scope caveats.
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
    baselineMetric: '95% surface-water dependent; same-month 2013 service-area demand baseline',
    observedShift: '−26% average monthly water use (Jun–Nov 2014 vs Jun–Nov 2013; 47 gal/person/day residential)',
    evidenceGrade: 'Descriptive',
    evidenceKind: 'Administrative before–after',
    caveat:
      'Utility service-area result (not city limits or whole county) with no untreated comparison: drought, publicity, restrictions, and price responses cannot be separated, and ecological streamflow closure was not measured.',
    source: {
      title: 'Santa Cruz County HSA, Water Resources Management Status Report for 2014 (Jan 27, 2015, Attachment 2, PDF p. 13)',
      url: 'https://www2.santacruzcountyca.gov/BDS/GovStream2/ASP/Display/PdfFinder.asp?Filename=024.pdf&MeetingDate=20150127&MeetingID=648&Type=Minutes',
    },
    baseline: SANTA_CRUZ_BASELINE,
    impacts: [
      {
        slug: 'freshwater-withdrawals',
        direction: 'improves',
        afterLevel: 24,
        note: 'Observed 26% average monthly demand savings across the utility service area (Jun–Nov 2014).',
      },
      {
        slug: 'water-sanitation',
        direction: 'mixed',
        afterLevel: -50,
        note: 'Affordability and fixed revenue-recovery fee pressures on lower-income households were not locally quantified.',
      },
    ],
    sliderReadout: {
      before: '2013 service-area baseline (0% emergency cut)',
      after: '−26% avg monthly use (47 gal/person/day)',
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
    baselineMetric: '28 annual ADU building permits issued in 2017 (unincorporated county); Housing baseline unscored',
    observedShift: '28 → 103 annual ADU permits (2017 to 2024; 2024 count includes one tiny home on wheels)',
    evidenceGrade: 'Descriptive',
    evidenceKind: 'Administrative output',
    caveat:
      'Permitting output only — not completed or occupied homes, and no rent-reduction estimate. State/local laws shifted alongside demand and credit conditions; Housing stays unscored without an invented threshold.',
    source: {
      title: 'Santa Cruz County, 2024 General Plan Annual Report (Feb 2025, Table 1, PDF p. 13)',
      url: 'https://www2.santacruzcountyca.gov/planning/plnmeetings/PLNSupMaterial/PC/agendas/2025/20250226/006.pdf',
    },
    baseline: SANTA_CRUZ_BASELINE,
    impacts: [
      {
        slug: 'housing',
        direction: 'improves',
        afterLevel: null,
        note: 'Unscored baseline dimension: annual permits rose from 28 (2017) to 103 (2024), highlighted directionally without inventing a threshold score.',
      },
    ],
    sliderReadout: {
      before: '28 annual ADU permits (2017)',
      after: '103 annual ADU permits (2024)',
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
    baselineMetric: '51.6% renter households cost-burdened · 101.9 unhoused per 10,000 residents (NYC baseline)',
    observedShift:
      '−1.0 pp eviction probability across housing-court cases during rollout (−8.4 pp IV local effect among induced tenants; 727,692 cases)',
    evidenceGrade: 'Quasi-experimental',
    evidenceKind: 'Program-rollout estimate (2016–2019)',
    caveat:
      'Early-rollout estimate, not current effectiveness: NYC Comptroller (May 2025) found representation fell from 71% (Q4 FY21) to 42% (Q4 FY24), and from 81% to 31% in the Bronx. No measured homelessness or long-run rent effect.',
    source: {
      title: 'Cassidy & Currie (2023), Journal of Public Economics 222:104844; NYC Comptroller (May 2025)',
      url: 'https://doi.org/10.1016/j.jpubeco.2023.104844',
    },
    baseline: NYC_BASELINE,
    impacts: [
      {
        slug: 'housing',
        direction: 'improves',
        afterLevel: 86,
        note: '−1.0 pp reduced-form eviction probability across targeted ZIP cases (−8.4 pp IV local effect among represented compliers).',
      },
      {
        slug: 'peace-justice',
        direction: 'improves',
        afterLevel: 90,
        note: '+12.4 pp first-stage representation probability; +85 days to judgment in primary IV specification.',
      },
      {
        slug: 'social-equity',
        direction: 'mixed',
        afterLevel: 72,
        note: 'Larger estimated gains for high-risk tenants, but post-2021 representation gaps concentrated in the Bronx.',
      },
    ],
    sliderReadout: {
      before: 'Pre-rollout housing-court baseline (2016)',
      after: '−1.0 pp rollout eviction probability (−8.4 pp IV)',
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
    baselineMetric: '6.26 µg/m³ annual mean PM2.5 (NYC portrait; 2011 pre-conversion NYCCAS surface)',
    observedShift:
      '−0.12 µg/m³ ambient PM2.5 (95% CI −0.15 to −0.09), −0.28 ppb SO₂, and −0.29 ppb NO₂ per 10 converted buildings/tract',
    evidenceGrade: 'Adjusted observational',
    evidenceKind: 'Spatial-lag regression (2011–2016)',
    caveat:
      'Per-10-building tract coefficient is not a total citywide causal effect. A separate 48-apartment study found unchanged indoor PM2.5 (12.8 µg/m³, p = .99); avoided deaths cited by officials are modeled, not counted.',
    source: {
      title: 'Zhang, He et al. (2021), Environmental Health Perspectives 129(12):127701',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8653771/',
    },
    baseline: NYC_BASELINE,
    impacts: [
      {
        slug: 'air-pollution',
        direction: 'improves',
        afterLevel: 30,
        note: 'Adjusted ambient reductions of −0.12 µg/m³ PM2.5, −0.28 ppb SO₂, and −0.29 ppb NO₂ per 10 converted buildings/tract.',
      },
      {
        slug: 'health',
        direction: 'mixed',
        afterLevel: 100,
        note: 'Held steady: ambient pollution associations do not establish indoor exposure or counted mortality gains.',
      },
    ],
    sliderReadout: {
      before: '2011 pre-phaseout ambient baseline',
      after: '−0.12 µg/m³ PM2.5 per 10 converted buildings/tract',
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
    baselineMetric: '16.8% food insecurity · 64.0% poor / 45.6% non-poor middle-school reference lunch uptake',
    observedShift:
      '+5.4 pp lunch participation for poor students (+11.0 pp non-poor); +0.032 to +0.083 SD math test scores',
    evidenceGrade: 'Quasi-experimental',
    evidenceKind: 'Student fixed-effects DiD (2010–2013)',
    caveat:
      'Evaluated earlier 2010–2013 middle-school provision, not the 2017 citywide rollout. Household food security, nutritional sufficiency, and meal-production ecological footprints were not measured.',
    source: {
      title: 'Schwartz & Rothbart (2020), Journal of Policy Analysis and Management 39(2):376–410',
      url: 'https://doi.org/10.1002/pam.22175',
    },
    baseline: NYC_BASELINE,
    impacts: [
      {
        slug: 'food',
        direction: 'improves',
        afterLevel: 82,
        note: '+5.4 pp lunch participation among poor middle-school students (+11.0 pp non-poor); food security itself not measured.',
      },
      {
        slug: 'education',
        direction: 'improves',
        afterLevel: 58,
        note: 'Math +0.032 SD (poor) / +0.083 SD (non-poor) and ELA +0.027 / +0.059 SD under DiD identifying assumptions.',
      },
    ],
    sliderReadout: {
      before: 'Means-tested lunch baseline (64.0% poor uptake)',
      after: '+5.4 pp poor / +11.0 pp non-poor lunch uptake',
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
        : impact.direction === 'improves'
          ? POLICY_SLIDER_COLOURS.improves
          : POLICY_SLIDER_COLOURS.mixed;

    if (dim.level === null || impact.afterLevel === null) {
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
