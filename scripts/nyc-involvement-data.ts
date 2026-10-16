/**
 * The fact-checked listings behind scripts/nyc-involvement.ts (SPEC-v6 §4.4):
 * New York City programs, public bodies, and organizations a resident can
 * use or join, one entry per way to get involved.
 *
 * Provenance. Each entry was researched from public pages and then checked
 * by a second, independent pass against the page in `source_url` in October
 * 2026; anything the check could not confirm was dropped (default to false:
 * an unconfirmed listing is worse than a missing one, because residents act
 * on it). `evidence` keeps what the check found, with dates, so the next
 * review starts from it instead of from scratch. Descriptions are the
 * checked text: change one only after re-checking its source, since staff
 * and residents read them as fact.
 *
 * Where a listing goes. `boroughs: 'citywide'` puts it on all six NYC
 * portraits; a list of boroughs puts it on those borough portraits and on
 * the whole-city portrait (which gets every listing).
 *
 * Shape. Each entry is what involvementListingInputSchema (@deep-fryer/core)
 * accepts — name ≤ 160 characters, description ≤ 600, https links, a dialable
 * phone, framework dimension slugs — plus `boroughs`, `operator`, and
 * `evidence`, which are for staff reviewing the proposal and are not written
 * to the database. The script validates every entry before it writes.
 *
 * Order is the display order on every portrait (the script spaces it by 10
 * so staff can slot listings in between), grouped by theme.
 *
 * Left out after fact-checking. These candidates could not be confirmed in
 * the October 2026 run (most because the shared web-search budget ran out
 * before they were checked, not because anything was found wrong); each
 * needs its official page confirmed before it is added. They are most of
 * what would fill the dimensions this proposal leaves thin:
 * - Schools and learning: free 2-K/3-K/Pre-K seats; Community Education
 *   Councils (district schools through grade 8 — high schools have the
 *   CCHS); Reading Partners NYC tutoring; DYCD adult literacy classes;
 *   Advocates for Children's Jill Chaifetz Education Helpline; Queens
 *   Public Library Adult Learner Program.
 * - Work and money: DCWP Office of Labor Policy & Standards complaints;
 *   Workforce1 Career Centers; the Jobs NYC Center; Financial Empowerment
 *   Centers; NYC Free Tax Prep (nyc.gov/taxprep); the Summer Youth
 *   Employment Program; Make the Road New York.
 * - Getting around and staying connected: Fair Fares NYC; Big Apple Connect;
 *   Citi Bike Reduced Fare; NYC Aging Older Adult Centers and its Friendly
 *   Visiting / Friendly VOICES volunteering; Riders Alliance; Transportation
 *   Alternatives; DOT Open Streets.
 * - Gender and safety: Family Justice Centers; the Commission on Human
 *   Rights; the Citywide Doula Initiative; WE NYC; Sanctuary for Families;
 *   Day One.
 * - Immigrants and equity: the MOIA immigration legal support hotline
 *   (ActionNYC); IDNYC; the Commission on Racial Equity; CitizensNYC grants.
 * - Elections and having a say: NYC Votes; Board of Elections poll workers;
 *   Council participatory budgeting; The People's Money; Community Boards;
 *   testifying at the City Council; commenting on proposed City rules;
 *   poll-site language assistance.
 * - Policing and justice: the Civilian Complaint Review Board; NYPD Build
 *   the Block meetings; Board of Correction meetings; Community Dispute
 *   Resolution Centers.
 * - Waste, air, and compost: the Citizens Air Complaint Program (idling);
 *   the Environment & Health Data Portal; DSNY refrigerant (CFC) removal,
 *   SAFE Disposal events, and Special Waste drop-off sites; curbside
 *   composting; the Master Composter course.
 * - Food, water, and housing: the Food Help NYC map; the N.Y.C. Groceries
 *   public grocery survey; free lead service line replacement; the Talk to
 *   Tenants campaign. The Home Water Assistance Program was dropped for good:
 *   it is an automatic bill credit, so there is nothing to sign up for.
 * Other drafts of the ACCESS NYC screener, NYC Accelerator, community solar,
 * and 988 were dropped in favor of the checked versions below.
 */
import type { InvolvementKind } from '@deep-fryer/core';

/** The borough portraits (slugs as provisioned by scripts/provision-nyc.ts). */
export const NYC_BOROUGHS = ['manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island'] as const;
export type NycBorough = (typeof NYC_BOROUGHS)[number];

/** One proposed listing, as checked. */
export interface NycInvolvementEntry {
  /** The listing's title; unique per portrait (the database's conflict key). */
  name: string;
  /** What a resident can do, in plain language (≤ 600 characters). */
  description: string;
  /** The page residents open: the program's own page (https). */
  url: string;
  /** A number to call, or null; shown as a tap-to-call link. */
  phone: string | null;
  kind: InvolvementKind;
  /** Framework dimension slugs the listing serves, most relevant first. */
  dimension_slugs: string[];
  /** 'citywide' (all six portraits), or the boroughs it serves (their portraits plus the whole-city one). */
  boroughs: 'citywide' | readonly NycBorough[];
  /** The page that confirmed the facts (https); staff check the listing against it. Often the same as `url`. */
  source_url: string;
  /** Who runs it, for staff reviewing the proposal (not shown to residents). */
  operator: string;
  /** What the fact-check found, with dates; not written to the database. */
  evidence: string;
}

export const NYC_INVOLVEMENT: NycInvolvementEntry[] = [
  // ---- Benefits, and food ------------------------------------------------------------
  {
    name: 'ACCESS NYC benefits screener',
    description:
      'Answer a short online questionnaire to see which of 40+ City, State and federal benefits your household may qualify for, including SNAP, health coverage, HEAP energy help and housing programs. You do not need an account to screen. The results explain how to apply, and the agency that runs each program makes the final decision.',
    url: 'https://access.nyc.gov/',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['food', 'health', 'energy', 'housing', 'income-work'],
    boroughs: 'citywide',
    source_url: 'https://access.nyc.gov/about',
    operator: "NYC Mayor's Office for Economic Opportunity",
    evidence:
      "ACCESS NYC About page: the screener covers 'over 40 benefits in 10 easy steps', screening without sign-in, 11 languages. NYC Opportunity portfolio page (nyc.gov/site/opportunity/portfolio/access-nyc.page) lists 44+ benefits.",
  },
  {
    name: 'Apply for SNAP through ACCESS HRA',
    description:
      "Apply for or recertify SNAP food benefits online through the ACCESS HRA website or mobile app, by phone at 718-557-1399 (weekdays 8am-5pm), or by mail. NYC residents apply through ACCESS HRA, not the State's myBenefits site.",
    url: 'https://www.nyc.gov/site/hra/help/snap-benefits-food-program.page',
    phone: '718-557-1399',
    kind: 'services',
    dimension_slugs: ['food', 'income-work'],
    boroughs: 'citywide',
    source_url: 'https://home4.nyc.gov/site/hra/help/snap-benefits-food-program.page',
    operator: 'NYC Human Resources Administration (Department of Social Services)',
    evidence:
      "HRA SNAP page: 'the quickest way to apply or recertify for SNAP benefits is online, through the ACCESS HRA website or the ACCESS HRA Mobile App'; phone line (718) 557-1399 weekdays 8-5; mail option. A NYS myBenefits notice says myBenefits no longer processes SNAP applications for NYC residents.",
  },
  {
    name: 'Health Bucks at farmers markets',
    description:
      'When you spend SNAP at a NYC farmers market or farm stand that accepts EBT, you get $2 in Health Bucks for every $2 you spend, up to $10 a day, to buy more fruits and vegetables. Swipe your EBT card at the market information tent. Community organizations can apply to get Health Bucks to hand out.',
    url: 'https://www.nyc.gov/site/doh/health/health-topics/health-bucks.page',
    phone: null,
    kind: 'services',
    dimension_slugs: ['food', 'health'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/doh/health/health-topics/health-bucks.page',
    operator: 'NYC Department of Health and Mental Hygiene',
    evidence:
      "DOHMH Health Bucks page: 'for every $2 spent at farmers markets and farm stands using SNAP on an EBT card, you can get $2 in Health Bucks, up to $10 per day', available year-round at markets that accept EBT, 120+ markets and farm stands; community organizations can apply for free Health Bucks. GrowNYC's 'Grow Your SNAP' page describes the same 2:2 match at Greenmarkets.",
  },
  {
    name: 'City Harvest volunteer shifts',
    description:
      "Attend City Harvest's free New Volunteer Orientation, then sign up for shifts such as Mobile Market produce distributions, Greenmarket food rescues or repacking food. Minimum ages vary by project, so check the volunteer FAQ before signing up. City Harvest also keeps an online map of free food sites at cityharvest.org/food-map.",
    url: 'https://www.cityharvest.org/volunteer/volunteer-faq/',
    phone: null,
    kind: 'volunteer',
    dimension_slugs: ['food'],
    boroughs: 'citywide',
    source_url: 'https://www.nycservice.org/opportunity/a0TQq00000a8BbZMAU',
    operator: 'Nonprofit food rescue organization',
    evidence:
      'City Harvest volunteer FAQ: new individual volunteers must attend a Volunteer Orientation (online) before signing up; ages 14+ for Greenmarket Rescues, 16+ for Mobile Markets, 18+ for Nutrition Education, 21+ for Special Events. NYC Service listing: orientations are held bi-monthly on Zoom, with the opportunity listed through 2030. A Union Square Greenmarket rescue shift was listed for July 18, 2026.',
  },
  {
    name: 'Food Bank For New York City volunteer portal',
    description:
      "Create an account on the Food Bank's volunteer portal and register for a shift, such as packing and handing out groceries at its Community Kitchen & Pantry in West Harlem or at mobile pantries. No orientation is needed, but walk-ins are not accepted. Volunteers must be 14 or older, and anyone under 18 needs a parent or guardian.",
    url: 'https://volunteer.foodbanknyc.org/',
    phone: null,
    kind: 'volunteer',
    dimension_slugs: ['food'],
    boroughs: 'citywide',
    source_url: 'https://volunteer.foodbanknyc.org/faqs',
    operator: 'Nonprofit food bank',
    evidence:
      "Volunteer portal FAQ: new volunteers create an account ('Not A Member?'); 'no sign-up, application, or orientation required' before registering for a shift; 14+ with guardian under 18; walk-ins not accepted; contact volunteer@foodbanknyc.org. Group shifts recorded in 2026 (Lehman Village mobile pantry May 16, 2026; community kitchen Sept 30, 2026).",
  },
  {
    name: 'GreenThumb community garden volunteering',
    description:
      'Join a free volunteer workday at a GreenThumb community garden; no experience is needed. You can also find a garden near you on the community garden map, visit during open hours and ask about becoming a member gardener. Groups of 10 or more can arrange a workday through the NYC Parks group contact form or gt.volunteer@parks.nyc.gov.',
    url: 'https://www.nycgovparks.org/greenthumb/volunteer-groups',
    phone: null,
    kind: 'volunteer',
    dimension_slugs: ['food', 'land-conversion', 'biodiversity-loss'],
    boroughs: 'citywide',
    source_url: 'https://www.nycgovparks.org/events/greenthumb',
    operator: 'NYC Parks (GreenThumb)',
    evidence:
      "NYC Parks 'Help A Garden Grow Volunteer Program' and 'How to Join a Community Garden' pages describe volunteer events, the garden map and group sign-up. The GreenThumb events calendar lists fall 2026 workdays, for example a Howard Garden build day on Oct 10 and a Fantasy Garden cleanup on Oct 24, 2026. GreenThumb sustains 550+ gardens.",
  },

  // ---- Health ------------------------------------------------------------------------
  {
    name: 'NYC Care',
    description:
      'If you live in the five boroughs and cannot afford, or do not qualify for, health insurance, enroll in NYC Care for low- or no-cost care at NYC Health + Hospitals. Immigration status does not matter, and fees are based on income and household size, starting at $0. Apply online or call 1-646-692-2273.',
    url: 'https://www.nyccare.nyc/',
    phone: '1-646-692-2273',
    kind: 'services',
    dimension_slugs: ['health'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/immigrants/city-services/health-services.page',
    operator: 'NYC Health + Hospitals',
    evidence:
      'City immigrant-services and ACCESS NYC pages: apply at nyccare.nyc or 1-646-692-2273 regardless of immigration status. Requirements: live in NYC and lack qualifying, affordable insurance. Fees start at $0 with no premiums. NYC Health + Hospitals does not record immigration status. NYC Care reported 125,000 members in Feb 2024.',
  },
  {
    name: 'GetCoveredNYC health insurance enrollment help',
    description:
      "Get free one-on-one help enrolling in health insurance, regardless of immigration status or income. Call 311 and say 'GetCoveredNYC', text CoveredNYC (SeguroNYC in Spanish) to 55676, or fill out the online contact form. People who qualify for Medicaid or the Essential Plan can enroll at any time of year.",
    url: 'https://www.nyc.gov/nyc-resources/get-covered.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['health'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/nyc-resources/get-covered.page',
    operator: "NYC Public Engagement Unit (now under the Mayor's Office of Mass Engagement)",
    evidence:
      "nyc.gov GetCoveredNYC page: 'Complete the contact form, call 311 and say GetCoveredNYC, or text CoveredNYC (SeguroNYC en Espanol) to 55676'. A 2025-era city release on insurance renewals uses the same number. City materials say Medicaid and Essential Plan enrollment is open year-round. The older 877877 text number is outdated.",
  },
  {
    name: 'NYC 988 mental health support',
    description:
      'Call or text 988, or chat online, to reach a trained counselor 24/7 about stress, depression, anxiety, alcohol or drug use, or a suicidal crisis. The service is free and confidential, regardless of immigration status. Press 2 or text AYUDA for Spanish; interpretation covers 200+ languages, and you should call 911 if someone is in immediate danger.',
    url: 'https://access.nyc.gov/programs/nyc-988/',
    phone: '988',
    kind: 'services',
    dimension_slugs: ['health'],
    boroughs: 'citywide',
    source_url: 'https://access.nyc.gov/programs/nyc-988/',
    operator: 'NYC Department of Health and Mental Hygiene',
    evidence:
      'ACCESS NYC NYC 988 page (updated June 2026): reach a counselor by phone, text or chat 24/7. Press 1 for veterans, 2 for Spanish, 3 for LGBTQI+ under 25. Counselors speak English, Spanish and Chinese, with interpretation in 200+ languages, regardless of immigration status. NYC 988 replaced NYC Well.',
  },
  {
    name: 'Free naloxone (Narcan) kits',
    description:
      'Get a free naloxone kit to reverse an opioid overdose. You can ask at a participating pharmacy (no ID or insurance needed), use a public health vending machine or community program listed on the NYC Health Map, or take a short virtual training and get a kit by mail. Call 311 with questions.',
    url: 'https://www.nyc.gov/site/doh/health/health-topics/naloxone.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['health'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/doh/about/press/pr2026/free-naloxone-by-mail-campaign.page',
    operator: 'NYC Department of Health and Mental Hygiene',
    evidence:
      "DOHMH naloxone page: free kits at participating pharmacies with no ID or insurance needed, Opioid Overdose Prevention Programs, and 24/7 public health vending machines. Find sites on the NYC Health Map ('Free Naloxone Kits'), or get a kit by mail after a virtual training. A May 2026 DOHMH press release announces a free-naloxone-by-mail campaign.",
  },
  {
    name: 'Neighborhood Health Action Centers',
    description:
      'Visit a Health Department Neighborhood Health Action Center in East Harlem, Brownsville or Tremont. The centers offer primary and mental health care on site, referrals to social services, and family programs such as childbirth and breastfeeding workshops. They also run naloxone trainings and offer meeting space where community groups can organize around health.',
    url: 'https://www.nyc.gov/site/doh/health/neighborhood-health/neighborhood-health-action-centers.page',
    phone: null,
    kind: 'services',
    dimension_slugs: ['health'],
    boroughs: ['manhattan', 'brooklyn', 'bronx'],
    source_url: 'https://www.nyc.gov/site/doh/health/neighborhood-health/neighborhood-health-action-centers.page',
    operator: 'NYC Department of Health and Mental Hygiene',
    evidence:
      'DOHMH page: services in North and Central Brooklyn, East Harlem and the South Bronx, with centers in East Harlem, Brownsville and Tremont. Services include co-located primary care, mental health care and some dental care, social-service referrals, a Family Wellness Suite, workshops including naloxone education, and community meeting space.',
  },
  {
    name: 'NYC Health + Hospitals Community Advisory Boards',
    description:
      'Attend a public meeting of the Community Advisory Board (CAB) at your local NYC Health + Hospitals hospital, long-term care facility or Gotham Health center, or apply to join one. There are 21 CABs made up of community volunteers. Members must be 18 or older, and application steps and term lengths vary by facility.',
    url: 'https://www.nychealthandhospitals.org/cabs/',
    phone: null,
    kind: 'civic',
    dimension_slugs: ['health', 'political-voice'],
    boroughs: 'citywide',
    source_url: 'https://www.nychealthandhospitals.org/cabs/',
    operator: 'NYC Health + Hospitals',
    evidence:
      "NYC H+H CAB page: '21 Community Advisory Boards, made up of volunteers representing our hospitals, long term care facilities and Gotham Health centers'. Members must be 18+ and serve two-year terms, and all CAB meetings are open to the public. Facility pages (Queens, Elmhurst, Gouverneur, Metropolitan) describe their own application routes.",
  },

  // ---- Water, sanitation, and the harbor ---------------------------------------------
  {
    name: 'Free lead-in-drinking-water test kit',
    description:
      "Request a free kit to test your home's tap water for lead by calling 311 or using DEP's online form. You collect the samples yourself and mail them back with the prepaid label, and results are mailed to you within 30 days. DEP notes that buildings built before 1961 may have lead service lines.",
    url: 'https://www.nyc.gov/site/dep/water/lead-in-drinking-water-test-kit.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['water-sanitation', 'health'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dep/water/lead-in-drinking-water-test-kit.page',
    operator: 'NYC Department of Environmental Protection',
    evidence:
      "DEP 'Lead in Drinking Water Test Kit' page: request a free kit by calling 311 or using the online form. The kit has two bottles, instructions, a chain-of-custody form and a prepaid return label, and results are mailed within 30 days. Buildings built before 1961 may have lead service lines.",
  },
  {
    name: 'Report sewer backups and clogged catch basins',
    description:
      "Report sewage backing up into your home, or a clogged catch basin flooding your street, to 311 or through DEP's online form. Give your contact details so DEP can investigate, and keep your service request number. DEP says grease and wipes down drains are the most common cause of backups.",
    url: 'https://www.nyc.gov/site/dep/water/sewer-backup.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['water-sanitation'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dep/water/sewer-backup.page',
    operator: 'NYC Department of Environmental Protection',
    evidence:
      'DEP sewer backup page: report to 311 or the DEP online form; DEP cannot investigate without contact information; keep 311 and DEP request numbers; the most common cause is grease and wipes. Reporting shows 11,066 clogged catch basin complaints in the latest fiscal year, cleared in about 2.5 days on average.',
  },
  {
    name: 'DSNY Volunteer Cleanup Program and Adopt-a-Basket',
    description:
      'Organize a cleanup of the public streets and sidewalks on your block. DSNY lends brooms, shovels and rakes, provides bags and gloves, and picks up the bags afterward; send your request at least two weeks ahead. Businesses, groups and individuals can also adopt a corner litter basket at nyc.gov/adoptabasket.',
    url: 'https://www.nyc.gov/site/dsny/resources/education/volunteer-cleanup.page',
    phone: null,
    kind: 'volunteer',
    dimension_slugs: ['water-sanitation', 'chemical-pollution'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/assets/dsny/docs/adopt-a-basket-flyer-abf-f.pdf',
    operator: 'NYC Department of Sanitation',
    evidence:
      'DSNY Volunteer Cleanup page: DSNY lends tools, provides bags and gloves, and arranges collection. Requests must come no less than two weeks in advance, and cleanups are limited to public streets and sidewalks, not parks or beaches. DSNY Adopt-a-Basket flyer: register at nyc.gov/adoptabasket, and DSNY supplies liners and a contact at the local office.',
  },
  {
    name: 'Billion Oyster Project volunteer days',
    description:
      'Sign up for a free public volunteer day on Governors Island (ages 16+, about five hours, training included) to clean shells and build oyster reef structures for New York Harbor. New dates are posted on the 15th of each month. After three events you can train as a long-term Ambassador.',
    url: 'https://billionoysterproject.org/volunteer',
    phone: null,
    kind: 'volunteer',
    dimension_slugs: ['water-sanitation', 'nitrogen-phosphorus-loading', 'biodiversity-loss'],
    boroughs: 'citywide',
    source_url: 'https://billionoysterproject.org/volunteer',
    operator: 'Nonprofit harbor restoration organization',
    evidence:
      'BOP volunteer page: new dates released on the 15th of every month; questions to volunteer@billionoysterproject.org. Public days are on Governors Island, free and about five hours, with a 16+ age limit. Three public events make you eligible for Ambassador training. The site cites 200M+ oysters restored as of July 2026, and a Sept 2026 report describes volunteers building reef structures on Governors Island.',
  },
  {
    name: 'Bronx River Alliance stewardship and water monitoring',
    description:
      'Join Bronx River Alliance stewardship events, such as litter pickups at Bronx River House in Starlight Park and rain-garden care in Bronx Park. You can also train for its volunteer water-quality monitoring program, which samples river stations every two weeks from May through October.',
    url: 'https://bronxriver.org/stewardship-and-volunteering',
    phone: null,
    kind: 'volunteer',
    dimension_slugs: ['water-sanitation', 'nitrogen-phosphorus-loading', 'biodiversity-loss'],
    boroughs: ['bronx'],
    source_url: 'https://bronxriver.org/stewardship-and-volunteering',
    operator: 'Nonprofit river conservation organization',
    evidence:
      'NYC Parks volunteer event listings: a Bronx River Alliance litter pickup at Bronx River House (Starlight Park) on Oct 26, 2026, and a rain-garden session at Fort Knox in Bronx Park on Oct 29, 2026. The Alliance stewardship page describes biweekly water-quality monitoring at 15 stations, with training in April and a May-October season.',
  },

  // ---- Energy and climate ------------------------------------------------------------
  {
    name: 'HEAP home energy assistance',
    description:
      "HEAP offers a grant toward heating costs once each season, emergency help if your heat is shut off or about to be, and seasonal benefits for heating-equipment repair or replacement and for cooling. The 2025-26 season has closed, so check HRA's energy assistance page or call 718-557-1399 to find out when the 2026-27 season opens. A HEAP grant also enrolls Con Edison customers in its bill discount.",
    url: 'https://www.nyc.gov/site/hra/help/energy-assistance.page',
    phone: '718-557-1399',
    kind: 'services',
    dimension_slugs: ['energy'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/hra/help/energy-assistance.page',
    operator: 'NYC Human Resources Administration (State HEAP program)',
    evidence:
      "HRA energy assistance page: 2025-2026 regular, emergency, heating equipment repair/replacement and cooling applications are 'now closed'; the regular benefit ran until April 7, 2026 or until funds ran out. The 2026-27 opening date was not found in search results. Con Edison: 'Once a HEAP grant is applied, you will be automatically enrolled in the Energy Affordability Program for 18 months.'",
  },
  {
    name: 'NYSERDA EmPower+ home energy upgrades',
    description:
      "Low- and moderate-income homeowners and renters in one- to four-family homes can apply for a free home energy assessment and upgrades such as air sealing, insulation and heat pumps. Renters need their landlord's permission. Low-income households can get upgrades at no cost, and moderate-income households get part of the cost covered, up to program limits. Apply through NYSERDA's online portal or by mail.",
    url: 'https://nyserda.ny.gov/empower',
    phone: null,
    kind: 'services',
    dimension_slugs: ['energy', 'climate-change', 'housing'],
    boroughs: 'citywide',
    source_url: 'https://nyserda.ny.gov/empower',
    operator: 'NYSERDA (New York State public authority)',
    evidence:
      'NYSERDA EmPower+ page: open to income-eligible owners and renters of 1-4 family homes, with a free assessment. Low-income single-family homes get no-cost improvements up to $14,000 downstate; moderate-income homes get a 50% cost share up to $7,000 downstate. Apply via the MyEnergy Portal or a printable application; Regional Clean Energy Hubs can help.',
  },
  {
    name: 'Con Edison Energy Affordability Program',
    description:
      "Con Edison customers who receive HEAP, SSI, TANF or certain other benefits are enrolled automatically in a monthly bill discount. Customers on Medicaid, federal public housing assistance or certain veterans' benefits, or below the income limits, can apply. Check the 'Adjustment Information' section of your bill to see whether the discount is applied.",
    url: 'https://www.coned.com/en/accounts-billing/payment-plans-assistance/energy-affordability-program',
    phone: null,
    kind: 'services',
    dimension_slugs: ['energy'],
    boroughs: 'citywide',
    source_url: 'https://dps.ny.gov/energy-affordability-program',
    operator: 'Con Edison (utility program under the NYS Public Service Commission)',
    evidence:
      "Con Edison EAP page: automatic enrollment if an agency reports HEAP, SSI, TANF, SNA or Direct Vendor/Utility Guarantee benefits. Medicaid, federal public housing assistance and veterans' pensions require applying, and there is an income pathway up to area-median thresholds. Discount table effective Dec 1, 2025. The State DPS runs the statewide Energy Affordability Program. Con Ed pages conflict on whether SNAP enrollment is automatic, so SNAP is omitted here.",
  },
  {
    name: 'Community solar and Solar for All',
    description:
      "Renters and homeowners can subscribe to a community solar project and get credits on their existing electric bill without installing panels. Use NYSERDA's Find a Community Solar Project tool, which lists State-registered providers, and check cancellation fees and rate terms before signing. Income-eligible households can enroll in Solar for All for no-cost credits of about $5-$15 a month.",
    url: 'https://www.nyserda.ny.gov/communitysolar',
    phone: null,
    kind: 'services',
    dimension_slugs: ['energy', 'climate-change'],
    boroughs: 'citywide',
    source_url: 'https://www.nyserda.ny.gov/-/media/Project/Nyserda/Files/Programs/NY-Sun/Solar-for-All/Solar-for-All-Fact-Sheet.pdf',
    operator: 'NYSERDA (NY-Sun program)',
    evidence:
      "NYSERDA 'Tap Into Community Solar' page: homeowners, renters and businesses can get solar benefits without panels, with credits on the current utility bill, and its project-finder tool lists only State-registered providers. The Solar for All fact sheet says income-eligible households get no-cost community solar credits of $5-$15 a month with no fees and can cancel anytime.",
  },
  {
    name: 'NYSERDA Regional Clean Energy Hubs (NYC)',
    description:
      'Contact the Clean Energy Hub that serves New York City, run by community nonprofits with NYSERDA funding, for free help with energy-saving and clean energy options. Hubs can prepare a free Home Energy Plan, find incentives and qualified contractors, and help you sign up for community solar.',
    url: 'https://www.nyserda.ny.gov/All-Programs/Regional-Clean-Energy-Hubs',
    phone: null,
    kind: 'services',
    dimension_slugs: ['energy', 'climate-change'],
    boroughs: 'citywide',
    source_url: 'https://www.nyserda.ny.gov/All-Programs/Regional-Clean-Energy-Hubs',
    operator: 'NYSERDA with community-based nonprofits',
    evidence:
      'NYSERDA hubs page and fact sheet: 12 regional hubs led by community nonprofits, plus two more funded for New York City. Hubs help with a free Home Energy Plan, incentives, contractors and community solar sign-up. An August 2026 NYSERDA market study update says hubs continue under the 2026-2030 low-to-moderate-income portfolio.',
  },
  {
    name: 'Comment on utility rate cases at the Public Service Commission',
    description:
      "Comment on Con Edison rate cases and other Public Service Commission proceedings: find the case in the PSC's online Document and Matter Management system and click 'Post Comments', or call the PSC Opinion Line. You can also speak at public statement hearings when they are scheduled in New York City.",
    url: 'https://dps.ny.gov/how-post-comments-and-receive-updates-psc-cases',
    phone: '1-800-335-2120',
    kind: 'civic',
    dimension_slugs: ['energy', 'political-voice'],
    boroughs: 'citywide',
    source_url: 'https://dps.ny.gov/news/more-dozen-public-statement-hearings-set-regarding-con-edisons-electric-gas-delivery-rates',
    operator: 'NYS Department of Public Service / Public Service Commission',
    evidence:
      "DPS 'Post Comments' page: members of the public can post comments on any PSC case in DMM. In the 2025 Con Edison rate cases (25-E-0072/25-G-0073), the PSC held NYC public statement hearings in July 2025 and took comments online, by mail or via the Opinion Line at 1-800-335-2120. In July 2026 the City appointed a Public Utility Advocate in MOCEJ to increase public participation in rate proceedings.",
  },
  {
    name: 'NYC Accelerator for building owners',
    description:
      'Building owners, co-op and condo boards and managers can get free expert help from NYC Accelerator with energy-efficiency and electrification upgrades, Local Law 97 emissions compliance, incentives and financing. An outreach specialist can also help request and compare contractor proposals. Tenants can point their owner or board to the program.',
    url: 'https://accelerator.nyc/technical-assistance',
    phone: null,
    kind: 'services',
    dimension_slugs: ['energy', 'climate-change'],
    boroughs: 'citywide',
    source_url: 'https://accelerator.nyc/ll97',
    operator: "NYC Mayor's Office of Climate & Environmental Justice",
    evidence:
      "accelerator.nyc pages: free technical assistance with building upgrades, local law compliance, incentives and financing, sponsored by the NYC Mayor's Office of Climate & Environmental Justice. The program says it has helped 30,000+ buildings since 2015, and owners are connected with an outreach specialist.",
  },
  {
    name: 'WE ACT for Environmental Justice membership and working groups',
    description:
      "Attend WE ACT's monthly membership meeting, usually on the second Saturday, or join a working group such as Climate Justice, Healthy Homes or NYCHA to organize on energy, housing and environmental health issues. Membership is centered on Northern Manhattan, and you do not need to be a member to attend.",
    url: 'https://weact.org/get-involved/membership/',
    phone: null,
    kind: 'organize',
    dimension_slugs: ['energy', 'housing', 'health', 'air-pollution', 'climate-change'],
    boroughs: ['manhattan'],
    source_url: 'https://weact.org/get-involved/',
    operator: 'Nonprofit environmental justice organization',
    evidence:
      'WE ACT membership page: monthly Membership Meeting on the second Saturday, plus Climate Justice, Healthy Homes, NYCHA and Spanish Civic Engagement working groups. The Get Involved page says non-members can attend meetings and working groups. The community calendar lists 2026 meetings including Sept 12 and Oct 10, 2026. Contact membership@weact.org.',
  },

  // ---- Housing -----------------------------------------------------------------------
  {
    name: 'Right to Counsel and the Tenant Helpline',
    description:
      "If you face eviction in Housing Court or a NYCHA proceeding, call 311 and ask for 'Right to Counsel' or the Tenant Helpline to be connected with free legal help from a nonprofit lawyer, regardless of immigration status. Tenants with household income at or below 200% of the federal poverty level get full representation, and others can get brief legal advice.",
    url: 'https://www.nyc.gov/site/mayorspeu/resources/right-to-counsel.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['housing', 'peace-justice'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/assets/hra/downloads/pdf/services/civiljustice/OCJ_Annual_Report_2025.pdf',
    operator: 'NYC Human Resources Administration, Office of Civil Justice',
    evidence:
      "City Right to Counsel page: HRA's Office of Civil Justice connects tenants facing eviction in Housing Court or NYCHA proceedings with free nonprofit legal help in every ZIP code, regardless of immigration status; call 311 and ask for Right to Counsel. City procurement notices (2024) set full representation at or below 200% FPL and brief assistance above it. OCJ published its 2025 annual report.",
  },
  {
    name: 'Report no heat, no hot water or needed repairs (HPD via 311)',
    description:
      'If your landlord does not restore heat or hot water or fix conditions, file a complaint with 311 by phone, online or in the app; heat complaints can be anonymous. HPD contacts the owner and may inspect, and you can track the outcome on HPD Online. During heat season (Oct 1-May 31) apartments must reach 68°F in the daytime when it is below 55°F outside and 62°F overnight, with 120°F hot water year-round.',
    url: 'https://www.nyc.gov/site/hpd/services-and-information/heat-and-hot-water-information.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['housing', 'health'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/mayors-office/news/2026/07/mayor-mamdani-releases--rental-ripoff-report---outlining-new-act',
    operator: 'NYC Department of Housing Preservation and Development',
    evidence:
      'HPD Heat and Hot Water page: contact the landlord first, then file with 311, and complaints can be anonymous. HPD notifies the owner and inspects if heat is still off; check status on HPDonline; legal temperature standards as stated. The July 2026 Rental Ripoff Report commits the City to investigate heat complaints individually, with inspectors attempting an investigation on every complaint starting in the October 2026 heat season.',
  },
  {
    name: 'NYC Housing Connect affordable housing lotteries',
    description:
      'Create one Housing Connect profile to apply for income-restricted rental and homeownership lotteries, including Mitchell-Lama, and re-rentals in all five boroughs. There is no application fee, so never pay anyone to apply, and you can apply regardless of immigration status. For help, call the hotline at 212-863-7990 or contact a Housing Ambassador.',
    url: 'https://www.nyc.gov/site/hpd/services-and-information/nyc-housing-connect.page',
    phone: '212-863-7990',
    kind: 'services',
    dimension_slugs: ['housing'],
    boroughs: 'citywide',
    source_url: 'https://amsterdamnews.com/news/2026/08/27/mamdani-aims-to-speed-up-nyc-housing-connect-and-housing-courts/',
    operator: 'NYC Department of Housing Preservation and Development',
    evidence:
      'HPD Housing Connect pages: the portal covers affordable rentals, homeownership and re-rentals, and all Mitchell-Lama lotteries now run on it. No fees, eligibility regardless of immigration status, hotline 212-863-7990, and Housing Ambassadors available. Amsterdam News (Aug 27, 2026): HPD is shortening the application period and streamlining income verification under the Block by Block plan; nearly 15,000 families were housed through Housing Connect and homeless placements in FY2025.',
  },
  {
    name: 'Homebase homelessness prevention',
    description:
      'If you are at risk of losing your home or entering shelter, contact the Homebase office for your ZIP code. Find it with the online locator, or call 311 and ask for Homebase. Services include eviction prevention, help with benefits and emergency rental assistance, financial counseling and job help; call ahead for an appointment, and you do not need every document to get help.',
    url: 'https://www.nyc.gov/site/dhs/prevention/homebase.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['housing', 'income-work'],
    boroughs: 'citywide',
    source_url: 'https://access.nyc.gov/programs/homebase/',
    operator: 'NYC Department of Social Services (DHS/HRA)',
    evidence:
      'DHS and HRA Homebase pages and ACCESS NYC: for people at imminent risk of entering shelter. Services include eviction prevention, benefits help, emergency rental assistance, job placement, financial counseling and short-term financial help. Use the Homebase locator or call 311, schedule an appointment in advance, and you do not need all documents to receive help.',
  },
  {
    name: 'Testify at Rent Guidelines Board hearings',
    description:
      'Each year, usually in May and June, the Rent Guidelines Board holds public hearings before it votes on lease increases for rent-stabilized apartments. Anyone can register to speak online, by phone or on the hearing night, and each speaker gets a short time limit. The 2026 hearings are over, so watch the RGB site for the 2027 schedule and format.',
    url: 'https://rentguidelinesboard.cityofnewyork.us/',
    phone: '212-669-7480',
    kind: 'civic',
    dimension_slugs: ['housing', 'political-voice'],
    boroughs: 'citywide',
    source_url: 'https://rentguidelinesboard.cityofnewyork.us/rent-guidelines/2026-notice-of-public-hearings-and-opportunity-to-comment-on-proposed-rules/',
    operator: 'NYC Rent Guidelines Board',
    evidence:
      'RGB 2026 notice: registration opened May 14, 2026 at nyc.gov/rgb or 212-669-7480, with hearings June 4, 8, 11 and 16, 2026 and in-person sign-up on hearing nights. Speakers get up to two minutes; the public can watch on YouTube but must attend to testify. Annual notices for 2022-2025 follow the same process. No 2027 schedule was found yet.',
  },
  {
    name: "Met Council on Housing Tenants' Rights Hotline",
    description:
      "Call Met Council's volunteer-staffed Tenants' Rights Hotline at 212-979-0611 (Mon and Wed 1:30-8pm, Fri 1:30-5pm) with tenant-rights questions. You can also become a member and train to staff the hotline; no prior expertise is needed, and Spanish speakers are encouraged to volunteer.",
    url: 'https://www.metcouncilonhousing.org/program/tenants-rights-hotline/',
    phone: '212-979-0611',
    kind: 'organize',
    dimension_slugs: ['housing'],
    boroughs: 'citywide',
    source_url: 'https://www.metcouncilonhousing.org/program/tenants-rights-hotline/',
    operator: 'Nonprofit tenant membership organization',
    evidence:
      'Met Council hotline page: staffed by volunteer members, with training materials provided and hotline volunteer trainings posted on the calendar. Hours are Mon and Wed 1:30-8pm and Fri 1:30-5pm, and the line may close on short notice. The organization has about 900 dues-paying members across all boroughs. The page date was not shown.',
  },
  {
    name: 'HOPE count volunteer (annual street homelessness survey)',
    description:
      "Volunteer for the City's annual HOPE count, an overnight survey (roughly 10pm-4am) in which trained teams walk assigned areas to estimate how many people are sleeping unsheltered. Volunteers are trained on the night of the count. Registration opens before each winter count at nyc.gov/hope.",
    url: 'https://www.nyc.gov/hope',
    phone: null,
    kind: 'volunteer',
    dimension_slugs: ['housing'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/assets/dhs/downloads/pdf/press-releases/Call-For-Volunteers-to-Join-NYC-HOPE-Survey-Effort-2026.pdf',
    operator: 'NYC Department of Social Services / Department of Homeless Services',
    evidence:
      "DSS 2026 call for volunteers: register at nyc.gov/hope; the count was set for 10pm-4am Jan 27-28, 2026, with teams trained that night. A freeze pushed the count to March 10, 2026, and results released July 2, 2026 estimate 4,991 unsheltered people. The Comptroller noted 2026 volunteer sign-ups were about half the prior year's. The 2027 date had not been announced.",
  },
];
