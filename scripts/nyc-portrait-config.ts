#!/usr/bin/env tsx
/**
 * NYC portrait config proposal (Phase 1 output of docs/nyc-research-brief.md;
 * research synthesis in docs/nyc-impact-research.md).
 *
 * Dry-run by default: prints the proposed config as a diff against framework
 * defaults. `--apply` writes to tenant_config for all six NYC tenants — run
 * only after the Phase 2 user confirmation.
 *
 * Design rules (from the brief): overrides only where NYC has an *adopted*
 * goal, each rationale cites the adopting instrument, nothing softens a
 * default. New threshold refs (no framework base) carry an explicit function
 * and, where target = 0, a scale.
 */
import frameworkThresholds from '../packages/contract/framework/thresholds.json' with { type: 'json' };
import { tenantConfigSchemas } from '@deep-fryer/core';
import { eq, inArray } from 'drizzle-orm';
import { getDb, tenantConfig, tenants } from '@deep-fryer/db';

const NYC_SLUGS = ['nyc', 'manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island'];

// ---------------------------------------------------------------------------
// Threshold overrides — same floor/ceiling for all six tenants by design:
// one set of adopted city goals, six geographies measured against it.
// ---------------------------------------------------------------------------
export const thresholdOverrides = {
  // -- Overrides of framework defaults (both strictly tighter) --
  'health.life-expectancy': {
    target: 83,
    function: 'higher_is_better',
    rationale:
      'HealthyNYC adopted target: citywide life expectancy of at least 83.0 years by 2030, codified by Local Law 93 of 2024. Provisional 2024 already reads 83.2 citywide, so the live question is equity: borough portraits score the same 83.0 floor, making the ~6-year borough gap the wedge.',
  },
  'networks.broadband-access': {
    target: 100,
    function: 'higher_is_better',
    rationale:
      'Universal adoption as the aspiration behind Big Apple Connect (NYCHA-wide free broadband, extended through 2028) and the 2025 digital-equity roadmap. Disclosed: the 2020 Internet Master Plan was shelved in 2022, so no currently-adopted citywide numeric target exists; 100 is the directional goal those programs serve, and is stricter than the framework default (95).',
  },

  // -- New NYC refs (no framework base) anchored in adopted law --
  'income-work.below-tcol-share': {
    target: 0,
    scale: 100,
    function: 'lower_is_better',
    rationale:
      "Share of residents below the NYC True Cost of Living, the charter-mandated measure (Charter §1151-c, 2022 ballot; first report April 2026: 62% citywide). The TCOL is by definition the income needed to meet basic needs without assistance — the adopted aspiration is everyone at or above it, so target 0% below, scored against the full 0–100 range.",
  },
  'education.class-size-compliance': {
    target: 100,
    function: 'higher_is_better',
    rationale:
      'NYS class-size law (2022, as amended June 2026): 100% of NYC classes at or under caps (K-3: 20, 4-8: 23, HS: 25) by school year 2029-30 on a 70/80/90/100 ramp; 64.0% compliant per the Nov 2025 DOE report (~7% of classes exempted from the denominator).',
  },
  'chemical-pollution.landfill-reduction-vs-2005': {
    target: 90,
    function: 'higher_is_better',
    rationale:
      'OneNYC 2015 "0x30": send zero waste to landfill by 2030, operationalized as a 90% reduction in landfill-bound tonnage vs 2005, codified by the Zero Waste Act (LL85/LL87 of 2023). Measured as % reduction achieved, from DSNY monthly tonnage (borough-native). Disclosed: this is landfill reduction, not the separately-codified 100% diversion goal for recyclables/organics, and DSNY data excludes commercial waste (~half the stream).',
  },
  'land-conversion.tree-canopy-pct': {
    target: 30,
    function: 'higher_is_better',
    rationale:
      "Local Law 148 of 2023 and the resulting Urban Forest Plan (April 2026) adopt 30% tree-canopy cover by 2040 (23.4% citywide, 2021 LiDAR). Borough-comparable via TNC/UVM 'Growing Greener' community-district fact sheets.",
  },
  'climate-change.ll97-over-2030-cap-share': {
    target: 0,
    scale: 100,
    function: 'lower_is_better',
    rationale:
      'Local Law 97 of 2019 sets binding emissions caps for buildings over 25k sq ft; the adopted end-state is zero covered buildings over their 2030 cap (57-63% currently over, per Sierra Club/Urban Green Council trackers). This is the enforcement wedge the administration directly controls.',
  },
  'climate-change.ghg-reduction-vs-2005': {
    target: 80,
    function: 'higher_is_better',
    rationale:
      'Local Law 66 of 2014 legally mandates an 80% citywide GHG reduction vs 2005 by 2050 (40x30 interim, reaffirmed in LL97 §3 and PlaNYC 2023). Measured as % reduction achieved from the MOCEJ inventory — citywide only; borough portraits carry it at regional scale, explicitly labeled.',
  },
  'housing.new-affordable-homes-per-year': {
    target: 20000,
    function: 'higher_is_better',
    rationale:
      'Block by Block (May 2026), the adopted city housing plan: 200,000 new permanently affordable homes over 10 years — 20,000/year on average, on a published ramp from 14,000+ (2027) to 21,000+/year (2031) — backed by a $22B five-year capital commitment.',
  },
  'land-conversion.park-access-share': {
    target: 85,
    function: 'higher_is_better',
    rationale:
      "OneNYC 2050 adopted goal: 85% of New Yorkers within walking distance of a park by 2030 (NYC Parks Walk to a Park; 84.2% as of July 2025). One access definition used throughout — Parks' service-area method, disclosed on the methodology page.",
  },
  'peace-justice.traffic-deaths': {
    target: 0,
    scale: 299,
    function: 'lower_is_better',
    rationale:
      'Vision Zero (adopted 2014): zero traffic deaths. Scored as distance from zero relative to the 2013 pre-Vision-Zero baseline of 299 deaths; 2025 hit a record-low 205.',
  },
} satisfies Record<string, { target: number; scale?: number; function: string; rationale: string }>;

// ---------------------------------------------------------------------------
// Source-priority tiers — framework structure, NYC-pinned examples.
// ---------------------------------------------------------------------------
export const sourcePriority = {
  tiers: [
    {
      tier: 1,
      name: 'NYC government primary data',
      description:
        "The city's own instruments: agency datasets, adopted plans, charter-mandated reports, open-data portals.",
      examples: [
        'NYC Open Data (data.cityofnewyork.us)',
        'DOHMH Community Health Profiles / EpiQuery / NYCCAS',
        'DSNY monthly tonnage; DEP harbor & drinking-water reports',
        'MOCEJ GHG inventories; Urban Forest Plan; Mayor\'s Management Report',
        'NYC TCOL report (Mayor\'s Office of Equity); DOE InfoHub (not the stale Open Data mirrors)',
        'HPD/HVS, NYCHA, Rent Guidelines Board; CFB voter turnout; HRA/DSS',
      ],
    },
    {
      tier: 2,
      name: 'State and federal statistical agencies',
      description:
        'Official series with the borough (county) or city as a reporting unit. All five boroughs are counties >65k, so ACS 1-year publishes annually for each.',
      examples: [
        'ACS via data.census.gov (county = borough)',
        'data.ny.gov: NYSERDA Utility Energy Registry, DCJS arrests, MTA ridership',
        'NYSDOL LAUS; EPA TRI; NCHS vital statistics; Census HVS',
      ],
    },
    {
      tier: 3,
      name: 'Established research institutions',
      description: 'Long-running series with published methodology, borough-disaggregated where possible.',
      examples: [
        'NYU Furman Center CoreData / Eviction Tracker',
        'Feeding America Map the Meal Gap; County Health Rankings',
        'Robin Hood/Columbia Poverty Tracker; Citizens Budget Commission',
        'Natural Areas Conservancy; TNC/UVM canopy assessment; Vera Institute',
      ],
    },
    {
      tier: 4,
      name: 'Reputable secondary reporting',
      description:
        'Journalism and advocacy reports that cite primary data — acceptable only when tiers 1-3 are exhausted, and flagged for review.',
      examples: ['THE CITY / Gothamist data desks', 'Coalition for the Homeless State of the Homeless'],
    },
  ],
};

// ---------------------------------------------------------------------------
// Recency: default 5 years; exceptions only where NYC's publication cadence
// makes 5 impossible and the dataset is still the authoritative one.
// ---------------------------------------------------------------------------
export const recency = {
  default_max_age_years: 5,
  per_dimension: {
    // Admits the 2019 MOCEJ/EcoDataLab consumption-based inventory (one-off,
    // tract-level, city-endorsed) alongside the annual territorial inventory.
    'climate-change': 8,
    // Impervious-surface/land-cover raster is 2017 (canopy itself is 2021).
    'land-conversion': 9,
  },
};

// ---------------------------------------------------------------------------
// Scale policy. Boroughs are county-equivalents, so the default (city,
// county) already matches how NYC data publishes. Citywide-only dimensions
// (GHG inventory, freshwater withdrawals) accept 'regional' so borough
// portraits can carry the citywide figure explicitly labeled rather than a
// fabricated split — Tier 2 of the ecological scale policy in
// docs/nyc-impact-research.md §3.
// ---------------------------------------------------------------------------
export const scalePolicy = {
  default_accepted: ['city', 'county'],
  per_dimension: {
    'climate-change': ['city', 'county', 'regional'],
    'freshwater-withdrawals': ['city', 'county', 'regional'],
    'biodiversity-loss': ['city', 'county', 'regional'],
    'ocean-acidification': ['city', 'county', 'regional', 'global'],
    'ozone-depletion': ['city', 'county', 'regional', 'state', 'national', 'global'],
  },
};

// ---------------------------------------------------------------------------
// Region context notes — appended guidance every research session sees.
// ---------------------------------------------------------------------------
const SHARED_NOTES = [
  'Frame: the NYC True Cost of Living report (April 2026) is the social-foundation anchor; adopted city law (LL97, LL93/HealthyNYC, Zero Waste Act, LL148, LL195, Vision Zero) supplies thresholds. Baseline trajectories to January 2026 where a wedge reflects inherited conditions.',
  'Data gotchas: NYPD shootings live dataset is 5ucz-vwe8 (833y-fsy8 is archived). DOE graduation/absenteeism: use InfoHub, not the frozen Open Data mirrors. NYCgov poverty microdata on Open Data ends 2018 — use report tables. MMR moved to nyc.gov/site/operations/reports/mmr.page. nyc.gov and furmancenter.org may 403 plain fetchers — capture evidence via the browser tool.',
  'Report a reference year per indicator; never one "data year" for the whole portrait (cadences range monthly DSNY to triennial HVS to the one-off 2019 consumption inventory).',
  'Ecological wedges: label each territorial vs consumption; the two rank boroughs in opposite orders. Citywide-only data (GHG inventory, water demand) goes on borough portraits as an explicitly-labeled citywide figure at regional scale, never a fabricated borough split. Air pollution: pair NYCCAS concentrations with attributable-burden context (exposure x vulnerability).',
] .join(' ');

const BOROUGH_NOTE =
  'This tenant is one borough (a county-equivalent). Prefer borough/county-cut data; ACS 1-year publishes annually for every borough. Where only citywide data exists, use it at regional scale with an explicit label, or record an honest gap.';

// ---------------------------------------------------------------------------

function validate() {
  tenantConfigSchemas.threshold_overrides.parse(thresholdOverrides);
  tenantConfigSchemas.source_priority.parse(sourcePriority);
  tenantConfigSchemas.recency.parse(recency);
  tenantConfigSchemas.scale_policy.parse(scalePolicy);
}

function printDiff() {
  const defaults = frameworkThresholds.thresholds as Record<
    string,
    { target?: number; function: string; scale?: number }
  >;
  console.log('# Threshold overrides vs framework defaults\n');
  for (const [ref, o] of Object.entries(thresholdOverrides)) {
    const base = defaults[ref];
    const from = base ? `default target ${base.target} (${base.function})` : 'NEW REF (no framework default)';
    console.log(`  ${ref}\n    ${from}  ->  target ${o.target}${o.scale ? ` scale ${o.scale}` : ''} (${o.function})`);
  }
  console.log('\n# Recency exceptions (default 5y):', JSON.stringify(recency.per_dimension));
  console.log('# Scale exceptions:', JSON.stringify(scalePolicy.per_dimension));
  console.log('# Source tiers: 4 tiers, NYC-pinned (see script source)');
  console.log('\nDry run. Re-run with --apply after Phase 2 confirmation.');
}

async function apply() {
  const db = getDb();
  const rows = await db.select().from(tenants).where(inArray(tenants.slug, NYC_SLUGS));
  if (rows.length !== NYC_SLUGS.length) {
    throw new Error(`expected ${NYC_SLUGS.length} tenants, found ${rows.length} — run provision-nyc first`);
  }
  for (const t of rows) {
    const [regionRow] = await db
      .select()
      .from(tenantConfig)
      .where(eq(tenantConfig.tenantId, t.id))
      .then((all) => all.filter((r) => r.key === 'region'));
    const region = (regionRow?.value ?? {}) as { name?: string; definition?: string; context_notes?: string };
    const baseNotes = (region.context_notes ?? '').split(' :: ')[0];
    const contextNotes = [baseNotes, SHARED_NOTES, t.slug === 'nyc' ? '' : BOROUGH_NOTE]
      .filter(Boolean)
      .join(' :: ');

    const entries: Array<[string, unknown]> = [
      ['threshold_overrides', thresholdOverrides],
      ['source_priority', sourcePriority],
      ['recency', recency],
      ['scale_policy', scalePolicy],
      ['region', { name: region.name ?? t.name, definition: region.definition ?? '', context_notes: contextNotes }],
    ];
    for (const [key, value] of entries) {
      tenantConfigSchemas[key as keyof typeof tenantConfigSchemas].parse(value);
      await db
        .insert(tenantConfig)
        .values({ tenantId: t.id, key, value })
        .onConflictDoUpdate({ target: [tenantConfig.tenantId, tenantConfig.key], set: { value, updatedAt: new Date() } });
    }
    console.log(`applied config: ${t.slug}`);
  }
}

async function main() {
  validate();
  if (process.argv.includes('--apply')) {
    await apply();
    console.log('NYC portrait config applied to all six tenants.');
  } else {
    printDiff();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
