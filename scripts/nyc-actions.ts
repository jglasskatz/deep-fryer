/**
 * Engagement actions per dimension for the NYC portrait family — the "how to
 * get involved" panel content (SPEC v2 §9/§10; SPEC v3 W1). Initial curated
 * set grounded in docs/nyc-impact-research.md: real NYC programs, adopted-law
 * levers, and civic entry points. Research sessions draft these per §9 in
 * future runs; this seeds the family until then.
 *
 * Keyed by dimension slug; `byTenant` overrides/extends for a borough where
 * the research names a specific local lever.
 */
export interface DimensionActions {
  actions: string[];
  byTenant?: Record<string, string[]>;
}

export const NYC_ACTIONS: Record<string, DimensionActions> = {
  food: {
    actions: [
      'Check SNAP eligibility and enroll at access.nyc.gov — roughly one in three eligible New Yorkers never claims benefits.',
      "Weigh in on the city's municipal grocery pilot: NYCEDC takes public comment on store siting and the discounted core basket.",
      'Volunteer or donate through City Harvest or Food Bank For NYC — Brooklyn alone has an 86-million-meal gap.',
    ],
    byTenant: {
      bronx: [
        'The first city-owned grocery store opens in Hunts Point — attend Bronx Community Board 2 meetings to shape its basket and hours.',
      ],
    },
  },
  health: {
    actions: [
      'Enroll in low- or no-cost coverage through NYC Care regardless of immigration status (nyccare.nyc).',
      'Comment on the HealthyNYC plan — the city is legally bound (Local Law 93) to close life-expectancy gaps, and public input shapes the update cycle.',
      'Use the NYC Health Map to find neighborhood clinics, mental-health support (988), and screening programs.',
    ],
  },
  education: {
    actions: [
      'Apply for free 2-K seats as they expand borough by borough — the first cohorts are enrolling now.',
      "Track your school's class-size compliance in the DOE's public reports; the 2022 state law requires 100% by 2029-30.",
      'Join your Community Education Council — the elected parent body with a formal voice on school policy.',
    ],
  },
  'income-work': {
    actions: [
      'Screen for every benefit you qualify for at access.nyc.gov — the True Cost of Living report shows 62% of New Yorkers fall short of basic needs.',
      'File wage-theft complaints with DCWP; the city recovers millions annually for underpaid workers.',
      'Support the $30-by-2030 minimum wage campaign — it requires Albany authorization, and constituent pressure moves state legislators.',
    ],
  },
  'water-sanitation': {
    actions: [
      'Get your free lead service line inspection — DEP publishes line materials by address and replaces lead lines at no cost in many cases.',
      'Report water quality concerns to 311; every complaint feeds the DEP monitoring system.',
      'Join a harbor or tributary cleanup with the Billion Oyster Project or your local waterfront alliance.',
    ],
  },
  energy: {
    actions: [
      'Apply for HEAP (Home Energy Assistance) before the season closes — energy burden above 6% of income is the affordability line.',
      'Request a free home energy assessment through NYSERDA; income-eligible households get free weatherization.',
      'If your building is over 25,000 sq ft, ask your board or landlord for its Local Law 97 compliance plan — 57% of covered buildings still exceed their 2030 cap.',
    ],
  },
  networks: {
    actions: [
      'Check Big Apple Connect eligibility — free broadband is live at 220+ NYCHA developments.',
      'Enroll in Fair Fares for half-price transit if your income qualifies; enrollment is far below eligibility.',
      'Ride and advocate: the bus-priority program adds miles only where communities show up for them at DOT workshops.',
    ],
  },
  housing: {
    actions: [
      "Facing eviction? You have a right to a free lawyer in housing court — call 311 and say 'right to counsel' before your first appearance.",
      'Report unsafe conditions to 311 and check your building\'s open violations on HPD Online.',
      'Attend your community board\'s land-use committee — the Block by Block plan (200,000 affordable homes) is siting projects borough by borough.',
    ],
  },
  'gender-equality': {
    actions: [
      'Know the salary-transparency law: NYC job postings must list pay ranges — report violations to the Commission on Human Rights.',
      'Free doula and midwife programs are expanding citywide; DOHMH maternal-health programs prioritize the highest-mortality neighborhoods.',
      'Universal 2-K childcare is the single strongest lever for mothers\' workforce participation — apply early and often.',
    ],
  },
  'social-equity': {
    actions: [
      'Read the charter-mandated Racial Equity Plan and file public comment — agencies must answer to it.',
      'Report discrimination to the NYC Commission on Human Rights (it has real enforcement power).',
      'Bank locally: community development credit unions reinvest deposits in the neighborhoods the TCOL report shows furthest below the line.',
    ],
  },
  'political-voice': {
    actions: [
      'Register to vote and check your poll site at vote.nyc — municipal turnout hovers near 41%.',
      'Join participatory budgeting in your council district: residents directly allocate real capital dollars every spring.',
      'Testify at City Council hearings — remote testimony is accepted, and hearing calendars are public at council.nyc.gov.',
    ],
  },
  'peace-justice': {
    actions: [
      'Learn about the Office of Community Safety\'s non-police mental-health response — and use 988, not 911, for mental-health crises where available.',
      'Attend your precinct community council meeting; commanding officers answer to residents there monthly.',
      'Support court-watching and jail-oversight programs tracking the Rikers closure mandate.',
    ],
  },
  'climate-change': {
    actions: [
      'If you own or manage a building over 25,000 sq ft, start Local Law 97 compliance now — caps tighten sharply in 2030.',
      'Enroll in community solar: renters and co-op owners can cut bills without owning a roof.',
      'Comment on PlaNYC updates — the 80x50 mandate (Local Law 66) is enforceable, and public pressure sets the pace.',
    ],
  },
  'ocean-acidification': {
    actions: [
      'Join the Billion Oyster Project — oyster reefs buffer local acidification and restore harbor ecology.',
      'Support the state\'s Ocean Acidification Task Force recommendations for New York coastal waters.',
    ],
  },
  'chemical-pollution': {
    actions: [
      'Separate organics — curbside composting is now citywide and mandatory; diversion is the zero-waste law\'s binding metric.',
      'Take hazardous waste to DSNY SAFE disposal events instead of the trash.',
      'Check EPA\'s Toxics Release Inventory for facilities near you and raise findings with your community board.',
    ],
  },
  'nitrogen-phosphorus-loading': {
    actions: [
      'Report illegal dumping and sewer overflows to 311 — CSO reduction targets are consent-order commitments DEP must meet.',
      'Volunteer with a green-infrastructure stewardship program: rain gardens and bioswales cut the overflows that load the harbor.',
    ],
  },
  'freshwater-withdrawals': {
    actions: [
      'Request free water-saving fixtures through DEP\'s conservation programs.',
      'Support watershed protection east and upstate — NYC\'s unfiltered supply depends on Catskill/Delaware land conservation.',
    ],
  },
  'land-conversion': {
    actions: [
      'Request a free street tree from NYC Parks — the Urban Forest Plan needs 30% canopy by 2040 and plants where residents ask.',
      'Join a Parks stewardship group or "It\'s My Park" day in your neighborhood.',
      'Advocate for the 1%-for-Parks budget pledge at council budget hearings.',
    ],
  },
  'biodiversity-loss': {
    actions: [
      'Volunteer with the Natural Areas Conservancy — forest and wetland restoration runs in every borough.',
      'Plant native species; the Greenbelt Native Plant Center publishes NYC-appropriate lists.',
      'Log wildlife sightings in iNaturalist — city ecologists use the data for the ecological assessments.',
    ],
  },
  'air-pollution': {
    actions: [
      'Report idling trucks and buses to 311 — citizens can even claim a bounty under the Citizens Air Complaint Program.',
      'Support congestion-pricing-funded transit and asthma programs — zone PM2.5 is down 22% and the revenue is committed by law.',
      'Check your neighborhood\'s NYCCAS air data and bring it to your community board — exposure varies more within boroughs than between them.',
    ],
    byTenant: {
      bronx: [
        'The $20M congestion-pricing asthma investment targets Bronx neighborhoods — DOHMH community programs are enrolling now.',
      ],
    },
  },
  'ozone-depletion': {
    actions: [
      'Dispose of old refrigerators and ACs through DSNY appliance pickup so refrigerants are recovered, not vented.',
    ],
  },
  'extreme-heat': {
    actions: [
      'Get a free air conditioner through the HEAP cooling assistance program if you qualify — no heat-stress death reviewed by DOHMH had a working AC at home.',
      'Check on elderly neighbors during heat emergencies and know your nearest cooling center (311 or the NYC Cool Options map).',
      'Outdoor workers: the 2026 heat-safety executive order sets protections — report violations to 311.',
    ],
  },
};
