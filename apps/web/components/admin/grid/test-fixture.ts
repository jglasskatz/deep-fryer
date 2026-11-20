import type { DimensionData, Indicator } from '@deep-fryer/core';
import { framework } from '@deep-fryer/contract';
import type { GridDimensionInput } from '@/lib/grid-data';

/*
 * A portrait shaped like the Santa Cruz one, for the data table's tests:
 * all 21 dimensions and 80 rows, with the cases the table must
 * handle: framework rows saved before rows had keys, custom rows, a gap
 * with no row, a whole-dimension gap, empty values, missing and unsafe
 * links, a very long name, a value with commas, quotes and a line break,
 * a source that looks like a spreadsheet formula, evidence with and
 * without a PDF, drafts and published versions, and a dimension with no
 * indicators at all. The figures are illustrative, not research.
 */

type Row = [name: string, value: number | string | null, unit: string, year: number | null, target: number | string | null,
  source: string, url: string, scale: Indicator['geographic_scale'], confidence: Indicator['confidence'], levelPct?: number];

const ROWS: Record<string, Row[]> = {
  food: [
    ['Food insecurity rate', 12.4, '% of residents', 2023, 10, 'DataShare SCC', 'https://www.datasharescc.org/indicators/index/view?indicatorId=2107', 'county', 'medium', 24],
    ['Households receiving CalFresh', 9.8, '% of households', 2022, null, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSST5Y2022.S2201', 'city', 'high'],
    ['Students eligible for free or reduced-price meals', 41, '% of students', 2024, null, 'CA Department of Education', 'https://dq.cde.ca.gov/dataquest/', 'county', 'high'],
    ['Food bank monthly clients', '70,000+ a month, "surging" to 100,000\nduring federal cuts', '', 2025, null, 'Second Harvest Food Bank', '', 'county', 'low'],
  ],
  health: [
    ['Uninsured residents', 5.1, '% of residents under 65', 2022, 3, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSST5Y2022.S2701', 'city', 'high', 40],
    ['Life expectancy at birth', 81.9, 'years', 2021, 80, 'CA Department of Public Health', 'https://www.cdph.ca.gov/', 'county', 'medium', -60],
    ['Adults reporting frequent mental distress', 14.2, '% of adults', 2021, null, 'CDC PLACES', 'https://www.cdc.gov/places/', 'city', 'medium'],
    ['Primary care physicians', 1240, 'residents per physician', 2022, 1000, 'County Health Rankings', 'https://www.countyhealthrankings.org/', 'county', 'medium', 12],
  ],
  education: [
    ['High school attainment', 93.4, '% of residents 25+', 2022, 95, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSST5Y2022.S1501', 'city', 'high', 8],
    ["Bachelor's degree or higher", 51.2, '% of residents 25+', 2022, null, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSST5Y2022.S1501', 'city', 'high'],
    ['Third graders meeting the reading standard', 48, '% of students', 2024, null, 'CAASPP results', 'https://caaspp-elpac.ets.org/', 'county', 'medium'],
    ['Chronic absenteeism', 21.7, '% of students', 2024, 10, 'CA Department of Education', 'https://dq.cde.ca.gov/dataquest/', 'county', 'medium', 117],
  ],
  'income-work': [
    ['Poverty rate', 18.9, '% of residents', 2022, 10, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSST5Y2022.S1701', 'city', 'high', 89],
    ['Unemployment rate', 4.6, '% of labor force', 2024, 4, 'CA Employment Development Department', 'https://labormarketinfo.edd.ca.gov/', 'county', 'high', 15],
    ['Households below the living wage', 38, '% of households', 2023, null, 'United Way ALICE report', 'https://www.unitedforalice.org/', 'county', 'medium'],
    ['Median household income', 92846, 'US dollars', 2022, null, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSST5Y2022.S1901', 'city', 'high'],
  ],
  'water-sanitation': [
    ['Safe drinking water', 100, '% of served population', 2023, 100, 'City of Santa Cruz Water Department', 'https://www.cityofsantacruz.com/government/city-departments/water', 'city', 'high', -100],
    ['Beach days with a bacteria advisory', 31, 'days a year', 2023, null, 'Heal the Bay report card', 'https://healthebay.org/beach-report-card/', 'city', 'medium'],
    ['Sewer overflows', null, 'spills a year', null, 0, '', '', 'city', 'low'],
    ['Lead service lines remaining', 0, 'lines', 2024, 0, 'City of Santa Cruz Water Department', 'https://www.cityofsantacruz.com/government/city-departments/water', 'city', 'high'],
  ],
  energy: [
    ['Energy burden', 2.9, '% of household income', 2022, 6, 'DOE LEAD tool', 'https://www.energy.gov/scep/slsc/lead-tool', 'city', 'medium', -50],
    ['Electricity from renewable sources', 100, '% of supply (default plan)', 2024, null, 'Central Coast Community Energy', 'https://3cenergy.org/', 'regional', 'high'],
    ['Homes heated with gas', 54, '% of households', 2022, null, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSDT5Y2022.B25040', 'city', 'high'],
    ['Public EV charging ports', 212, 'ports', 2025, null, 'Alternative Fuels Data Center', 'https://afdc.energy.gov/stations', 'city', 'medium'],
  ],
  networks: [
    ['Broadband access', 92.7, '% of households', 2022, 98, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSST5Y2022.S2801', 'city', 'high', 30],
    ['Residents who feel they belong', null, '% of residents', null, null, '', '', 'city', 'low'],
    ['Library visits', 4.1, 'visits per resident a year', 2023, null, 'Santa Cruz Public Libraries', 'https://www.santacruzpl.org/', 'county', 'medium'],
    ['Volunteering adults', 31, '% of adults', 2021, null, 'AmeriCorps Volunteering and Civic Life', 'https://americorps.gov/', 'state', 'low'],
  ],
  housing: [
    ['Cost-burdened renters', 62.3, '% of renter households', 2022, 30, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSDT5Y2022.B25070', 'city', 'high', 150],
    ['Homelessness rate', 85, 'per 10,000 residents', 2024, 10, 'Santa Cruz County Point-in-Time Count', 'https://housingforhealthpartnership.org/', 'county', 'medium', 150],
    ['Median rent for a two-bedroom home', 3450, 'US dollars a month', 2024, null, 'Zillow Observed Rent Index', 'https://www.zillow.com/research/data/', 'city', 'medium'],
    ['Affordable homes permitted as a share of the regional housing need allocation for very low and low income households, 2023 to 2031 cycle', 11, '% of allocation', 2024, 100, 'City of Santa Cruz Housing Element annual progress report', 'https://www.cityofsantacruz.com/government/city-departments/planning-and-community-development/housing', 'city', 'high', 89],
  ],
  'gender-equality': [
    ['Gender pay ratio', 81, '%', 2022, 100, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSST5Y2022.S2411', 'city', 'high', 19],
    ['Women on the City Council', 57, '% of seats', 2024, 50, 'City of Santa Cruz', 'https://www.cityofsantacruz.com/government/city-council', 'city', 'high', -100],
    ['Women-owned businesses', 23, '% of firms', 2021, null, 'Annual Business Survey', 'https://www.census.gov/programs-surveys/abs.html', 'county', 'low'],
    ['Reported domestic violence calls', 3.9, 'per 1,000 residents', 2023, null, 'CA Department of Justice OpenJustice', 'https://openjustice.doj.ca.gov/', 'county', 'medium'],
  ],
  'social-equity': [
    ['Gini index', 0.52, 'index 0–1', 2022, 0.4, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSDT5Y2022.B19083', 'city', 'high', 60],
    ['Latino residents in poverty', 24.5, '% of Latino residents', 2022, null, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSST5Y2022.S1701', 'city', 'medium'],
    ['Racial dissimilarity index', 0.31, 'index 0–1', 2020, null, 'Othering & Belonging Institute', 'javascript:alert(1)', 'city', 'low'],
    ['Linguistically isolated households', 4.8, '% of households', 2022, null, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSST5Y2022.S1602', 'city', 'high'],
  ],
  'political-voice': [
    ['Voter turnout', 79.6, '% of registered voters', 2024, 80, 'Santa Cruz County Elections', 'https://votescount.us/', 'county', 'high', 1],
    ['Eligible residents registered to vote', 82, '% of eligible residents', 2024, null, 'CA Secretary of State', 'https://www.sos.ca.gov/elections', 'county', 'high'],
    ['Public comments at council meetings', 1430, 'comments a year', 2024, null, '=HYPERLINK("https://example.org","City Clerk")', 'https://www.cityofsantacruz.com/government/city-clerk', 'city', 'medium'],
    ['Municipal turnout in off-year elections', null, '% of registered voters', null, null, '', '', 'city', 'low'],
  ],
  'peace-justice': [
    ['Violent crime rate', 6.8, 'per 1,000 residents', 2023, 3, 'FBI Crime Data Explorer', 'https://cde.ucr.cjis.gov/', 'city', 'medium', 75],
    ['Residents who trust the police', null, '% of residents', null, null, '', '', 'city', 'low'],
    ['Jail population', 210, 'people per 100,000 residents', 2023, null, 'Vera Institute Incarceration Trends', 'https://trends.vera.org/', 'county', 'medium'],
    ['Traffic deaths and serious injuries', 48, 'people a year', 2023, 0, 'Transportation Injury Mapping System', 'https://tims.berkeley.edu/', 'city', 'high', 150],
  ],
  'climate-change': [
    ['GHG per capita', 4.22, 'tCO2e per resident per year', 2019, 2.51, 'City of Santa Cruz GHG inventory', 'https://www.cityofsantacruz.com/government/city-departments/city-manager/climate-action-program', 'city', 'high', 68],
    ['Share of emissions from transportation', 69, '% of community emissions', 2019, null, 'City of Santa Cruz Climate Action Plan 2030', 'https://www.cityofsantacruz.com/government/city-departments/city-manager/climate-action-program', 'city', 'high'],
    ['Consumption-based emissions', 32, 'tCO2e per household a year', 2015, null, 'CoolClimate Network', 'https://coolclimate.org/maps', 'city', 'low'],
    ['Trips to work by bike, foot or transit', 21, '% of commuters', 2022, null, 'US Census ACS 5-year', 'https://data.census.gov/table/ACSST5Y2022.S0801', 'city', 'high'],
  ],
  'ocean-acidification': [],
  'chemical-pollution': [
    ['Toxic releases', 0.4, 'lbs per resident per year', 2022, 1, 'EPA Toxics Release Inventory', 'https://www.epa.gov/toxics-release-inventory-tri-program', 'county', 'medium', -60],
    ['Agricultural pesticide use', 7.9, 'million lbs active ingredient', 2022, null, 'CA DPR Pesticide Use Reports', 'https://www.cdpr.ca.gov/docs/pur/purmain.htm', 'county', 'high'],
    ['Cleanup sites', 37, 'open sites', 2025, null, 'GeoTracker', 'https://geotracker.waterboards.ca.gov/', 'city', 'medium'],
    ['Microplastics in Monterey Bay', null, 'particles per cubic metre', null, null, 'Monterey Bay Aquarium Research Institute', 'https://www.mbari.org/', 'regional', 'low'],
  ],
  'nitrogen-phosphorus-loading': [
    ['Nitrate in groundwater', 3.1, 'mg/L NO3-N', 2023, 10, 'UC Davis Groundwater Nitrate Viewer', 'https://groundwaternitrate.ucdavis.edu/', 'county', 'medium', -70],
    ['Wells over the nitrate limit', 12, '% of sampled wells', 2023, 0, 'GAMA groundwater program', 'https://www.waterboards.ca.gov/gama/', 'county', 'medium', 60],
    ['River nutrient impairment listings', 4, 'water bodies', 2022, null, 'State Water Board 303(d) list', 'https://www.waterboards.ca.gov/water_issues/programs/tmdl/integrated2022.html', 'county', 'high'],
    ['Wastewater nitrogen discharged', 410, 'tonnes a year', 2022, null, 'Santa Cruz Wastewater Treatment Facility', 'https://www.cityofsantacruz.com/', 'city', 'medium'],
  ],
  'freshwater-withdrawals': [
    ['Residential water use', 44, 'gallons per capita per day', 2023, 55, 'City of Santa Cruz Water Department', 'https://www.cityofsantacruz.com/government/city-departments/water', 'city', 'high', -40],
    ['Supply from surface water', 95, '% of supply', 2023, null, 'Urban Water Management Plan', 'https://www.cityofsantacruz.com/government/city-departments/water', 'city', 'high'],
    ['Groundwater basin overdraft', null, 'acre-feet a year', null, 0, '', '', 'regional', 'low'],
    ['Water lost to leaks', 7.5, '% of water produced', 2023, null, 'AWWA water audit', 'https://www.cityofsantacruz.com/government/city-departments/water', 'city', 'medium'],
  ],
  'land-conversion': [
    ['Natural land converted', 1.8, '% per decade', 2021, 1, 'National Land Cover Database', 'https://www.mrlc.gov/', 'county', 'medium', 80],
    ['Tree canopy cover', 33, '% of city area', 2020, 40, 'City of Santa Cruz Urban Forest Master Plan', 'https://www.cityofsantacruz.com/', 'city', 'medium', 18],
    ['Impervious surface', 39, '% of city area', 2021, null, 'National Land Cover Database', 'https://www.mrlc.gov/', 'city', 'medium'],
    ['Farmland lost to development', 640, 'acres since 2008', 2020, null, 'Farmland Mapping and Monitoring Program', 'https://www.conservation.ca.gov/dlrp/fmmp', 'county', 'high'],
  ],
  'biodiversity-loss': [
    ['Protected land share', 27, '% of jurisdiction land area', 2024, 30, 'California Protected Areas Database', 'https://www.calands.org/', 'city', 'high', 10],
    ['Native plant species', 1000, 'species', 2022, null, 'California Native Plant Society', 'https://www.cnps.org/', 'county', 'medium'],
    ['Endemic species at risk', 35, 'species', 2022, null, 'CNDDB', 'https://wildlife.ca.gov/Data/CNDDB', 'county', 'medium'],
    ['Monarch butterflies at Natural Bridges', 1500, 'butterflies (Thanksgiving count)', 2024, null, 'Xerces Society Western Monarch Count', 'https://www.westernmonarchcount.org/', 'city', 'medium'],
  ],
  'air-pollution': [
    ['PM2.5 annual average', 6.5, 'µg/m³', 2019, 5, 'DataShare SCC / American Lung Association', 'https://www.datasharescc.org/indicators/index/view?indicatorId=168', 'county', 'medium', 30],
    ['Days with unhealthy air', 5.2, 'days a year', 2018, 3.2, 'American Lung Association State of the Air', 'https://www.lung.org/research/sota', 'county', 'medium', 69],
    ['Ozone exceedance days', 0, 'days a year', 2023, 0, 'EPA Air Quality System', 'https://www.epa.gov/aqs', 'county', 'high', -100],
    ['Asthma emergency visits', 36, 'per 10,000 residents', 2021, null, 'CalEnviroScreen 4.0', 'https://oehha.ca.gov/calenviroscreen', 'city', 'medium'],
    ['Wildfire smoke days', 11, 'days a year', 2020, null, 'NOAA Hazard Mapping System', 'https://www.ospo.noaa.gov/products/land/hms.html', 'county', 'low'],
  ],
  'ozone-depletion': [
    ['ODS phase-out compliance', 99.7, '% of tracked ODS phased out', 2023, 100, 'UNEP Ozone Secretariat', 'https://ozone.unep.org/', 'global', 'high', 0],
    ['Refrigerant leaks from large systems', 2.1, 'tonnes CO2e a year', 2023, null, 'CARB Refrigerant Management Program', 'https://ww2.arb.ca.gov/our-work/programs/refrigerant-management-program', 'county', 'low'],
  ],
};

/** Rows saved before rows had keys: the framework rows of these dimensions carry no key. */
const UNKEYED = new Set(['health', 'housing']);
/** Dimensions whose latest version is a draft, not the published one. */
const DRAFT = new Set(['housing', 'climate-change']);

function indicatorsFor(slug: string): Indicator[] {
  return (ROWS[slug] ?? []).map(([name, value, unit, year, target, source, url, scale, confidence, levelPct], i) => {
    const frameworkIndicator = framework.dimensions.find((d) => d.slug === slug)?.indicators[i];
    const ind: Indicator = {
      ...(frameworkIndicator && !UNKEYED.has(slug) ? { key: frameworkIndicator.slug } : {}),
      // Framework rows carry the framework's name, so unkeyed ones are matched to it.
      name: frameworkIndicator && UNKEYED.has(slug) ? frameworkIndicator.name : name,
      value,
      unit,
      year,
      target,
      source,
      source_url: url,
      confidence,
      geographic_scale: scale,
      ...(typeof levelPct === 'number' ? { level_pct: levelPct } : {}),
    };
    return ind;
  });
}

const EVIDENCE: Record<string, Indicator['evidence']> = {
  'climate-change': { snapshot_path: 'evidence/ghg.png', pdf_path: 'evidence/ghg.pdf', captured_at: '2026-09-01T10:00:00Z' },
  'air-pollution': { snapshot_path: 'evidence/pm25.png', captured_at: '2026-08-14T10:00:00Z' },
};

/** The fixture's dimensions as admin-data's tenantDimensions returns them (the parts the table reads). */
export function santaCruzFixture(): GridDimensionInput[] {
  return framework.dimensions.map((fd) => {
    const indicators = indicatorsFor(fd.slug);
    const first = indicators[0];
    if (first && EVIDENCE[fd.slug]) first.evidence = EVIDENCE[fd.slug];
    if (fd.slug === 'freshwater-withdrawals' && indicators[0]) {
      indicators[0].supporting_source_url = 'https://www.cityofsantacruz.com/home/showpublisheddocument/water-2023';
    }
    const data: DimensionData = {
      name: fd.name,
      icon: '',
      description: '',
      context: '',
      indicators,
      actions: [],
      ...(fd.slug === 'ocean-acidification'
        ? { gaps: [{ indicator: 'all', reason: 'No local monitoring series.', scales_tried: ['city', 'county'], searched_at: '2026-09-01T00:00:00Z' }] }
        : {}),
      ...(fd.slug === 'peace-justice'
        ? {
            gaps: [
              { indicator: 'residents-who-trust-the-police', reason: 'No survey since 2018.', scales_tried: ['city'], searched_at: '2026-09-01T00:00:00Z' },
              { indicator: 'hate-crimes-reported', reason: 'Reported counts are too small to publish.', scales_tried: ['city', 'county'], searched_at: '2026-09-01T00:00:00Z' },
            ],
          }
        : {}),
    };
    const id = `dim-${fd.slug}`;
    const versionId = `ver-${fd.slug}`;
    return {
      dimension: {
        id,
        slug: fd.slug,
        canonicalSlug: fd.slug,
        ring: fd.ring,
        publishedVersionId: DRAFT.has(fd.slug) ? `ver-${fd.slug}-previous` : versionId,
      },
      latest: { id: versionId, versionNum: DRAFT.has(fd.slug) ? 4 : 2, data },
    };
  });
}

/** Rows the fixture has: one per listed indicator, plus the gap with no row in Peace & Justice. */
export const FIXTURE_ROW_COUNT = Object.values(ROWS).reduce((n, rows) => n + rows.length, 0) + 1;
