# Translation review worksheet: SPEC-v5 strings

The strings added with the emergency view, the theme toggle and deep-fry
menu, and the service worker's update prompt were drafted per language
family and then reviewed by an independent back-translation pass. This
worksheet is what that pass left for the certified reviewer
([language-access.md](language-access.md#certified-translation--required-before-an-agency-relies-on-it)):
the corrections it already made, and the choices it could not settle without
a native speaker or the agency's own terminology. Keys are `emergency.*`,
`theme.*`, and `common.updateAvailable` / `common.reload` in
`apps/web/lib/i18n/messages/<code>.ts`.

Start with the emergency strings residents act on: severities, the
"no alerts" sentence, alert time windows, and resource kinds (cooling center,
shelter, mutual aid) — match the terms NYC Emergency Management and NWS
already publish in each language.

## Spanish, French, Haitian Creole

**Corrected in review:**

- es emergency.alertWindow: 'Desde {start} hasta {end}' -> 'Desde el {start} hasta el {end}'. The Spanish date fills in as '15 jul 2026, 20:00 GMT-4', and a date in Spanish needs the article (this also matches alertsSavedCopy's 'el {time}').
- es emergency.alertFrom: 'Desde {start}' -> 'A partir del {start}'. This adds the missing article, and 'a partir de' reads correctly for an alert that starts in the future.
- es emergency.doughnutLabel: '...las dimensiones que {hazard} pone en riesgo' -> '...las dimensiones en riesgo por {hazard}'. The English hazard name was the subject of the verb, so a plural name like 'Coastal storms' broke agreement. The new wording matches doughnutThreat 'En riesgo por: {hazard}'.
- es emergency.offlineUpdate: 'Vuelva a cargar la página' -> 'Recargue la página'. It now uses the same verb as the common.reload button ('Recargar') the reader is told to press.
- fr theme.hint: 'faites un appui long, un clic droit, ou appuyez sur Maj+F10' -> 'maintenez appuyé, faites un clic droit ou appuyez sur Maj+F10'. This removes the English-style serial comma, which French does not use, and makes the three gestures parallel verbs. The no-break spaces inside « {system} » are unchanged.

**Open for the certified reviewer:**

- Shift+F10 key name, left as drafted (es 'Mayús+F10', fr 'Maj+F10', ht 'Shift+F10'). This is a policy choice, not an error. NYC readers mostly have US keyboards labelled 'Shift', and the button's aria-keyshortcuts is 'Shift+F10'. If the city wants the printed key label, use 'Shift' in es and fr.
- NWS name: es 'Servicio Nacional de Meteorología' matches the NWS's own Spanish usage. NWS has no official French or Haitian Creole name, so fr 'Service météorologique national' and ht 'Sèvis Meteyo Nasyonal la' are reasonable but unconfirmed. Keeping '(National Weather Service)' once in contentInEnglish is right.
- CAP severities kept: es Extrema/Grave/Moderada/Menor, fr Extrême/Grave/Modérée/Mineure. 'Grave' is better than the anglicisms 'Severa'/'Sévère' and matches the 'graves' wording of phone emergency-alert settings, but has not been checked against IPAWS/WEA. ht 'Minè' can also mean 'underage' or 'miner'; the reviewer may prefer 'Lejè'.
- ht 'Moderate' is translated two ways on the same page: severity 'Modere', but risk 'Risk mwayen' and impact 'enpak mwayen'. It is not wrong; the reviewer may want one term.
- ht hazardKind.coastal_storm 'Tanpèt kotyè': 'kotyè' is a French loan (côtier) that may not be plain Kreyòl. 'Tanpèt bò lanmè' is plainer; check NYC Emergency Management's Creole coastal-storm materials. Left unchanged.
- Cooling center and shelter terms not checked against NYC's own translated pages: es 'Centro de enfriamiento' / 'Refugio', fr 'Centre de rafraîchissement' / 'Hébergement d’urgence', ht 'Sant rafrechisman' / 'Abri'. es 'centro de enfriamiento' matches common US-agency usage; the fr and ht terms are unconfirmed.
- ht mutual aid 'Èd mityèl' / 'Èd ak gwoup èd mityèl' kept. Whether NYC Haitian organizers say 'sipò mityèl' or 'konbit' needs a community check. es 'Ayuda mutua' and fr 'Entraide' are standard.
- es winter_weather 'Clima invernal' kept (common in US Spanish). NWS Spanish product names use 'tiempo invernal'; pick one if the city's materials do.
- doughnutThreat accepted in all three. The colon after the preposition copies the English source ('At risk from: {hazard}'), and fr 'Menacé' agrees with the implied masculine donut/portrait. The alternative 'Menace : {hazard}' was considered and not adopted.
- threatens recast from 'Puts at risk:' to 'Dimensions at risk:' (es 'Dimensiones en riesgo:', fr 'Dimensions menacées :', ht 'Dimansyon ki an danje:') is accepted. It keeps the meaning and works as a standalone label in both places it appears.
- alertsNone 'as of {time}': es 'al {time}' and fr 'au {time}' are idiomatic with the actual Intl output ('15 jul 2026, 20:00 GMT-4' / '15 juil. 2026, 20:00 UTC−4'). ht 'Nan dat {time}' with the numeric '2026-07-15 20:00 EDT' is understandable; a native reviewer should confirm.
- Quotation marks: es « » (RAE) is correct, but NYC Spanish materials often use “ ”. This is a house-style choice. fr « » uses U+00A0 no-break spaces inside, which I verified matches the rest of the fr catalog.
- fr emergency.offlineFailed 'Réessayez lorsque vous disposez d’une connexion' uses the present tense after 'lorsque' for a future action. This is common in UI copy but strict grammar wants 'disposerez'. Left unchanged.

<details><summary>Drafting notes (the review pass above weighed each)</summary>

- Shift+F10 key name: es uses 'Mayús+F10' and fr uses 'Maj+F10' (Microsoft localization convention), ht keeps 'Shift+F10'. If the city prefers the label printed on US keyboards, use 'Shift' in all three.
- NWS name: es 'Servicio Nacional de Meteorología', fr 'Service météorologique national', ht 'Sèvis Meteyo Nasyonal la'. Each adds '(National Weather Service)' once, in contentInEnglish. For ht I chose 'Meteyo' over a spelling of 'météorologie' I was not sure of.
- CAP severities: es Extrema/Grave/Moderada/Menor, fr Extrême/Grave/Modérée/Mineure (feminine, agreeing with alerta/alerte), ht Ekstrèm/Grav/Modere/Minè. 'Grave' was chosen over 'Severa'/'Sévère'; check against the IPAWS/WEA translations.
- Cooling center: es 'Centro de enfriamiento', fr 'Centre de rafraîchissement', ht 'Sant rafrechisman'. Confirm against NYC's own translated cooling-center pages.
- Shelter: es 'Refugio', fr 'Hébergement d’urgence', ht 'Abri'. NYC also uses 'centro de evacuación' for hurricane shelters, and 'albergue' for shelters in other contexts.
- Mutual aid in ht: 'Èd mityèl' (chip) and 'Èd ak gwoup èd mityèl' (heading). Check whether NYC Haitian organizers use 'sipò mityèl' or 'konbit' instead. es uses 'Ayuda mutua' / 'Ayuda y redes de ayuda mutua'; fr uses 'Entraide' / 'Aide et entraide'.
- Infectious disease in ht: 'Maladi kontajye' (literally 'contagious disease', plainer than 'maladi enfeksyon').
- Winter weather: es 'Clima invernal', fr 'Intempéries hivernales', ht 'Move tan livè'.
- doughnutThreat (used as a heading and as a toggle label): es 'En riesgo por: {hazard}', fr 'Menacé par : {hazard}', ht 'An danje akoz: {hazard}'. In fr the colon after 'par' was kept to set off the English hazard name.
- The source string 'Puts at risk:' (threatens) was rendered as 'Dimensions at risk:' in all three: es 'Dimensiones en riesgo:', fr 'Dimensions menacées :', ht 'Dimansyon ki an danje:'. A subjectless verb reads badly as a standalone label.
- alertsNone 'as of {time}': es 'al {time}', fr 'au {time}', ht 'Nan dat {time}, …'. {time} is a full date and time (all-numeric in ht).
- Deep-fry joke: es 'Freír esta página' / 'Desfreír esta página', fr 'Faire frire cette page' / 'Défrire cette page', ht 'Fri paj sa a' / 'Defri paj sa a'. The 'un-fry' verbs are playful made-up words on purpose.
- Quotation marks in theme.hint and theme.fried: es uses « » (RAE preference), fr uses « » with no-break spaces inside, ht uses “ ”.

</details>

## Chinese (Traditional, Simplified), Korean

**Corrected in review:**

- zh-Hant emergency.intro: 本區 -> 本地區. In this catalog 區 is the word for 'district', and in Hong Kong 本區 reads as 'this district'. That narrowed the source's 'this area' when the portrait is a whole city. It also now matches zh-Hans 本地区.
- zh-Hant emergency.alertsNone: 本區 -> 本地區 ('As of {time}, no active weather alerts for this area'), for the same reason. The all-clear message must not sound like it covers only one district.
- ko emergency.alertsNone: 기상 경보 -> 기상특보. In KMA usage 기상 경보 means only the warning tier (advisories are 주의보), so the sentence said 'no warnings in effect' when the source says no weather alerts of any kind. 기상특보 is KMA's umbrella term for both tiers, and '발효 중인 특보' is KMA's own phrasing.

**Open for the certified reviewer:**

- zh-Hans emergency.severity 特别严重/严重/较重/一般: I kept it. It matches the national four-level warning scale (Ⅰ–Ⅳ 级, red/orange/yellow/blue), and the page's badge colours line up with that scale (Minor is blue). A lone 一般 badge can still read as 'ordinary' to readers who don't know the scale, so a certified reviewer should confirm it, or choose 轻微.
- zh-Hant emergency.severity 極端/嚴重/中等/輕微: I kept the literal rendering. It isn't wrong, but Hong Kong has no CAP severity convention to check it against. 極度嚴重 would read more clearly as a top level than the bare adjective 極端.
- ko emergency.severity 극심/심각/중간/경미: I kept it. In the national crisis scale (관심/주의/경계/심각), 심각 is the top level. Here it is the second level (Severe), so a reader might take a Severe badge as the highest. That overstates the danger rather than understating it.
- ko '경보' as the general word for 'alert' (alertsTitle, activeNow, getAlerts, signupLink, intro and others): I kept it. US Korean public materials use 경보 for 'alert' (e.g. 긴급 경보), and the NWS feed also carries non-weather civil alerts that 특보 would not cover. To KMA-literate readers, 경보 can still suggest the warning tier on an Advisory card.
- cooling_center: zh 降溫中心/降温中心 matches what NYC Chinese media use. Hong Kong's own term is 臨時避暑中心. ko 무더위 쉼터 is Korea's official term. NYC's Korean term was not checked.
- zh-Hant shelter 庇護中心 (Hong Kong 臨時庇護中心) vs NYC's 避難所/庇護所. Both are understood. Kept.
- zh-Hant 水浸 / 酷熱天氣 / 空氣質素欠佳: kept as Hong Kong usage, per docs/language-access.md.
- signupNamed 訂閱{name}/订阅{name} vs NYC's 註冊 (register); ko uses '{name} 가입하기' while signupLink uses 신청하기. All read naturally; kept.
- ko resourceKind.hotline 상담 전화 suggests a counselling line. 핫라인 would be more neutral for a utility or heat hotline. Kept, not an error.
- zh resourceHazards 適用於/适用于 ('applies to') is looser than 'Helps with'. 可協助應對 would be closer. Kept, not an error.
- The deep-fry joke strings (油炸本頁/取消油炸/炸至金黃酥脆; 이 페이지 튀기기/튀김 취소하기) are accurate and consistent with each other; kept.

<details><summary>Drafting notes (the review pass above weighed each)</summary>

- zh-Hans emergency.severity: 特别严重/严重/较重/一般 follows mainland China's four-level warning scale, which I believe GB/T 35965.1 maps to CAP Extreme/Severe/Moderate/Minor; Minor as 一般 may read as 'ordinary'
- zh-Hant emergency.severity: 極端/嚴重/中等/輕微 is a literal rendering; I know of no Hong Kong CAP severity convention
- ko emergency.severity: 극심/심각/중간/경미 is literal; the Korean crisis-alert scale (관심/주의/경계/심각) is a different concept, so it was not used
- 'alert': zh-Hant 警報 (as in HK's 緊急警報系統), zh-Hans 预警 (mainland), ko 경보 throughout; for weather alerts KMA's own umbrella term is 특보, and 경보 strictly means only the warning level
- cooling_center: zh 降溫中心/降温中心 (I believe this is NYC's Chinese term; HK may say 臨時避暑中心); ko 무더위 쉼터 (Korea's official term; NYC Korean materials may say 냉방 센터)
- zh-Hant shelter 庇護中心 follows HK's 臨時庇護中心; NYC Traditional Chinese materials may use 避難所 (zh-Hans uses 避难所)
- zh-Hant HK hazard terms: 水浸 (flooding; may read colloquial to Taiwanese readers, neutral is 洪水), 酷熱天氣 (extreme heat, from the HKO warning name; 極端高溫 is more literal), 空氣質素欠佳
- mutual aid: zh 社區互助 (chip), ko 상호부조
- likelihood/severityRating 'X of 5': zh shortened to '可能性：{n}/5' and '嚴重程度：{n}/5'; ko uses '5점 중 {n}점'
- ko theme light/dark: 라이트 모드/다크 모드 (Samsung/iOS usage) rather than Windows' 밝게/어둡게
- signupNamed: 訂閱{name}/订阅{name} (subscribe); NYC Chinese materials may use 註冊 (register)
- deep-fry joke: zh 油炸本頁/油炸本页 with fried status 炸至金黃酥脆 (fried golden and crispy), un-fry 取消油炸; ko 이 페이지 튀기기 / 튀김 취소하기 with 바삭하게 튀겼습니다

</details>

## Russian, Polish

**Corrected in review:**

- ru theme.unfry: changed 'Разжарить страницу' to 'Отменить жарку'. With heat verbs the раз- prefix usually means 'more' (разогреть, раскалить, разжечь), so readers could take the coinage as 'fry it more', the opposite meaning. This is the same trap the Polish translator avoided with 'odsmaż'.
- ru theme.fried: changed 'Страница зажарена. Чтобы отменить, выберите «Разжарить страницу».' to 'Страница зажарена. Чтобы вернуть обычный вид, выберите «Отменить жарку».'. It now names the renamed menu item and avoids saying 'cancel' twice.
- ru theme.hint: changed 'Переключает светлую и тёмную тему' (literally 'switches the light and dark theme') to 'Переключает между светлой и тёмной темой' ('switches between light and dark'). Also changed 'вариант «{system}» и другие' to 'вариант «{system}» или другие параметры' so the sentence reads 'to choose {system} or other options'.

**Open for the certified reviewer:**

- ru resourceKind.shelter 'Убежище': kept. It reads as 'refuge' but can suggest a bomb shelter. 'Временное убежище' is a Russian legal term for temporary asylum, so it is not a safe alternative. The precise term 'Пункт временного размещения' fits the chip but may be unfamiliar to long-settled NYC readers. A certified reviewer should check NYC Emergency Management's Russian materials.
- ru resourceKind.cooling_center 'Центр охлаждения': kept and not confirmed against NYC Russian materials. It is the common rendering in US Russian-language media.
- ru severity (Чрезвычайная / Высокая / Умеренная / Низкая опасность): kept. The order and distinctions are correct and do not clash with risk labels ('… риск'). There is no established Russian rendering of the CAP levels.
- ru hazardKind.wildfire 'Лесной пожар' and infrastructure_failure 'Сбой инфраструктуры': kept. 'Природный пожар' and 'Авария на объектах инфраструктуры' are the more official alternatives if a reviewer prefers them.
- ru emergency.alertSource 'Источник: {source}': kept. It matches doughnut.source and dimension.source in the same catalog, and the meaning is preserved.
- pl resourceKind.cooling_center 'Centrum chłodzenia': not confirmed against NYC Polish materials. It could be misread as an industrial cooling facility; 'Ośrodek chłodzenia' and 'Punkt chłodzenia' remain the alternatives.
- pl resourceKind.shelter 'Schronienie': kept. In Polish civil-defence law (MDS, 'miejsca doraźnego schronienia') it also has a bomb-shelter sense, much like ru 'Убежище'. 'Schronisko' would suggest a homeless or animal shelter.
- pl resourceKind.hotline 'Infolinia': kept. It can sound like a customer-service line; for crisis lines a reviewer may prefer 'Linia wsparcia' or 'Telefon pomocowy'.
- pl severity (Ekstremalne / Poważne / Umiarkowane / Niewielkie zagrożenie): kept. The order is correct and the labels stay separate from the 'ryzyko' risk labels. IMGW uses numbered levels instead, so there is no established equivalent.
- pl hazardKind.coastal_storm 'Sztorm przybrzeżny', winter_weather 'Trudne warunki zimowe', wildfire 'Pożar lasu': descriptive renderings with no confirmed NYC Polish term.
- pl theme.system 'Jak w urządzeniu': kept. It is short and clear in both the toggle ('Motyw: Jak w urządzeniu') and the hint.
- Both: NWS is translated with the English name in parentheses, which suits text followed by a weather.gov link. The generic word for 'alerts' is 'оповещения' / 'ostrzeżenia'. In Polish, 'ostrzeżenia' is also IMGW's generic term for every warning level, so it does not imply the NWS 'Warning' tier. The English event names (Advisory / Watch / Warning) are shown untranslated, so the warning/advisory distinction is not lost.

<details><summary>Drafting notes (the review pass above weighed each)</summary>

- ru resourceKind.cooling_center 'Центр охлаждения': the literal form. I could not confirm whether NYC's Russian materials use 'центр охлаждения' or 'охлаждающий центр'.
- ru resourceKind.shelter 'Убежище': picked over 'Пункт временного размещения' (the term Russia's emergency ministry uses) because NYC Russian readers know it better. It can also suggest a bomb shelter.
- ru severity (Чрезвычайная / Высокая / Умеренная / Низкая опасность): based on the Russian fire-danger scale. I know of no established Russian rendering of the NWS/CAP severity levels.
- ru theme.unfry 'Разжарить страницу': a deliberate playful coinage (раз- prefix means undo, as in разморозить) to pair with 'Зажарить страницу'. If it reads oddly, use 'Отменить жарку'.
- ru hazardKind.wildfire 'Лесной пожар': chosen for plain language over the official term 'Природный пожар'.
- ru emergency.alertSource 'Источник: {source}': means 'Source:' rather than a literal 'Issued by'.
- pl resourceKind.cooling_center 'Centrum chłodzenia': I could not confirm NYC's established Polish term; alternatives are 'Ośrodek chłodzenia' and 'Punkt chłodzenia'.
- pl resourceKind.shelter 'Schronienie': a generic word. The Polish crisis-management term would be 'miejsce tymczasowego zakwaterowania' (too long for a chip). 'Schronisko' also suggests an animal or homeless shelter.
- pl mutual aid 'pomoc wzajemna' (helpTitle 'Wsparcie i pomoc wzajemna'): avoids 'Pomoc i pomoc wzajemna'. Polish community groups also use 'pomoc sąsiedzka'.
- pl severity (Ekstremalne / Poważne / Umiarkowane / Niewielkie zagrożenie): I know of no established Polish rendering of the CAP severity levels. Polish forecasters (IMGW) use warning levels 1, 2 and 3 instead.
- pl hazardKind.coastal_storm 'Sztorm przybrzeżny' and winter_weather 'Trudne warunki zimowe': descriptive renderings with no confirmed NYC Polish term.
- pl theme.unfry 'Cofnij smażenie': avoids 'odsmaż', which in Polish means re-fry ('odsmażane'), the opposite of the joke.
- pl theme.system 'Jak w urządzeniu': short form. Some interfaces say 'Zgodnie z ustawieniami systemu'.
- NWS name in both languages is translated, with the English name kept in parentheses: 'Национальная метеорологическая служба (National Weather Service)' / 'Narodowa Służba Meteorologiczna (National Weather Service)'.

</details>

## Arabic, Urdu, Bengali

**Corrected in review:**

- ar emergency.alertsNone: 'لا توجد تنبيهات جوية سارية لهذه المنطقة حتى {time}.' -> '... وفقًا لآخر تحقق في {time}.' The old text used حتى, the same word as 'until' in alertWindow ('من {start} حتى {end}'), so it read 'no alerts until {time}', like a forecast. It now says 'per the last check at {time}', which is what 'as of' means.
- ur emergency.alertsNone: '{time} تک ...' -> '{time} کو کی گئی آخری جانچ کے مطابق اس علاقے کے لیے موسم کا کوئی جاری الرٹ نہیں۔' تک is the 'until' of alertWindow ('{start} سے {end} تک'). It now says 'per the last check made on {time}', using the same '{time} کو' construction as alertsSavedCopy.
- bn emergency.alertsNone: '{time} পর্যন্ত ...' -> 'সর্বশেষ যাচাই ({time}) অনুযায়ী এই এলাকার জন্য আবহাওয়ার কোনো চলমান সতর্কবার্তা নেই।' পর্যন্ত is the 'until' of alertWindow ('{start} থেকে {end} পর্যন্ত'). It now says 'per the latest check ({time})', matching alertsChecked 'সর্বশেষ যাচাই'.
- bn emergency.navLabel/metaTitle/title/empty/helpIntro: 'জরুরি অবস্থা' -> 'জরুরি পরিস্থিতি'. Standing alone, as a nav label on every page and as the page title, 'জরুরি অবস্থা' reads in Bangladeshi usage as a declared 'state of emergency', which is a misleading claim for a city site. 'জরুরি পরিস্থিতি' means emergencies or emergency situations. emergencyCall 'জরুরি প্রয়োজনে' was already right and is unchanged.
- ar emergency.doughnutThreat: 'تحت تهديد: {hazard}' -> 'مصدر الخطر: {hazard}'. The colon left the construct 'under threat of' dangling, so 'Under threat: <hazard>' could read as the hazard being the thing threatened. The new text ('source of risk') is unambiguous as both the h2 heading and the Today/alternate toggle label, and it matches ur 'خطرے کا باعث' and bn 'ঝুঁকির কারণ'.

**Open for the certified reviewer:**

- ar mutual aid 'العون المتبادل' kept. It is a legitimate MSA term (the standard Arabic title of Kropotkin's 'Mutual Aid'), but it is unverified whether NYC Arabic-speaking groups say 'المساعدة المتبادلة' or 'التكافل' instead.
- ar NWS 'هيئة الأرصاد الجوية الوطنية' kept. It is common in Arabic press, alertsStale/alertsSavedCopy are followed by a weather.gov link, and contentInEnglish gives the Latin name. No official Arabic name exists.
- ar/ur/bn alert severity scales (بالغ الشدة/شديد/متوسط/طفيف; انتہائی شدید/شدید/درمیانہ/معمولی; অতি তীব্র/তীব্র/মাঝারি/মৃদু) kept. The order is correct and they agree with each catalog's doughnut.level words. None is checked against an official CAP translation.
- ur threatsTitle 'درجۂ خطر کے لحاظ سے خطرات' kept. It repeats خطر but means 'threats by risk level' correctly. A certified reviewer may prefer other wording.
- ur theme Light/Dark 'روشن/تاریک' and bn 'হালকা/গাঢ়' kept. Both are clear. The OS-transliteration alternatives (لائٹ/ڈارک) are a style choice.
- ur unfry 'صفحہ دوبارہ کچا کریں' and bn unfry 'পৃষ্ঠাটি আবার কাঁচা করুন' kept. They are clear puns and the `fried` messages quote them exactly, so the undo path is explained.
- bn cooling center 'কুলিং সেন্টার' kept. It is unverified whether it matches NYC's own Bengali materials.
- bn extreme_heat 'চরম তাপ' kept. Bangladeshi media more often say 'তীব্র গরম' or 'তাপপ্রবাহ' (heat wave), but তীব্র is already the Severe severity word, so the current term avoids a clash.
- ur alertsTitle 'جاری الرٹس' / activeNow 'الرٹ ابھی جاری ہے' kept. 'جاری' as an adjective means ongoing, though in 'الرٹ جاری' it can also mean 'issued'. Both readings mean an alert is in force, so it is not a safety issue.

<details><summary>Drafting notes (the review pass above weighed each)</summary>

- ar mutual aid: 'العون المتبادل' (helpTitle 'المساعدة والعون المتبادل'); 'المساعدة المتبادلة' or 'التكافل' may be what NYC Arabic-speaking organizers use.
- ar National Weather Service: 'هيئة الأرصاد الجوية الوطنية'. NWS has no official Arabic name, so the Latin name is added in parentheses in contentInEnglish.
- ar alert severities Extreme/Severe/Moderate/Minor: 'بالغ الشدة/شديد/متوسط/طفيف'. Not checked against an Arabic CAP alerting system.
- ar doughnutThreat ('At risk from: {hazard}'): 'تحت تهديد: {hazard}'.
- ar theme: Match device 'حسب إعداد الجهاز'; deep fry uses the verbal-noun menu style: 'قلي هذه الصفحة' / 'إلغاء قلي هذه الصفحة'.
- ur National Weather Service: transliterated 'نیشنل ویدر سروس', following Urdu press usage.
- ur alert severities: 'انتہائی شدید/شدید/درمیانہ/معمولی', modeled on Pakistani NDMA/PMD usage and not verified.
- ur: 'threat' and 'risk' are both خطرہ in Urdu, so threatsTitle is 'درجۂ خطر کے لحاظ سے خطرات'. A reviewer may prefer different wording.
- ur theme: Light/Dark are 'روشن/تاریک'; some operating-system interfaces use the transliterations 'لائٹ/ڈارک'.
- ur un-fry: 'صفحہ دوبارہ کچا کریں' ('make the page raw again') is a pun on 'یہ صفحہ تل دیں'. A reviewer may want plainer wording.
- bn alert severities: Bangladesh Meteorological Department heat-wave scale words 'অতি তীব্র/তীব্র/মাঝারি/মৃদু'.
- bn cooling center: transliterated 'কুলিং সেন্টার', assumed to match NYC's Bengali materials. Shelter is 'আশ্রয়কেন্দ্র', the Bangladeshi cyclone-shelter term.
- bn hazard kinds: winter_weather 'শীতকালীন বৈরী আবহাওয়া' and air_quality 'খারাপ বায়ুমান' use Bangladeshi news wording.
- bn un-fry: 'পৃষ্ঠাটি আবার কাঁচা করুন' ('make the page raw again') is a pun on deepFry 'পৃষ্ঠাটি ডুবো তেলে ভাজুন'.
- bn theme: Light/Dark are 'হালকা/গাঢ়', as in Google's Bangla UI.
- all three: 'as of {time}' is rendered as 'حتى {time}' / '{time} تک' / '{time} পর্যন্ত', which literally reads 'up to {time}'. This is the usual idiom, but worth a reviewer check.

</details>
