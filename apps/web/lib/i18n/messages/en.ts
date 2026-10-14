import type { PluralForms } from '../format';

/**
 * English source catalog for the public plane — the contract every
 * translation implements (`Messages = typeof en`, so a translation missing a
 * key, or carrying one English does not, fails the typecheck).
 *
 * Conventions for translators:
 * - `{name}` placeholders are filled at runtime; keep each one, move it
 *   wherever the sentence needs it. In `rich` messages a placeholder stands
 *   for a link or emphasis (e.g. `{link}`).
 * - Plural messages are objects keyed by CLDR plural category; supply every
 *   category your language uses (Intl.PluralRules), `other` always.
 * - Register: plain-language public information, as a city agency writes to
 *   residents (polite form where the language has one).
 * - Proper names (deep-fryer, Doughnut Economics, portrait and agency names)
 *   stay as they are. Numbers and units come from the data and are not
 *   translated.
 */
const plural = (forms: PluralForms): PluralForms => forms;

export const en = {
  common: {
    skipToContent: 'Skip to content',
    breadcrumb: 'Breadcrumb',
    mainNav: 'Main',
    menu: 'Menu',
    accountMenu: 'Account menu',
    accountAndPortraits: 'Account & portraits',
    installApp: 'Install app',
    signOut: 'Sign out',
    signIn: 'Sign in',
    back: '← {name}',
    noData: 'No data',
    updated: 'Updated {date}',
    socialFoundation: 'Social foundation',
    ecologicalCeiling: 'Ecological ceiling',
    admin: 'Admin',
  },
  nav: {
    progress: 'Progress',
    methodology: 'Methodology',
    getInvolved: 'Get involved',
    compare: 'Compare',
    insights: 'Insights',
    familyPortraits: '{org} portraits',
  },
  language: {
    label: 'Language',
    choose: 'Choose a language',
    contentNotice:
      'Page headings and explanations are translated. Research findings, sources, and resident comments are published in English.',
    help: 'For free help in your language, contact: {contact}',
  },
  doughnut: {
    chartLabel: 'Doughnut chart of social foundation and ecological ceiling dimensions',
    summary:
      '{name}: {outside} of {total} dimensions outside the safe and just space. A list of links to each dimension follows.',
    summaryWithGaps:
      '{name}: {outside} of {total} dimensions outside the safe and just space, {gaps} without data. A list of links to each dimension follows.',
    portrait: 'Doughnut portrait',
    dimensionsOf: '{name} dimensions',
    dataNeeded: 'Data needed',
    year: 'Year: {year}',
    source: 'Source: {source}',
    fullPortrait: 'Full portrait & discussion',
    level: {
      unknown: 'Unknown',
      noProblem: 'No problem',
      underControl: 'Under control',
      onTrack: 'On track',
      needsAttention: 'Needs attention',
      critical: 'Critical',
      severe: 'Severe',
    },
  },
  /** Doughnut Economics dimensions, by framework slug. */
  dimensions: {
    food: 'Food',
    health: 'Health',
    education: 'Education',
    'income-work': 'Income & Work',
    'water-sanitation': 'Water & Sanitation',
    energy: 'Energy',
    networks: 'Networks',
    housing: 'Housing',
    'gender-equality': 'Gender Equality',
    'social-equity': 'Social Equity',
    'political-voice': 'Political Voice',
    'peace-justice': 'Peace & Justice',
    'climate-change': 'Climate Change',
    'ocean-acidification': 'Ocean Acidification',
    'chemical-pollution': 'Chemical Pollution',
    'nitrogen-phosphorus-loading': 'Nitrogen & Phosphorus Loading',
    'freshwater-withdrawals': 'Freshwater Withdrawals',
    'land-conversion': 'Land Conversion',
    'biodiversity-loss': 'Biodiversity Loss',
    'air-pollution': 'Air Pollution',
    'ozone-depletion': 'Ozone Layer Depletion',
  },
  /** Geographic scale of a figure. */
  scales: {
    city: 'city',
    county: 'county',
    regional: 'regional',
    state: 'state',
    national: 'national',
    global: 'global',
  },
  /**
   * What an organization calls its portraits ("each borough"), as the
   * grammatical singular and plural (nominative) that fill `{noun}` and
   * `{nouns}` — not CLDR plural categories, which do not yield a nominative
   * plural in every language. Phrase sentences so these forms fit.
   */
  nouns: {
    portrait: { singular: 'portrait', plural: 'portraits' },
    borough: { singular: 'borough', plural: 'boroughs' },
    district: { singular: 'district', plural: 'districts' },
    ward: { singular: 'ward', plural: 'wards' },
    neighborhood: { singular: 'neighborhood', plural: 'neighborhoods' },
    county: { singular: 'county', plural: 'counties' },
  },
  status: {
    met: 'Met',
    on_track: 'On track',
    off_track: 'Off track',
    improving: 'Improving',
    worsening: 'Worsening',
    no_change: 'No change',
    baseline_only: 'Baseline only',
    no_target: 'No target',
    no_data: 'No data',
  },
  statusExplainer: {
    met: 'At or past the adopted target.',
    on_track: 'Moving toward the target at least as fast as a straight line from the baseline to the due date.',
    off_track: 'Improving, but slower than the pace the due date requires.',
    improving: 'Closer to the target than at the baseline (the goal has no due date).',
    worsening: 'Further from the target than at the baseline.',
    baseline_only: 'Only the baseline measurement exists so far; the next refresh will show the trend.',
  },
  portrait: {
    population: 'pop. {n}',
    clickHint: 'Select a segment for indicators, evidence, actions, and discussion.',
    demoHint: 'Demo data — set DATABASE_URL and publish versions for real content.',
  },
  dimension: {
    updated: 'updated {date}',
    target: 'target: {value}',
    noTarget: 'no target set',
    scaleData: '{scale} data',
    source: 'Source: {source}',
    snapshotAlt: 'Snapshot of the source for {name}, captured {date}',
    snapshotCaptured: 'Source snapshot captured {date}',
    originalDocument: 'original document',
    dataGap: 'Data gap',
    searchedAt: 'Searched at: {scales}',
    whatYouCanDo: 'What you can do',
  },
  discussion: {
    title: 'Discussion',
    sortTop: 'top',
    sortNew: 'new',
    sortLabel: 'Sort comments',
    placeholder: 'What should the city do about this? Keep it civil and on topic.',
    post: 'Post',
    pendingApproval: 'Posted — your first comment is awaiting moderator approval.',
    signInToJoin: '{link} to join the discussion.',
    empty: 'No comments yet.',
    you: 'you',
    locked: 'locked',
    removed: 'removed',
    removedBody: '[removed by moderators]',
    upvote: 'Agree',
    downvote: 'Disagree',
    score: 'Score {n}',
    reply: 'reply',
    replyLabel: 'Your reply',
    replySubmit: 'Reply',
    restore: 'restore',
    remove: 'remove',
    lock: 'lock',
    removeReason: 'Reason for removal (logged publicly to staff):',
    lockReason: 'Reason for locking this thread:',
  },
  progress: {
    metaTitle: 'Progress · {name}',
    metaDescription: 'How {name} is moving against its adopted goals.',
    title: 'Progress: {name}',
    baseline: 'Baseline:',
    intro:
      "Targets are the portrait's published thresholds — adopted local goals where they exist — and where a goal has a due date, progress is judged against a straight path from the baseline to that date.",
    nothingPublished: 'Nothing has been published for this portrait yet.',
    summary: 'Summary',
    tracked: 'indicators tracked',
    withDueDate: plural({ one: '{n} with a due date', other: '{n} with a due date' }),
    statusesMeaning: 'What the statuses mean',
    gapsTitle: "What we can't measure yet",
    gapsIntro:
      'Honest gaps: data no agency publishes at this geography. Each is a request — publishing it would let this portrait track it.',
    openData: 'Open data',
    openDataIntro: 'The same numbers, machine-readable, for open-data portals and council packets: {files}.',
    methodologyLink: 'Methodology: {link}.',
    thresholdsAndRationales: 'thresholds and rationales',
    columns: {
      indicator: 'Indicator',
      baseline: 'Baseline',
      latest: 'Latest',
      target: 'Target',
      status: 'Status',
      trend: 'Trend',
    },
    scaleFigure: '{scale} figure',
    earliest: '(earliest)',
    sameAsBaseline: 'same as baseline',
    byYear: 'by {year}',
    needsPerYear: 'needs {change} a year',
    trend: 'Trend: {points}',
    trendTarget: 'target {value}',
  },
  methodology: {
    title: 'Methodology',
    intro:
      'This portrait follows the Doughnut Economics downscaling approach: a social foundation (falling short is a shortfall, drawn toward the center) and an ecological ceiling (exceeding it is an overshoot, drawn outward). Every indicator has an explicit target with a written rationale, listed below. Where this portrait uses a target different from the framework default, the local rationale is shown.',
    geography: 'Geography',
    sourcePriority: 'Source priority',
    sourcePriorityIntro:
      'Data is accepted from the highest-priority tier available; a lower tier is used only when every higher tier has been exhausted.',
    recency: 'Recency',
    recencyText: plural({
      one: 'Data older than {n} year is treated as a data gap rather than reported as current.',
      other: 'Data older than {n} years is treated as a data gap rather than reported as current.',
    }),
    targets: 'Targets & rationales',
    target: 'target {value}',
    localTarget: 'Local target: {rationale}',
    frameworkDefault: 'Framework default was {target}: {rationale}',
    lastRefreshed: 'Last refreshed',
    contentInEnglish: 'Indicator names and rationales are published in English.',
  },
  outreach: {
    title: 'Get involved',
    empty:
      'Local organizations will be listed here as the portrait grows. In the meantime, each dimension page lists concrete actions.',
  },
  org: {
    portraitCount: plural({ one: '{n} portrait', other: '{n} portraits' }),
    portraits: 'Portraits',
    nothingPublished: 'Nothing published yet',
    outsideSafeSpace: plural({
      one: '{n} of {total} dimensions outside the safe space',
      other: '{n} of {total} dimensions outside the safe space',
    }),
    dataGaps: plural({ one: '{n} data gap', other: '{n} data gaps' }),
  },
  compare: {
    metaTitle: 'Compare · {org}',
    titleJurisdiction: '{n} doughnuts, one jurisdiction: {org}',
    titleFamily: '{n} doughnuts, one family: {org}',
    introJurisdiction:
      'The same social foundation and ecological ceiling, measured {n} times — the whole jurisdiction and each {noun} — against identical thresholds anchored in adopted local goals. Wedges pointing out overshoot the ceiling; wedges pointing in fall short of the foundation; gray is an honest data gap.',
    introFamily:
      'The same social foundation and ecological ceiling, measured {n} times against identical thresholds anchored in adopted local goals. Wedges pointing out overshoot the ceiling; wedges pointing in fall short of the foundation; gray is an honest data gap.',
    wedgesOutside: '{n}/{total} wedges outside the safe zone',
    divergeTitle: 'Where the {nouns} diverge most',
    divergeIntro:
      'Published indicators compared across {nouns}, ranked by the spread between the best- and worst-placed {noun}.',
    wholeColumn: 'The whole-jurisdiction column is its own published figure, not an average.',
    indicator: 'Indicator',
    spread: 'Spread',
    legend:
      'Red = the {noun} furthest from the target, green = closest, for each row. Jurisdiction-wide indicators (identical across {nouns}) drop out of this table by construction.',
  },
  insights: {
    metaTitle: 'Insights · {org}',
    title: 'Insights by {noun} · {org}',
    intro:
      'Every dimension, every {noun}, one matrix — measured against the same thresholds, anchored in adopted local goals. Select a dimension for the unrolled comparison and the research behind each number.',
    biggestDivides: 'Biggest divides',
    insideSafeZone: 'inside the safe zone',
    beyondBoundary: '{n} beyond the boundary',
    divide: '{worst} is {worstState}, while {best} is {bestState}.',
    matrix: 'The matrix',
    matrixIntro:
      'Green = inside the safe zone, red = shortfall or overshoot (darker is further out), gray = honest data gap. Select a row to unroll it.',
    dimension: 'Dimension',
    noData: 'no data',
    unrolled: '{name} — unrolled',
    dataGap: 'data gap',
    barsExplainer:
      "Bars measure distance from the boundary (the vertical line): left and green is inside the safe zone, right and red is shortfall or overshoot, on the doughnut's −100…150 scale.",
    researchBehind: 'The research behind it',
    fullDrilldown: 'full drilldown →',
    yearNA: 'year n/a',
    tier: 'tier {n}',
    confidence: 'confidence {value}',
    confidenceLevels: { high: 'high', medium: 'medium', low: 'low' },
    evidence: 'evidence',
    workedMath: 'worked math',
    gapLabel: '{indicator}: data gap',
    fullSearchTrail: '(full search trail)',
    selectPrompt:
      'Select a dimension above to unroll the comparison across {nouns} and inspect sources, evidence, and scoring.',
  },
  familyProgress: {
    metaTitle: 'Progress · {org}',
    title: 'Progress across {org}',
    introOne: 'Each adopted goal for the portrait, measured from a common baseline: {baseline}.',
    introMany: 'Each adopted goal for every {noun}, measured from a common baseline: {baseline}.',
    summaryByPortrait: 'Summary by portrait',
    onCourse: plural({ one: '{n} on course', other: '{n} on course' }),
    slipping: plural({ one: '{n} slipping', other: '{n} slipping' }),
    baselineOnly: plural({ one: '{n} baseline only', other: '{n} baseline only' }),
    matrixTitle: 'Goals by {noun}',
    goal: 'Goal',
    target: 'target {value}',
    targetBy: 'target {value} by {year}',
    nothingPublished: 'Nothing published yet.',
  },
  notFound: {
    title: 'Page not found',
    body: 'There is no portrait or page at this address. It may have moved, or the portrait may not be published yet.',
    home: 'Go home',
  },
};

export type Messages = typeof en;
