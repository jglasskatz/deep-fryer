import type { Messages } from './en';

/** Spanish (es) — draft for certified review (docs/language-access.md). */
export const es: Messages = {
  common: {
    updateAvailable: 'Hay una nueva versión disponible.',
    reload: 'Recargar',
    skipToContent: 'Ir al contenido',
    breadcrumb: 'Ruta de navegación',
    mainNav: 'Navegación principal',
    menu: 'Menú',
    accountMenu: 'Menú de la cuenta',
    accountAndPortraits: 'Cuenta y retratos',
    installApp: 'Instalar la aplicación',
    signOut: 'Cerrar sesión',
    signIn: 'Iniciar sesión',
    back: '← {name}',
    noData: 'Sin datos',
    updated: 'Actualizado: {date}',
    socialFoundation: 'Base social',
    ecologicalCeiling: 'Techo ecológico',
    admin: 'Administración',
  },
  nav: {
    progress: 'Progreso',
    methodology: 'Metodología',
    getInvolved: 'Participe',
    compare: 'Comparar',
    insights: 'Análisis',
    familyPortraits: 'Retratos de {org}',
  },
  language: {
    label: 'Idioma',
    choose: 'Elija un idioma',
    contentNotice:
      'Los títulos y las explicaciones de la página están traducidos. Los resultados de investigación, las fuentes y los comentarios de los residentes se publican en inglés.',
    help: 'Para obtener ayuda gratuita en su idioma, comuníquese con: {contact}',
  },
  doughnut: {
    chartLabel: 'Gráfico de rosquilla con las dimensiones de la base social y del techo ecológico',
    summary:
      '{name}: {outside} de {total} dimensiones fuera del espacio seguro y justo. A continuación se incluye una lista de enlaces a cada dimensión.',
    summaryWithGaps:
      '{name}: {outside} de {total} dimensiones fuera del espacio seguro y justo; {gaps} sin datos. A continuación se incluye una lista de enlaces a cada dimensión.',
    portrait: 'Retrato Doughnut',
    dimensionsOf: 'Dimensiones de {name}',
    dataNeeded: 'Se necesitan datos',
    year: 'Año: {year}',
    source: 'Fuente: {source}',
    fullPortrait: 'Retrato completo y debate',
    /** The hint under the doughnut's hover tooltip. */
    clickForDetails: 'Haga clic para ver los detalles',
    level: {
      unknown: 'Desconocido',
      noProblem: 'Sin problemas',
      underControl: 'Bajo control',
      onTrack: 'En buen camino',
      needsAttention: 'Requiere atención',
      critical: 'Crítico',
      severe: 'Muy grave',
    },
  },
  /** Doughnut Economics dimensions, by framework slug. */
  dimensions: {
    food: 'Alimentación',
    health: 'Salud',
    education: 'Educación',
    'income-work': 'Ingresos y trabajo',
    'water-sanitation': 'Agua y saneamiento',
    energy: 'Energía',
    networks: 'Redes',
    housing: 'Vivienda',
    'gender-equality': 'Igualdad de género',
    'social-equity': 'Equidad social',
    'political-voice': 'Voz política',
    'peace-justice': 'Paz y justicia',
    'climate-change': 'Cambio climático',
    'ocean-acidification': 'Acidificación de los océanos',
    'chemical-pollution': 'Contaminación química',
    'nitrogen-phosphorus-loading': 'Carga de nitrógeno y fósforo',
    'freshwater-withdrawals': 'Extracción de agua dulce',
    'land-conversion': 'Conversión de tierras',
    'biodiversity-loss': 'Pérdida de biodiversidad',
    'air-pollution': 'Contaminación del aire',
    'ozone-depletion': 'Agotamiento de la capa de ozono',
  },
  /**
   * Geographic scale of a figure. Each label completes "a escala …"
   * ("datos a escala municipal", "cifra a escala de condado") and also reads
   * on its own in a comma-separated list.
   */
  scales: {
    city: 'municipal',
    county: 'de condado',
    regional: 'regional',
    state: 'estatal',
    national: 'nacional',
    global: 'mundial',
  },
  /**
   * All nouns are masculine, so sentences may use "el"/"los" before
   * `{noun}`/`{nouns}`.
   */
  nouns: {
    portrait: { singular: 'retrato', plural: 'retratos' },
    borough: { singular: 'distrito municipal', plural: 'distritos municipales' },
    district: { singular: 'distrito', plural: 'distritos' },
    ward: { singular: 'distrito electoral', plural: 'distritos electorales' },
    neighborhood: { singular: 'vecindario', plural: 'vecindarios' },
    county: { singular: 'condado', plural: 'condados' },
  },
  status: {
    met: 'Meta alcanzada',
    on_track: 'En buen camino',
    off_track: 'Con retraso',
    improving: 'Mejorando',
    worsening: 'Empeorando',
    no_change: 'Sin cambios',
    baseline_only: 'Solo línea de base',
    no_target: 'Sin meta',
    no_data: 'Sin datos',
  },
  statusExplainer: {
    met: 'Alcanzó o superó la meta adoptada.',
    on_track:
      'Avanza hacia la meta al menos al ritmo de una trayectoria en línea recta desde la línea de base hasta la fecha límite.',
    off_track: 'Está mejorando, pero a un ritmo más lento del que exige la fecha límite.',
    improving: 'Está más cerca de la meta que en la línea de base (el objetivo no tiene fecha límite).',
    worsening: 'Está más lejos de la meta que en la línea de base.',
    baseline_only:
      'Por ahora solo existe la medición de la línea de base; la próxima actualización mostrará la tendencia.',
  },
  portrait: {
    metaDescription: 'El retrato Doughnut de {name}: la base social y el techo ecológico, con la fuente de cada cifra.',
    population: 'población: {n}',
    clickHint: 'Seleccione un segmento para ver indicadores, evidencia, acciones y el debate.',
    demoHint: 'Datos de demostración: configure DATABASE_URL y publique versiones para ver contenido real.',
    /** The visible list of dimensions under the doughnut (SPEC-v6 §2.1). */
    exploreTitle: 'Explore las dimensiones',
    exploreIntro: 'Cada dimensión tiene sus datos, sus fuentes, formas de participar y un debate.',
    /** The list's intro when the portrait has no discussion (SPEC-v7 §3). */
    exploreIntroCore: 'Cada dimensión tiene sus datos, sus fuentes y lo que usted puede hacer.',
    /** The detail panel beside the doughnut (SPEC-v7 §2) — the Santa Cruz core view. */
    panelEmpty: 'Seleccione una dimensión en la rosquilla o en la lista para ver sus datos, sus fuentes y lo que usted puede hacer.',
    panelClose: 'Cerrar',
    panelSelected: 'Se muestra: {name}',
    openFull: 'Abrir la página completa',
    openFullDiscussion: 'Abrir la página completa y el debate',
    moreListings: {
      one: 'Ver {n} forma más de participar en la página completa',
      many: 'Ver {n} formas más de participar en la página completa',
      other: 'Ver {n} formas más de participar en la página completa',
    },
    legendTitle: 'Cómo leer la rosquilla',
    legendSafe: 'Anillo verde: el espacio seguro y justo',
    legendShortfall: 'Rojo hacia el centro: un déficit, por debajo de la base social',
    legendOvershoot: 'Rojo fuera del anillo: una extralimitación, por encima del techo ecológico',
    legendNoData: 'Gris: todavía no hay datos',
  },
  dimension: {
    metaDescription: '{dimension} en {name}: los datos, sus fuentes y lo que usted puede hacer.',
    updated: 'actualizado: {date}',
    target: 'meta: {value}',
    noTarget: 'sin meta establecida',
    scaleData: 'datos a escala {scale}',
    source: 'Fuente: {source}',
    snapshotAlt: 'Captura de la fuente de {name}, tomada el {date}',
    snapshotCaptured: 'Captura de la fuente tomada el {date}',
    originalDocument: 'documento original',
    dataGap: 'Vacío de datos',
    searchedAt: 'Escalas consultadas: {scales}',
    whatYouCanDo: 'Lo que usted puede hacer',
    /** Short actions listed after the dimension's involvement listings. */
    moreYouCanDo: 'Otras cosas que usted puede hacer',
  },
  discussion: {
    title: 'Debate',
    sortTop: 'más votados',
    sortNew: 'más recientes',
    sortLabel: 'Ordenar comentarios',
    placeholder: '¿Qué debería hacer la ciudad al respecto? Mantenga un tono respetuoso y no se aparte del tema.',
    post: 'Publicar',
    pendingApproval: 'Publicado — su primer comentario está pendiente de la aprobación de un moderador.',
    signInToJoin: '{link} para participar en el debate.',
    empty: 'Todavía no hay comentarios.',
    you: 'usted',
    locked: 'bloqueado',
    removed: 'eliminado',
    removedBody: '[eliminado por los moderadores]',
    upvote: 'De acuerdo',
    downvote: 'En desacuerdo',
    score: 'Puntuación: {n}',
    reply: 'responder',
    replyLabel: 'Su respuesta',
    replySubmit: 'Responder',
    restore: 'restaurar',
    remove: 'eliminar',
    lock: 'bloquear',
    removeReason: 'Motivo de la eliminación (queda registrado y visible para el personal):',
    lockReason: 'Motivo para bloquear este hilo:',
    /** A first comment held for a moderator (SPEC-v6 §3.1). Shown to its author and to moderators only. */
    awaitingApproval: 'Pendiente de aprobación',
    awaitingNote: 'Solo usted y los moderadores pueden ver este comentario hasta que se apruebe.',
    approve: 'aprobar',
    decline: 'rechazar',
    /** A held comment moderators did not approve; only its author and the moderators see it. */
    declined: 'No aprobado',
    declinedNote: 'Los moderadores no aprobaron este comentario. Solo usted y los moderadores pueden verlo.',
    /** Label beside a comment written by the portrait's team (SPEC-v6 §3.3). */
    staff: 'Equipo',
    staffTitle: 'Miembro del equipo de este retrato',
  },
  progress: {
    metaTitle: 'Progreso · {name}',
    metaDescription: 'Cómo avanza {name} hacia los objetivos que adoptó.',
    title: 'Progreso: {name}',
    baseline: 'Línea de base:',
    intro:
      'Las metas son los umbrales publicados del retrato —objetivos locales adoptados, cuando existen— y, cuando un objetivo tiene fecha límite, el progreso se evalúa respecto a una trayectoria en línea recta desde la línea de base hasta esa fecha.',
    nothingPublished: 'Todavía no se ha publicado nada para este retrato.',
    summary: 'Resumen',
    tracked: 'indicadores con seguimiento',
    withDueDate: {
      one: '{n} con fecha límite',
      many: '{n} con fecha límite',
      other: '{n} con fecha límite',
    },
    statusesMeaning: 'Qué significan los estados',
    gapsTitle: 'Lo que aún no podemos medir',
    gapsIntro:
      'Vacíos de datos que reconocemos abiertamente: datos que ninguna agencia publica para esta zona geográfica. Cada uno es una solicitud: si se publicaran, este retrato podría darles seguimiento.',
    openData: 'Datos abiertos',
    openDataIntro:
      'Las mismas cifras, en formato legible por máquina, para portales de datos abiertos y documentos del Concejo Municipal: {files}.',
    methodologyLink: 'Metodología: {link}.',
    thresholdsAndRationales: 'umbrales y justificaciones',
    columns: {
      indicator: 'Indicador',
      baseline: 'Línea de base',
      latest: 'Más reciente',
      target: 'Meta',
      status: 'Estado',
      trend: 'Tendencia',
    },
    scaleFigure: 'cifra a escala {scale}',
    earliest: '(primer dato disponible)',
    sameAsBaseline: 'igual que la línea de base',
    byYear: 'para {year}',
    needsPerYear: 'requiere {change} al año',
    trend: 'Tendencia: {points}',
    trendTarget: 'meta {value}',
  },
  methodology: {
    metaDescription: 'Cómo se mide el retrato de {name}: ámbito geográfico, fuentes y cada meta con su justificación.',
    title: 'Metodología',
    intro:
      'Este retrato sigue el enfoque de Doughnut Economics (Economía Rosquilla) para llevar el modelo a escala local: una base social (no alcanzarla es un déficit, que se dibuja hacia el centro) y un techo ecológico (sobrepasarlo es una extralimitación, que se dibuja hacia afuera). Cada indicador tiene una meta explícita con una justificación por escrito, que se detalla a continuación. Cuando este retrato usa una meta distinta de la predeterminada del marco, se muestra la justificación local.',
    geography: 'Ámbito geográfico',
    sourcePriority: 'Prioridad de las fuentes',
    sourcePriorityIntro:
      'Se aceptan datos del nivel de prioridad más alto disponible; solo se recurre a un nivel inferior cuando se han agotado todos los niveles superiores.',
    recency: 'Actualidad de los datos',
    recencyText: {
      one: 'Los datos con más de {n} año de antigüedad se consideran un vacío de datos en lugar de presentarse como actuales.',
      many: 'Los datos con más de {n} años de antigüedad se consideran un vacío de datos en lugar de presentarse como actuales.',
      other:
        'Los datos con más de {n} años de antigüedad se consideran un vacío de datos en lugar de presentarse como actuales.',
    },
    targets: 'Metas y justificaciones',
    target: 'meta {value}',
    localTarget: 'Meta local: {rationale}',
    frameworkDefault: 'La meta predeterminada del marco era {target}: {rationale}',
    lastRefreshed: 'Última actualización',
    contentInEnglish: 'Los nombres y las justificaciones de los indicadores se publican en inglés.',
  },
  outreach: {
    metaDescription: 'Formas de participar en {name} y organizaciones que trabajan con sus datos.',
    title: 'Participe',
    empty:
      'A medida que el retrato crezca, aquí aparecerán organizaciones locales. Mientras tanto, la página de cada dimensión incluye acciones concretas.',
    intro: 'Programas, organizaciones y organismos públicos en los que usted puede participar, por dimensión. El personal revisa cada uno antes de que aparezca aquí.',
    /** Organizations working on the portrait's data (research contacts), when any are published. */
    partnersTitle: 'Organizaciones que trabajan con estos datos',
  },
  /** Ways to get involved and the organization form (SPEC-v6 §4). */
  involvement: {
    title: 'Cómo participar',
    kind: {
      volunteer: 'Haga voluntariado',
      services: 'Obtenga ayuda o inscríbase',
      civic: 'Dé su opinión',
      organize: 'Únase a un grupo',
      other: 'Participe',
    },
    website: 'Sitio web',
    call: 'Llamar al {phone}',
    /** {date} is a formatted date. */
    checked: 'Enlace verificado el {date}',
    forEveryDimension: 'Para todas las dimensiones',
    filterLabel: 'Dimensión',
    filterAll: 'Todas las dimensiones',
    none: 'Todavía no hay opciones de participación para esta dimensión.',
    noneAtAll: 'Todavía no hay opciones de participación.',
    contentInEnglish: 'El personal redacta estas opciones de participación y las publica en inglés.',
    formTitle: '¿Conoce una forma de participar?',
    /** On a dimension page; {dimension} is the dimension's name. */
    formIntro: '¿Su organización ofrece a las personas una buena forma de participar en temas de {dimension}? ¿O tiene una sugerencia? Cuénteselo al personal, que revisa cada propuesta antes de publicar cualquier cosa.',
    formIntroGeneral: '¿Su organización ofrece a las personas una buena forma de participar? ¿O tiene una sugerencia? Cuénteselo al personal, que revisa cada propuesta antes de publicar cualquier cosa.',
    open: 'Sugiera una forma de participar',
    kindLegend: '¿Qué desea compartir?',
    kindListing: 'Mi organización ofrece una forma de participar',
    kindSuggestion: 'Una sugerencia sobre cómo pueden participar las personas',
    dimensionLabel: 'Dimensión',
    dimensionAny: 'Varias, o no lo sé',
    orgName: 'Nombre de la organización o del grupo',
    about: 'Quiénes son ustedes',
    aboutHint: 'Qué hace su organización y a quién atiende.',
    pitchListing: '¿Por qué es una buena forma de participar?',
    pitchListingHint: '¿Qué pueden hacer las personas con ustedes: hacer voluntariado, hacerse miembros, asistir a actividades, recibir ayuda?',
    pitchSuggestion: 'Su sugerencia',
    pitchSuggestionHint: '¿Cómo podrían participar las personas en esto?',
    websiteLabel: 'Sitio web',
    contactLegend: 'Cómo puede comunicarse el personal con usted',
    contactName: 'Su nombre',
    email: 'Correo electrónico',
    phone: 'Teléfono',
    optional: '(opcional)',
    privacy: 'Sus datos de contacto solo llegan al personal y nunca se publican.',
    send: 'Enviar al personal',
    sending: 'Enviando…',
    thanks: 'Gracias. El personal revisa cada propuesta. Si es adecuada, aparecerá en esta página, y es posible que el personal se comunique antes con usted.',
    sendAnother: 'Enviar otra propuesta',
    /** Above the form when fields need fixing; each field also shows its own message. */
    invalid: 'Revise los campos marcados más abajo.',
    websiteInvalid: 'Escriba la dirección web completa, que empiece por https://; por ejemplo, https://example.org.',
    phoneInvalid:
      'Use solo números y los separadores habituales, como en (212) 555-0100, sin extensión ni otras palabras.',
    tooFast: 'Eso fue muy rápido. Espere un momento y vuelva a enviarlo.',
    rateLimited: 'Hoy se enviaron demasiadas propuestas desde aquí. Vuelva a intentarlo más tarde.',
    expired: 'Este formulario venció. Recargue la página e inténtelo de nuevo.',
    failed: 'No pudimos enviarlo. Vuelva a intentarlo.',
  },
  /**
   * Asking for a portrait in another language while its translation is off
   * (SPEC-v7 §3.5). Shown in the reader's preferred language even though the
   * page itself is English. {language} is a language's own name (Español).
   */
  translationRequest: {
    button: 'Solicitar una traducción',
    intro: 'Este retrato se publica en inglés. Dígale al personal qué idioma necesita: el personal puede ver cuántas personas piden cada idioma.',
    language: 'Idioma',
    send: 'Enviar solicitud',
    sending: 'Enviando…',
    sent: 'Gracias. El personal verá que una persona pidió este idioma: {language}.',
    limited:
      'Llegaron demasiadas solicitudes desde esta red en la última hora, así que esta no quedó registrada. Vuelva a intentarlo más tarde.',
    notNeeded: 'Este retrato se acaba de traducir. Recargue la página para elegir su idioma.',
    failed: 'No pudimos enviar la solicitud. Vuelva a intentarlo.',
  },
  /** The sign-in page (SPEC-v6 §2.2). */
  login: {
    title: 'Iniciar sesión',
    intro: 'Los residentes inician sesión para participar en el debate de un retrato. El personal de la ciudad usa su cuenta de trabajo.',
    /** Replaces `intro` when the person is on the way to setting up their city's portrait (/start): city staff, not residents. */
    startIntro: 'Inicie sesión con su correo electrónico de trabajo para configurar la rosquilla de su ciudad.',
    microsoft: 'Continuar con Microsoft (cuenta de trabajo)',
    google: 'Continuar con Google',
    emailLabel: 'Reciba por correo electrónico un enlace para iniciar sesión',
    emailPlaceholder: 'nombre@example.org',
    send: 'Enviar enlace',
    sending: 'Enviando…',
    noMethods: 'No hay ningún método de inicio de sesión configurado en este servidor.',
    /** {link} is the "start a portrait" link. */
    newHere: '¿Trabaja para la ciudad? Después de iniciar sesión, puede {link}.',
    startLink: 'crear un retrato para su jurisdicción',
    checkTitle: 'Revise su correo electrónico',
    checkBody: 'Enviamos un enlace para iniciar sesión a la dirección que ingresó. Solo funciona una vez y vence en 15 minutos.',
    checkHelp: '¿No le llegó después de unos minutos? Revise su carpeta de correo no deseado (spam) o envíe otro enlace.',
    sendAnother: 'Enviar otro enlace',
    errors: {
      OAuthAccountNotLinked: 'Ese correo electrónico ya se usó para iniciar sesión de otra forma. Use el mismo método que usó antes (o un enlace por correo electrónico) y luego vincule este proveedor desde la página de su cuenta.',
      Verification: 'Ese enlace para iniciar sesión venció o ya se usó. Solicite uno nuevo.',
      AccessDenied: 'Se rechazó el inicio de sesión.',
      Configuration: 'El inicio de sesión no está bien configurado en este servidor. Comuníquese con el administrador del sitio.',
      EmailSignin: 'No pudimos enviar el correo electrónico para iniciar sesión. Revise la dirección y vuelva a intentarlo en unos minutos.',
      /** Nothing was sent: this address already has three unused sign-in links from the last 15 minutes. */
      TooManyLinks:
        'Ya enviamos varios enlaces para iniciar sesión a esta dirección en los últimos 15 minutos. Use el más reciente o vuelva a intentarlo dentro de 15 minutos.',
      /** Nothing was sent: this network has asked for its hourly share of sign-in emails (shared Wi-Fi counts as one). */
      TooManyEmails:
        'Se solicitaron demasiados correos electrónicos para iniciar sesión desde esta red, así que este no se envió. Vuelva a intentarlo dentro de una hora.',
      default: 'No se pudo iniciar sesión. Vuelva a intentarlo.',
    },
  },
  org: {
    portraitCount: { one: '{n} retrato', many: '{n} retratos', other: '{n} retratos' },
    portraits: 'Retratos',
    nothingPublished: 'Aún no se ha publicado nada',
    outsideSafeSpace: {
      one: '{n} de {total} dimensiones fuera del espacio seguro',
      many: '{n} de {total} dimensiones fuera del espacio seguro',
      other: '{n} de {total} dimensiones fuera del espacio seguro',
    },
    dataGaps: { one: '{n} vacío de datos', many: '{n} vacíos de datos', other: '{n} vacíos de datos' },
  },
  compare: {
    metaTitle: 'Comparar · {org}',
    titleJurisdiction: '{n} rosquillas, una jurisdicción: {org}',
    titleFamily: '{n} rosquillas, una familia: {org}',
    introJurisdiction:
      'La misma base social y el mismo techo ecológico, medidos {n} veces —la jurisdicción completa y cada {noun}— con umbrales idénticos basados en objetivos locales adoptados. Los segmentos que apuntan hacia afuera sobrepasan el techo; los que apuntan hacia adentro no alcanzan la base; el gris indica un vacío de datos reconocido.',
    introFamily:
      'La misma base social y el mismo techo ecológico, medidos {n} veces con umbrales idénticos basados en objetivos locales adoptados. Los segmentos que apuntan hacia afuera sobrepasan el techo; los que apuntan hacia adentro no alcanzan la base; el gris indica un vacío de datos reconocido.',
    wedgesOutside: '{n}/{total} segmentos fuera de la zona segura',
    divergeTitle: 'Mayores diferencias entre {nouns}',
    divergeIntro:
      'Indicadores publicados, comparados entre {nouns} y ordenados según la diferencia entre el {noun} mejor ubicado y el peor ubicado.',
    wholeColumn: 'La columna de la jurisdicción completa es una cifra publicada por separado, no un promedio.',
    indicator: 'Indicador',
    spread: 'Diferencia',
    legend:
      'Rojo = el {noun} más alejado de la meta; verde = el más cercano, en cada fila. Los indicadores que abarcan toda la jurisdicción (idénticos en todos los {nouns}) no aparecen en esta tabla por definición.',
  },
  insights: {
    metaTitle: 'Análisis · {org}',
    title: 'Análisis por {noun} · {org}',
    intro:
      'Cada dimensión y cada {noun} en una sola matriz, medidos con los mismos umbrales basados en objetivos locales adoptados. Seleccione una dimensión para ver la comparación desplegada y la investigación detrás de cada cifra.',
    biggestDivides: 'Mayores brechas',
    insideSafeZone: 'dentro de la zona segura',
    beyondBoundary: '{n} puntos más allá del límite',
    divide: '{worst} está {worstState}, mientras que {best} está {bestState}.',
    matrix: 'La matriz',
    matrixIntro:
      'Verde = dentro de la zona segura; rojo = déficit o extralimitación (cuanto más oscuro, más lejos del límite); gris = vacío de datos reconocido. Seleccione una fila para desplegarla.',
    dimension: 'Dimensión',
    noData: 'sin datos',
    unrolled: '{name} — vista desplegada',
    dataGap: 'vacío de datos',
    barsExplainer:
      'Las barras miden la distancia respecto al límite (la línea vertical): a la izquierda y en verde, dentro de la zona segura; a la derecha y en rojo, déficit o extralimitación, en la escala −100…150 de la rosquilla.',
    researchBehind: 'La investigación detrás de los datos',
    fullDrilldown: 'detalle completo →',
    yearNA: 'año no disponible',
    tier: 'nivel {n}',
    confidence: 'confianza: {value}',
    confidenceLevels: { high: 'alta', medium: 'media', low: 'baja' },
    evidence: 'evidencia',
    workedMath: 'cálculo detallado',
    gapLabel: '{indicator}: vacío de datos',
    fullSearchTrail: '(registro completo de la búsqueda)',
    selectPrompt:
      'Seleccione una dimensión arriba para desplegar la comparación entre {nouns} y revisar las fuentes, la evidencia y la puntuación.',
  },
  familyProgress: {
    metaTitle: 'Progreso · {org}',
    title: 'Progreso en {org}',
    introOne: 'Cada objetivo adoptado para el retrato, medido desde una línea de base común: {baseline}.',
    introMany: 'Cada objetivo adoptado para cada {noun}, medido desde una línea de base común: {baseline}.',
    summaryByPortrait: 'Resumen por retrato',
    onCourse: { one: '{n} en buen camino', many: '{n} en buen camino', other: '{n} en buen camino' },
    slipping: { one: '{n} con retraso', many: '{n} con retraso', other: '{n} con retraso' },
    baselineOnly: {
      one: '{n} solo con línea de base',
      many: '{n} solo con línea de base',
      other: '{n} solo con línea de base',
    },
    matrixTitle: 'Objetivos por {noun}',
    goal: 'Objetivo',
    target: 'meta {value}',
    targetBy: 'meta {value} para {year}',
    nothingPublished: 'Aún no se ha publicado nada.',
  },
  notFound: {
    title: 'Página no encontrada',
    body: 'No hay ningún retrato ni página en esta dirección. Es posible que se haya trasladado o que el retrato aún no se haya publicado.',
    home: 'Ir al inicio',
  },
  /** Emergency view (SPEC-v5 §3): official alerts, threats by risk, plans, help. */
  emergency: {
    navLabel: 'Emergencias',
    metaTitle: 'Emergencias · {name}',
    title: 'Emergencias y desastres: {name}',
    intro:
      'Alertas oficiales, las amenazas que enfrenta esta zona, los planes ya establecidos y dónde obtener ayuda.',
    empty: 'Este retrato aún no ha publicado información sobre emergencias.',
    alertsTitle: 'Alertas vigentes',
    alertsNone: 'No hay alertas meteorológicas vigentes para esta zona al {time}.',
    alertsChecked: 'Última verificación: {time}.',
    alertsStale:
      'Recientemente no pudimos acceder a la fuente oficial de alertas. Consulte directamente el Servicio Nacional de Meteorología.',
    alertsSavedCopy:
      'Esta es una copia guardada de la página. Las alertas se verificaron por última vez el {time} y es posible que hayan cambiado desde entonces. Consulte directamente el Servicio Nacional de Meteorología.',
    alertsNotConfigured: 'Las alertas oficiales aún no están configuradas para este retrato.',
    alertsOriginal: 'Las alertas se muestran exactamente como se emitieron, en inglés.',
    alertSource: 'Emitida por {source}',
    alertWindow: 'Desde el {start} hasta el {end}',
    alertFrom: 'A partir del {start}',
    alertInstructions: 'Qué hacer',
    alertDetails: 'Texto completo de la alerta',
    alertLink: 'Alerta oficial',
    alertEnded: 'Finalizada',
    severity: {
      Extreme: 'Extrema',
      Severe: 'Grave',
      Moderate: 'Moderada',
      Minor: 'Menor',
      Unknown: 'Gravedad desconocida',
    },
    getAlerts: 'Reciba alertas oficiales',
    emergencyCall: 'En caso de emergencia, llame al {phone}.',
    infoCall: 'Para recibir ayuda que no sea de emergencia, llame al {phone}.',
    threatsTitle: 'Amenazas por nivel de riesgo',
    threatsIntro:
      'Qué tan probable es cada amenaza y qué tan grave sería, según la evaluación del personal de la ciudad, y qué partes de la rosquilla pone en riesgo.',
    likelihood: 'Probabilidad: {n} de 5',
    severityRating: 'Gravedad: {n} de 5',
    risk: {
      low: 'Riesgo bajo',
      moderate: 'Riesgo moderado',
      high: 'Riesgo alto',
      very_high: 'Riesgo muy alto',
    },
    activeNow: 'Alerta vigente',
    threatens: 'Dimensiones en riesgo:',
    dimensionImpact: '{dimension} ({impact})',
    impactLevel: {
      low: 'impacto bajo',
      moderate: 'impacto moderado',
      high: 'impacto alto',
    },
    hazardKind: {
      coastal_storm: 'Tormenta costera',
      flooding: 'Inundaciones',
      extreme_heat: 'Calor extremo',
      winter_weather: 'Clima invernal',
      high_winds: 'Vientos fuertes',
      air_quality: 'Mala calidad del aire',
      drought: 'Sequía',
      wildfire: 'Incendio forestal',
      earthquake: 'Terremoto',
      infectious_disease: 'Enfermedad infecciosa',
      infrastructure_failure: 'Falla de infraestructura',
      other: 'Otra amenaza',
    },
    showOnDoughnut: 'Mostrar en la rosquilla',
    doughnutNow: 'Hoy',
    doughnutThreat: 'En riesgo por: {hazard}',
    doughnutLabel: 'Retrato Doughnut que marca las dimensiones en riesgo por {hazard}',
    doughnutControls: 'Vista de la rosquilla',
    play: 'Reproducir',
    pause: 'Pausar',
    relatedPlans: 'Planes para esta amenaza:',
    plansTitle: 'Planes ya establecidos',
    plansIntro: 'Planes que la ciudad ha adoptado para estas amenazas: lo que se ha comprometido a hacer.',
    planBy: '{agency}, {year}',
    planAgency: '{agency}',
    planLanguages: 'También publicado en: {languages}',
    readPlan: 'Leer el plan',
    helpTitle: 'Ayuda y redes de ayuda mutua',
    helpIntro: 'Lugares y grupos que brindan ayuda durante una emergencia.',
    resourceKind: {
      cooling_center: 'Centro de enfriamiento',
      shelter: 'Refugio',
      hotline: 'Línea de ayuda',
      mutual_aid: 'Ayuda mutua',
      food: 'Alimentos',
      medical: 'Atención médica',
      other: 'Otro tipo de ayuda',
    },
    call: 'Llamar al {phone}',
    website: 'Sitio web',
    offlineTitle: 'Guarde esta página para usarla sin conexión',
    offlineBody:
      'Guarde esta página para que se abra incluso sin conexión, en caso de que falle la red.',
    offlineSave: 'Guardar para usar sin conexión',
    offlineSaved:
      'Página guardada. Se abrirá incluso sin conexión. Una copia guardada no se actualiza por sí sola: sus alertas son las de la última vez que usted la abrió con conexión.',
    offlineUnavailable: 'Este navegador no puede guardar páginas para usarlas sin conexión.',
    offlineSaving: 'Guardando…',
    offlineFailed: 'No se pudo guardar esta página. Vuelva a intentarlo cuando tenga conexión.',
    offlineUpdate:
      'Esta aplicación tiene una actualización pendiente y no puede guardar páginas hasta que se aplique. Recargue la página e inténtelo de nuevo.',
    offlineSignedIn:
      'Las páginas se guardan en este dispositivo solo cuando usted no ha iniciado sesión, para que su cuenta se mantenga privada en computadoras compartidas.',
    metaDescription: 'Alertas oficiales, amenazas, planes y ayuda para {name}.',
    contentInEnglish:
      'El personal redacta las amenazas, los planes y los recursos de ayuda, y se publican en inglés. Las alertas se muestran tal como las emitió el Servicio Nacional de Meteorología (National Weather Service).',
    alertArea: 'Zonas: {areas}',
    alertRelated: 'Amenaza relacionada: {hazard}',
    signupLink: 'Inscribirse para recibir alertas oficiales',
    signupNamed: 'Inscribirse en {name}',
    resourceHazards: 'Ayuda en caso de:',
    doughnutLegend: 'Colores en la rosquilla:',
  },
  /** The site footer, on every page but embeds (components/site-footer/SiteFooter.tsx). */
  footer: {
    /** The footer's navigation landmark. */
    label: 'Acerca de este sitio',
    /** {email} is the support address of whoever runs this site, as a link. */
    contact: 'Contacto: {email}',
    accessibility: 'Accesibilidad',
    privacy: 'Privacidad',
    terms: 'Términos de uso',
    /**
     * The Doughnut's attribution (docs/OPEN-SOURCE.md §3.3), also under every
     * embedded doughnut. {license} is the license's name as a link; {book}
     * and {method} are the English titles of the book and the method guide.
     */
    credit:
      'Diagrama de la rosquilla: Kate Raworth y Christian Guthier, {license}, adaptado con datos locales (Raworth, {book}, 2017). Método de retratos de ciudad basado en {method}, de Doughnut Economics Action Lab. Este sitio no está afiliado a Doughnut Economics Action Lab ni cuenta con su respaldo.',
  },
  /**
   * On a portrait seeded with synthetic values (scripts/seed-demo-data.ts):
   * its page, its dimension pages, its embed, its organization's compare,
   * insights and progress pages, so a screenshot cannot pass for research.
   */
  sampleData: {
    title: 'Datos de muestra — no son resultados de investigación',
    /** A portrait's own pages and its embed; {name} is the portrait. */
    body: 'Las cifras de {name} que aparecen en este sitio se generaron para hacer una demostración del software. No son mediciones y no deben citarse.',
    /** An organization's pages, when any portrait shown there is seeded; {org} is the organization. */
    bodyOrg:
      'Algunas o todas las cifras de {org} que aparecen en esta página se generaron para hacer una demostración del software. No son mediciones y no deben citarse.',
  },
  /** Theme toggle and the fryer (SPEC-v5 §4). */
  theme: {
    label: 'Tema',
    /** The toggle's accessible name, and the status message after a flip. */
    toggle: 'Tema: {mode}',
    /** The toggle's description and hover title. {system} is the "Match device" item's label. */
    hint: 'Alterna entre claro y oscuro. Para «{system}» y otras opciones, mantenga presionado, haga clic con el botón derecho o presione Mayús+F10.',
    light: 'Claro',
    dark: 'Oscuro',
    system: 'Según el dispositivo',
    menu: 'Opciones de tema',
    deepFry: 'Freír esta página',
    unfry: 'Desfreír esta página',
    fried: 'Página frita. Elija «Desfreír esta página» para deshacerlo.',
    unfried: 'Página restaurada.',
  },
};
