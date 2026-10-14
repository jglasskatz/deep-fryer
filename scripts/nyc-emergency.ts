#!/usr/bin/env tsx
/**
 * NYC emergency view proposal (SPEC-v5 §3 [P]).
 *
 *   tsx scripts/nyc-emergency.ts            # dry run: print the proposal
 *   tsx scripts/nyc-emergency.ts --apply    # write it (run provision-nyc first)
 *
 * For each of the six NYC portraits it proposes:
 * - the emergency config: the National Weather Service zones — each
 *   borough's county AND its forecast zone(s) (the whole city: all of them),
 *   because the alerts feed matches the codes an alert was issued for, and
 *   the NWS issues heat, winter storm, coastal flood, wind, and air quality
 *   alerts by forecast zone but tornado, severe thunderstorm, and flash
 *   flood warnings by county — Notify NYC as the official alert sign-up,
 *   911 / 311, and the America/New_York clock;
 * - hazards from the NYC Hazard Mitigation Plan's hazard list, with
 *   PROPOSED likelihood and severity (1–5), the doughnut dimensions each
 *   plausibly threatens, and the NWS event names that mean it is happening
 *   now. Ratings are a staff decision, so every hazard is written
 *   UNPUBLISHED: staff review, adjust, and publish at /{tenant}/admin/emergency;
 * - adopted plans, only with links known to be the official pages; at
 *   --apply each link must answer a GET with 2xx within 10 s, after
 *   following at most five https redirects, or it is refused, never
 *   written (the page it lands on is printed). Plans are written
 *   unpublished too.
 *
 * Idempotent and conservative: existing rows are matched (hazards by slug,
 * plans by url) and left exactly as staff set them; only missing ones are
 * inserted. An existing config keeps every value staff entered; only empty
 * fields are filled from the proposal, and proposed zones missing from a
 * saved list are reported for staff to add rather than added. Every record
 * is validated with the same core schemas as the admin forms before
 * anything is written.
 *
 * The zone codes below are the NWS Upton, NY (OKX) assignments as this
 * script was written. The dry run prints them, and the preflight
 * (scripts/preflight.ts) checks that api.weather.gov answers for each
 * portrait's configured list before launch.
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  emergencyConfigSchema,
  emergencyPlanInputSchema,
  hazardInputSchema,
  riskBand,
  riskScore,
  type EmergencyConfig,
  type EmergencyPlanInput,
  type EmergencyPlanInputDraft,
  type HazardInputDraft,
} from '@deep-fryer/core';
import { emergencyPlans, getDb, hazards, tenantConfig, tenants } from '@deep-fryer/db';

/**
 * NWS zones (UGC) per borough: the county (NYC + county FIPS) and the public
 * forecast zone(s) covering it. Queens is split into two forecast zones.
 */
const BOROUGH_ZONES = {
  manhattan: { county: 'NYC061', zones: ['NYZ072'], names: 'New York County; New York (Manhattan)' },
  bronx: { county: 'NYC005', zones: ['NYZ073'], names: 'Bronx County; Bronx' },
  'staten-island': { county: 'NYC085', zones: ['NYZ074'], names: 'Richmond County; Richmond (Staten Island)' },
  brooklyn: { county: 'NYC047', zones: ['NYZ075'], names: 'Kings County; Kings (Brooklyn)' },
  queens: { county: 'NYC081', zones: ['NYZ176', 'NYZ178'], names: 'Queens County; Northern Queens, Southern Queens' },
} as const;
const boroughCodes = (b: keyof typeof BOROUGH_ZONES) => [BOROUGH_ZONES[b].county, ...BOROUGH_ZONES[b].zones];
const ZONES: Record<string, string[]> = {
  nyc: (Object.keys(BOROUGH_ZONES) as (keyof typeof BOROUGH_ZONES)[]).flatMap(boroughCodes),
  ...Object.fromEntries((Object.keys(BOROUGH_ZONES) as (keyof typeof BOROUGH_ZONES)[]).map((b) => [b, boroughCodes(b)])),
};
const NYC_SLUGS = ['nyc', 'manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island'];

/** Notify NYC, the City's official emergency notification program (NYC Emergency Management). */
const NOTIFY_NYC_URL = 'https://a858-nycnotify.nyc.gov/notifynyc/';

function configFor(slug: string): EmergencyConfig {
  return emergencyConfigSchema.parse({
    nws_zones: ZONES[slug],
    alerts_signup_url: NOTIFY_NYC_URL,
    alerts_signup_label: 'Notify NYC',
    emergency_phone: '911',
    info_phone: '311',
    time_zone: 'America/New_York',
  });
}

/**
 * The NYC Hazard Mitigation Plan's hazards. Likelihood and severity are
 * PROPOSALS for staff to confirm (they are printed as such and written
 * unpublished); the reasoning is in each description.
 */
const HAZARDS: HazardInputDraft[] = [
  {
    slug: 'extreme-heat',
    name: 'Extreme heat',
    kind: 'extreme_heat',
    description:
      'Heat waves cause more deaths in New York City than any other weather hazard, most among older adults and people without air conditioning.',
    likelihood: 5,
    severity: 4,
    dimensions: [
      { dimension_slug: 'health', impact: 'high' },
      { dimension_slug: 'energy', impact: 'high' },
      { dimension_slug: 'housing', impact: 'moderate' },
      { dimension_slug: 'income-work', impact: 'moderate' },
      { dimension_slug: 'social-equity', impact: 'moderate' },
    ],
    // The NWS renamed "Excessive Heat" products to "Extreme Heat" in 2025;
    // both names are listed so either matches.
    nws_events: ['Heat Advisory', 'Excessive Heat Warning', 'Excessive Heat Watch', 'Extreme Heat Warning', 'Extreme Heat Watch'],
  },
  {
    slug: 'flooding',
    name: 'Flooding from heavy rain',
    kind: 'flooding',
    description:
      'Intense rainfall overwhelms sewers and floods streets, subways, and basement apartments within minutes, as during the remnants of Hurricane Ida in 2021.',
    likelihood: 4,
    severity: 4,
    dimensions: [
      { dimension_slug: 'housing', impact: 'high' },
      { dimension_slug: 'health', impact: 'high' },
      { dimension_slug: 'networks', impact: 'moderate' },
      { dimension_slug: 'water-sanitation', impact: 'moderate' },
    ],
    nws_events: ['Flash Flood Warning', 'Flash Flood Watch', 'Flood Warning', 'Flood Watch', 'Flood Advisory'],
  },
  {
    slug: 'coastal-storms',
    name: 'Coastal storms and storm surge',
    kind: 'coastal_storm',
    description:
      'Hurricanes, tropical storms, and nor’easters push storm surge into low-lying coastal neighborhoods, as Hurricane Sandy did in 2012.',
    likelihood: 3,
    severity: 5,
    dimensions: [
      { dimension_slug: 'housing', impact: 'high' },
      { dimension_slug: 'energy', impact: 'high' },
      { dimension_slug: 'health', impact: 'moderate' },
      { dimension_slug: 'networks', impact: 'moderate' },
      { dimension_slug: 'income-work', impact: 'moderate' },
      { dimension_slug: 'water-sanitation', impact: 'moderate' },
    ],
    nws_events: [
      'Hurricane Warning',
      'Hurricane Watch',
      'Tropical Storm Warning',
      'Tropical Storm Watch',
      'Storm Surge Warning',
      'Storm Surge Watch',
      'Coastal Flood Warning',
      'Coastal Flood Watch',
      'Coastal Flood Advisory',
    ],
  },
  {
    slug: 'winter-weather',
    name: 'Winter storms and extreme cold',
    kind: 'winter_weather',
    description: 'Snow, ice, and extreme cold disrupt transit and heat, and endanger people without stable housing.',
    likelihood: 4,
    severity: 3,
    dimensions: [
      { dimension_slug: 'health', impact: 'moderate' },
      { dimension_slug: 'energy', impact: 'moderate' },
      { dimension_slug: 'networks', impact: 'moderate' },
      { dimension_slug: 'housing', impact: 'low' },
    ],
    // "Wind Chill" products became "Extreme Cold" / "Cold Weather" in 2024–25.
    nws_events: [
      'Winter Storm Warning',
      'Winter Storm Watch',
      'Blizzard Warning',
      'Winter Weather Advisory',
      'Ice Storm Warning',
      'Extreme Cold Warning',
      'Extreme Cold Watch',
      'Cold Weather Advisory',
      'Wind Chill Warning',
      'Wind Chill Advisory',
    ],
  },
  {
    slug: 'high-winds',
    name: 'High winds and severe thunderstorms',
    kind: 'high_winds',
    description: 'Damaging winds topple trees and power lines and can bring tornadoes.',
    likelihood: 4,
    severity: 2,
    dimensions: [
      { dimension_slug: 'energy', impact: 'moderate' },
      { dimension_slug: 'networks', impact: 'low' },
      { dimension_slug: 'housing', impact: 'low' },
    ],
    nws_events: ['High Wind Warning', 'High Wind Watch', 'Wind Advisory', 'Severe Thunderstorm Warning', 'Tornado Warning', 'Tornado Watch'],
  },
  {
    slug: 'poor-air-quality',
    name: 'Poor air quality and wildfire smoke',
    kind: 'air_quality',
    description:
      'Ozone on hot days and smoke from distant wildfires, as in June 2023, make the air unhealthy to breathe, especially for children and people with asthma.',
    likelihood: 4,
    severity: 3,
    dimensions: [
      { dimension_slug: 'air-pollution', impact: 'high' },
      { dimension_slug: 'health', impact: 'high' },
    ],
    nws_events: ['Air Quality Alert', 'Dense Smoke Advisory'],
  },
  {
    slug: 'drought',
    name: 'Drought',
    kind: 'drought',
    description: 'Dry periods draw down the upstate reservoirs that supply the city’s water; the City declares drought watches and emergencies.',
    likelihood: 2,
    severity: 2,
    dimensions: [
      { dimension_slug: 'freshwater-withdrawals', impact: 'high' },
      { dimension_slug: 'water-sanitation', impact: 'moderate' },
    ],
    nws_events: [],
  },
  {
    slug: 'earthquake',
    name: 'Earthquake',
    kind: 'earthquake',
    description: 'Damaging earthquakes are rare here, but older unreinforced buildings and dense infrastructure raise the stakes.',
    likelihood: 1,
    severity: 5,
    dimensions: [
      { dimension_slug: 'housing', impact: 'high' },
      { dimension_slug: 'networks', impact: 'high' },
      { dimension_slug: 'health', impact: 'moderate' },
      { dimension_slug: 'energy', impact: 'moderate' },
    ],
    nws_events: [],
  },
  {
    slug: 'infectious-disease',
    name: 'Infectious disease outbreaks',
    kind: 'infectious_disease',
    description: 'Pandemics and outbreaks strain hospitals, close schools and workplaces, and fall hardest on essential workers.',
    likelihood: 3,
    severity: 4,
    dimensions: [
      { dimension_slug: 'health', impact: 'high' },
      { dimension_slug: 'income-work', impact: 'high' },
      { dimension_slug: 'education', impact: 'moderate' },
      { dimension_slug: 'social-equity', impact: 'moderate' },
    ],
    nws_events: [],
  },
  {
    slug: 'infrastructure-failure',
    name: 'Infrastructure failure',
    kind: 'infrastructure_failure',
    description: 'Power outages, water main breaks, and transit or communications failures, on their own or set off by another hazard.',
    likelihood: 3,
    severity: 3,
    dimensions: [
      { dimension_slug: 'energy', impact: 'high' },
      { dimension_slug: 'networks', impact: 'high' },
      { dimension_slug: 'water-sanitation', impact: 'moderate' },
      { dimension_slug: 'health', impact: 'moderate' },
    ],
    nws_events: [],
  },
];

/**
 * Plans with links known to be the official pages. Adoption year is left
 * for staff to confirm against the current edition.
 */
const PLANS: EmergencyPlanInputDraft[] = [
  {
    title: 'NYC Hazard Mitigation Plan',
    agency: 'NYC Emergency Management',
    url: 'https://nychazardmitigation.com/',
    adopted_year: null,
    summary:
      'The City’s plan to reduce long-term risk from the hazards it faces, from coastal storms and extreme heat to infrastructure failure. It is updated every five years for FEMA approval.',
    languages: ['en'],
    hazard_slugs: HAZARDS.map((h) => h.slug),
  },
];

// ---- Validation (dry run and apply alike) -------------------------------------------

const hazardRecords = HAZARDS.map((h, i) => hazardInputSchema.parse({ ...h, display_order: i * 10, published: false }));
const planRecords = PLANS.map((p, i) => emergencyPlanInputSchema.parse({ ...p, display_order: i * 10, published: false }));

function printProposal() {
  console.log('# Emergency config per portrait (NWS county and forecast zones)\n');
  for (const slug of NYC_SLUGS) {
    const c = configFor(slug);
    console.log(`  ${slug.padEnd(14)} zones ${c.nws_zones.join(',')}  sign-up ${c.alerts_signup_label} <${c.alerts_signup_url}>  ${c.emergency_phone} / ${c.info_phone}  ${c.time_zone}`);
  }
  console.log('\n  Zone names:');
  for (const [borough, b] of Object.entries(BOROUGH_ZONES)) console.log(`    ${borough.padEnd(14)} ${[b.county, ...b.zones].join(', ')}  (${b.names})`);
  console.log('\n# Hazards (NYC Hazard Mitigation Plan list) — ratings are PROPOSALS, written unpublished\n');
  for (const h of [...hazardRecords].sort((a, b) => riskScore(b.likelihood, b.severity) - riskScore(a.likelihood, a.severity))) {
    const risk = riskScore(h.likelihood, h.severity);
    console.log(`  ${h.slug.padEnd(24)} PROPOSED likelihood ${h.likelihood}, severity ${h.severity} → risk ${risk} (${riskBand(risk)})`);
    console.log(`  ${''.padEnd(24)} threatens ${h.dimensions.map((d) => `${d.dimension_slug}:${d.impact}`).join(', ')}`);
    console.log(`  ${''.padEnd(24)} NWS events ${h.nws_events.length ? h.nws_events.join(', ') : '(none issued for this hazard)'}`);
  }
  console.log('\n# Plans — links are checked at --apply and refused if they do not answer; written unpublished\n');
  for (const p of planRecords) console.log(`  ${p.title} (${p.agency}) <${p.url}>`);
  console.log('\nDry run. Re-run with --apply to write (existing rows are left as staff set them).');
}

const MAX_REDIRECTS = 5;

/**
 * GET the link and follow its redirects (at most five, https only) to the
 * page it really lands on, which must answer 2xx within 10 s overall. A
 * redirect is not an answer: a moved page can land on a 404 or a parked
 * domain. Returns where it landed, so the dry run can show staff the page
 * residents would open.
 */
async function linkAnswers(url: string): Promise<{ ok: true; finalUrl: string } | { ok: false; reason: string }> {
  const signal = AbortSignal.timeout(10_000);
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (new URL(current).protocol !== 'https:') return { ok: false, reason: `redirected to a non-https link ${current}` };
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': 'deep-fryer/1.0 (link check)', Accept: 'text/html,application/xhtml+xml,*/*' },
      });
      await res.body?.cancel();
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).href;
        continue;
      }
      return res.status >= 200 && res.status < 300
        ? { ok: true, finalUrl: current }
        : { ok: false, reason: `${current === url ? '' : `landed on ${current}, which `}answered ${res.status}` };
    }
    return { ok: false, reason: `more than ${MAX_REDIRECTS} redirects` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Fill only the fields staff left empty; everything they set stays. */
function mergeConfig(existing: EmergencyConfig | null, proposal: EmergencyConfig): EmergencyConfig {
  if (!existing) return proposal;
  return emergencyConfigSchema.parse({
    nws_zones: existing.nws_zones.length ? existing.nws_zones : proposal.nws_zones,
    alerts_signup_url: existing.alerts_signup_url ?? proposal.alerts_signup_url,
    alerts_signup_label: existing.alerts_signup_url ? existing.alerts_signup_label : proposal.alerts_signup_label,
    emergency_phone: existing.emergency_phone ?? proposal.emergency_phone,
    info_phone: existing.info_phone ?? proposal.info_phone,
    time_zone: existing.time_zone,
  });
}

async function apply() {
  const db = getDb();
  const rows = await db.select().from(tenants).where(inArray(tenants.slug, NYC_SLUGS));
  if (rows.length !== NYC_SLUGS.length) {
    throw new Error(`expected ${NYC_SLUGS.length} NYC portraits, found ${rows.length} — run provision-nyc first`);
  }

  // Every link is checked once, before anything is written.
  const signup = await linkAnswers(NOTIFY_NYC_URL);
  if (signup.ok) console.log(`sign-up link ${NOTIFY_NYC_URL} answers (lands on ${signup.finalUrl})`);
  else console.warn(`REFUSED sign-up link ${NOTIFY_NYC_URL}: ${signup.reason} — config written without it`);
  const plans: EmergencyPlanInput[] = [];
  for (const p of planRecords) {
    const check = await linkAnswers(p.url);
    if (check.ok) {
      plans.push(p);
      console.log(`plan "${p.title}" <${p.url}> answers (lands on ${check.finalUrl})`);
    } else console.warn(`REFUSED plan "${p.title}" <${p.url}>: ${check.reason} — not written`);
  }

  for (const t of rows) {
    const proposal = configFor(t.slug);
    const config = signup.ok ? proposal : { ...proposal, alerts_signup_url: null, alerts_signup_label: null };
    const [existingRow] = await db
      .select({ value: tenantConfig.value })
      .from(tenantConfig)
      .where(and(eq(tenantConfig.tenantId, t.id), eq(tenantConfig.key, 'emergency')));
    const existing = existingRow ? emergencyConfigSchema.safeParse(existingRow.value) : null;
    if (existing && !existing.success) {
      console.warn(`${t.slug}: stored emergency config does not validate; leaving it for staff to fix in the admin page`);
    } else {
      const value = mergeConfig(existing?.data ?? null, config);
      // A list staff saved is theirs to change, but a missing forecast zone
      // silently hides most alerts, so say which proposed codes it lacks.
      const missing = config.nws_zones.filter((z) => !value.nws_zones.includes(z));
      if (missing.length) {
        console.warn(
          `${t.slug}: saved NWS zones lack proposed ${missing.join(', ')} — add them at /${t.slug}/admin/emergency (forecast zones carry heat, winter, coastal flood, wind, and air quality alerts)`,
        );
      }
      await db
        .insert(tenantConfig)
        .values({ tenantId: t.id, key: 'emergency', value })
        .onConflictDoUpdate({ target: [tenantConfig.tenantId, tenantConfig.key], set: { value, updatedAt: new Date() } });
    }

    let added = 0;
    for (const h of hazardRecords) {
      const inserted = await db
        .insert(hazards)
        .values({
          tenantId: t.id,
          slug: h.slug,
          name: h.name,
          kind: h.kind,
          description: h.description,
          likelihood: h.likelihood,
          severity: h.severity,
          dimensions: h.dimensions,
          nwsEvents: h.nws_events,
          displayOrder: h.display_order,
          published: false,
        })
        .onConflictDoNothing({ target: [hazards.tenantId, hazards.slug] })
        .returning({ id: hazards.id });
      added += inserted.length;
    }

    let plansAdded = 0;
    for (const p of plans) {
      const [existingPlan] = await db
        .select({ id: emergencyPlans.id })
        .from(emergencyPlans)
        .where(and(eq(emergencyPlans.tenantId, t.id), eq(emergencyPlans.url, p.url)));
      if (existingPlan) continue;
      await db.insert(emergencyPlans).values({
        tenantId: t.id,
        title: p.title,
        agency: p.agency,
        url: p.url,
        adoptedYear: p.adopted_year,
        summary: p.summary,
        languages: p.languages,
        hazardSlugs: p.hazard_slugs,
        displayOrder: p.display_order,
        published: false,
      });
      plansAdded++;
    }
    console.log(
      `${t.slug}: config ${existingRow ? 'kept, empty fields filled' : 'written'}; ${added} hazard(s) and ${plansAdded} plan(s) added unpublished (existing rows left as is)`,
    );
  }
}

async function main() {
  if (process.argv.includes('--apply')) {
    await apply();
    console.log('\nNYC emergency proposal written. Review ratings and publish at /{portrait}/admin/emergency.');
  } else {
    printProposal();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
