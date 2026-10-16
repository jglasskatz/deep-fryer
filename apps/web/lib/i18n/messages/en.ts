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
    /** Service worker update notice (shown on every page). */
    updateAvailable: 'A new version is available.',
    reload: 'Reload',
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
    /** The visible list of dimensions under the doughnut (SPEC-v6 §2.1). */
    exploreTitle: 'Explore the dimensions',
    exploreIntro: 'Each dimension has its data, sources, ways to get involved, and a discussion.',
    /** The detail panel beside the doughnut (SPEC-v7 §2) — the Santa Cruz core view. */
    panelEmpty: 'Select a dimension on the doughnut or in the list to see its data, its sources, and what you can do.',
    panelClose: 'Close',
    panelSelected: 'Showing {name}',
    openFull: 'Open the full page',
    openFullDiscussion: 'Open the full page and discussion',
    legendTitle: 'How to read the doughnut',
    legendSafe: 'Green ring: the safe and just space',
    legendShortfall: 'Red toward the centre: a shortfall below the social foundation',
    legendOvershoot: 'Red outside the ring: an overshoot of the ecological ceiling',
    legendNoData: 'Grey: no data yet',
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
    /** Short actions listed after the dimension's involvement listings. */
    moreYouCanDo: 'More things you can do',
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
    /** A first comment held for a moderator (SPEC-v6 §3.1). Shown to its author and to moderators only. */
    awaitingApproval: 'Awaiting approval',
    awaitingNote: 'Only you and the moderators can see this until it is approved.',
    approve: 'approve',
    decline: 'decline',
    /** A held comment moderators did not approve; only its author and the moderators see it. */
    declined: 'Not approved',
    declinedNote: 'The moderators did not approve this comment. Only you and the moderators can see it.',
    /** Label beside a comment written by the portrait's team (SPEC-v6 §3.3). */
    staff: 'Staff',
    staffTitle: 'Member of this portrait’s team',
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
    intro: 'Programs, organizations, and public bodies where you can take part, by dimension. Staff check each listing before it appears here.',
    /** Organizations working on the portrait's data (research contacts), when any are published. */
    partnersTitle: 'Organizations working on this data',
  },
  /** Ways to get involved and the organization form (SPEC-v6 §4). */
  involvement: {
    title: 'How to get involved',
    kind: {
      volunteer: 'Volunteer',
      services: 'Get help or enroll',
      civic: 'Have your say',
      organize: 'Join a group',
      other: 'Get involved',
    },
    website: 'Website',
    call: 'Call {phone}',
    /** {date} is a formatted date. */
    checked: 'Link checked {date}',
    forEveryDimension: 'For every dimension',
    filterLabel: 'Dimension',
    filterAll: 'All dimensions',
    none: 'No listings for this dimension yet.',
    noneAtAll: 'No listings yet.',
    contentInEnglish: 'Listings are written by staff and published in English.',
    formTitle: 'Know a way to get involved?',
    /** On a dimension page; {dimension} is the dimension's name. */
    formIntro:
      'Is your organization a good way for people to get involved with {dimension}? Or do you have a suggestion? Tell staff — they review every submission before anything is published.',
    formIntroGeneral:
      'Is your organization a good way for people to get involved? Or do you have a suggestion? Tell staff — they review every submission before anything is published.',
    open: 'Suggest a way to get involved',
    kindLegend: 'What are you sharing?',
    kindListing: 'My organization is a way to get involved',
    kindSuggestion: 'A suggestion for how people can get involved',
    dimensionLabel: 'Dimension',
    dimensionAny: 'Several, or not sure',
    orgName: 'Organization or group name',
    about: 'Who you are',
    aboutHint: 'What your organization does, and who it serves.',
    pitchListing: 'Why is it a good way for people to get involved?',
    pitchListingHint: 'What can people do with you — volunteer, join, attend, get help?',
    pitchSuggestion: 'Your suggestion',
    pitchSuggestionHint: 'How could people get involved with this?',
    websiteLabel: 'Website',
    contactLegend: 'How staff can reach you',
    contactName: 'Your name',
    email: 'Email',
    phone: 'Phone',
    optional: '(optional)',
    privacy: 'Your contact details go only to staff and are never published.',
    send: 'Send to staff',
    sending: 'Sending…',
    thanks:
      'Thank you. Staff review every submission. If it is a good fit it will appear on this page, and they may contact you first.',
    sendAnother: 'Send another',
    /** Above the form when fields need fixing; each field also shows its own message. */
    invalid: 'Please check the fields marked below.',
    tooFast: 'That was very quick. Please wait a moment, then send again.',
    rateLimited: 'Too many submissions from here today. Please try again later.',
    expired: 'This form has expired. Reload the page and try again.',
    failed: 'We could not send that. Please try again.',
  },
  /**
   * Asking for a portrait in another language while its translation is off
   * (SPEC-v7 §3.5). Shown in the reader's preferred language even though the
   * page itself is English. {language} is a language's own name (Español).
   */
  translationRequest: {
    button: 'Request a translation',
    intro: 'This portrait is published in English. Tell the staff which language you need — they see how many readers ask for each one.',
    language: 'Language',
    send: 'Send request',
    sending: 'Sending…',
    sent: 'Thank you. Staff will see that a reader asked for {language}.',
    limited: 'Thank you — your requests are recorded. Please try again later.',
    failed: 'We could not send that. Please try again.',
  },
  /** The sign-in page (SPEC-v6 §2.2). */
  login: {
    title: 'Sign in',
    intro: 'Residents sign in to join a portrait’s discussion. City staff use their work account.',
    microsoft: 'Continue with Microsoft (work account)',
    google: 'Continue with Google',
    emailLabel: 'Email me a sign-in link',
    emailPlaceholder: 'you@example.org',
    send: 'Send link',
    sending: 'Sending…',
    noMethods: 'No sign-in method is configured on this server.',
    /** {link} is the "start a portrait" link. */
    newHere: 'Are you city staff? After signing in you can {link}.',
    startLink: 'start a portrait for your jurisdiction',
    checkTitle: 'Check your email',
    checkBody: 'We sent a sign-in link to the address you entered. It works once and expires in 15 minutes.',
    checkHelp: 'Not there after a few minutes? Check your spam folder, or send another link.',
    sendAnother: 'Send another link',
    errors: {
      OAuthAccountNotLinked:
        'That email already signed in another way. Use the method you used before (or an email link), then link this provider from your account page.',
      Verification: 'That sign-in link has expired or was already used. Request a new one.',
      AccessDenied: 'Sign-in was declined.',
      Configuration: 'Sign-in is misconfigured on this server. Contact the site administrator.',
      EmailSignin: 'We could not send the sign-in email. Check the address and try again in a few minutes.',
      default: 'Sign-in failed. Try again.',
    },
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
  /** Emergency view (SPEC-v5 §3): official alerts, threats by risk, plans, help. */
  emergency: {
    navLabel: 'Emergencies',
    metaTitle: 'Emergencies · {name}',
    title: 'Emergencies and disasters: {name}',
    intro:
      'Official alerts, the threats this area faces, the plans already in place, and where to get help.',
    empty: 'This portrait has not published emergency information yet.',
    alertsTitle: 'Active alerts',
    alertsNone: 'No active weather alerts for this area as of {time}.',
    alertsChecked: 'Last checked {time}.',
    alertsStale:
      'We could not reach the official alert feed recently. Check the National Weather Service directly.',
    alertsSavedCopy:
      'This is a saved copy of the page. Alerts were last checked {time} and may have changed since. Check the National Weather Service directly.',
    alertsNotConfigured: 'Official alerts are not set up for this portrait yet.',
    alertsOriginal: 'Alerts are shown exactly as issued, in English.',
    alertSource: 'Issued by {source}',
    alertWindow: '{start} until {end}',
    alertFrom: 'From {start}',
    alertInstructions: 'What to do',
    alertDetails: 'Full alert text',
    alertLink: 'Official alert',
    alertEnded: 'Ended',
    severity: {
      Extreme: 'Extreme',
      Severe: 'Severe',
      Moderate: 'Moderate',
      Minor: 'Minor',
      Unknown: 'Severity unknown',
    },
    getAlerts: 'Get official alerts',
    emergencyCall: 'In an emergency, call {phone}.',
    infoCall: 'For non-emergency help, call {phone}.',
    threatsTitle: 'Threats by risk',
    threatsIntro:
      'How likely each threat is and how severe it would be, as rated by city staff, and which parts of the doughnut it puts at risk.',
    likelihood: 'Likelihood {n} of 5',
    severityRating: 'Severity {n} of 5',
    risk: {
      low: 'Low risk',
      moderate: 'Moderate risk',
      high: 'High risk',
      very_high: 'Very high risk',
    },
    activeNow: 'Alert active now',
    threatens: 'Puts at risk:',
    dimensionImpact: '{dimension} ({impact})',
    impactLevel: {
      low: 'low impact',
      moderate: 'moderate impact',
      high: 'high impact',
    },
    hazardKind: {
      coastal_storm: 'Coastal storm',
      flooding: 'Flooding',
      extreme_heat: 'Extreme heat',
      winter_weather: 'Winter weather',
      high_winds: 'High winds',
      air_quality: 'Poor air quality',
      drought: 'Drought',
      wildfire: 'Wildfire',
      earthquake: 'Earthquake',
      infectious_disease: 'Infectious disease',
      infrastructure_failure: 'Infrastructure failure',
      other: 'Other threat',
    },
    showOnDoughnut: 'Show on the doughnut',
    doughnutNow: 'Today',
    doughnutThreat: 'At risk from: {hazard}',
    doughnutLabel: 'Doughnut portrait marking the dimensions put at risk by {hazard}',
    doughnutControls: 'Doughnut view',
    play: 'Play',
    pause: 'Pause',
    relatedPlans: 'Plans for this threat:',
    plansTitle: 'Plans already in place',
    plansIntro: 'Plans the city has adopted for these threats: what it has committed to do.',
    planBy: '{agency}, {year}',
    planAgency: '{agency}',
    planLanguages: 'Also published in: {languages}',
    readPlan: 'Read the plan',
    helpTitle: 'Help and mutual aid',
    helpIntro: 'Places and groups that help during an emergency.',
    resourceKind: {
      cooling_center: 'Cooling center',
      shelter: 'Shelter',
      hotline: 'Hotline',
      mutual_aid: 'Mutual aid',
      food: 'Food',
      medical: 'Medical care',
      other: 'Other help',
    },
    call: 'Call {phone}',
    website: 'Website',
    offlineTitle: 'Keep this page for offline use',
    offlineBody:
      'Save this page so it opens even without a connection, in case the network goes down.',
    offlineSave: 'Save for offline',
    offlineSaved:
      'Saved. This page will open without a connection. A saved copy does not update itself: its alerts are as of the last time you opened it online.',
    offlineUnavailable: 'This browser cannot save pages for offline use.',
    offlineSaving: 'Saving…',
    offlineFailed: 'This page could not be saved. Try again while you have a connection.',
    offlineUpdate: 'This app has an update waiting and cannot save pages until it is applied. Reload the page, then try again.',
    offlineSignedIn:
      'Pages are saved on this device only when you are signed out, so your account stays private on shared computers.',
    metaDescription: 'Official alerts, threats, plans, and help for {name}.',
    contentInEnglish:
      'Threats, plans, and help listings are written by staff and published in English. Alerts are shown as the National Weather Service issued them.',
    alertArea: 'Areas: {areas}',
    alertRelated: 'Related threat: {hazard}',
    signupLink: 'Sign up for official alerts',
    signupNamed: 'Sign up for {name}',
    resourceHazards: 'Helps with:',
    doughnutLegend: 'Colors on the doughnut:',
  },
  /** Theme toggle and the fryer (SPEC-v5 §4). */
  theme: {
    label: 'Theme',
    /** The toggle's accessible name, and the status message after a flip. */
    toggle: 'Theme: {mode}',
    /** The toggle's description and hover title. {system} is the "Match device" item's label. */
    hint: 'Switches between light and dark. For {system} and more, press and hold, right-click, or press Shift+F10.',
    light: 'Light',
    dark: 'Dark',
    system: 'Match device',
    menu: 'Theme options',
    deepFry: 'Deep fry this page',
    unfry: 'Un-fry this page',
    fried: 'Page deep fried. Choose “Un-fry this page” to undo.',
    unfried: 'Page restored.',
  },
};

export type Messages = typeof en;
