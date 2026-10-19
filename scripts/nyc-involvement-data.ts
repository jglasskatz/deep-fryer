/**
 * The fact-checked listings behind scripts/nyc-involvement.ts (SPEC-v6 §4.4):
 * New York City programs, public bodies, and organizations a resident can
 * use or join, one entry per way to get involved.
 *
 * How this list was produced (October 2026). Candidates were researched from
 * public pages; then an independent fact-checker checked each one with its
 * own web searches and kept a claim only if its own results showed it. The
 * search budget was small and fixed (about one or two searches per
 * candidate), so a candidate whose official page did not come up was dropped
 * as UNVERIFIED rather than judged wrong: default to false, because an
 * unconfirmed listing is worse than a missing one when residents act on it.
 * Every entry below passed that check, with its fixes applied: a link it
 * could not confirm was replaced by the official page its search returned,
 * claims it could not confirm were cut from the description, and dimensions
 * were corrected. `source_url` is the page the fact-checker's own search
 * confirmed (the same as `url` when the program page itself did), and
 * `evidence` keeps what it found, shortened, with dates, so the next review
 * starts from it instead of from scratch. Descriptions are the checked text:
 * change one only after re-checking its source, since staff and residents
 * read them as fact. This replaces the previous version of this file, whose
 * entries had been kept on prior knowledge after the search budget ran out.
 *
 * Merged and renamed. Two drafts each of the ACCESS NYC screener, NYC 988
 * (the "988 / NYC Well" draft) and NYC Accelerator (its technical-assistance
 * and Local Law 97 pages) passed the check; each pair is one entry here, using
 * only text one of the two checks confirmed. A name was changed where the
 * check cut the claim it made: "Report sewer backups" (was "... and clogged
 * catch basins"), "MOIA Immigration Legal Support Hotline" (was "... hotline
 * (ActionNYC)"), "Community Dispute Resolution Centers (mediation)" (was
 * "(free mediation)"), "Cooling Center Finder" (was "... and Cool It! NYC").
 * Phone numbers the check could not confirm are left empty: the PSC Opinion
 * Line, the Rent Guidelines Board, NYC Votes, the Board of Correction, and
 * 311 for Homebase.
 *
 * What staff must still do before publishing:
 * - Check every link from a normal network. This list was built in a sandbox
 *   that cannot reach NYC sites, so no link was opened from here and the
 *   script's link check gets no answer from any of them; --apply therefore
 *   writes every listing with link_checked_at empty. Open each `url` (and
 *   `source_url` where it differs), confirm it lands on the program's own
 *   page, and press "Link checked today" at /{portrait}/admin/involvement.
 * - Re-check time-sensitive text, which is right as of October 2026 only:
 *   NYC Votes (the November 3, 2026 election's dates, stale after Election
 *   Day); the Board of Correction (next meeting November 17, 2026); HEAP,
 *   NYC Free Tax Prep and DSNY SAFE Disposal events (next season); SYEP (the
 *   2027 application); Rent Guidelines Board hearings (2027); the HOPE count
 *   (next count); 2-K, 3-K and Pre-K (application windows); Council
 *   participatory budgeting and The People's Money (next cycle); CitizensNYC
 *   grants (next round); Fair Fares (the 200% FPL expansion taking effect);
 *   the Home Water Assistance credit (its eligibility seasons); lead service
 *   line replacement (Brooklyn from 2027); Jobs NYC Center hours; the HRPK
 *   Blue Team and the State Beach Cleanup (2027 dates); NYC CoolRoofs (next
 *   training cohort).
 * - Follow up the entries whose `evidence` says STAFF: Workforce1 links the
 *   Spanish page (the English one is probably /employment/programs/workforce1
 *   on nyc.gov); WE ACT's membership link was not seen verbatim; the NYPD
 *   Build the Block finder and the poll-site language maps may be stale.
 *
 * Thin dimensions. Every dimension has at least two listings on every
 * portrait except ocean-acidification, which has one (the HRPK Blue Team) on
 * the whole-city and Manhattan portraits and none on Brooklyn, Queens, the
 * Bronx or Staten Island. The Billion Oyster Project shell recycling below
 * would fill it once a current, dated source confirms it.
 *
 * Worklist for a run with network access: candidates the October 2026
 * fact-check dropped as UNVERIFIED, by main dimension (dimensions in
 * brackets). None was shown to be wrong; each needs its official page, dated
 * 2025-2026, confirmed before it is added. Where results contradicted a
 * detail, the line says so.
 * - Food
 *   - N.Y.C. Groceries public grocery store survey [food]: only the April
 *     2026 La Marqueta announcement came up; no survey, no edc.nyc program
 *     page, and the "30% below supermarket prices" claim unconfirmed.
 * - Health
 *   - NYC Care [health]: only 2019-2022 releases; no current enrollment page.
 *   - GetCoveredNYC health insurance enrollment help [health]: the given
 *     page did not come up; only 2017-2023 pages, with conflicting text
 *     short codes (55676 and 877877).
 *   - Neighborhood Health Action Centers [health]: no current official page
 *     (only a 2021 release); currency and on-site services seen on
 *     third-party sites only.
 * - Education
 *   - Advocates for Children of New York, Jill Chaifetz Education Helpline
 *     [education, social-equity]: third-party pages only (866-427-6033,
 *     Mon-Thu 10-4); nothing official or dated 2025-2026.
 * - Income & Work
 *   - Make the Road New York [income-work, social-equity]: no result dated
 *     2025-2026; the only official-domain result was an old interview page.
 * - Networks
 *   - NYC Aging Older Adult Centers [networks, food, health]: no result for
 *     the page, the 300+ centers figure, or eligibility.
 *   - NYC Aging volunteer programs: Friendly Visiting and Friendly VOICES
 *     [networks]: Friendly Visiting is confirmed on nyc.gov but Friendly
 *     VOICES was not found; it could return as Friendly Visiting only.
 *   - Riders Alliance [networks, political-voice]: the search returned only
 *     unrelated groups.
 * - Gender Equality
 *   - WE NYC (Women Entrepreneurs NYC) [gender-equality, income-work]: the
 *     page came up, but the only dated evidence is from 2018 and 2021; the
 *     "call 888-SBS-4NYC and ask for WE NYC" instruction unconfirmed.
 *   - Day One (youth dating violence services) [gender-equality,
 *     peace-justice]: dayoneny.org and listings (helpline 800-214-4150) came
 *     up, but nothing dated 2025-2026.
 * - Political Voice
 *   - Community Boards [political-voice, land-conversion]: the CAU page did
 *     not come up; only undated or older handbooks; the 2026 application
 *     details unconfirmed.
 * - Climate Change
 *   - NY-Sun Community Solar subscriptions [climate-change, energy]: three
 *     conflicting NYSERDA links, none confirmed as a current page (the
 *     Solar for All entry covers the topic meanwhile).
 *   - Master Composter Certificate Course (NYC Community Compost Network)
 *     [climate-change, education]: funding confirmed only through June 30,
 *     2026, nothing for FY27; results contradicted the hours and some host
 *     sites in the draft.
 * - Ocean Acidification
 *   - Billion Oyster Project shell recycling [ocean-acidification,
 *     biodiversity-loss, nitrogen-phosphorus-loading]: the official page
 *     (billionoysterproject.org/shell-recycling: public drop-off at Compost
 *     Power, 105 River St, and Red Hook Farms, 560 Columbia St) came up, but
 *     nothing dated 2025-2026.
 * - Freshwater Withdrawals
 *   - DEP Water Conservation & Reuse Grants [freshwater-withdrawals]: the
 *     official page (nyc.gov/site/dep/water/water-conservation-reuse-grants.page)
 *     came up, but only 2019-2020 dated items; nothing shows it is funded or
 *     open now.
 * - Ozone Layer Depletion
 *   - Essential Plan Cooling Program (free air conditioner) [ozone-depletion,
 *     health, energy]: secondary sources show it ran in 2026 (deadline
 *     extended to July 6, 2026), but the official nystateofhealth.ny.gov
 *     page did not come up, and the 2026 window has closed.
 *
 * Where a listing goes. `boroughs: 'citywide'` puts it on all six NYC
 * portraits; a list of boroughs puts it on those borough portraits and on
 * the whole-city portrait (which gets every listing).
 *
 * Shape. Each entry is what involvementListingInputSchema (@deep-fryer/core)
 * accepts — name ≤ 160 characters, description ≤ 600, https links, a dialable
 * phone ('' for none), framework dimension slugs — plus `boroughs`,
 * `operator`, and `evidence`, which are for staff reviewing the proposal and
 * are not written to the database. The script validates every entry before
 * it writes.
 *
 * Order is the display order on every portrait (the script spaces it by 10
 * so staff can slot listings in between): grouped by each entry's first
 * (main) dimension in framework order, and within a dimension services
 * first, then civic, organize, volunteer, and other.
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
  /** A number to call, or '' when there is none (stored as null); shown as a tap-to-call link. */
  phone: string;
  kind: InvolvementKind;
  /** Framework dimension slugs the listing serves, most relevant first; the first decides its place in the order. */
  dimension_slugs: string[];
  /** 'citywide' (all six portraits), or the boroughs it serves (their portraits plus the whole-city one). */
  boroughs: 'citywide' | readonly NycBorough[];
  /** The page the fact-check confirmed the facts on (https); staff check the listing against it. Often `url`. */
  source_url: string;
  /** Who runs it, for staff reviewing the proposal (not shown to residents). */
  operator: string;
  /** What the fact-check found, shortened, with dates; not written to the database. */
  evidence: string;
}

export const NYC_INVOLVEMENT: NycInvolvementEntry[] = [
  // ---- Food --------------------------------------------------------------------------
  {
    name: 'ACCESS NYC benefits screener',
    description:
      'Answer a short questionnaire (about 10 minutes, no account needed) to see which City, State and federal benefit programs you may qualify for, such as SNAP, cash assistance, health insurance, child care, HEAP energy help, housing programs and Fair Fares. ACCESS NYC is only a screener: it explains how to apply, but you still apply to each program separately, and the agency that runs it decides eligibility.',
    url: 'https://access.nyc.gov/',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['food', 'health', 'energy', 'housing', 'income-work', 'social-equity'],
    boroughs: 'citywide',
    source_url: 'https://access.nyc.gov/about',
    operator: "NYC Mayor's Office for Economic Opportunity (NYC Opportunity)",
    evidence:
      "Verified by web search, October 2026. Two checks of the same listing, merged here. ACCESS NYC About page (updated Sept 15, 2025): check 'potential eligibility for over 40 benefits in 10 easy steps', no account needed; an April 2025 Council hearing confirmed it is only a screener and applicants re-enter their information in each application. NYC Opportunity's page (nyc.gov/site/opportunity/portfolio/access-nyc.page) calls it the 'screening front door to 70+ city benefit programs', and a 2026 article cites 'over 80' programs and about 10 minutes, so the description gives no count.",
  },
  {
    name: 'Apply for SNAP through ACCESS HRA',
    description:
      "Apply for or recertify SNAP food benefits online through the ACCESS HRA website or mobile app, which HRA calls the quickest way. You can also call 311 or HRA's Infoline at 718-557-1399 to have a paper application mailed to you, or pick one up at any HRA Center. After you apply, you complete an eligibility interview by phone.",
    url: 'https://www.nyc.gov/site/hra/help/snap-benefits-food-program.page',
    phone: '718-557-1399',
    kind: 'services',
    dimension_slugs: ['food', 'income-work'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/hra/help/snap-benefits-food-program.page',
    operator: 'NYC Human Resources Administration (Department of Social Services)',
    evidence:
      "Verified by web search, October 2026. HRA SNAP page: 'The quickest way to apply or recertify for SNAP benefits is online. You can use the ACCESS HRA website or the ACCESS HRA Mobile App'; 'Call 311 or HRA's Infoline at 718-557-1399 and we will send you an application.' The phone line mails a paper application; it does not take one by phone. Removed (not confirmed): weekday 8am-5pm hours, the State myBenefits claim.",
  },
  {
    name: 'Food Help NYC map',
    description:
      "Search by address on the City's Food Help NYC map to find free food near you, such as food pantries and soup kitchens. The map also shows grocery stores and farmers markets. Hours change, so call ahead, or call 311 for help finding the nearest location.",
    url: 'https://finder.nyc.gov/foodhelp',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['food'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/hra/help/food-assistance.page',
    operator: "City of New York (Mayor's Office of Food Policy / HRA)",
    evidence:
      'Verified by web search, October 2026. HRA Food Assistance page lists the Food Help NYC Map (finder.nyc.gov/foodhelp) as an interactive map for finding an active food pantry near you, and says to call 311 for help finding the nearest location. A school resource sheet uploaded October 2025 also lists the map. Removed (not confirmed): filtering by type, hours and phone numbers in the listings.',
  },
  {
    name: 'Health Bucks at farmers markets',
    description:
      'When you spend SNAP with your EBT card at a NYC farmers market or farm stand that accepts EBT, you get $2 in Health Bucks for every $2 you spend, up to $10 a day. Health Bucks buy more fresh fruits and vegetables and are available year-round. Nonprofit organizations can apply to receive free Health Bucks to hand out in their community.',
    url: 'https://www.nyc.gov/site/doh/health/health-topics/health-bucks.page',
    phone: '',
    kind: 'services',
    dimension_slugs: ['food', 'health'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/doh/health/health-topics/health-bucks.page',
    operator: 'NYC Department of Health and Mental Hygiene',
    evidence:
      "Verified by web search, October 2026. DOHMH Health Bucks page: 'For every $2 spent at farmers markets and farm stands using SNAP on an EBT card, you can get $2 in Health Bucks, up to $10 per day'; 'available year-round at NYC farmers markets and farm stands that accept EBT'; 'Not-for-profit organizations can apply to receive free Health Bucks.' The toolkit and market map are dated 2025. Removed (not confirmed): swiping at the market information tent.",
  },
  {
    name: 'City Harvest volunteer shifts',
    description:
      'All new volunteers must first attend a free virtual Volunteer Orientation. After that, you can sign up for shifts such as Greenmarket food rescues. Minimum ages depend on the project, for example 14 and up for Greenmarket Rescues and 18 and up for Food Show Rescues. Nutrition Education roles need extra training after the orientation.',
    url: 'https://www.cityharvest.org/volunteer/volunteer-faq/',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['food'],
    boroughs: 'citywide',
    source_url: 'https://www.cityharvest.org/volunteer/volunteer-faq/',
    operator: 'Nonprofit food rescue organization',
    evidence:
      "Verified by web search, October 2026. City Harvest volunteer FAQ: 'all new individual volunteers must complete a Volunteer Orientation'; 'Greenmarket Rescues at 14 and up and Food Show Rescues at 18 and up'; Nutrition Education roles need more training. The volunteer page says first-time volunteers attend a virtual orientation. Removed (not confirmed): the 21+ age range, Mobile Market and repacking roles, the food-map link.",
  },
  {
    name: 'Food Bank For New York City volunteer portal',
    description:
      "Create an account on the Food Bank's volunteer portal and register ahead of time for a shift, such as pantry distribution at its Community Kitchen & Pantry in West Harlem. Walk-ins are not accepted. Volunteers must be at least 14, and anyone under 18 needs a parent or legal guardian present. If you can't attend, cancel online at least 24 hours before your shift.",
    url: 'https://volunteer.foodbanknyc.org/',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['food'],
    boroughs: 'citywide',
    source_url: 'https://volunteer.foodbanknyc.org/',
    operator: 'Nonprofit food bank',
    evidence:
      "Verified by web search, October 2026. Volunteer portal: new users create an account ('Not A Member?') and current roles are listed; its guidelines say West Harlem Community Kitchen and Pantry shifts 'require advance registration on the portal, and walk-ins are not accepted'; volunteers must be at least 14, and under-18s need a parent or legal guardian present. Removed (not confirmed): 'no orientation is needed', mobile pantry shifts.",
  },
  {
    name: 'GreenThumb community garden volunteering',
    description:
      'Attend a GreenThumb volunteer event, or use the GreenThumb map to find a community garden near you and connect with its volunteer garden group. GreenThumb supports more than 550 community gardens across the five boroughs. Groups that want to volunteer at a GreenThumb garden can fill out the NYC Parks Group Contact Form.',
    url: 'https://www.nycgovparks.org/greenthumb/volunteer-groups',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['food', 'land-conversion', 'biodiversity-loss'],
    boroughs: 'citywide',
    source_url: 'https://prd2.nycgovparks.org/greenthumb/volunteer-groups',
    operator: 'NYC Parks (GreenThumb)',
    evidence:
      "Verified by web search, October 2026. NYC Parks GreenThumb volunteer-groups page (the same path, seen on the prd2.nycgovparks.org host) suggests attending a GreenThumb volunteer event before joining a garden and says: 'If your group is interested in volunteering at a GreenThumb garden, please fill out the NYC Parks Group Contact Form.' The GreenThumb homepage says it sustains 'over 550 community gardens.' Removed (not confirmed): the 10-or-more group threshold, the gt.volunteer email address, 'no experience needed'.",
  },

  // ---- Health ------------------------------------------------------------------------
  {
    name: 'NYC 988 mental health support',
    description:
      'NYC 988, which replaced NYC Well, is a free, confidential mental health and substance use crisis line. Call or text 988, or chat online, to reach a trained counselor 24/7, 365 days a year, regardless of immigration status. Spanish speakers can text AYUDA, veterans can also text 838255, and there is specialized help for LGBTQI+ young people 25 and under; interpretation covers more than 200 languages. If you are deaf or hard of hearing, call 711, then 988. Call 911 if someone is in immediate danger.',
    url: 'https://access.nyc.gov/programs/nyc-988/',
    phone: '988',
    kind: 'services',
    dimension_slugs: ['health', 'peace-justice'],
    boroughs: 'citywide',
    source_url: 'https://access.nyc.gov/programs/nyc-well/',
    operator: 'NYC Department of Health and Mental Hygiene',
    evidence:
      "Verified by web search, October 2026. Two checks, merged here (the 'NYC 988' and '988 / NYC Well' drafts). ACCESS NYC NYC 988 page (updated June 9, 2026): 'NYC 988 is a free, confidential mental health and substance use crisis line. Reach a counselor by phone, text, or chat 24/7, 365 days a year'; Spanish speakers can text 'AYUDA'; interpretation 'in over 200 languages'; anyone can use it 'regardless of citizenship or immigration status'; call 911 for immediate danger. ACCESS NYC NYC Well page (updated May 11, 2026): help for veterans (text 838255), Spanish speakers and LGBTQI+ youth; a 2023 DOHMH release confirms the move from NYC Well to 988. Removed (not confirmed): 'press 2'.",
  },
  {
    name: 'Free naloxone (Narcan) kits',
    description:
      'Get a free naloxone kit to reverse an opioid overdose. You can ask at a participating pharmacy (no ID or insurance needed), use a public health vending machine or community program listed on the NYC Health Map, or take a short virtual training and get a kit by mail. Call 311 with questions.',
    url: 'https://www.nyc.gov/health/naloxone',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['health'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/doh/about/press/pr2026/free-naloxone-by-mail-campaign.page',
    operator: 'NYC Department of Health and Mental Hygiene',
    evidence:
      "Verified by web search, October 2026. DOHMH naloxone page (nyc.gov/health/naloxone): find pharmacies giving out free kits on the NYC Health Map and 'simply walk in and ask for a free naloxone kit'; the pharmacy list dated July 1, 2025 says no ID or insurance is required. A 2026 DOHMH press release announces free naloxone by mail after a short virtual training, and the City runs a vending machine network. The earlier naloxone.page link did not come up, so the official short link replaces it.",
  },
  {
    name: 'NYC Health + Hospitals Community Advisory Boards',
    description:
      'Attend a public meeting of the Community Advisory Board (CAB) at your local NYC Health + Hospitals hospital, long-term care facility or Gotham Health center, or apply to join one. There are 21 CABs made up of community volunteers. Members must be 18 or older, and application steps and term lengths vary by facility.',
    url: 'https://www.nychealthandhospitals.org/cabs/',
    phone: '',
    kind: 'civic',
    dimension_slugs: ['health', 'political-voice'],
    boroughs: 'citywide',
    source_url: 'https://www.nychealthandhospitals.org/cabs/',
    operator: 'NYC Health + Hospitals',
    evidence:
      "Verified by web search, October 2026. NYC H+H 'About the Community Advisory Board (CAB)' page: 21 CABs of volunteers covering hospitals, long-term care facilities and Gotham Health centers; members must be 18 or older and live near or use a facility; term lengths differ (2 years in the overview, 3 on the Queens page); facility pages show public monthly meetings, e.g. Kings County 'meetings and committees are open to the public'. No result was dated, so currency rests on the live official page.",
  },

  // ---- Education ---------------------------------------------------------------------
  {
    name: 'Free early childhood seats: 2-K, 3-K and Pre-K (NYC Public Schools)',
    description:
      "Families can apply for free early childhood seats online at MySchools.nyc, by phone at 718-935-2009, or at a Family Welcome Center. 2-K, for children born in 2024, launched for fall 2026 in Districts 6, 10, 18, 23 and 27, with priority for children living in those districts; the 2026 application window ran June 2 to 26. If you missed a deadline, you can add yourself to program waitlists on MySchools. 3-K and Pre-K have their own application timelines on NYC Public Schools' enrollment pages.",
    url: 'https://www.schools.nyc.gov/enrollment/enroll-grade-by-grade/2-k',
    phone: '718-935-2009',
    kind: 'services',
    dimension_slugs: ['education', 'gender-equality'],
    boroughs: 'citywide',
    source_url: 'https://www.schools.nyc.gov/enrollment/enroll-grade-by-grade/2-k',
    operator: 'NYC Public Schools (Department of Education) with NYS',
    evidence:
      "Verified by web search, October 2026. NYC Public Schools 2-K page: all NYC children born in 2024 can apply for fall 2026; 'Families can apply by visiting MySchools, calling 718-935-2009, or visiting a Family Welcome Center'; launch districts 6, 10, 18, 23 and 27; waitlists through MySchools. News results give the June 2-26, 2026 window. Removed (not confirmed): growth to 'about 12,000 seats in 2027-28', a 3-K/Pre-K window of January 14 to February 27, 2026.",
  },
  {
    name: 'DYCD Adult Literacy Program',
    description:
      "Adults and out-of-school youth aged 16 or older can take free classes in English (ESOL), basic literacy, and high school equivalency (HSE) prep through DYCD-funded community providers. Eligibility is for NYC residents with low incomes who do not have a high school diploma or have limited English, and a short placement test is required. Search discoverDYCD for 'Adult Literacy' or call DYCD Connect.",
    url: 'https://www.nyc.gov/employment/programs/dycd-adult-literacy-program',
    phone: '1-800-246-4646',
    kind: 'services',
    dimension_slugs: ['education'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/employment/programs/dycd-adult-literacy-program',
    operator: 'NYC Department of Youth and Community Development (DYCD)',
    evidence:
      "Verified by web search, October 2026. nyc.gov/employment program page (also in Spanish) and the DYCD Reading & Writing page: free ESOL, Adult Basic Education and HSE/GED prep for NYC residents 16+, low-income, not in school, without a high school diploma, with a basic eligibility test; enroll by searching 'Adult Literacy' on discoverDYCD; phone 1-800-246-4646. One nyc.gov page mentions a June-July summer run, so confirm the schedule with providers.",
  },
  {
    name: 'Queens Public Library Adult Learner Program',
    description:
      'Adults and young adults in Queens can take free classes in English (ESOL), adult basic education, and high school equivalency (HSE) at library sites across Queens; ESOL is offered in person and virtually. ESOL classes are for non-native English speakers 17 and older, and HSE classes are for adults 17 and older. Some classes fill up, so call 718-990-0700 or email ALPREF@queenslibrary.org for current openings.',
    url: 'https://www.queenslibrary.org/programs-activities/adult-learners',
    phone: '718-990-0700',
    kind: 'services',
    dimension_slugs: ['education'],
    boroughs: ['queens'],
    source_url: 'https://www.queenslibrary.org/programs-activities/adult-learners',
    operator: 'Queens Public Library (public library system)',
    evidence:
      "Verified by web search, October 2026. Queens Public Library Adult Learners page: the program 'offers ESOL, Adult Basic Education, and High School Equivalency instruction to adults and young adults at sites throughout Queens'; contact ALPREF@queenslibrary.org or 718-990-0700. The NYC.gov listing says ESOL is offered virtually and in person for non-native speakers 17+, and HSE is for 17+. An undated QPL page says some classes are full. Removed (not confirmed): placement by test, in-person registration.",
  },
  {
    name: 'Community Education Councils (CECs)',
    description:
      "Each of NYC's 32 community school districts has a Community Education Council. It has 10 members elected from among parents of the district's Pre-K-8 students, plus two Borough President appointees. Councils work with district superintendents, review educational programs, approve school zoning lines, hold public hearings on budget and capital matters, and recommend ways to improve services. Eligible parents can vote in council elections or run for a seat. Elections are held every two years, most recently in spring 2025.",
    url: 'https://www.schools.nyc.gov/get-involved/families/education-councils/community-education-councils',
    phone: '',
    kind: 'civic',
    dimension_slugs: ['education', 'political-voice'],
    boroughs: 'citywide',
    source_url: 'https://www.schools.nyc.gov/get-involved/families/education-councils/community-education-councils',
    operator: 'NYC Public Schools (Department of Education)',
    evidence:
      "Verified by web search, October 2026. NYC Public Schools CEC page: 'There are 32 CECs in New York City, one for each Community School District'; 10 elected members who are parents of Pre-K-8 students plus two Borough President appointees; councils work with superintendents, approve school zoning lines and hold hearings on budget and capital matters. The 2025 elections ran in spring 2025, and members took office July 1. Corrected or removed (not confirmed): 'monthly' meetings, comment on closings and co-locations, 'Pre-K to 12' voters.",
  },
  {
    name: 'Reading Partners NYC volunteer tutoring',
    description:
      'Volunteer as a reading tutor for an elementary student at a NYC public school, in person (sites in Manhattan, the Bronx, Brooklyn and Queens) or online, for a little over an hour a week during school hours, for at least one semester. No teaching experience is needed; Reading Partners provides the curriculum, training and support. Volunteers must be 14 or older, attend a tutor orientation, and pass a background check.',
    url: 'https://readingpartners.org/volunteer-in-new-york/',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['education'],
    boroughs: ['manhattan', 'bronx', 'brooklyn', 'queens'],
    source_url: 'https://readingpartners.org/volunteer-in-new-york/',
    operator: 'Nonprofit (Reading Partners)',
    evidence:
      "Verified by web search, October 2026. Reading Partners 'Volunteer in New York' page: recruiting NYC volunteers for the 2026-27 school year, in person and online; 'a little over an hour per week'; 'must be 14 years or older'; background check and tutor orientation; 'no experience needed'; in-person sites in Manhattan, the Bronx, Queens and Brooklyn; minimum one semester. The 'K-4' grade range was not shown, so the description says 'elementary student'.",
  },

  // ---- Income & Work -----------------------------------------------------------------
  {
    name: "File a workplace complaint with DCWP's Office of Labor Policy & Standards",
    description:
      "Workers in NYC can report violations of City workplace laws, such as the Paid Safe and Sick Leave Law, to DCWP's Office of Labor Policy & Standards (OLPS). File online, call 311, or email OLPS@dcwp.nyc.gov, and check a complaint's status with your intake number. DCWP keeps what you share confidential, and complaints can be filed anonymously. State minimum-wage and overtime claims go to the NYS Department of Labor (888-469-7365).",
    url: 'https://www.nyc.gov/site/dca/workers/workersrights/file-workplace-complaint.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['income-work'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dca/workers/workersrights/file-workplace-complaint.page',
    operator: 'NYC Department of Consumer and Worker Protection (DCWP)',
    evidence:
      "Verified by web search, October 2026. DCWP 'File a Workplace Complaint' page: report violations online; 'DCWP will treat all information received as confidential'; check status with your Intake Number. The OLPS intake form lists 311 and OLPS@dcwp.nyc.gov; OLPS 'investigates claims under those laws, such as the Paid Safe and Sick Leave Law'; minimum wage and overtime go to labor.ny.gov / 888-469-7365; DCWP materials say complaints can be anonymous. Removed (not confirmed): the 'protected time off' rename, Fair Workweek, delivery-worker pay.",
  },
  {
    name: 'Workforce1 Career Centers',
    description:
      'Get free job-search help from the City: career counseling, job listings and hiring events, and workforce training, online, by phone, or in person at 18 Workforce1 Career Centers across the five boroughs. Anyone 18 or older who is legally authorized to work in the U.S. can use the centers. Some centers offer specialized services for veterans, foreign-born New Yorkers, and people with justice involvement.',
    url: 'https://www.nyc.gov/es/employment/programs/workforce1',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['income-work'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/es/employment/programs/workforce1',
    operator: 'NYC Department of Small Business Services (SBS)',
    evidence:
      "Verified by web search, October 2026. nyc.gov employment program page (seen in Spanish): services are 'free and available online, over the phone, or in-person at one of 18 Workforce1 Career Centers located across the five boroughs'; 'Anyone 18 years or older who is legally authorized to work in the US' is eligible; specialized services for veterans, foreign-born and justice-involved New Yorkers. The Fiscal 2026 PMMR reports FY2026 Workforce1 activity. STAFF: the only page seen is the Spanish one (/es/); the English page is probably https://www.nyc.gov/employment/programs/workforce1 (the DYCD pages follow that pattern), so swap it in once it loads. Removed (not confirmed): an NYC-residency rule, the 18-24 young-adult track, the access.nyc.gov link.",
  },
  {
    name: 'Jobs NYC Center (city government jobs)',
    description:
      'Walk in to the Jobs NYC Center at 2 Lafayette Street in Lower Manhattan (Monday-Thursday, 10am-4pm) for free help finding and applying for City government jobs and understanding the civil service process. Staff can also point you to state, federal, and City-contracted nonprofit jobs. The Center hosts workforce events, job fairs, and agency hiring halls. Walk-in hours began October 5, 2026.',
    url: 'https://www.nyc.gov/site/dcas/news/032-26/mayor-mamdani-opens-new-jobs-nyc-center-connecting-new-yorkers-good-paying-jobs-public',
    phone: '',
    kind: 'services',
    dimension_slugs: ['income-work'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dcas/news/032-26/mayor-mamdani-opens-new-jobs-nyc-center-connecting-new-yorkers-good-paying-jobs-public',
    operator: 'NYC Department of Citywide Administrative Services (DCAS) and Department of Small Business Services (SBS)',
    evidence:
      "Verified by web search, October 2026. DCAS and Mayor's Office releases: the Center at 2 Lafayette Street launched September 28, 2026, with regular walk-in hours from October 5, Monday-Thursday 10am-4pm; it offers 'walk-in career services, workforce development events, job fairs and agency hiring halls', help applying and understanding civil service, and connections to state, federal and City-contracted nonprofit jobs. Removed (not confirmed): 'Civil Service 101' workshops, 'interview on the spot'.",
  },
  {
    name: 'NYC Financial Empowerment Centers (free financial counseling)',
    description:
      "Book a free, confidential session with a professional financial counselor for help with a budget, credit, debt (including student loans), savings, or opening a safe bank account. Sessions are by phone or in person, in multiple languages, with as many follow-ups as you need. It is open to anyone 18+ who lives or works in NYC, regardless of income or immigration status. Book at nyc.gov/TalkMoney or call 311 and say 'Financial Counseling'.",
    url: 'https://nyc.gov/TalkMoney',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['income-work'],
    boroughs: 'citywide',
    source_url: 'https://nyc.gov/TalkMoney',
    operator: 'NYC Department of Consumer and Worker Protection (DCWP)',
    evidence:
      "Verified by web search, October 2026. nyc.gov/TalkMoney 'Get Free Financial Counseling' page and the DCWP FAQ: 'at least 18 and live or work in NYC. Income and immigration status do not matter'; help with a budget, credit, saving, debt such as student loans, and opening a bank account; sessions 'in person or by phone and in multiple languages', free and confidential, with follow-ups as needed; book at nyc.gov/TalkMoney or call 311 and say 'Financial Counseling'.",
  },
  {
    name: 'NYC Free Tax Prep',
    description:
      "File your taxes for free with IRS-certified VITA/TCE volunteer preparers if your income is under the program's limits (for 2025 taxes: $97,000 or less for families, $68,000 or less for single filers), regardless of immigration status. Options include in-person, drop-off, virtual, and assisted self-preparation. The 2026 season (2025 taxes) has ended; check nyc.gov/taxprep or call 311 and ask for 'tax preparation' for next season's sites.",
    url: 'https://www.nyc.gov/site/dca/talk-money/file-your-taxes-individuals-families.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['income-work'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dca/talk-money/file-your-taxes-individuals-families.page',
    operator: 'NYC Department of Consumer and Worker Protection (DCWP)',
    evidence:
      "Verified by web search, October 2026. DCWP 'NYC Free Tax Prep for Individuals and Families' page and a February 2026 DCWP release (Mayor Mamdani kicked off the 2026 season): $97,000 or less in 2025 for families ($68,000 single filers); IRS-certified VITA/TCE volunteers; in-person, drop-off, virtual and assisted self-preparation; 'regardless of immigration status'; nyc.gov/taxprep and 311. The September 2026 Mayor's Office link did not come up. Removed (not confirmed): year-round amended-return sites, a January 2027 start, freelancer help, volunteer-preparer recruitment.",
  },
  {
    name: 'Summer Youth Employment Program (SYEP)',
    description:
      'NYC residents aged 14 to 24 can apply for a paid six-week summer work experience. Participants are selected by lottery and must submit eligibility documents and attend orientation. Youth 16-24 earn minimum wage and 14-15-year-olds receive a stipend. The 2026 application closed March 13, 2026; watch nyc.gov/syep for the 2027 application, or call DYCD Community Connect at 1-800-246-4646 for help applying.',
    url: 'https://access.nyc.gov/programs/summer-youth-employment-program-syep',
    phone: '1-800-246-4646',
    kind: 'services',
    dimension_slugs: ['income-work', 'education'],
    boroughs: 'citywide',
    source_url: 'https://access.nyc.gov/programs/summer-youth-employment-program-syep',
    operator: 'NYC Department of Youth and Community Development (DYCD)',
    evidence:
      "Verified by web search, October 2026. ACCESS NYC SYEP page and DYCD's 2026 application and extension PDFs on nyc.gov: applications opened January 23, 2026 for ages 14-24, with the deadline extended to March 13, 2026; six weeks; ages 14-15 receive a stipend and 16-24 earn minimum wage; participants are picked by random lottery; DYCD Community Connect is 1-800-246-4646 (added as the phone). Removed (not confirmed): 'July and August', 'youth with disabilities encouraged to apply'.",
  },

  // ---- Water & Sanitation ------------------------------------------------------------
  {
    name: 'Free lead-in-drinking-water test kit',
    description:
      "Request a free kit to test your home's tap water for lead by calling 311 or using DEP's online order form. The kit comes with two sample bottles, sampling instructions (in several languages, with a how-to video), a chain-of-custody form and a return label for mailing your samples to a lab for lead analysis.",
    url: 'https://www.nyc.gov/site/dep/water/lead-in-drinking-water-test-kit.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['water-sanitation', 'health'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dep/water/lead-in-drinking-water-test-kit.page',
    operator: 'NYC Department of Environmental Protection',
    evidence:
      "Verified by web search, October 2026. DEP 'Lead in Drinking Water Test Kit' page: 'call 311 or fill in an online form to order a free lead in drinking water test kit'; the kit includes two empty bottles, instructions, a chain-of-custody form, a bag, tape and a return label. A 2025 DEP news release also came up. Removed (not confirmed on an official page): the 30-day results timeline, the pre-1961 note.",
  },
  {
    name: 'Free lead service line replacement',
    description:
      "If DEP has sent you a letter, register your property in DEP's LeadCAST portal to get a lead or galvanized-steel water service line replaced with copper at no cost. The program covers eligible homeowners in targeted Bronx and Queens neighborhoods, and Brooklyn is planned for 2027. Tenants cannot enroll but can tell their landlord about it.",
    url: 'https://www.nyc.gov/site/dep/water/lead-service-line-replacement-signup.page',
    phone: '',
    kind: 'services',
    dimension_slugs: ['water-sanitation', 'health'],
    boroughs: ['bronx', 'queens'],
    source_url: 'https://www.nyc.gov/site/dep/water/lead-service-line-replacement-signup.page',
    operator: 'NYC Department of Environmental Protection',
    evidence:
      "Verified by web search, October 2026. DEP 'Lead Service Line Replacement Eligibility Check & Signup' page: register on LeadCAST; 'Only property owners who receive a letter from DEP are eligible'; 'Only property owners can sign up', not tenants. A September 2026 Governor and Mayor joint release (in Russian, on governor.ny.gov) says Bronx and Queens owners should apply now and Brooklyn work starts in 2027, superseding DEP's October 2025 release (which named 2026 for Queens and Brooklyn).",
  },
  {
    name: 'Home Water Assistance Program credit',
    description:
      "Owners of one- to four-family homes automatically get a $145 credit on their water and sewer bill if they received a HEAP Regular Heating Benefit for the 2024-25 season or held an approved Senior Citizen, Disabled or Veteran homeowner exemption in 2025. No application is needed. The credit appears on your DEP bill as 'NYC Home Water Assistance Credit.'",
    url: 'https://www.nyc.gov/site/dep/pay-my-bills/home-water-assistance-program.page',
    phone: '',
    kind: 'services',
    dimension_slugs: ['water-sanitation', 'income-work'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dep/pay-my-bills/home-water-assistance-program.page',
    operator: 'NYC Department of Environmental Protection',
    evidence:
      "Verified by web search, October 2026. DEP Home Water Assistance Program page: a 1-4 family home plus a HEAP Regular Heating Benefit for 2024-2025 or an approved Senior/Disabled/Veteran exemption in 2025; 'Eligible customers will automatically receive a credit'; the credit is $145.00. The FY2026 Preliminary MMR says nearly 62,000 customers got credits in FY2025. Removed (not confirmed): payment agreements.",
  },
  {
    name: 'Report sewer backups',
    description:
      "Report raw sewage backing up into your home to 311 or through DEP's online form, and keep your 311 tracking number and DEP service request number. DEP field crews respond to sewer-related 311 requests and inspect nearby sewers. Grease and debris are among the causes DEP records for backups.",
    url: 'https://www.nyc.gov/site/dep/water/sewer-backup.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['water-sanitation', 'nitrogen-phosphorus-loading'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dep/water/sewer-backup.page',
    operator: 'NYC Department of Environmental Protection',
    evidence:
      "Verified by web search, October 2026. DEP sewer backup page: report raw sewage backing up into a home by calling 311 or using an online form, and keep the 311 tracking number and DEP service request number. DEP's plan says field crews respond to every sewer-related 311 request and record causes such as grease and debris; the 2025 State of the Sewers report is current. Removed (not confirmed): catch-basin reporting on this page (so 'and clogged catch basins' was dropped from the name), 'grease and wipes are the most common cause'.",
  },
  {
    name: 'DSNY Volunteer Cleanup Program and Adopt-a-Basket',
    description:
      "Organize a volunteer cleanup of public streets and sidewalks on your block (not parks, beaches or private property). DSNY lends brooms, shovels and rakes (one tool per volunteer, to be returned) and provides bags and gloves. Email your request to DSNY at least two weeks ahead. Note: DSNY's Adopt-a-Basket program is paused and is not taking new applications until it relaunches.",
    url: 'https://www.nyc.gov/site/dsny/resources/education/volunteer-cleanup.page',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['water-sanitation', 'chemical-pollution'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dsny/resources/education/volunteer-cleanup.page',
    operator: 'NYC Department of Sanitation',
    evidence:
      "Verified by web search, October 2026. DSNY Volunteer Cleanup Program page: lends brooms, shovels and rakes and offers bags and gloves; requests 'no less than TWO WEEKS in advance'; events are for public streets and sidewalks. DSNY's Adopt-a-Basket page: 'Until then, we are no longer accepting applications for enrollment' pending a relaunch. Removed (not confirmed): DSNY picking up the bags.",
  },

  // ---- Energy ------------------------------------------------------------------------
  {
    name: 'HEAP home energy assistance',
    description:
      "HEAP helps eligible households with energy costs through seasonal benefits: Regular and Emergency heating help (if your heat is shut off or about to be), Cooling Assistance, Clean and Tune, and Heating Equipment Repair and Replacement. The 2025-26 Regular benefit closed April 7, 2026 (or when funds ran out). Check HRA's energy assistance page or ACCESS HRA for the next season's dates. Apply online, in person or by mail (help: 718-557-1399 or 311). Getting HEAP also enrolls Con Edison customers in its bill discount.",
    url: 'https://www.nyc.gov/site/hra/help/energy-assistance.page',
    phone: '718-557-1399',
    kind: 'services',
    dimension_slugs: ['energy'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/hra/help/energy-assistance.page',
    operator: 'NYC Human Resources Administration (State HEAP program)',
    evidence:
      "Verified by web search, October 2026. HRA energy assistance page (2025-2026 season): Regular applications accepted 'until April 7, 2026 or when funds run out'; Emergency HEAP opened January 2, 2026; 'five seasonal components' (Regular, Emergency, Cooling Assistance, Clean and Tune, HERR); for mail applications 'call 718-557-1399 or 311'. Con Edison's EAP page confirms HEAP recipients are enrolled automatically. Corrected: only the Regular benefit closed in April 2026. Removed (not confirmed): a '60+' detail.",
  },
  {
    name: 'NYSERDA EmPower+ home energy upgrades',
    description:
      "Income-eligible homeowners and renters in one- to four-family homes can apply for a no-cost home energy assessment and upgrades such as air sealing, insulation and heat pumps. Low-income households get the work at no cost, up to $14,000 downstate. Moderate-income households get a 50% incentive, up to $7,000 downstate. Apply online at NYSERDA's EmPower+ page or call 1-866-NYSERDA. Your Regional Clean Energy Hub can help you apply.",
    url: 'https://nyserda.ny.gov/empower',
    phone: '',
    kind: 'services',
    dimension_slugs: ['energy', 'climate-change', 'housing'],
    boroughs: 'citywide',
    source_url: 'https://nyserda.ny.gov/empower',
    operator: 'NYSERDA (New York State public authority)',
    evidence:
      "Verified by web search, October 2026. NYSERDA EmPower+ page: no-cost assessments for income-eligible owners and renters of 1-4 family homes; funding for air sealing, insulation and heat pumps; low-income work no-cost up to $14,000 downstate; moderate-income households 50% capped at $7,000 downstate. The March 2025 fact sheet says to apply online or call 1-866-NYSERDA. Removed (not confirmed): the 'MyEnergy portal or by mail' route.",
  },
  {
    name: 'Con Edison Energy Affordability Program',
    description:
      "Con Edison customers who receive HEAP, SNAP, SSI, TANF or certain other benefits are enrolled automatically in a monthly bill discount. Customers on Medicaid, federal public housing assistance, Lifeline or certain veterans' benefits can apply online, by mail or fax, or at a walk-in center. Check your bill or My Account to see whether you are enrolled. Discounts are tiered and were updated February 1, 2026.",
    url: 'https://coned.com/EAP',
    phone: '',
    kind: 'services',
    dimension_slugs: ['energy'],
    boroughs: 'citywide',
    source_url: 'https://coned.com/EAP',
    operator: 'Con Edison (utility program under the NYS Public Service Commission)',
    evidence:
      "Verified by web search, October 2026. Con Edison EAP page (coned.com/EAP): customers are 'enrolled automatically if an agency notifies us that you receive benefits from programs such as HEAP, SNAP, SSI, or TANF'; Medicaid, Federal Public Housing Assistance, veterans' pensions and Lifeline recipients must apply; tiered discounts took effect February 1, 2026. The longer coned.com path came up only on a mirror. Removed (not confirmed): an income-limit route (the application requires enrollment in a program), the bill's 'Adjustment Information' section.",
  },
  {
    name: 'Community solar and Solar for All',
    description:
      "Renters and homeowners can subscribe to a community solar project and get credits on their electric bill without installing panels; check cancellation fees and rate terms before signing. Through NYSERDA's Statewide Solar for All, households with income below 60% of State median income can get community solar credits on their utility bill at no cost: there are no upfront costs or fees, and you can cancel at any time. Check your eligibility on NYSERDA's site.",
    url: 'https://www.nyserda.ny.gov/All-Programs/NY-Sun/Community-Solar/Solar-for-All',
    phone: '',
    kind: 'services',
    dimension_slugs: ['energy', 'climate-change'],
    boroughs: 'citywide',
    source_url: 'https://www.nyserda.ny.gov/All-Programs/NY-Sun/Community-Solar/Solar-for-All',
    operator: 'NYSERDA (NY-Sun program)',
    evidence:
      "Verified by web search, October 2026. NYSERDA 'Statewide Solar for All' page: the utility handles enrollment and puts bill credits on eligible customers' monthly bills; NYSERDA's FAQ sets household income below 60% of State median income; its talking points say there are no upfront costs or fees and participants can cancel at any time without penalty. The short link /communitysolar did not come up. Removed (not confirmed): '$5-$15 a month', the 'Find a Community Solar Project' tool.",
  },
  {
    name: 'NYSERDA Regional Clean Energy Hubs (NYC)',
    description:
      "Contact a Regional Clean Energy Hub serving New York City (NYC has up to three). Hubs are teams of community-based organizations funded by NYSERDA that help New Yorkers find clean energy options, including heat pump, solar and EV information, rebates and incentives, contractors, and community solar sign-ups. Find your Hub on NYSERDA's list of Hubs by region.",
    url: 'https://www.nyserda.ny.gov/All-Programs/Regional-Clean-Energy-Hubs',
    phone: '',
    kind: 'services',
    dimension_slugs: ['energy', 'climate-change'],
    boroughs: 'citywide',
    source_url: 'https://www.nyserda.ny.gov/All-Programs/Regional-Clean-Energy-Hubs',
    operator: 'NYSERDA with community-based nonprofits',
    evidence:
      "Verified by web search, October 2026. NYSERDA Regional Clean Energy Hubs page: Hubs are teams of 'trusted, knowledgeable, community-based organizations in and from your region' that help with heat pump, solar and EV information, rebates, contractors and community solar sign-ups; a NYSERDA overview lists '12 hubs in total (3 in NYC)'; the page is cited in 2026 ACEEE proceedings. Removed (not confirmed): a 'free Home Energy Plan'.",
  },
  {
    name: 'NYC Accelerator for building owners',
    description:
      'Building owners, property managers, developers, and co-op and condo boards can get free one-on-one help from NYC Accelerator with energy-efficiency and clean energy upgrades and with local law compliance, including Local Law 97. You are matched with an account manager who can point you to incentives and vetted service providers. In April 2026 the City added Momentum, a free concierge-style service with web tools to plan retrofits, project Local Law 97 compliance and estimate penalties. Tenants can point their owner or board to the program.',
    url: 'https://accelerator.nyc/technical-assistance',
    phone: '',
    kind: 'services',
    dimension_slugs: ['energy', 'climate-change'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/hpd/news/21a-26/nyc-accelerator-new-era-chief-climate-officer-free-concierge-style-support-for',
    operator: "NYC Mayor's Office of Climate & Environmental Justice",
    evidence:
      "Verified by web search, October 2026. Two checks, merged here (the technical-assistance and Local Law 97 drafts). accelerator.nyc 'Free technical assistance with energy and building upgrades' page: free one-on-one help with energy efficiency, clean energy upgrades and local law compliance including LL97, matching with an account manager, referrals to vetted service providers; its /ll97 page offers the same free help. HPD/DOB announcement, April 14, 2026: a free concierge-style service (Momentum) through NYC Accelerator; 'Building owners can visit accelerator.nyc to get started.' Removed (not confirmed): help to 'request and compare contractor proposals', an account manager who handles assessments and audit review.",
  },
  {
    name: 'Comment on utility rate cases at the Public Service Commission',
    description:
      "Comment on Con Edison rate cases and other Public Service Commission proceedings. Search for the case by number or keyword in the PSC's Document and Matter Management (DMM) system, open its case page, and click 'Post Comments'. You can also subscribe to a case's service list to get updates when the Commission issues orders, notices and rulings.",
    url: 'https://dps.ny.gov/how-post-comments-and-receive-updates-psc-cases',
    phone: '',
    kind: 'civic',
    dimension_slugs: ['energy', 'political-voice'],
    boroughs: 'citywide',
    source_url: 'https://dps.ny.gov/how-post-comments-and-receive-updates-psc-cases',
    operator: 'NYS Department of Public Service / Public Service Commission',
    evidence:
      "Verified by web search, October 2026. DPS 'How to Post Comments and Receive Updates on PSC Cases' page: search for a case in DMM, open its case files page and use the 'Post Comments' button; subscribe to the case's service list by email or in DMM. Removed (not confirmed): the Opinion Line 1-800-335-2120 (so no phone is listed; add it back only once confirmed), NYC public statement hearings.",
  },
  {
    name: 'WE ACT for Environmental Justice membership and working groups',
    description:
      "Attend WE ACT's monthly membership meeting, held on the second Saturday of the month, or join a working group such as Climate Justice, Healthy Homes, NYCHA or Spanish Civic Engagement to organize on environmental health, housing and climate issues. WE ACT is based in Northern Manhattan. Annual membership dues are $25, with a sliding-scale option for those who cannot pay that amount.",
    url: 'https://weact.org/get-involved/membership/',
    phone: '',
    kind: 'organize',
    dimension_slugs: ['energy', 'housing', 'health', 'air-pollution', 'climate-change'],
    boroughs: ['manhattan'],
    source_url: 'https://community.weact.org/we_act_june_membership_meeting26',
    operator: 'Nonprofit environmental justice organization',
    evidence:
      "Verified by web search, October 2026. weact.org: a monthly Membership Meeting 'on the second Saturday of the month'; Climate Justice, Healthy Homes, NYCHA and Spanish Civic Engagement working groups; $25 annual dues with a sliding option. community.weact.org lists membership meetings on June 13, September 12 and October 10, 2026. STAFF: the membership path is on weact.org but did not appear verbatim in results, so spot-check the link. Removed (not confirmed): 'you do not need to be a member to attend'.",
  },

  // ---- Networks ----------------------------------------------------------------------
  {
    name: 'Fair Fares NYC (half-price transit)',
    description:
      "New Yorkers aged 18-64 with low household incomes can get 50% off subway and eligible bus fares, regardless of immigration status. Apply online at nyc.gov/fairfares or in person, then upload documents through the ACCESS HRA app within 10 days. New enrollees get a Fair Fares OMNY card, and weekly fare capping applies. The city's June 2026 budget agreement raises the income limit to 200% of the federal poverty level, expected to take effect in 2026. If you were over the limit before, check again.",
    url: 'https://access.nyc.gov/programs/fair-fares/',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['networks', 'income-work'],
    boroughs: 'citywide',
    source_url: 'https://access.nyc.gov/programs/fair-fares/',
    operator: 'NYC Department of Social Services / Human Resources Administration (HRA)',
    evidence:
      "Verified by web search, October 2026. ACCESS NYC Fair Fares page and nyc.gov Fair Fares OMNY card leaflets (REV.09/2025). An IBO June 2026 report and July 2026 news ('NYC Opens Fair Fares to 1.3 Million Residents After Major Eligibility Expansion'): the June 2026 budget raises eligibility to 200% FPL, 'expected to take effect later this year'. Updated: the draft called this only an HRA proposal. Removed (not confirmed): Access-A-Ride coverage, a one-year enrollment period.",
  },
  {
    name: 'Big Apple Connect (free internet for NYCHA residents)',
    description:
      'Residents of participating NYCHA developments can get free home internet (up to 300 Mbps) and basic cable TV, plus the router, modem, and cable box, from Optimum or Spectrum depending on address. Current customers at eligible developments can have those charges reduced to as low as $0. Check the list of eligible developments before enrolling.',
    url: 'https://www.nyc.gov/assets/bigappleconnect',
    phone: '',
    kind: 'services',
    dimension_slugs: ['networks'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/assets/bigappleconnect',
    operator: 'NYC Office of Technology and Innovation with NYCHA (providers: Optimum, Spectrum)',
    evidence:
      "Verified by web search, October 2026. nyc.gov/assets/bigappleconnect: eligible NYCHA residents get free internet up to 300 Mbps, a free router, modem, basic cable TV and cable box; existing customers' bills are reduced 'as low as $0'; Optimum or Spectrum depending on address; only certain developments are eligible. PIX11 reports the program was extended through June 2028.",
  },
  {
    name: 'Citi Bike Reduced Fare Bike Share',
    description:
      "NYCHA residents and SNAP recipients aged 16 or older can join Citi Bike for $5 a month with no annual commitment. Classic bike rides of up to 45 minutes are included, and e-bike rides cost a reduced per-minute rate. Sign up on Citi Bike's reduced-fare page with your NYCHA tenant account number (from your rent bill) or your SNAP EBT card number, plus a credit or debit card.",
    url: 'https://www.citibikenyc.com/pricing/reducedfare',
    phone: '',
    kind: 'services',
    dimension_slugs: ['networks', 'income-work'],
    boroughs: 'citywide',
    source_url: 'https://www.citibikenyc.com/pricing/reducedfare',
    operator: 'Citi Bike (Lyft) in partnership with NYC DOT',
    evidence:
      "Verified by web search, October 2026. Citi Bike '$5/month for NYCHA and SNAP' page (citibikenyc.com/pricing/reducedfare): for NYCHA residents and SNAP recipients 16+, verified by tenant account number or EBT card number, with 45-minute classic rides and a per-minute e-bike upgrade. The live official page appears in current results, but no date was shown.",
  },
  {
    name: 'Transportation Alternatives volunteer and borough activist committees',
    description:
      "Volunteer with Transportation Alternatives to campaign for safer streets, better transit, bicycling, and walking in your neighborhood. Start with a one-time 30-minute Zoom intro session, held on the last Monday of each month, that covers TA's mission, current campaigns, and volunteer options. Then join your borough's activist committee; no experience is needed.",
    url: 'https://transalt.org/volunteer',
    phone: '',
    kind: 'organize',
    dimension_slugs: ['networks', 'political-voice'],
    boroughs: 'citywide',
    source_url: 'https://transalt.org/volunteer',
    operator: 'Nonprofit advocacy organization',
    evidence:
      "Verified by web search, October 2026. transalt.org/volunteer ('Get Involved with Transportation Alternatives'): a '30-minute Zoom intro session... held on the last Monday of each month' and a pointer to 'TA's Borough Committees'; a TA committee page says 'no experience is necessary to join in'. Removed (not confirmed): committee members voting on campaigns, public meetings and rides.",
  },
  {
    name: 'NYC DOT Open Streets: run an Open Street',
    description:
      'Community groups, businesses, BIDs, and schools can apply to NYC DOT to manage an Open Street on their block, where the street is closed to cars for community programming and gathering. New and returning partners must apply online. DOT has accepted applications on a rolling basis and needs at least 90 days to review each one.',
    url: 'https://nyc.gov/openstreets',
    phone: '',
    kind: 'organize',
    dimension_slugs: ['networks', 'land-conversion'],
    boroughs: 'citywide',
    source_url: 'https://nyc.gov/openstreets',
    operator: 'NYC Department of Transportation (DOT)',
    evidence:
      "Verified by web search, October 2026. nyc.gov/openstreets: 'Both new and returning partners must apply to manage an Open Street'; DOT accepts applications on a rolling basis; 'Each application requires a minimum of 90 days for review'; eligible partners include block associations, BIDs, civic groups, nonprofits, schools and groups of businesses. A May 21, 2026 DOT release says applications 'remain open throughout the 2026 season'. Dimensions: political-voice replaced by land-conversion (streets used as public open space).",
  },
  {
    name: 'NYC Service volunteer portal',
    description:
      "Search volunteer opportunities with more than 800 NYC nonprofits by area of interest or zip code, then sign up through NYC Service, the City's volunteer hub. Featured efforts include fighting hunger and the Resident Volunteer Corps, which places volunteers with City agencies.",
    url: 'https://www.nycservice.org/volunteer',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['networks', 'food', 'social-equity'],
    boroughs: 'citywide',
    source_url: 'https://www.nycservice.org/volunteer',
    operator: "NYC Service (Mayor's Office)",
    evidence:
      "Verified by web search, October 2026. nycservice.org/volunteer: volunteer opportunity search, a calendar and an organization directory; it 'connects people with over 800 nonprofits'; features Eliminate Hunger and the Resident Volunteer Corps (with City agencies). Removed (not confirmed): 'NYC Service staff screen every opportunity', the tutoring and mentoring emphasis; dimensions moved from education to networks, food and social equity.",
  },

  // ---- Housing -----------------------------------------------------------------------
  {
    name: 'Right to Counsel and the Tenant Helpline',
    description:
      "If you face eviction in Housing Court or a NYCHA administrative proceeding, call 311 and ask for 'Right to Counsel' to be connected with free legal services from nonprofit partners. Help is available in every ZIP code regardless of immigration status. You can also call 311 and ask for the 'Tenant Helpline' for tenant-rights information and referrals to free legal help.",
    url: 'https://www.nyc.gov/site/mayorspeu/resources/right-to-counsel.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['housing', 'peace-justice'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/mayorspeu/resources/right-to-counsel.page',
    operator: 'NYC Human Resources Administration, Office of Civil Justice',
    evidence:
      "Verified by web search, October 2026. nyc.gov Right to Counsel page: free services for tenants facing eviction in Housing Court or NYCHA administrative proceedings, in every ZIP code and regardless of immigration status: 'call 311 and ask for the Right to Counsel'. A Tenant Helpline page on nyc.gov says to call 311 and ask for 'Tenant Helpline', run by PEU specialists. Removed (not confirmed): the 200%-of-poverty threshold, mediation arranged by the helpline.",
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
    source_url: 'https://www.nyc.gov/site/hpd/services-and-information/heat-and-hot-water-information.page',
    operator: 'NYC Department of Housing Preservation and Development',
    evidence:
      "Verified by web search, October 2026. HPD Heat and Hot Water page: contact your landlord, then file a 311 complaint by phone, online or in the app; tenants can file anonymously; HPD notifies the owner, and status can be checked on HPDONLINE; 68°F from 6am to 10pm when it is below 55°F outside, 62°F overnight, 120°F hot water. Heat complaint counts are given 'as of 1/29/2026'. Repair complaints through 311 were not separately checked.",
  },
  {
    name: 'NYC Housing Connect affordable housing lotteries',
    description:
      'Create a Housing Connect profile to apply for income-restricted affordable housing lotteries across the five boroughs. For help, call the Housing Connect helpline at 212-863-7990 and leave a detailed voicemail for a callback, or email nychousingconnect@hpd.nyc.gov. Housing Ambassador community organizations can also help you apply.',
    url: 'https://www.nyc.gov/site/housingportal/have-a-question/have-a-question.page',
    phone: '212-863-7990',
    kind: 'services',
    dimension_slugs: ['housing'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/hpd/contact/contact.page',
    operator: 'NYC Department of Housing Preservation and Development',
    evidence:
      "Verified by web search, October 2026. HPD contact page lists 212-863-7990 and nychousingconnect@hpd.nyc.gov for Housing Connect; HPD testimony from 2025 (022-25) says the hotline handles over 10,000 calls a year; the housing portal 'Have a Question?' page points to Housing Ambassadors. The hpd/nyc-housing-connect.page link did not come up. Removed (not confirmed): Mitchell-Lama, no-fee and immigration-status claims.",
  },
  {
    name: 'Homebase homelessness prevention',
    description:
      "If you are low-income and at imminent risk of losing your home or entering shelter, contact Homebase, the City's homelessness prevention program, to make a plan to stay housed in your community. Services include eviction prevention, help with public benefits, emergency rental assistance and relocation help. See the Homebase page for locations and contact information.",
    url: 'https://www.nyc.gov/site/dhs/prevention/homebase.page',
    phone: '',
    kind: 'services',
    dimension_slugs: ['housing', 'income-work'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dhs/prevention/homebase.page',
    operator: 'NYC Department of Social Services (DHS/HRA)',
    evidence:
      "Verified by web search, October 2026. DHS Homebase page: for New Yorkers 'at imminent risk of entering the shelter system' who are low-income and want to stay housed in their community; eviction prevention, public benefits help, emergency rental assistance and relocation help. The DHS prevention page says the program 'remains central' to prevention work; HRA also has a page (nyc.gov/homebase). Removed (not confirmed): the ZIP-code locator, 'ask 311 for Homebase' (so no phone is listed), financial counseling, job help, 'you do not need every document'.",
  },
  {
    name: 'Testify at Rent Guidelines Board hearings',
    description:
      "Each year the Rent Guidelines Board holds public hearings before its final vote on lease increases for rent-stabilized apartments; in 2026 they were held in June across four boroughs. When hearings are announced, you can pre-register online or by phone, or sign up on-site at a hearing, and each speaker gets up to two minutes. You can also submit written comments during the public comment period. The 2026 hearings and comment period have ended, so check the Board's site for the next schedule.",
    url: 'https://rentguidelinesboard.cityofnewyork.us/testimony/',
    phone: '',
    kind: 'civic',
    dimension_slugs: ['housing', 'political-voice'],
    boroughs: 'citywide',
    source_url: 'https://rentguidelinesboard.cityofnewyork.us/2026-public-hearing-testimony-instructions/',
    operator: 'NYC Rent Guidelines Board',
    evidence:
      "Verified by web search, October 2026. RGB site: the 2026 hearings (June 4, 8, 11 and 16, 2026) and testimony instructions; online and phone pre-registration now closed; on-site sign-up available; up to two minutes per speaker; the 'comment period on the proposed rules has concluded'. Removed (contradicted or not confirmed): 'testimony must be given in person' (written comments were accepted), YouTube streaming, the /2026-meetings/ link, the phone 212-669-7480 (so no phone is listed).",
  },
  {
    name: "Met Council on Housing Tenants' Rights Hotline",
    description:
      "Call Met Council's Tenants' Rights Hotline at 212-979-0611 (Mon and Wed 1:30-8pm, Fri 1:30-5pm) for tenant-rights information from trained volunteers. They are not lawyers and do not give legal advice. Members can also train to staff the hotline; volunteers should be willing to learn and comfortable on the phone, and Spanish speakers are encouraged to join.",
    url: 'https://www.metcouncilonhousing.org/program/tenants-rights-hotline/',
    phone: '212-979-0611',
    kind: 'organize',
    dimension_slugs: ['housing'],
    boroughs: 'citywide',
    source_url: 'https://www.metcouncilonhousing.org/program/tenants-rights-hotline/',
    operator: 'Nonprofit tenant membership organization',
    evidence:
      "Verified by web search, October 2026. Met Council hotline page: 212-979-0611, Monday 1:30-8pm, Wednesday 1:30-8pm, Friday 1:30-5pm; staffed by trained volunteer members who are not lawyers and give lay information rather than legal advice; hotline volunteer trainings are on the Met Council calendar. ProBono.net says volunteers should be 'willing to learn' and encourages Spanish speakers.",
  },
  {
    name: 'Talk to Tenants door-knocking campaign',
    description:
      "Volunteer with the City's 'Talk to Tenants' campaign, which knocks on doors in buildings with chronic housing violations to explain tenants' right to organize and connect them with resources and organizing trainings. No experience is needed, and volunteers get a short training. The campaign began in East Harlem, Washington Heights, Inwood and Flatbush and is expanding citywide.",
    url: 'https://www.nyc.gov/mayors-office/news/2026/07/mayor-mamdani-launches--talk-to-tenants--campaign-to-build-tenan.html',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['housing', 'political-voice'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/mayors-office/news/2026/07/mayor-mamdani-launches--talk-to-tenants--campaign-to-build-tenan.html',
    operator: "Mayor's Office of Mass Engagement with the Mayor's Office to Protect Tenants",
    evidence:
      "Verified by web search, October 2026. Mayor's Office release, July 20, 2026: the Mayor's Office of Mass Engagement, with the Mayor's Office to Protect Tenants, launched 'Talk to Tenants', a door-to-door organizing campaign for renters in buildings with chronic housing violations; 'New Yorkers interested in volunteering can learn more HERE.' 6sqft: no prior experience necessary, brief training, starting in East Harlem, Washington Heights, Inwood and Flatbush before expanding to all five boroughs.",
  },
  {
    name: 'HOPE count volunteer (annual street homelessness survey)',
    description:
      "Volunteer for the City's annual HOPE (Homeless Outreach Population Estimate) count. It is an overnight survey, roughly 10pm to 4am, in which teams canvass assigned areas to estimate how many people are sleeping unsheltered. Registration opens before each count at nyc.gov/hope. In 2026 a winter storm moved the count to March 10.",
    url: 'https://www.nyc.gov/hope',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['housing'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/assets/dhs/downloads/pdf/press-releases/Call-For-Volunteers-to-Join-NYC-HOPE-Survey-Effort-2026.pdf',
    operator: 'NYC Department of Social Services / Department of Homeless Services',
    evidence:
      "Verified by web search, October 2026. DHS 'Call For Volunteers to Join NYC HOPE Survey Effort 2026' release: the survey 'has been rescheduled to Tuesday, March 10, 2026, from 10:00 PM to 4:00 AM; Volunteers ... are asked to re-register at nyc.gov/hope'. A DSS release dated July 2, 2026 reported 4,991 unsheltered people counted on March 10, 2026. Removed (not confirmed): volunteers 'trained on the night of the count'.",
  },

  // ---- Gender Equality ---------------------------------------------------------------
  {
    name: 'NYC Family Justice Centers (domestic and gender-based violence)',
    description:
      'Survivors of domestic and gender-based violence and their children can get social services, civil legal help, and criminal justice assistance under one roof at the NYC Family Justice Centers in Brooklyn, Queens, the Bronx, Manhattan, and Staten Island. Visit the center in the borough where you live, or the one where you feel safest, or call 311 to get connected. The 24-hour NYC HOPE hotline is 1-800-621-HOPE (4673).',
    url: 'https://nyc.gov/endgbv',
    phone: '1-800-621-4673',
    kind: 'services',
    dimension_slugs: ['gender-equality', 'peace-justice'],
    boroughs: 'citywide',
    source_url: 'https://nyc.gov/endgbv',
    operator: "NYC Mayor's Office to End Domestic and Gender-Based Violence (ENDGBV)",
    evidence:
      "Verified by web search, October 2026. ENDGBV page (nyc.gov/endgbv): ENDGBV oversees the FJCs in all five boroughs, offering 'social services, civil legal, and criminal justice assistance... under one roof'; 'visit the FJC in the borough where you live (or one where you feel safest) or call 311'. The FY2025 annual report, dated June 2026, shows the centers are current. The access.nyc.gov link did not come up. Removed (not confirmed): weekday 9-5 walk-in hours (a 2019 flyer only), remote services, childcare, eligibility claims.",
  },
  {
    name: 'NYC Commission on Human Rights: report discrimination',
    description:
      "Report discrimination or harassment at work, in housing, or in public places to the NYC Commission on Human Rights. This includes cases based on gender, pregnancy, race, disability, or immigration status. Call 212-416-0197, call 311, or submit a claim on the Commission's website. Services are free. File within one year of the incident, or within three years for gender-based harassment.",
    url: 'https://www.nyc.gov/site/cchr/enforcement/complaint-process.page',
    phone: '212-416-0197',
    kind: 'services',
    dimension_slugs: ['gender-equality', 'social-equity'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/cchr/enforcement/complaint-process.page',
    operator: 'NYC Commission on Human Rights (CCHR)',
    evidence:
      "Verified by web search, October 2026. CCHR 'Complaint Process' page: report 'by calling CCHR at (212) 416-0197, calling 311, or submitting a claim through CCHR's website'; services are free; the deadline is one year, or three years for gender-based harassment, per the 2025 Notice of Rights. Removed (not confirmed): anonymous reporting, salary-range ads.",
  },
  {
    name: 'Citywide Doula Initiative (free doula care)',
    description:
      "Pregnant people who live in the program's service neighborhoods, or in a shelter or foster home in NYC, and have Medicaid-range income can get free doula services. Priority goes to people giving birth for the first time, people who have aged out of foster care, and people without other labor support. To check eligibility or enroll, call 844-OK-DOULA (844-653-6852), weekdays 9am-5pm, or email cdi@health.nyc.gov.",
    url: 'https://www.nyc.gov/site/doh/health/health-topics/citywide-doula-initiative.page',
    phone: '844-653-6852',
    kind: 'services',
    dimension_slugs: ['gender-equality', 'health'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/doh/health/health-topics/citywide-doula-initiative.page',
    operator: 'NYC Department of Health and Mental Hygiene (DOHMH)',
    evidence:
      "Verified by web search, October 2026. DOHMH Citywide Doula Initiative page: no-cost doula services; applicants must live in a service area, or a shelter or foster home, and have Medicaid-range income; 844-OK-DOULA (844-653-6852), Monday-Friday 9-5, cdi@health.nyc.gov. A 2025 ACS document describes it, and on October 29, 2025 the City Council passed Intro 1285 to make CDI permanent. Corrected: the priority groups are first-time births, people who aged out of foster care and people without labor support (not 'high-risk conditions'). Removed (not confirmed): immigration-status and insurance claims. Health added as a dimension.",
  },
  {
    name: 'Sanctuary for Families volunteer program',
    description:
      "Volunteer with Sanctuary for Families, a New York nonprofit that serves survivors of domestic violence. Volunteers have helped with childcare for clients' children during meetings and groups, tutoring (including virtual tutoring for the after-school program at its transitional shelter), language outreach, and clinical administration such as data entry and client files. Roles change over time, so see the volunteer page for current openings.",
    url: 'https://sanctuaryforfamilies.org/support-us/volunteer/',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['gender-equality', 'peace-justice'],
    boroughs: 'citywide',
    source_url: 'https://sanctuaryforfamilies.org/category/volunteers/page/2/',
    operator: 'Nonprofit (Sanctuary for Families)',
    evidence:
      "Verified by web search, October 2026. Sanctuary for Families 'Celebrating Bharat Sanka: 2026 Pillars of Change Honoree' (a volunteer since fall 2022) shows the volunteer program is active in 2026; a pro bono listing points to sanctuaryforfamilies.org/support-us/volunteer/. Roles found: childcare, clinical administration (data entry, client files), language outreach and tutoring, including virtual tutoring for the shelter after-school program. Removed (not confirmed): adult tutoring 'one hour a week for at least three months', remote translation in Spanish, French and Mandarin, the trafficking claim.",
  },

  // ---- Social Equity -----------------------------------------------------------------
  {
    name: 'MOIA Immigration Legal Support Hotline',
    description:
      "Call the City's free, confidential MOIA Immigration Legal Support Hotline at 800-354-0365, or call 311 and say 'Immigration Legal'. Staff answer immigration policy questions and refer callers to free, City-funded immigration legal help in the five boroughs. The hotline does not provide legal services itself or schedule appointments, and because demand is high, full representation is not guaranteed. Hours vary, so check the hotline page before calling.",
    url: 'https://www.nyc.gov/site/immigrants/legal-resources/moia-immigration-legal-support-hotline.page',
    phone: '1-800-354-0365',
    kind: 'services',
    dimension_slugs: ['social-equity', 'peace-justice'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/immigrants/legal-resources/moia-immigration-legal-support-hotline.page',
    operator: "NYC Mayor's Office of Immigrant Affairs (MOIA)",
    evidence:
      "Verified by web search, October 2026. nyc.gov 'MOIA Immigration Legal Support Hotline' page: 800-354-0365; it 'answers immigration policy questions and points callers to free, City-funded immigration legal help', 'does not provide legal services directly and does not schedule callers for appointments', and full representation is 'not guaranteed'; callers can also call 311 and say 'Immigration Legal'. An April 2026 MOIA flyer shows it is current. Removed (not confirmed): the 'ActionNYC' label (so it was dropped from the name), in-language help, status eligibility; the press-release link was replaced with the hotline page.",
  },
  {
    name: 'IDNYC municipal ID card',
    description:
      "NYC residents aged 10 and older can get IDNYC, the City's government-issued photo ID card, regardless of immigration status, criminal record, or homelessness. You need documents worth three points to prove your identity and a one-point document to prove NYC residency (the IDNYC Document Calculator shows which count). Start the application online, then visit an enrollment center. Walk-ins are first-come, first-served at East New York (Tue), Bronx Monterey (Wed), Union Square (Thu), and Queens Central Library (Fri). Other sites need an appointment, which you can book online or through 311.",
    url: 'https://www.nyc.gov/site/idnyc/card/how-to-apply.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['social-equity'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/idnyc/card/how-to-apply.page',
    operator: 'NYC Human Resources Administration (IDNYC program)',
    evidence:
      "Verified by web search, October 2026. IDNYC 'How To Apply' page: walk-ins first-come, first-served at East New York on Tuesdays, Bronx Monterey on Wednesdays, Union Square on Thursdays and Queens Public Library at Central on Fridays; all other locations require an appointment; eligibility is 'anyone living in NYC who is 10 or older... regardless of immigration status, criminal record, or homelessness'; 3 identity points and 1 residency point. Removed (not confirmed): 'free', '10-14 business days' mail delivery.",
  },
  {
    name: 'Citywide Racial Equity Plan and Commission on Racial Equity (CORE)',
    description:
      "Read New York City's first Citywide Racial Equity Plan, released in final form on September 1, 2026 after a public comment period on the April draft, and track its eight citywide goals in areas such as employment, maternal health, and child care. The Mayor's Office of Equity & Racial Justice will report on progress toward each goal every two years. The independent Commission on Racial Equity (CORE) also publishes its own reports.",
    url: 'https://www.nyc.gov/mayors-office/news/2026/09/mayor-mamdani-releases-new-york-city-s-first-citywide-racial-equ',
    phone: '',
    kind: 'civic',
    dimension_slugs: ['social-equity', 'political-voice'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/mayors-office/news/2026/09/mayor-mamdani-releases-new-york-city-s-first-citywide-racial-equ',
    operator: "NYC Mayor's Office of Equity & Racial Justice (MOERJ); NYC Commission on Racial Equity (CORE)",
    evidence:
      "Verified by web search, October 2026. Mayor's Office release, September 2026, and coverage: the final plan was released September 1, 2026 by Mayor Mamdani and MOERJ, sets eight citywide goals, and followed a 30-day comment period on the April preliminary draft; 'MOERJ will report every two years on progress'. A CORE September 2026 report is on nyc.gov/assets/core. Softened: CORE listening sessions on the plan were confirmed only for the earlier tour (a May 2026 article).",
  },
  {
    name: 'CitizensNYC Community Leaders Grants',
    description:
      'Resident-led and grassroots groups in the five boroughs can apply to CitizensNYC for Community Leaders Grants of up to $5,000 for community-building projects that improve neighborhood life. In 2026 there were two application rounds, and the second closed July 27, 2026. Check the CitizensNYC grants page or email grants@citizensnyc.org for the next round.',
    url: 'https://www.citizensnyc.org/clg/',
    phone: '',
    kind: 'organize',
    dimension_slugs: ['social-equity', 'networks'],
    boroughs: 'citywide',
    source_url: 'https://www.citizensnyc.org/clg/',
    operator: 'Nonprofit (Citizens Committee for New York City)',
    evidence:
      "Verified by web search, October 2026. CitizensNYC /clg/ page: grants 'up to $5,000 for community-building projects led by residents'; the 2026 first cycle closed February 2, 2026; the second opened May 4 with a July 27 deadline and decisions in September 2026; helpnewyork.com coverage of CitizensNYC turning 50 confirms the dates. The page's 'currently open' banner is stale, and no date for the next cycle was found. The /grantprograms link did not come up.",
  },

  // ---- Political Voice ---------------------------------------------------------------
  {
    name: 'Poll site language assistance (Civic Engagement Commission)',
    description:
      'Voters with limited English can get free interpreters from the Civic Engagement Commission at selected poll sites during early voting and on Election Day. Languages include Arabic, Bengali, Chinese (Cantonese and Mandarin), French, Haitian Creole, Italian, Korean, Polish, Russian, Urdu and Yiddish, with Greek and Albanian added from June 2026. Check the Early Voting and Election Day service maps to see which sites offer which languages. You may also bring your own interpreter, such as a friend or relative, but not your employer or union representative.',
    url: 'https://www.participate.nyc.gov/processes/vote',
    phone: '',
    kind: 'services',
    dimension_slugs: ['political-voice', 'social-equity'],
    boroughs: 'citywide',
    source_url: 'https://www.participate.nyc.gov/processes/vote',
    operator: 'NYC Civic Engagement Commission',
    evidence:
      "Verified by web search, October 2026. participate.nyc.gov/processes/vote ('Voter Language Assistance'): 'CEC's language services will be available in select poll sites and languages. To see if your poll site will receive voter interpretation services, use the Early Voting Services Map or Election Day Services Map'; your interpreter can be a friend or family member 'but not an employer or union representative.' The CEC's final methodology resolution of April 30, 2026 lists the 11 citywide languages and adds Greek and Albanian 'effective June 2026'. STAFF: the page header still mentions 2025 elections, so check the maps have been updated.",
  },
  {
    name: 'NYC Votes: registration, ballot and election dates',
    description:
      "Use NYC Votes, the NYC Campaign Finance Board's nonpartisan voter site, to find key election dates. For the November 3, 2026 general election, the last day to register or update your registration is October 24, and the deadline to request a mail ballot online or by mail is also October 24. Early voting runs October 24 to November 1, and polls are open 6am to 9pm on Election Day.",
    url: 'https://www.nycvotes.org/how-to-vote/election-calendar/',
    phone: '',
    kind: 'civic',
    dimension_slugs: ['political-voice'],
    boroughs: 'citywide',
    source_url: 'https://www.nycvotes.org/how-to-vote/election-calendar/',
    operator: 'NYC Campaign Finance Board (NYC Votes)',
    evidence:
      "Verified by web search, October 2026. nycvotes.org election calendar (seen with a tracking parameter, dropped here) 'lists Sat, October 24, 2026 as the last day to register or update your registration', and the NYS Board of Elections gives the same date; other results give early voting October 24 to November 1, the mail-ballot request deadline October 24, and Election Day polls 6am to 9pm. Removed (not confirmed): the /meet-the-candidates/ link, the registration and ballot lookups, 866-868-3692 as a CFB line (so no phone is listed). EXPIRES: after November 3, 2026 the description needs the next election's dates.",
  },
  {
    name: 'Become a poll worker (Board of Elections in the City of New York)',
    description:
      "Work at a poll site during early voting or on Election Day. The Board of Elections pays poll workers $250 per day plus $100 for training, and working up to 10 days of early voting and Election Day can total up to $2,750. Inspectors must be registered voters and are appointed through a party commissioner. Interpreters, accessibility clerks, and information clerks do not need to be registered voters. Apply with the Board's poll worker application form.",
    url: 'https://vote.nyc/sites/default/files/pdf/job_applications/Poll_Worker_Application_v11b.pdf',
    phone: '866-868-3692',
    kind: 'civic',
    dimension_slugs: ['political-voice'],
    boroughs: 'citywide',
    source_url: 'https://vote.nyc/sites/default/files/pdf/job_applications/Poll_Worker_Application_v11b.pdf',
    operator: 'Board of Elections in the City of New York',
    evidence:
      "Verified by web search, October 2026. Board of Elections (vote.nyc): poll workers earn '$250 per day and $100 for training'; a 2025 PIX11 piece and a 2025 'Apply to be a poll worker for the 2025 general election' article say pay can reach '$2,750 for working up to 10 days'; the official application PDF says 'Interpreters, Accessibility Clerks, or Information Clerks do not have to be registered voters', while inspectors are registered voters appointed by a party commissioner. The vote.nyc/node/166 link did not come up. Removed (not confirmed): the '5am until results are reported' shift. The phone (1-866-VOTE-NYC, the Board's line) was not separately checked.",
  },
  {
    name: 'Participatory Budgeting (NYC Council)',
    description:
      "In participating City Council districts, residents propose and then vote on how to spend part of their council member's capital budget on projects such as improvements to schools, parks, libraries, and streets. During Vote Week, April 11-19, 2026, residents of the 22 participating districts voted online or in person on how to spend $22 million in the City's Fiscal Year 2027 budget. Check the Council's PB page for the next cycle's idea-collection and voting dates.",
    url: 'https://council.nyc.gov/pb/',
    phone: '',
    kind: 'civic',
    dimension_slugs: ['political-voice'],
    boroughs: 'citywide',
    source_url: 'https://council.nyc.gov/press/2026/04/10/3104',
    operator: 'New York City Council',
    evidence:
      "Verified by web search, October 2026. Council release (council.nyc.gov/press/2026/04/10/3104): 'Vote Week ran from April 11 to April 19' in 'the 22 participating City Council districts, deciding how $22 million in capital funding will be spent in the city's Fiscal Year 2027 city budget'. Corrected: 'nearly 130,000 residents voted on about $25 million' (130,000 is the Civic Engagement Commission's citywide figure). Removed (not confirmed): 'aged 11 and older', a '$50,000 minimum'.",
  },
  {
    name: "The People's Money (citywide participatory budgeting)",
    description:
      "Through The People's Money, the Civic Engagement Commission's citywide participatory budgeting process, New Yorkers aged 11 and older can submit project ideas and vote on how to spend part of the City budget, regardless of immigration status. In the 2026 vote (May 6 to June 21), more than 130,000 New Yorkers took part and chose 20 projects worth $4 million in total. Check participate.nyc.gov for the next cycle's dates.",
    url: 'https://www.participate.nyc.gov/',
    phone: '',
    kind: 'civic',
    dimension_slugs: ['political-voice', 'social-equity'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/civicengagement/news/nyc-cec-winning-projects-082726.page',
    operator: 'NYC Civic Engagement Commission',
    evidence:
      "Verified by web search, October 2026. CEC release, August 27, 2026: 20 winners announced August 25; 'over 130,000 New Yorkers participated in the vote to decide how to spend $4 million'; voting 'ran from May 6 through June 21'; open to 'all New Yorkers 11 and older, regardless of immigration status'; the CEC also invites idea submissions; the process platform is participate.nyc.gov. Removed (not confirmed): borough assemblies.",
  },
  {
    name: 'Testify at a City Council hearing',
    description:
      "Anyone can testify at City Council hearings in person or remotely by Zoom (web or phone). Sign up on the Council's testify page before the hearing; advocacy guides advise signing up at least a day ahead. Written testimony is accepted up to 72 hours after a hearing is adjourned. Request interpretation or accessibility accommodations at least three business days before. Anything you submit becomes part of the public record.",
    url: 'https://council.nyc.gov/testify/',
    phone: '',
    kind: 'civic',
    dimension_slugs: ['political-voice'],
    boroughs: 'citywide',
    source_url: 'https://council.nyc.gov/testify/',
    operator: 'New York City Council',
    evidence:
      "Verified by web search, October 2026. council.nyc.gov/testify: 'Members of the public can sign up to testify at virtual public hearings via Zoom Web, Zoom Phone, or in-person. Written testimony may be submitted up to 72 hours after hearing has been adjourned.' Accommodations: contact the EEO Officer 'at least three (3) business days before the hearing.' The Council's Land Use page lists July 2026 hearings. Removed: 'in-person testimony needs no pre-registration' (a TransAlt guide says to sign up at least one day before, in person or remote).",
  },
  {
    name: 'NYC Rules: comment on proposed City rules',
    description:
      "City agencies post proposed rules, such as changes to benefit eligibility, fees, or street rules, on NYC Rules before adopting them. Each proposed rule lists a comment deadline, and most have a public hearing. You can comment through the online form on the rule's page until the deadline, by email or mail as the rule's notice specifies, or by signing up to speak at the hearing.",
    url: 'https://rules.cityofnewyork.us/',
    phone: '',
    kind: 'civic',
    dimension_slugs: ['political-voice'],
    boroughs: 'citywide',
    source_url: 'https://rules.cityofnewyork.us/wp-content/uploads/2026/10/Notice-of-Public-Hearing-and-Opportunity-to-Comment-DONYC-Rule-Amendments-with-certifications.pdf',
    operator: "City of New York (Mayor's Office of Operations / Law Department, rulemaking portal)",
    evidence:
      "Verified by web search, October 2026. rules.cityofnewyork.us: a 2026 notice (DONYC rule amendments, uploaded October 2026, written comments due November 9, 2026) and a DOT proposed rule from February 2026; the site 'has a comment form next to each proposed rule, and comments may be submitted until the date indicated in the Comment Deadline column', and agencies also take email, mail or fax. Removed (not confirmed): reading comments others have submitted.",
  },

  // ---- Peace & Justice ---------------------------------------------------------------
  {
    name: 'Community Dispute Resolution Centers (mediation)',
    description:
      "Every county in New York State, including each NYC borough, has a Community Dispute Resolution Center. Each center is run by an independent nonprofit together with the State court system and helps people resolve parenting and family, neighbor, housing, elder care, small claims, and other disputes through mediation. Find your borough's center, with its address, phone and email, on the courts' program list by choosing your county.",
    url: 'https://nycourts.gov/ip/adr/ProgramList.shtml',
    phone: '',
    kind: 'services',
    dimension_slugs: ['peace-justice'],
    boroughs: 'citywide',
    source_url: 'https://nycourts.gov/ip/adr/ProgramList.shtml',
    operator: 'NYS Unified Court System (Office of ADR) with nonprofit centers',
    evidence:
      "Verified by web search, October 2026. UCS program list (nycourts.gov/ip/adr/ProgramList.shtml): 'To find contact information for your local CDRC, click on the county in which you live', with each center's address, phone and email; the ADR programs page says the program helps New Yorkers 'resolve parenting and family, neighbor, housing, elder care, small claims, and other kinds of disputes', a UCS initiative 'in collaboration with independent not-for-profit organizations.' A CDRC RFP was amended in March 2026. Removed (not confirmed): 'free or low-cost' (so 'free' was dropped from the name), timing before or during a court case, the New York Peace Institute example, virtual sessions.",
  },
  {
    name: 'Civilian Complaint Review Board: report police misconduct',
    description:
      "File a complaint about misconduct by an NYPD officer online, by phone at 1-800-341-2272 (weekdays 9am-5pm, with voicemail after hours), through 311 at any time, by mail, or in person at 100 Church Street, 10th floor (no appointment needed). You do not need the officer's name or badge number. The CCRB takes complaints regardless of immigration status and never asks about it, and translation services are available.",
    url: 'https://www.nyc.gov/site/ccrb/complaints/file-complaint.page',
    phone: '1-800-341-2272',
    kind: 'civic',
    dimension_slugs: ['peace-justice'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/ccrb/complaints/file-complaint.page',
    operator: 'NYC Civilian Complaint Review Board (CCRB)',
    evidence:
      "Verified by web search, October 2026. CCRB 'How to file a complaint with the CCRB' page: 'call the CCRB's hotline Monday through Friday 9am - 5pm ... 1-800-341-2272 (CCRB). After 5pm and on weekends, you can leave your complaint on voicemail'; call 311 any time; 'Visit our office located at 100 Church Street, 10th Fl. ... No appointment is necessary.'; 'The CCRB takes complaints regardless of a person's immigration status and never asks.' Softened: 'interpretation in all languages' to translation services. Note: since January 2024 the CCRB has not investigated some discourtesy-only allegations.",
  },
  {
    name: 'NYPD Build the Block neighborhood meetings',
    description:
      "Use the NYPD's Find Your Meeting page to look up your neighborhood sector and the next Build the Block meeting, where residents raise local public-safety concerns with their sector's Neighborhood Coordination Officers. Meeting times and places can change, so confirm with your local precinct or call 311.",
    url: 'https://www.nyc.gov/site/nypd/bureaus/patrol/find-your-meeting.page',
    phone: '311',
    kind: 'civic',
    dimension_slugs: ['peace-justice', 'political-voice'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/nypd/bureaus/patrol/find-your-meeting.page',
    operator: 'New York City Police Department (NYPD)',
    evidence:
      "Verified by web search, October 2026. NYPD 'Find Your Meeting' page: 'search for upcoming meetings in your neighborhood, or sector, and come to a Build the Block meeting.' The page is live in current results, but no result gave a 2025-2026 date (others were from 2017-2021). STAFF: spot-check that the finder still lists upcoming meetings. Removed (not confirmed): NCO contact details in the finder, monthly precinct community council meetings.",
  },
  {
    name: 'NYC Board of Correction public meetings (jail oversight)',
    description:
      "The Board of Correction, which oversees the City's jails, holds public meetings several times a year. In 2026 these were in January, March, July and September, and the next listed meeting is November 17, 2026 at 1:00 pm. Recent meetings were held at 125 Worth Street in Manhattan. Check the Board's meetings page for each meeting's agenda, location, how to attend or comment, and materials posted afterward.",
    url: 'https://www.nyc.gov/site/boc/meetings/2026-meetings.page',
    phone: '',
    kind: 'civic',
    dimension_slugs: ['peace-justice', 'political-voice'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/boc/meetings/20261117.page',
    operator: 'NYC Board of Correction',
    evidence:
      "Verified by web search, October 2026. BOC page nyc.gov/site/boc/meetings/20261117.page: a meeting on November 17, 2026, 'Time: 1:00 pm'. City Record notices list meetings on September 9 and July 14, 2026 at 1:00pm at 125 Worth Street and point to the 2026 meetings page; agendas exist for January 13 and March 10, 2026. Corrected: 'most months' (meetings are roughly every other month). Removed (not confirmed): 9am remote sign-up, boc@boc.nyc.gov, recordings and minutes, the phone 212-669-7900 (so no phone is listed).",
  },

  // ---- Climate Change ----------------------------------------------------------------
  {
    name: 'DSNY curbside composting (food scraps and yard waste)',
    description:
      "All NYC residents must separate food scraps, food-soiled paper and yard waste from trash for DSNY curbside collection. No sign-up is needed, and any bin of 55 gallons or less with a secure lid works. Owners and managers of buildings with four or more units must provide a storage area with clearly labeled compost bins. DSNY's FAQ explains the requirement for households and buildings.",
    url: 'https://www.nyc.gov/site/dsny/collection/residents/curbside-composting-faq.page',
    phone: '',
    kind: 'services',
    dimension_slugs: ['climate-change'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dsny/collection/residents/curbside-composting-faq.page',
    operator: 'NYC Department of Sanitation (DSNY)',
    evidence:
      "Verified by web search, October 2026. DSNY 'Curbside Composting FAQ': 'all NYC residents are required to separate food scraps, food-soiled paper, or yard waste from trash'; buildings with four or more units must provide a storage area and labeled bins. DSNY release 26-018 ('Compost the City', April 2026) confirms the requirement is current. The nyc.gov/compost short link was only mentioned, not returned. Dimensions: chemical-pollution dropped (diverting organics from landfill is mainly a climate benefit).",
  },

  // ---- Ocean Acidification -----------------------------------------------------------
  {
    name: 'HRPK Blue Team: oyster monitoring and shoreline cleanup (Hudson River Park River Project)',
    description:
      'Volunteers join weekend sessions at Gansevoort Peninsula, held May through October. They clean, measure and record data on oysters in the Hudson River to support restoration, and they collect and sort shoreline debris with River Project scientists. To sign up, email the address on the program page.',
    url: 'https://hudsonriverpark.org/get-involved/volunteer/hrpk-blue-team/',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['ocean-acidification', 'biodiversity-loss', 'chemical-pollution'],
    boroughs: ['manhattan'],
    source_url: 'https://hudsonriverpark.org/visit/events/event/hrpk-blue-team-october-3-2026/',
    operator: "Hudson River Park Trust / Hudson River Park's River Project (public benefit corporation)",
    evidence:
      "Verified by web search, October 2026. Hudson River Park pages: 2026 Blue Team dates May 2, June 6, July 18, August 8, September 26 and October 3, 2026 (October 3: 10am-12pm at Gansevoort Peninsula); events are 'hosted from May through October'; volunteers 'clean, measure and record data on local oysters, supporting restoration efforts' and do shoreline cleanups with River Project scientists; contact volunteer@hudsonriverpark.org. The 2026 season has ended, so look for 2027 dates.",
  },

  // ---- Chemical Pollution ------------------------------------------------------------
  {
    name: 'DSNY SAFE Disposal Events',
    description:
      "At seasonal drop-off events in all five boroughs, residents can bring household chemicals, automotive products, electronics and other harmful household products for safe disposal instead of putting them in the trash. Events are for NYC residents only, with no businesses or commercial vehicles, and proof of residency may be requested. Plug-in appliances and items containing CFCs are not accepted. Check the page for the current season's dates and locations.",
    url: 'https://nyc.gov/safeevents',
    phone: '',
    kind: 'services',
    dimension_slugs: ['chemical-pollution'],
    boroughs: 'citywide',
    source_url: 'https://nyc.gov/safeevents',
    operator: 'NYC Department of Sanitation (DSNY)',
    evidence:
      "Verified by web search, October 2026. DSNY page (nyc.gov/safeevents) lists 2026 events, 10am-4pm: Manhattan September 20, Queens September 26, Brooklyn October 11, Staten Island October 17 and Bronx October 24; 'These events are for NYC residents ONLY. NO businesses or commercial vehicles'; 'You may be asked for proof of NYC residency'; 'We DO NOT accept plug-in appliances ... or ones containing CFCs.' Removed (not confirmed): medications, items 'sealed and unmixed'.",
  },
  {
    name: 'DSNY Special Waste Drop-Off Sites',
    description:
      "Residents can drop off items such as paint, batteries, motor oil and filters, fluorescent bulbs and CFLs, mercury-containing devices, passenger car tires and electronics at a DSNY site in each borough: Hunts Point, Greenpoint, Lower East Side/Two Bridges, College Point and Fresh Kills. Sites are open Thursday through Saturday, 9am to 5pm. They are for NYC residents only, and staff may ask for proof of residency. Check DSNY's page for current hours and per-visit limits before going.",
    url: 'https://www.nyc.gov/site/dsny/what-we-do/programs/special-waste-drop-off.page',
    phone: '',
    kind: 'services',
    dimension_slugs: ['chemical-pollution'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dsny/what-we-do/programs/special-waste-drop-off.page',
    operator: 'NYC Department of Sanitation (DSNY)',
    evidence:
      "Verified by web search, October 2026. DSNY 'Special Waste Drop-Off' page (also nyc.gov/specialwaste): five sites (Hunts Point, Greenpoint, Lower East Side/Two Bridges, College Point, Fresh Kills), open 'every Thursday, Friday, and Saturday from 9:00 AM to 5:00 PM'; for NYC residents only; 'Staff may ask for proof of NYC residency' (the draft said 'required'). The draft's link was a December 2024 press release (24-039), replaced with the program page.",
  },
  {
    name: 'New York State Beach Cleanup (American Littoral Society)',
    description:
      "The American Littoral Society's Northeast Chapter has led the New York State Beach Cleanup since 1985 as part of the International Coastal Cleanup. 2026 was the program's 40th year, with International Coastal Cleanup Day on September 19, 2026. Volunteers can join a shoreline cleanup or register as a beach captain to lead one at a site of their choosing. Check the Society's site for the next season's registration.",
    url: 'https://www.littoralsociety.org/blog/40th-anniversary-of-new-york-state-beach-clean-ups',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['chemical-pollution', 'biodiversity-loss'],
    boroughs: 'citywide',
    source_url: 'https://www.littoralsociety.org/blog/40th-anniversary-of-new-york-state-beach-clean-ups',
    operator: 'American Littoral Society, Northeast Chapter (nonprofit)',
    evidence:
      "Verified by web search, October 2026. American Littoral Society blog, July 2026: the '40th Anniversary of our beach cleanup program', with International Coastal Cleanup Day on September 19, 2026; Society posts say the Northeast Chapter has led the cleanup since 1985 as part of the International Coastal Cleanup and that volunteers can register as beach captains. The nys-beach-cleanup.html page did not come up, so the link is the 2026 post. Removed (not confirmed): the August-December window, the Jamaica Bay site list; ocean-acidification replaced by biodiversity-loss.",
  },

  // ---- Nitrogen & Phosphorus Loading -------------------------------------------------
  {
    name: 'Billion Oyster Project volunteer days',
    description:
      "Sign up for a free public volunteer day on Governors Island to help restore New York Harbor's oyster reefs by cleaning shell, building reef balls or maintaining the shell pile. Sessions are usually held Tuesday through Saturday and last about three to five hours. Some listings require ages 16+. Tools, safety gear and ferry access are provided. Dates can sell out, and events may be canceled for bad weather.",
    url: 'https://www.billionoysterproject.org/volunteering',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['nitrogen-phosphorus-loading', 'biodiversity-loss'],
    boroughs: 'citywide',
    source_url: 'https://www.billionoysterproject.org/volunteering',
    operator: 'Nonprofit harbor restoration organization',
    evidence:
      "Verified by web search, October 2026. Billion Oyster Project pages: public volunteer days on Governors Island with 2026 dates, e.g. September 11 (9:30-2:30), September 23 (1-4pm) and October 10, 2026; activities 'cleaning shell substrate, fabricating reef balls, or maintaining the shell pile'; free; one listing says 16+; tools, gear and ferry access included. Removed (not confirmed): new dates on the 15th of each month, Ambassador training after three events; ocean-acidification and water-sanitation dropped (reef habitat work).",
  },
  {
    name: 'Bronx River Alliance stewardship and water monitoring',
    description:
      'Volunteer with the Bronx River Alliance on river stewardship, such as restoration and gardening, green infrastructure maintenance and park cleanups. You can also train for its volunteer water-quality monitoring program, in which volunteers sample river stations every two weeks from May through October, with training in April. Email volunteer@bronxriver.org to confirm current opportunities.',
    url: 'https://bronxriver.org/stewardship-and-volunteering',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['nitrogen-phosphorus-loading', 'biodiversity-loss'],
    boroughs: ['bronx'],
    source_url: 'https://bronxriver.org/stewardship-and-volunteering',
    operator: 'Nonprofit river conservation organization',
    evidence:
      "Verified by web search, October 2026. Bronx River Alliance 'stewardship and volunteering' page: a biweekly water quality monitoring program, and an Alliance post invites 'water quality ambassadors' this season; role descriptions give 'May – October with a training session in April'; the handbook lists Restoration & Gardening, Green Infrastructure Maintenance and Park Clean-ups. Caveat: the supporting PDFs date from 2021 and no result carried a 2025-26 date. Removed (not confirmed): specific Starlight Park and Bronx Park activities; water-sanitation dropped.",
  },
  {
    name: 'Coordinated Volunteer Water Quality Monitoring Program (Interstate Environmental Commission)',
    description:
      "Community groups sample near-shore harbor waters that regulators do not routinely monitor. They take on-site readings with a multiparameter sonde and send samples to the commission's lab, mainly to test for sewage-related bacteria. NYC participants have included Freshkills Park Alliance, Gowanus Canal Conservancy, Hudson River Park Trust and SWIM Coalition. Residents can volunteer through one of these groups, and waterfront organizations can contact the commission about joining.",
    url: 'https://www.iec-nynjct.org/node/115',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['nitrogen-phosphorus-loading', 'water-sanitation'],
    boroughs: 'citywide',
    source_url: 'https://www.iec-nynjct.org/node/115',
    operator: 'Interstate Environmental Commission (NY-NJ-CT interstate water pollution control agency)',
    evidence:
      "Verified by web search, October 2026. IEC program page (iec-nynjct.org/node/115): as of 2026 eight groups take part, including Freshkills Park Alliance, Gowanus Canal Conservancy, Hudson River Park Trust and SWIM Coalition; the program 'targets areas not routinely monitored by regulatory agencies, particularly near-shore recreational areas', testing mainly for pathogen indicators such as enterococcus and fecal coliform; groups get a YSI multiparameter sonde and send sample bottles to IEC's lab. IEC posted State Summary 2026 PDFs. Ocean-acidification dropped (sewage bacteria, not ocean chemistry).",
  },

  // ---- Freshwater Withdrawals --------------------------------------------------------
  {
    name: 'DEP leak alerts through My DEP Account and free leak-detection tools',
    description:
      'Water account holders can sign up in their online My DEP Account for alerts when water use suddenly spikes, which often means a leak, so they can fix it before water and money are lost. DEP also offers leak-detection dye tablets for finding leaky plumbing fixtures, plus free home water-conservation kits at DEP customer service offices citywide.',
    url: 'https://www.nyc.gov/site/dep/news/26-003/dep-encourages-new-yorkers-save-water-money-finding-repairing-leaks-during-fix-leak',
    phone: '718-595-7000',
    kind: 'services',
    dimension_slugs: ['freshwater-withdrawals', 'water-sanitation'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dep/news/26-003/dep-encourages-new-yorkers-save-water-money-finding-repairing-leaks-during-fix-leak',
    operator: 'NYC Department of Environmental Protection (DEP)',
    evidence:
      "Verified by web search, October 2026. DEP Fix a Leak Week release, March 16, 2026: 'Customers can sign up for leak notifications through the online My DEP Account'; almost 48,000 proactive high-usage alerts in 2025, which DEP estimates prevented about 1.7 billion gallons of waste; leak-detection dye tablets and a home water-conservation kit, with free kits at customer service offices citywide. The phone (DEP customer service, 718-595-7000, business hours) is from the research reading of the same release; the fact-check did not mention it.",
  },
  {
    name: 'Free fire hydrant spray caps and reporting open hydrants to 311',
    description:
      'Adults 18 and older can get a free City-approved spray cap at their local firehouse. A capped hydrant releases about 20 to 25 gallons a minute, compared with about 1,000 gallons a minute when it is open without a cap. Uncapped open hydrants waste water and lower pressure for firefighting and household taps. Report a running hydrant through the 311 app or by calling 311.',
    url: 'https://www.nyc.gov/site/dep/news/26-018/dep-encourages-safe-hydrant-use-safeguard-water-pressure-during-historic-extreme-heatwave',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['freshwater-withdrawals', 'water-sanitation'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dep/news/26-018/dep-encourages-safe-hydrant-use-safeguard-water-pressure-during-historic-extreme-heatwave',
    operator: 'NYC Department of Environmental Protection (DEP), with FDNY firehouses',
    evidence:
      "Verified by web search, October 2026. DEP release, July 2, 2026 ('DEP Encourages Safe Hydrant Use to Safeguard Water Pressure During Historic Extreme Heatwave'): hydrants can be opened legally only with a City-approved spray cap, which limits flow to about 20-25 gallons per minute; 'An adult 18 or older can get one free at a local firehouse'; uncapped hydrants can release more than 1,000 gallons per minute and cut pressure for firefighting and homes; report leaking, running or illegally opened hydrants to 311. News12 covered it the same day.",
  },

  // ---- Biodiversity Loss -------------------------------------------------------------
  {
    name: 'Salt Marsh Alliance volunteering at the Salt Marsh Nature Center (Marine Park)',
    description:
      "Volunteers help the Salt Marsh Alliance, a nonprofit that supports NYC Parks' Salt Marsh Nature Center in Marine Park, Brooklyn, with garden and natural-area work such as planting cordgrass and clearing weeds. Volunteers must be 18 or older, and no special skills are needed. Contact the Alliance through its volunteer page to learn about current opportunities.",
    url: 'https://saltmarshalliance.org/volunteer-2/',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['biodiversity-loss', 'land-conversion'],
    boroughs: ['brooklyn'],
    source_url: 'https://php1-84.nycgovparks.org/events/2026/03/07/maintaining-marine-parks-forever-wild-natural-areas',
    operator: "Salt Marsh Alliance, Inc. (nonprofit partner of NYC Parks' Salt Marsh Nature Center)",
    evidence:
      "Verified by web search, October 2026. Salt Marsh Alliance volunteer page (saltmarshalliance.org/volunteer-2/): volunteers must be at least 18, skill level is no barrier, and tasks include garden work such as planting cordgrass and clearing weeds. An NYC Parks listing for March 7, 2026 ('Maintaining Marine Park's Forever Wild Natural Areas') names the Alliance as contact (saltmarshalliance@gmail.com, 718-421-2021). Removed (not confirmed): tending the Salt Marsh Nature Trail; ocean-acidification dropped (habitat and land work, not ocean chemistry).",
  },

  // ---- Air Pollution -----------------------------------------------------------------
  {
    name: 'Citizens Air Complaint Program (report idling trucks and buses)',
    description:
      "Residents who see a truck or bus idling for more than three minutes (more than one minute next to a school or park) can record a time- and date-stamped video and file a complaint through DEP's Idling Complaint System. Filers may receive a share of any penalty collected. Check DEP's page for current evidence requirements before filing.",
    url: 'https://www.nyc.gov/site/dep/environment/idling-citizens-air-complaint-program.page',
    phone: '',
    kind: 'civic',
    dimension_slugs: ['air-pollution'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dep/environment/idling-citizens-air-complaint-program.page',
    operator: 'NYC Department of Environmental Protection (DEP)',
    evidence:
      "Verified by web search, October 2026. DEP 'Citizens Air Complaint Program' page: earn a reward for reporting illegal idling, over three minutes or over one minute next to a school or park; complaints are filed and tracked in DEP's Idling Complaint System. A 2024 DEP testimony summary says complainants receive 25% or 50% of fines. Removed (not confirmed): proposed Council bill Int. 561 of 2026, a 2026 federal lawsuit.",
  },
  {
    name: 'NYC Environment & Health Data Portal: neighborhood air quality (NYC Community Air Survey)',
    description:
      'Residents can look up neighborhood estimates of fine particulate matter (PM2.5) and nitrogen dioxide from the NYC Community Air Survey. The survey is a network of about 100 street-level monitors that the Health Department runs with Queens College, CUNY. You can compare your neighborhood with others and cite the data at community board meetings or public hearings.',
    url: 'https://a816-dohbesp.nyc.gov/IndicatorPublic/data-stories/air-quality-by-neighborhood/',
    phone: '',
    kind: 'other',
    dimension_slugs: ['air-pollution'],
    boroughs: 'citywide',
    source_url: 'https://a816-dohbesp.nyc.gov/IndicatorPublic/data-stories/air-quality-by-neighborhood/',
    operator: 'NYC Department of Health and Mental Hygiene (with Queens College)',
    evidence:
      "Verified by web search, October 2026. Health Department portal data story 'What our air quality monitors tell us about NYC's neighborhoods': NYCCAS is 'a network of about 100 air quality monitors', run with Queens College, with a recent report covering 2008-2023; the neighborhood feature shows 'Two major air pollutant measurements' (PM2.5 and NO2). Removed (not confirmed): 'and other pollutants', downloadable reports.",
  },

  // ---- Ozone Layer Depletion ---------------------------------------------------------
  {
    name: 'DSNY refrigerant (CFC/Freon) removal for refrigerators and air conditioners',
    description:
      'Before putting out a refrigerator, freezer, air conditioner, water cooler or other appliance containing CFC gas for collection, residents must book a refrigerant-removal appointment through 311 or an online service request. Up to 10 appliances fit on one appointment, and appointments cannot be made anonymously. DSNY staff remove the refrigerant and tag the unit, which is collected on the next recycling day. The service is for residents only; businesses must hire private carters. DSNY cannot collect newer units with R600a or R32 refrigerant (yellow triangle warning sticker with black flames).',
    url: 'https://www.nyc.gov/site/dsny/collection/get-rid-of/cfc-removal.page',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['ozone-depletion', 'climate-change'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/dsny/collection/get-rid-of/cfc-removal.page',
    operator: 'NYC Department of Sanitation (DSNY)',
    evidence:
      "Verified by web search, October 2026. DSNY 'CFC Removal' page (also nyc.gov/cfc): call 311 or submit an Online Service Request; 'Up to 10 appliances can be scheduled per appointment'; 'available for residents ONLY'; newer R600a/R32 units with 'a yellow triangle with black flames' sticker cannot be collected; staff remove the refrigerant and tag the unit, and tagged items are picked up on the next recycling day. Removed (not confirmed): 'free', 'contact the manufacturer'.",
  },
  {
    name: 'Cooling Center Finder',
    description:
      'On extreme-heat days, the City opens free air-conditioned cooling centers across the five boroughs, generally when the heat index reaches 100°F for a day or 95°F or higher for two or more days. Find locations, including accessible and pet-friendly sites, at finder.nyc.gov/coolingcenters or by calling 311. LinkNYC kiosks show walking directions to the nearest open center.',
    url: 'https://finder.nyc.gov/coolingcenters',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['ozone-depletion', 'climate-change', 'health'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/site/em/about/press-releases/20260713_pr_NYCEM-Mayor-Mamdani-Activates-Emergency-Heat-Plan.page',
    operator: 'NYC Emergency Management (with NYC Health Department and partner sites)',
    evidence:
      "Verified by web search, October 2026. NYC Emergency Management release, July 13, 2026 (heat emergency plan activated), with similar June and August 2026 releases: 'New Yorkers can find locations, including accessible and pet-friendly sites, at finder.nyc.gov/coolingcenters/ or by calling 311'; LinkNYC kiosks show walking directions to the nearest center within a 10-minute walk; centers open at a heat index of 100°F for one day or 95°F or higher for two or more days. Removed (not confirmed): the Cool It! NYC spray-shower map (so it was dropped from the name).",
  },
  {
    name: 'Notify NYC emergency and heat alerts',
    description:
      'Sign up for free official City alerts about heat emergencies, storms and other emergencies. Text NOTIFYNYC to 692-692 and add a ZIP code when prompted for neighborhood alerts (NOTIFYNYCESP for Spanish). You can also sign up at nyc.gov/NotifyNYC or by calling 311.',
    url: 'https://www.nyc.gov/notifynyc',
    phone: '311',
    kind: 'services',
    dimension_slugs: ['ozone-depletion', 'climate-change', 'health'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/mayors-office/news/2025/04/mayor-adams-nycem-commissioner-iscol-new-way-enroll-notify-nyc-receive',
    operator: 'NYC Emergency Management',
    evidence:
      "Verified by web search, October 2026. Mayor's Office release, April 2025, on a new way to enroll: 'By texting NOTIFYNYC to 692-692, New Yorkers can sign up for citywide SMS text alerts'; residents can reply with ZIP codes for local alerts, or enroll by 'visiting nyc.gov/NotifyNYC, calling 311.' The NYCEM tips page lists NOTIFYNYCESP for Spanish. A 2026 NYCEM heat statement also urged sign-ups. Removed (not confirmed): the TTY number.",
  },
  {
    name: 'NYC CoolRoofs',
    description:
      'NYC CoolRoofs coats rooftops with reflective material to lower building temperatures, focusing on heat-vulnerable neighborhoods such as the Bronx. It also runs a paid job-training program: about 10 weeks of training plus 10–11 weeks of full-time paid work experience installing cool roofs, with free construction-safety certifications (such as SST, Flagger, Scaffold User and Fireguard). Applicants must be NYC residents 18 or older. Start dates for the next cohort are to be announced; check the program page or contact The HOPE Program.',
    url: 'https://www.nyc.gov/employment/programs/nyc-coolroofs/',
    phone: '',
    kind: 'services',
    dimension_slugs: ['ozone-depletion', 'climate-change', 'energy', 'income-work'],
    boroughs: 'citywide',
    source_url: 'https://www.nyc.gov/employment/programs/nyc-coolroofs/',
    operator: 'NYC Department of Small Business Services with The HOPE Program (nonprofit)',
    evidence:
      "Verified by web search, October 2026. City program page (nyc.gov/employment/programs/nyc-coolroofs, mirrored on jobs.nyc.gov, last updated January 24, 2025): a 10-week paid training program with 10-11 weeks of full-time paid work experience and free construction certifications; applicants must be 18 or older and NYC residents; SBS and the Mayor's Office of Climate and Environmental Justice, with The HOPE Program as partner, which lists the next start dates as TBD. News12 (September 2025) covered reflective roof coatings in the Bronx. Removed (not confirmed): free coating for building owners, Local Law 97 help, CoolRoofs@sbs.nyc.gov, the nyc-business.nyc.gov link.",
  },
  {
    name: 'NYC Parks street tree stewardship volunteer events',
    description:
      'Join free NYC Parks Stewardship volunteer sessions to care for neighborhood street trees. Volunteers learn to aerate, cultivate and mulch tree beds and to identify street trees. Registration is required, volunteers under 18 need a chaperone, and groups of 10 or more should email stewardship@parks.nyc.gov. Check the Stewardship page for upcoming sessions.',
    url: 'https://www.nycgovparks.org/reg/stewardship',
    phone: '',
    kind: 'volunteer',
    dimension_slugs: ['ozone-depletion', 'biodiversity-loss', 'climate-change', 'air-pollution'],
    boroughs: 'citywide',
    source_url: 'https://php1-84.nycgovparks.org/events/2026/03/21/astoria-street-tree-care-with-super-stewards',
    operator: 'NYC Department of Parks & Recreation',
    evidence:
      "Verified by web search, October 2026. NYC Parks Stewardship registration page (nycgovparks.org/reg/stewardship, seen on the php1-84.nycgovparks.org host) and event pages list 2026 street tree care sessions, e.g. MLK Day (January 19, 2026) in Jackson Heights, Harlem and Prospect Lefferts Gardens, Turtle Bay (February 13) and Astoria (March 21, 2026), all free with required registration; volunteers 'learn how to aerate, cultivate, mulch, and identify street trees'; under-18s need a chaperone; groups of 10 or more contact stewardship@parks.nyc.gov. No fall 2026 sessions appeared. Removed (not confirmed): watering, a free Tree Work Permit.",
  },
];
