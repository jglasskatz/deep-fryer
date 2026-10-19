import type { Messages } from './en';

/** Haitian Creole (ht) — draft for certified review (docs/language-access.md). */
export const ht: Messages = {
  common: {
    updateAvailable: 'Gen yon nouvo vèsyon ki disponib.',
    reload: 'Rechaje',
    skipToContent: 'Ale dirèkteman nan kontni an',
    breadcrumb: 'Chemen navigasyon',
    mainNav: 'Navigasyon prensipal',
    menu: 'Meni',
    accountMenu: 'Meni kont ou',
    accountAndPortraits: 'Kont ak pòtre',
    installApp: 'Enstale aplikasyon an',
    signOut: 'Dekonekte',
    signIn: 'Konekte',
    back: '← {name}',
    noData: 'Pa gen done',
    updated: 'Mizajou: {date}',
    socialFoundation: 'Fondasyon sosyal',
    ecologicalCeiling: 'Plafon ekolojik',
    admin: 'Administrasyon',
  },
  nav: {
    progress: 'Pwogrè',
    methodology: 'Metodoloji',
    getInvolved: 'Patisipe',
    compare: 'Konpare',
    insights: 'Analiz',
    familyPortraits: 'Pòtre {org} yo',
  },
  language: {
    label: 'Lang',
    choose: 'Chwazi yon lang',
    contentNotice:
      'Tit ak eksplikasyon ki sou paj la tradui. Rezilta rechèch yo, sous yo ak kòmantè rezidan yo pibliye an angle.',
    help: 'Pou jwenn èd gratis nan lang ou, kontakte: {contact}',
  },
  doughnut: {
    chartLabel: 'Grafik Doughnut ki montre dimansyon fondasyon sosyal la ak plafon ekolojik la',
    summary:
      '{name}: {outside} sou {total} dimansyon deyò espas ki an sekirite e ki jis la. Apre sa, gen yon lis lyen pou chak dimansyon.',
    summaryWithGaps:
      '{name}: {outside} sou {total} dimansyon deyò espas ki an sekirite e ki jis la, {gaps} san done. Apre sa, gen yon lis lyen pou chak dimansyon.',
    portrait: 'Pòtre Doughnut',
    dimensionsOf: 'Dimansyon {name} yo',
    dataNeeded: 'Bezwen done',
    year: 'Ane: {year}',
    source: 'Sous: {source}',
    fullPortrait: 'Pòtre konplè ak diskisyon',
    /** The hint under the doughnut's hover tooltip. */
    clickForDetails: 'Klike pou wè detay yo',
    level: {
      unknown: 'Enkoni',
      noProblem: 'Pa gen pwoblèm',
      underControl: 'Anba kontwòl',
      onTrack: 'Sou bon chemen',
      needsAttention: 'Bezwen atansyon',
      critical: 'Kritik',
      severe: 'Grav anpil',
    },
  },
  /** Doughnut Economics dimensions, by framework slug. */
  dimensions: {
    food: 'Manje',
    health: 'Sante',
    education: 'Edikasyon',
    'income-work': 'Revni ak travay',
    'water-sanitation': 'Dlo ak asenisman',
    energy: 'Enèji',
    networks: 'Rezo',
    housing: 'Lojman',
    'gender-equality': 'Egalite ant fanm ak gason',
    'social-equity': 'Ekite sosyal',
    'political-voice': 'Vwa politik',
    'peace-justice': 'Lapè ak jistis',
    'climate-change': 'Chanjman klimatik',
    'ocean-acidification': 'Asidifikasyon oseyan yo',
    'chemical-pollution': 'Polisyon chimik',
    'nitrogen-phosphorus-loading': 'Chaj azòt ak fosfò',
    'freshwater-withdrawals': 'Prelèvman dlo dous',
    'land-conversion': 'Konvèsyon tè',
    'biodiversity-loss': 'Pèt divèsite byolojik',
    'air-pollution': 'Polisyon lè',
    'ozone-depletion': 'Diminisyon kouch ozòn nan',
  },
  /**
   * Geographic scale of a figure. Each label completes "nivo …" ("done nivo
   * vil", "chif nivo konte") and also reads on its own in a comma-separated
   * list.
   */
  scales: {
    city: 'vil',
    county: 'konte',
    regional: 'rejyonal',
    state: 'eta',
    national: 'nasyonal',
    global: 'mondyal',
  },
  /**
   * Creole marks the plural with the determiner "yo", not on the noun, so the
   * bare noun serves as both forms; sentences add "yo" after `{nouns}` where
   * the definite plural is meant. No sentence puts a sound-dependent
   * determiner (a/la/an/nan) directly after `{noun}`.
   */
  nouns: {
    portrait: { singular: 'pòtre', plural: 'pòtre' },
    borough: { singular: 'awondisman', plural: 'awondisman' },
    district: { singular: 'distri', plural: 'distri' },
    ward: { singular: 'distri elektoral', plural: 'distri elektoral' },
    neighborhood: { singular: 'katye', plural: 'katye' },
    county: { singular: 'konte', plural: 'konte' },
  },
  status: {
    met: 'Sib atenn',
    on_track: 'Sou bon chemen',
    off_track: 'An reta',
    improving: 'Ap amelyore',
    worsening: 'Ap vin pi mal',
    no_change: 'Pa gen chanjman',
    baseline_only: 'Pwen depa sèlman',
    no_target: 'Pa gen sib',
    no_data: 'Pa gen done',
  },
  statusExplainer: {
    met: 'Rive oswa depase sib ki te adopte a.',
    on_track:
      'Ap avanse vè sib la omwen ak menm vitès ak yon liy dwat ki soti nan pwen depa a rive nan dat limit la.',
    off_track: 'Ap amelyore, men pi dousman pase vitès dat limit la mande.',
    improving: 'Pi pre sib la pase nan pwen depa a (objektif la pa gen dat limit).',
    worsening: 'Pi lwen sib la pase nan pwen depa a.',
    baseline_only:
      'Pou kounye a, se sèlman mezi pwen depa a ki egziste; pwochen mizajou a ap montre evolisyon an.',
  },
  portrait: {
    metaDescription: 'Pòtre Doughnut {name}: fondasyon sosyal ak plafon ekolojik, ak sous ki dèyè chak chif.',
    population: 'popilasyon: {n}',
    clickHint: 'Chwazi yon segman pou wè endikatè yo, prèv yo, aksyon yo ak diskisyon an.',
    demoHint: 'Done demonstrasyon — mete DATABASE_URL epi pibliye vèsyon yo pou wè vrè kontni an.',
    /** The visible list of dimensions under the doughnut (SPEC-v6 §2.1). */
    exploreTitle: 'Gade dimansyon yo',
    exploreIntro: 'Chak dimansyon gen done li, sous li, fason pou w patisipe, ak yon diskisyon.',
    /** The list's intro when the portrait has no discussion (SPEC-v7 §3). */
    exploreIntroCore: 'Chak dimansyon gen done li, sous li, ak sa ou ka fè.',
    /** The detail panel beside the doughnut (SPEC-v7 §2) — the Santa Cruz core view. */
    panelEmpty: 'Chwazi yon dimansyon sou Doughnut la oswa nan lis la pou w wè done li, sous li, ak sa ou ka fè.',
    panelClose: 'Fèmen',
    panelSelected: 'N ap montre {name}',
    openFull: 'Louvri paj konplè a',
    openFullDiscussion: 'Louvri paj konplè a ak diskisyon an',
    moreListings: {
      one: '{n} lòt fason pou w patisipe sou paj konplè a',
      other: '{n} lòt fason pou w patisipe sou paj konplè a',
    },
    legendTitle: 'Kijan pou w li Doughnut la',
    legendSafe: 'Sèk vèt: espas ki an sekirite e ki jis la',
    legendShortfall: 'Wouj vè mitan an: yon defisi, anba fondasyon sosyal la',
    legendOvershoot: 'Wouj deyò sèk la: yon depasman, pi wo pase plafon ekolojik la',
    legendNoData: 'Gri: poko gen done',
  },
  dimension: {
    metaDescription: '{dimension} nan {name}: done yo, sous yo, ak sa ou ka fè.',
    updated: 'mizajou: {date}',
    target: 'sib: {value}',
    noTarget: 'pa gen sib ki fikse',
    scaleData: 'done nivo {scale}',
    source: 'Sous: {source}',
    snapshotAlt: 'Imaj sous pou {name}, pran {date}',
    snapshotCaptured: 'Imaj sous la pran {date}',
    originalDocument: 'dokiman orijinal la',
    dataGap: 'Mank done',
    searchedAt: 'Nivo nou chèche: {scales}',
    whatYouCanDo: 'Sa ou ka fè',
    /** Short actions listed after the dimension's involvement listings. */
    moreYouCanDo: 'Lòt bagay ou ka fè',
  },
  discussion: {
    title: 'Diskisyon',
    sortTop: 'pi popilè',
    sortNew: 'pi resan',
    sortLabel: 'Klase kòmantè yo',
    placeholder: 'Kisa vil la ta dwe fè sou sa? Tanpri rete respektye epi pa soti nan sijè a.',
    post: 'Pibliye',
    pendingApproval: 'Pibliye — premye kòmantè ou ap tann apwobasyon yon moderatè.',
    signInToJoin: '{link} pou patisipe nan diskisyon an.',
    empty: 'Poko gen kòmantè.',
    you: 'ou',
    locked: 'bloke',
    removed: 'retire',
    removedBody: '[moderatè yo retire li]',
    upvote: 'Dakò',
    downvote: 'Pa dakò',
    score: 'Pwen: {n}',
    reply: 'reponn',
    replyLabel: 'Repons ou',
    replySubmit: 'Reponn',
    restore: 'remèt',
    remove: 'retire',
    lock: 'bloke',
    removeReason: 'Rezon ou retire kòmantè a (n ap anrejistre l nan yon jounal anplwaye yo ka wè):',
    lockReason: 'Rezon ou bloke diskisyon sa a:',
    /** A first comment held for a moderator (SPEC-v6 §3.1). Shown to its author and to moderators only. */
    awaitingApproval: 'Ap tann apwobasyon',
    awaitingNote: 'Se sèlman ou menm ak moderatè yo ki ka wè kòmantè sa a jiskaske yo apwouve l.',
    approve: 'apwouve',
    decline: 'refize',
    /** A held comment moderators did not approve; only its author and the moderators see it. */
    declined: 'Pa apwouve',
    declinedNote: 'Moderatè yo pa apwouve kòmantè sa a. Se sèlman ou menm ak moderatè yo ki ka wè l.',
    /** Label beside a comment written by the portrait's team (SPEC-v6 §3.3). */
    staff: 'Anplwaye',
    staffTitle: 'Manm ekip pòtre sa a',
  },
  progress: {
    metaTitle: 'Pwogrè · {name}',
    metaDescription: 'Kijan {name} ap avanse parapò ak objektif li te adopte yo.',
    title: 'Pwogrè: {name}',
    baseline: 'Pwen depa:',
    intro:
      'Sib yo se limit pòtre a pibliye — objektif lokal ki te adopte yo, lè yo egziste — epi, lè yon objektif gen yon dat limit, nou mezire pwogrè a parapò ak yon chemen dwat ki soti nan pwen depa a rive nan dat sa a.',
    nothingPublished: 'Poko gen anyen ki pibliye pou pòtre sa a.',
    summary: 'Rezime',
    tracked: 'endikatè nou swiv',
    withDueDate: { one: '{n} ki gen yon dat limit', other: '{n} ki gen yon dat limit' },
    statusesMeaning: 'Sa estati yo vle di',
    gapsTitle: 'Sa nou poko ka mezire',
    gapsIntro:
      'Nou rekonèt mank sa yo kareman: done okenn ajans pa pibliye pou zòn jeyografik sa a. Chak mank se yon demann — si yo ta pibliye done sa yo, pòtre sa a ta ka swiv yo.',
    openData: 'Done ouvè',
    openDataIntro:
      'Menm chif yo, nan yon fòma òdinatè ka li, pou pòtay done ouvè ak dosye konsèy minisipal la: {files}.',
    methodologyLink: 'Metodoloji: {link}.',
    thresholdsAndRationales: 'limit ak jistifikasyon',
    columns: {
      indicator: 'Endikatè',
      baseline: 'Pwen depa',
      latest: 'Pi resan',
      target: 'Sib',
      status: 'Estati',
      trend: 'Tandans',
    },
    scaleFigure: 'chif nivo {scale}',
    earliest: '(premye done ki disponib)',
    sameAsBaseline: 'menm ak pwen depa a',
    byYear: 'pou {year}',
    needsPerYear: 'bezwen {change} chak ane',
    trend: 'Tandans: {points}',
    trendTarget: 'sib {value}',
  },
  methodology: {
    metaDescription: 'Kijan yo mezire pòtre {name}: zòn jeyografik, sous, ak chak sib ak jistifikasyon li.',
    title: 'Metodoloji',
    intro:
      'Pòtre sa a swiv metòd Doughnut Economics la pou aplike modèl la a nivo lokal: yon fondasyon sosyal (lè yon kote pa rive ladan l, se yon defisi, ki desine vè mitan an) ak yon plafon ekolojik (lè yon kote depase l, se yon depasman, ki desine vè deyò). Chak endikatè gen yon sib klè ak yon jistifikasyon ekri, ki parèt anba a. Lè pòtre sa a sèvi ak yon sib ki diferan de sib pa defo kad la, nou montre jistifikasyon lokal la.',
    geography: 'Zòn jeyografik',
    sourcePriority: 'Priyorite sous yo',
    sourcePriorityIntro:
      'Nou aksepte done ki soti nan nivo priyorite ki pi wo ki disponib la; nou sèvi ak yon nivo ki pi ba sèlman lè nou fin chèche nan tout nivo ki pi wo yo.',
    recency: 'Laj done yo',
    recencyText: {
      one: 'Lè done gen plis pase {n} an, nou konsidere yo kòm yon mank done olye nou prezante yo kòm done aktyèl.',
      other: 'Lè done gen plis pase {n} an, nou konsidere yo kòm yon mank done olye nou prezante yo kòm done aktyèl.',
    },
    targets: 'Sib ak jistifikasyon',
    target: 'sib {value}',
    localTarget: 'Sib lokal: {rationale}',
    frameworkDefault: 'Sib pa defo kad la se te {target}: {rationale}',
    lastRefreshed: 'Dènye mizajou',
    contentInEnglish: 'Non endikatè yo ak jistifikasyon yo pibliye an angle.',
  },
  outreach: {
    metaDescription: 'Fason pou w patisipe nan {name}, ak òganizasyon k ap travay sou done li yo.',
    title: 'Patisipe',
    empty:
      'N ap mete òganizasyon lokal yo isit la pandan pòtre a ap grandi. Antretan, chak paj dimansyon gen aksyon konkrè ou ka fè.',
    intro: 'Pwogram, òganizasyon ak ajans piblik kote ou ka patisipe, klase pa dimansyon. Anplwaye yo tcheke chak non ki nan lis la anvan li parèt isit la.',
    /** Organizations working on the portrait's data (research contacts), when any are published. */
    partnersTitle: 'Òganizasyon k ap travay sou done sa yo',
  },
  /** Ways to get involved and the organization form (SPEC-v6 §4). */
  involvement: {
    title: 'Kijan pou w patisipe',
    kind: {
      volunteer: 'Fè travay volontè',
      services: 'Jwenn èd oswa enskri',
      civic: 'Bay opinyon w',
      organize: 'Antre nan yon gwoup',
      other: 'Patisipe',
    },
    website: 'Sit entènèt',
    call: 'Rele {phone}',
    /** {date} is a formatted date. */
    checked: 'Lyen an tcheke nan dat {date}',
    forEveryDimension: 'Pou tout dimansyon yo',
    filterLabel: 'Dimansyon',
    filterAll: 'Tout dimansyon yo',
    none: 'Poko gen anyen nan lis la pou dimansyon sa a.',
    noneAtAll: 'Poko gen anyen nan lis la.',
    contentInEnglish: 'Se anplwaye yo ki ekri lis la, epi yo pibliye l an angle.',
    formTitle: 'Ou konnen yon fason pou moun patisipe?',
    /** On a dimension page; {dimension} is the dimension's name. */
    formIntro: 'Èske òganizasyon ou se yon bon fason pou moun patisipe nan zafè {dimension}? Oswa èske ou gen yon sijesyon? Di anplwaye yo — yo gade tout sa moun voye anvan yo pibliye anyen.',
    formIntroGeneral: 'Èske òganizasyon ou se yon bon fason pou moun patisipe? Oswa èske ou gen yon sijesyon? Di anplwaye yo — yo gade tout sa moun voye anvan yo pibliye anyen.',
    open: 'Sijere yon fason pou moun patisipe',
    kindLegend: 'Kisa ou vle pataje?',
    kindListing: 'Òganizasyon mwen se yon fason pou moun patisipe',
    kindSuggestion: 'Yon sijesyon sou kijan moun ka patisipe',
    dimensionLabel: 'Dimansyon',
    dimensionAny: 'Plizyè, oswa mwen pa sèten',
    orgName: 'Non òganizasyon an oswa gwoup la',
    about: 'Prezante òganizasyon ou',
    aboutHint: 'Kisa òganizasyon ou fè, ak ki moun li sèvi.',
    pitchListing: 'Poukisa se yon bon fason pou moun patisipe?',
    pitchListingHint: 'Kisa moun ka fè ak òganizasyon ou — fè travay volontè, vin manm, vin nan aktivite, jwenn èd?',
    pitchSuggestion: 'Sijesyon ou',
    pitchSuggestionHint: 'Kijan moun ta ka patisipe nan sa?',
    websiteLabel: 'Sit entènèt',
    contactLegend: 'Kijan anplwaye yo ka kontakte w',
    contactName: 'Non ou',
    email: 'Imèl',
    phone: 'Telefòn',
    optional: '(si ou vle)',
    privacy: 'Se sèlman anplwaye yo ki resevwa enfòmasyon kontak ou. Nou p ap janm pibliye yo.',
    send: 'Voye bay anplwaye yo',
    sending: 'N ap voye…',
    thanks: 'Mèsi. Anplwaye yo gade tout sa moun voye. Si sa ou voye a bon pou paj sa a, l ap parèt isit la, epi yo ka kontakte w anvan.',
    sendAnother: 'Voye yon lòt',
    /** Above the form when fields need fixing; each field also shows its own message. */
    invalid: 'Tanpri tcheke kote ki make anba a.',
    websiteInvalid: 'Ekri tout adrès sit entènèt la, ki kòmanse ak https:// — pa egzanp https://example.org.',
    phoneInvalid: 'Sèvi sèlman ak chif ak separatè abityèl yo, tankou (212) 555-0100, san ekstansyon ni lòt mo.',
    tooFast: 'Sa te twò vit. Tanpri tann yon ti moman, epi voye l ankò.',
    rateLimited: 'Twòp fòmilè soti isit la jodi a. Tanpri eseye ankò pita.',
    expired: 'Fòmilè sa a ekspire. Rechaje paj la, epi eseye ankò.',
    failed: 'Nou pa t ka voye l. Tanpri eseye ankò.',
  },
  /**
   * Asking for a portrait in another language while its translation is off
   * (SPEC-v7 §3.5). Shown in the reader's preferred language even though the
   * page itself is English. {language} is a language's own name (Español).
   */
  translationRequest: {
    button: 'Mande yon tradiksyon',
    intro: 'Pòtre sa a pibliye an angle. Di anplwaye yo ki lang ou bezwen — yo wè konbyen moun ki mande chak lang.',
    language: 'Lang',
    send: 'Voye demann nan',
    sending: 'N ap voye…',
    sent: 'Mèsi. Anplwaye yo ap wè yon moun te mande lang sa a: {language}.',
    limited:
      'Twòp demann soti nan rezo sa a nan dènye èdtan an, kidonk nou pa t anrejistre demann sa a. Tanpri eseye ankò pita.',
    notNeeded: 'Pòtre sa a fèk tradui. Rechaje paj la pou w chwazi lang ou.',
    failed: 'Nou pa t ka voye demann nan. Tanpri eseye ankò.',
  },
  /** The sign-in page (SPEC-v6 §2.2). */
  login: {
    title: 'Konekte',
    intro: 'Rezidan yo konekte pou yo patisipe nan diskisyon yon pòtre. Anplwaye vil la sèvi ak kont travay yo.',
    /** Replaces `intro` when the person is on the way to setting up their city's portrait (/start): city staff, not residents. */
    startIntro: 'Konekte pou w kreye Doughnut vil ou a — sèvi ak imèl travay ou.',
    microsoft: 'Kontinye ak Microsoft (kont travay)',
    google: 'Kontinye ak Google',
    emailLabel: 'Resevwa yon lyen pou konekte pa imèl',
    emailPlaceholder: 'ou@example.org',
    send: 'Voye lyen an',
    sending: 'N ap voye…',
    noMethods: 'Pa gen okenn fason pou konekte ki konfigire sou sèvè sa a.',
    /** {link} is the "start a portrait" link. */
    newHere: 'Èske ou se anplwaye vil la? Apre ou fin konekte, ou ka {link}.',
    startLink: 'kreye yon pòtre pou jiridiksyon ou',
    checkTitle: 'Tcheke imèl ou',
    checkBody: 'Nou voye yon lyen pou konekte nan adrès ou te antre a. Li mache yon sèl fwa, epi li ekspire nan 15 minit.',
    checkHelp: 'Ou pa wè l apre kèk minit? Tcheke dosye spam ou, oswa voye yon lòt lyen.',
    sendAnother: 'Voye yon lòt lyen',
    errors: {
      OAuthAccountNotLinked: 'Ou te deja konekte ak imèl sa a yon lòt fason. Sèvi ak menm fason ou te konekte anvan an (oswa yon lyen pa imèl), epi apre sa, ajoute sèvis sa a nan paj kont ou.',
      Verification: 'Lyen pou konekte sa a ekspire oswa yo te deja sèvi avè l. Mande yon nouvo lyen.',
      AccessDenied: 'Yo refize koneksyon an.',
      Configuration: 'Koneksyon an pa byen konfigire sou sèvè sa a. Kontakte administratè sit la.',
      EmailSignin: 'Nou pa t ka voye imèl pou konekte a. Tcheke adrès la epi eseye ankò nan kèk minit.',
      /** Nothing was sent: this address already has three unused sign-in links from the last 15 minutes. */
      TooManyLinks:
        'Nou deja voye plizyè lyen pou konekte nan adrès sa a nan 15 dènye minit yo. Sèvi ak lyen ki pi resan an, oswa eseye ankò nan 15 minit.',
      /** Nothing was sent: this network has asked for its hourly share of sign-in emails (shared Wi-Fi counts as one). */
      TooManyEmails:
        'Gen twòp demann imèl pou konekte ki soti nan rezo sa a, kidonk nou pa t voye imèl sa a. Tanpri eseye ankò nan yon èdtan.',
      default: 'Koneksyon an pa mache. Eseye ankò.',
    },
  },
  org: {
    portraitCount: { one: '{n} pòtre', other: '{n} pòtre' },
    portraits: 'Pòtre',
    nothingPublished: 'Poko gen anyen ki pibliye',
    outsideSafeSpace: {
      one: '{n} sou {total} dimansyon deyò espas ki an sekirite a',
      other: '{n} sou {total} dimansyon deyò espas ki an sekirite a',
    },
    dataGaps: { one: '{n} mank done', other: '{n} mank done' },
  },
  compare: {
    metaTitle: 'Konpare · {org}',
    titleJurisdiction: '{n} Doughnut, yon sèl jiridiksyon: {org}',
    titleFamily: '{n} Doughnut, yon sèl fanmi: {org}',
    introJurisdiction:
      'Menm fondasyon sosyal la ak menm plafon ekolojik la, mezire {n} fwa — tout jiridiksyon an ak chak {noun} — ak menm limit yo, ki baze sou objektif lokal ki te adopte yo. Segman ki pwente deyò yo depase plafon an; segman ki pwente anndan yo pa rive nan fondasyon an; gri vle di gen yon mank done nou rekonèt.',
    introFamily:
      'Menm fondasyon sosyal la ak menm plafon ekolojik la, mezire {n} fwa ak menm limit yo, ki baze sou objektif lokal ki te adopte yo. Segman ki pwente deyò yo depase plafon an; segman ki pwente anndan yo pa rive nan fondasyon an; gri vle di gen yon mank done nou rekonèt.',
    wedgesOutside: '{n}/{total} segman deyò zòn ki an sekirite a',
    divergeTitle: 'Kote diferans ant {nouns} yo pi gwo',
    divergeIntro:
      'Endikatè ki pibliye yo, konpare ant {nouns} yo, klase dapre diferans ant {noun} ki pi byen plase a ak sa ki pi mal plase a.',
    wholeColumn: 'Kolòn tout jiridiksyon an se yon chif ki pibliye apa, se pa yon mwayèn.',
    indicator: 'Endikatè',
    spread: 'Diferans',
    legend:
      'Wouj = {noun} ki pi lwen sib la, vèt = sa ki pi pre a, pou chak liy. Endikatè ki valab pou tout jiridiksyon an (ki menm pou tout {nouns} yo) pa parèt nan tablo sa a, akoz fason li fèt.',
  },
  insights: {
    metaTitle: 'Analiz · {org}',
    title: 'Analiz pa {noun} · {org}',
    intro:
      'Chak dimansyon, chak {noun}, nan yon sèl tablo — mezire ak menm limit yo, ki baze sou objektif lokal ki te adopte yo. Chwazi yon dimansyon pou wè konparezon an an detay ak rechèch ki dèyè chak chif.',
    biggestDivides: 'Pi gwo diferans yo',
    insideSafeZone: 'anndan zòn ki an sekirite a',
    beyondBoundary: 'depase limit la ak {n} pwen',
    divide: '{worst} {worstState}, alòske {best} {bestState}.',
    matrix: 'Matris la',
    matrixIntro:
      'Vèt = anndan zòn ki an sekirite a, wouj = defisi oswa depasman (plis koulè a fonse, plis li lwen), gri = mank done nou rekonèt. Chwazi yon liy pou wè l an detay.',
    dimension: 'Dimansyon',
    noData: 'pa gen done',
    unrolled: '{name} — an detay',
    dataGap: 'mank done',
    barsExplainer:
      'Ba yo mezire distans ak limit la (liy vètikal la): sou bò goch ak an vèt, se anndan zòn ki an sekirite a; sou bò dwat ak an wouj, se defisi oswa depasman, sou echèl −100…150 Doughnut la.',
    researchBehind: 'Rechèch ki dèyè sa',
    fullDrilldown: 'tout detay yo →',
    yearNA: 'ane pa disponib',
    tier: 'nivo {n}',
    confidence: 'konfyans: {value}',
    confidenceLevels: { high: 'wo', medium: 'mwayen', low: 'ba' },
    evidence: 'prèv',
    workedMath: 'kalkil detaye',
    gapLabel: '{indicator}: mank done',
    fullSearchTrail: '(tout rechèch ki fèt yo)',
    selectPrompt:
      'Chwazi yon dimansyon anlè a pou wè konparezon ant {nouns} yo an detay epi pou egzamine sous yo, prèv yo ak fason yo bay pwen yo.',
  },
  familyProgress: {
    metaTitle: 'Pwogrè · {org}',
    title: 'Pwogrè nan tout {org}',
    introOne: 'Chak objektif ki te adopte pou pòtre a, mezire apati yon pwen depa komen: {baseline}.',
    introMany: 'Chak objektif ki te adopte pou chak {noun}, mezire apati yon pwen depa komen: {baseline}.',
    summaryByPortrait: 'Rezime pa pòtre',
    onCourse: { one: '{n} sou bon chemen', other: '{n} sou bon chemen' },
    slipping: { one: '{n} an reta', other: '{n} an reta' },
    baselineOnly: { one: '{n} ak pwen depa sèlman', other: '{n} ak pwen depa sèlman' },
    matrixTitle: 'Objektif pa {noun}',
    goal: 'Objektif',
    target: 'sib {value}',
    targetBy: 'sib {value} pou {year}',
    nothingPublished: 'Poko gen anyen ki pibliye.',
  },
  notFound: {
    title: 'Nou pa jwenn paj la',
    body: 'Pa gen okenn pòtre ni paj nan adrès sa a. Petèt yo deplase li, oswa petèt pòtre a poko pibliye.',
    home: 'Ale nan paj dakèy la',
  },
  /** Emergency view (SPEC-v5 §3): official alerts, threats by risk, plans, help. */
  emergency: {
    navLabel: 'Ijans',
    metaTitle: 'Ijans · {name}',
    title: 'Ijans ak dezas: {name}',
    intro:
      'Alèt ofisyèl yo, menas zòn sa a ap fè fas ak yo, plan ki deja an plas yo, ak kote pou jwenn èd.',
    empty: 'Pòtre sa a poko pibliye enfòmasyon sou ijans.',
    alertsTitle: 'Alèt aktif yo',
    alertsNone: 'Nan dat {time}, pa gen okenn alèt move tan ki aktif pou zòn sa a.',
    alertsChecked: 'Dènye verifikasyon: {time}.',
    alertsStale:
      'Dènyèman, nou pa t ka jwenn aksè nan sous ofisyèl alèt yo. Tanpri tcheke dirèkteman nan Sèvis Meteyo Nasyonal la.',
    alertsSavedCopy:
      'Sa a se yon kopi paj la ki anrejistre. Dènye fwa nou te verifye alèt yo se te {time}, e yo ka chanje depi lè sa a. Tanpri tcheke dirèkteman nan Sèvis Meteyo Nasyonal la.',
    alertsNotConfigured: 'Alèt ofisyèl yo poko konfigire pou pòtre sa a.',
    alertsOriginal: 'Alèt yo parèt egzakteman jan yo te pibliye yo, an angle.',
    alertSource: 'Se {source} ki pibliye l',
    alertWindow: 'Depi {start} jiska {end}',
    alertFrom: 'Apati {start}',
    alertInstructions: 'Sa pou w fè',
    alertDetails: 'Tout tèks alèt la',
    alertLink: 'Alèt ofisyèl la',
    alertEnded: 'Fini',
    severity: {
      Extreme: 'Ekstrèm',
      Severe: 'Grav',
      Moderate: 'Modere',
      Minor: 'Minè',
      Unknown: 'Gravite enkoni',
    },
    getAlerts: 'Resevwa alèt ofisyèl yo',
    emergencyCall: 'Si gen yon ijans, rele {phone}.',
    infoCall: 'Pou jwenn èd ki pa yon ijans, rele {phone}.',
    threatsTitle: 'Menas dapre nivo risk yo',
    threatsIntro:
      'Ki chans chak menas genyen pou l rive ak ki jan li ta ka grav, dapre evalyasyon anplwaye vil la, ak ki pati nan Doughnut la li mete an danje.',
    likelihood: 'Pwobabilite: {n} sou 5',
    severityRating: 'Gravite: {n} sou 5',
    risk: {
      low: 'Risk ba',
      moderate: 'Risk mwayen',
      high: 'Risk wo',
      very_high: 'Risk trè wo',
    },
    activeNow: 'Alèt aktif kounye a',
    threatens: 'Dimansyon ki an danje:',
    dimensionImpact: '{dimension} ({impact})',
    impactLevel: {
      low: 'ti enpak',
      moderate: 'enpak mwayen',
      high: 'gwo enpak',
    },
    hazardKind: {
      coastal_storm: 'Tanpèt kotyè',
      flooding: 'Inondasyon',
      extreme_heat: 'Chalè ekstrèm',
      winter_weather: 'Move tan livè',
      high_winds: 'Gwo van',
      air_quality: 'Move kalite lè',
      drought: 'Sechrès',
      wildfire: 'Dife forè',
      earthquake: 'Tranblemanntè',
      infectious_disease: 'Maladi kontajye',
      infrastructure_failure: 'Pàn enfrastrikti',
      other: 'Lòt menas',
    },
    showOnDoughnut: 'Montre sou Doughnut la',
    doughnutNow: 'Jodi a',
    doughnutThreat: 'An danje akoz: {hazard}',
    doughnutLabel: 'Pòtre Doughnut ki make dimansyon ki an danje akoz {hazard}',
    doughnutControls: 'Afichaj Doughnut la',
    play: 'Jwe',
    pause: 'Poz',
    relatedPlans: 'Plan pou menas sa a:',
    plansTitle: 'Plan ki deja an plas',
    plansIntro: 'Plan vil la te adopte pou menas sa yo: sa li angaje l pou l fè.',
    planBy: '{agency}, {year}',
    planAgency: '{agency}',
    planLanguages: 'Pibliye tou nan lang sa yo: {languages}',
    readPlan: 'Li plan an',
    helpTitle: 'Èd ak gwoup èd mityèl',
    helpIntro: 'Kote ak gwoup ki bay èd pandan yon ijans.',
    resourceKind: {
      cooling_center: 'Sant rafrechisman',
      shelter: 'Abri',
      hotline: 'Liy dirèk',
      mutual_aid: 'Èd mityèl',
      food: 'Manje',
      medical: 'Swen medikal',
      other: 'Lòt èd',
    },
    call: 'Rele {phone}',
    website: 'Sit entènèt',
    offlineTitle: 'Kenbe paj sa a pou w ka itilize l san koneksyon',
    offlineBody:
      'Anrejistre paj sa a pou l ka louvri menm san koneksyon, an ka rezo a ta tonbe.',
    offlineSave: 'Anrejistre pou itilize san koneksyon',
    offlineSaved:
      'Paj la anrejistre. L ap louvri menm san koneksyon. Yon kopi ki anrejistre pa mete tèt li ajou poukont li: alèt ki ladan l yo se sa ki te la dènye fwa ou te louvri l ak koneksyon.',
    offlineUnavailable: 'Navigatè sa a pa ka anrejistre paj pou itilize san koneksyon.',
    offlineSaving: 'N ap anrejistre…',
    offlineFailed: 'Nou pa t ka anrejistre paj sa a. Eseye ankò pandan ou gen koneksyon.',
    offlineUpdate:
      'Aplikasyon sa a gen yon mizajou k ap tann, e li pa ka anrejistre paj jiskaske mizajou a aplike. Rechaje paj la, epi eseye ankò.',
    offlineSignedIn:
      'Paj yo anrejistre sou aparèy sa a sèlman lè ou pa konekte nan kont ou, konsa kont ou rete prive sou òdinatè plizyè moun itilize.',
    metaDescription: 'Alèt ofisyèl, menas, plan ak èd pou {name}.',
    contentInEnglish:
      'Se anplwaye yo ki ekri menas yo, plan yo ak lis èd yo, epi yo pibliye yo an angle. Alèt yo parèt jan Sèvis Meteyo Nasyonal la (National Weather Service) te pibliye yo.',
    alertArea: 'Zòn: {areas}',
    alertRelated: 'Menas ki gen rapò: {hazard}',
    signupLink: 'Enskri pou resevwa alèt ofisyèl',
    signupNamed: 'Enskri nan {name}',
    resourceHazards: 'Itil pandan:',
    doughnutLegend: 'Koulè sou Doughnut la:',
  },
  /** The site footer, on every page but embeds (components/site-footer/SiteFooter.tsx). */
  footer: {
    /** The footer's navigation landmark. */
    label: 'Konsènan sit sa a',
    /** {email} is the support address of whoever runs this site, as a link. */
    contact: 'Kontak: {email}',
    accessibility: 'Aksesiblite',
    privacy: 'Konfidansyalite',
    terms: 'Kondisyon itilizasyon',
    /**
     * The Doughnut's attribution (docs/OPEN-SOURCE.md §3.3), also under every
     * embedded doughnut. {license} is the license's name as a link; {book}
     * and {method} are the English titles of the book and the method guide.
     * Keep all three, and keep the people's and the organization's names.
     */
    credit:
      'Dyagram Doughnut la: Kate Raworth ak Christian Guthier, {license}, adapte ak done lokal (Raworth, {book}, 2017). Metòd pòtre vil yo baze sou {method}, yon gid Doughnut Economics Action Lab. Sit sa a pa afilye ak Doughnut Economics Action Lab, e òganizasyon sa a pa apiye l non plis.',
  },
  /**
   * On a portrait seeded with synthetic values (scripts/seed-demo-data.ts):
   * its page, its dimension pages, its embed, its organization's compare,
   * insights and progress pages, so a screenshot cannot pass for research.
   */
  sampleData: {
    title: 'Done egzanp — se pa rezilta rechèch',
    /** A portrait's own pages and its embed; {name} is the portrait. */
    body: 'Yo te kreye chif ki parèt pou {name} sou sit sa a pou montre kijan lojisyèl la mache. Chif sa yo pa soti nan okenn mezi, e ou pa dwe site yo.',
    /** An organization's pages, when any portrait shown there is seeded; {org} is the organization. */
    bodyOrg:
      'Yo te kreye kèk oswa tout chif ki parèt pou {org} sou paj sa a pou montre kijan lojisyèl la mache. Chif sa yo pa soti nan okenn mezi, e ou pa dwe site yo.',
  },
  /** Theme toggle and the fryer (SPEC-v5 §4). */
  theme: {
    label: 'Tèm',
    /** The toggle's accessible name, and the status message after a flip. */
    toggle: 'Tèm: {mode}',
    /** The toggle's description and hover title. {system} is the "Match device" item's label. */
    hint: 'Chanje ant klè ak fonse. Pou “{system}” ak lòt opsyon, peze epi kenbe, klike ak bouton dwat la, oswa peze Shift+F10.',
    light: 'Klè',
    dark: 'Fonse',
    system: 'Swiv aparèy la',
    menu: 'Opsyon tèm',
    deepFry: 'Fri paj sa a',
    unfry: 'Defri paj sa a',
    fried: 'Paj la fri. Chwazi “Defri paj sa a” pou anile sa.',
    unfried: 'Paj la retounen nòmal.',
  },
};
