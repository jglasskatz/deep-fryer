# Translation review worksheet: SPEC-v6 and SPEC-v7 strings

The strings added for getting involved, sign-in and comment moderation
(SPEC-v6), and for the core view's detail panel and legend, the feature
notes and "Request a translation" (SPEC-v7), were drafted per language family
and then reviewed by an independent back-translation pass. This worksheet is
what that pass left for the certified reviewer
([language-access.md](language-access.md#certified-translation--required-before-an-agency-relies-on-it)):
the corrections it already made, and the choices it could not settle without
a native speaker or the agency's own terminology. All eleven catalogs in
`apps/web/lib/i18n/messages/<code>.ts` pass `catalogs.test.ts` with the
corrections in place.

Start with the strings residents act on:

- The organization form ("Suggest a way to get involved"). Its labels are `involvement.kindLegend`, `kindListing`, `kindSuggestion`, `dimensionLabel`, `dimensionAny`, `orgName`, `about`, `aboutHint`, `pitchListing`, `pitchListingHint`, `pitchSuggestion`, `pitchSuggestionHint`, `websiteLabel`, `contactLegend`, `contactName`, `email`, `phone`, `optional` and `send`. Its errors are `invalid`, `tooFast`, `rateLimited`, `expired` and `failed`. Its privacy line is `privacy` ("Your contact details go only to staff and are never published"), and `thanks` follows it.
- The sign-in and check-email pages: all of `login.*`, including every `login.errors.*` message.
- The notes on a held comment, which only its author and the moderators see: "Awaiting approval" (`discussion.awaitingApproval`, `awaitingNote`) and "Not approved" (`discussion.declined`, `declinedNote`).
- "Request a translation" (`translationRequest.*`). It is shown in the reader's language on a page that is otherwise in English. Per SPEC-v7 §3.5 it appears only where a portrait has translation turned off; NYC portraits keep translation on.

## Keys covered

There are 101 keys per language:

- **SPEC-v6 §2.1, exploring the doughnut:** `portrait.exploreTitle`, `portrait.exploreIntro`, `dimension.moreYouCanDo`.
- **SPEC-v6 §2.2, sign-in:** `login.title`, `intro`, `microsoft`, `google`, `emailLabel`, `emailPlaceholder`, `send`, `sending`, `noMethods`, `newHere`, `startLink`, `checkTitle`, `checkBody`, `checkHelp`, `sendAnother`, and `login.errors.OAuthAccountNotLinked`, `Verification`, `AccessDenied`, `Configuration`, `EmailSignin`, `default`.
- **SPEC-v6 §3, moderation:**
  - author notes: `discussion.awaitingApproval`, `awaitingNote`, `declined`, `declinedNote`
  - moderator buttons (staff plane): `discussion.approve`, `decline`
  - the staff badge and its tooltip: `discussion.staff`, `staffTitle`
- **SPEC-v6 §4, getting involved:**
  - `outreach.intro`, `outreach.partnersTitle`
  - the listings: `involvement.title`, `kind.volunteer`, `kind.services`, `kind.civic`, `kind.organize`, `kind.other`, `website`, `call`, `checked`, `forEveryDimension`, `filterLabel`, `filterAll`, `none`, `noneAtAll`, `contentInEnglish`
  - the organization form: `involvement.formTitle`, `formIntro`, `formIntroGeneral`, `open`, and every key from `kindLegend` through `failed`
- **SPEC-v7 §2, the core view:** `doughnut.clickForDetails` (the hint under the hover tooltip), `portrait.panelEmpty`, `panelClose`, `panelSelected`, `openFull`, `openFullDiscussion`, `legendTitle`, `legendSafe`, `legendShortfall`, `legendOvershoot`, `legendNoData`.
- **SPEC-v7 §3, feature notes:** `portrait.exploreIntroCore`, the list intro used when the portrait has no discussion.
- **SPEC-v7 §3.5:** `translationRequest.button`, `intro`, `language`, `send`, `sending`, `sent`, `limited`, `failed`.

## Across languages

The review raised these points in more than one language family. Each one is best settled once for the whole site.

- **`discussion.staff`, the one-word badge on a staff member's comment.** The word stands alone next to one person's name, and most drafts had trouble with it:
  - es 'Equipo', fr 'Équipe', pl 'Zespół' and ar 'فريق العمل' all mean "team" rather than the catalog's usual word for staff. In es and fr, 'Personal'/'Personnel' alone on a badge reads as the adjective.
  - ur 'عملہ' is a collective noun.
  - bn 'কর্মী' alone can read as "worker" or "activist".
  - ru 'Сотрудник' is grammatically masculine.
  - ko 직원, zh 工作人员/工作人員 and ht 'Anplwaye' use the catalog's word and were not flagged.
- **"Listing" is a new term in every catalog.** Each draft chose its own: es 'opciones de participación', fr 'fiche', ht 'lis la', ar قوائم / يُدرج, ur فہرست / درج, bn তালিকা / তালিকাভুক্ত, ru 'запись', pl 'wpis', ko 항목, zh-Hans 参与信息, zh-Hant 參與資訊.
- **`involvement.kind.*` badges differ in form:**
  - imperatives in es, ar, ur and bn
  - infinitives in fr and ru
  - nouns in pl
  - The review raised this as a register choice in ar, ur, bn, ru and pl. Decide whether the badges name actions or categories.
- **`involvement.rateLimited` ("Too many submissions from here today") is looser than the code.** `lib/involvement-actions.ts` limits submissions per network address per hour and per email address per day. Every draft renders "from here" literally, for example fr 'd’ici', ru 'отсюда', pl 'stąd', ko '이곳에서', zh '从这里/從這裡'. Clarify `en.ts` first. The review's alternatives are "from this connection" or "from this network" (ru, pl) and "from this device or network" (ko '이 기기 또는 네트워크에서').
- **"Public bodies" in `outreach.intro`.** The NYC listings include community boards, which are not agencies or institutions. The drafts use ht 'ajans piblik', ru 'государственные учреждения', pl 'instytucje publiczne' and bn 'সরকারি প্রতিষ্ঠান'. Use NYC's own term for community boards in each language where one exists.
- **Digits.** ar, ur and bn write '15' in Western digits in `login.checkBody`. Whether to use ١٥ / ۱۵ / ১৫ instead is a catalog-wide decision.

## Spanish, French, Haitian Creole

**Corrected in review:**

- **fr `involvement.rateLimited`:**
  - Before: 'Trop de propositions ont été envoyées d’ici aujourd’hui. …'
  - After: 'Aujourd’hui, trop de propositions ont été envoyées d’ici. …'
  - Why: 'd’ici' before a time word means 'by' ('d’ici demain' is 'by tomorrow'), so the old order first read as 'sent by today'. With 'Aujourd’hui' first, 'd’ici' means 'from here', as the English intends.
- **ht `login.errors.OAuthAccountNotLinked`:**
  - Before: 'Imèl sa a te deja konekte yon lòt fason. …'
  - After: 'Ou te deja konekte ak imèl sa a yon lòt fason. …'
  - Why: in Kreyòl it is a person who konekte, not an email address. The subject 'ou' is plainer, and the sentence now matches es and fr ('this email was already used to sign in another way'). The rest of the sentence is unchanged.

Spanish needed no correction.

**Open for the certified reviewer:**

- **es `discussion.staff` 'Equipo' and fr 'Équipe'.** Alternatives for es: 'Personal', 'Personal del retrato'. See "Across languages".
- **es `involvement.kind.volunteer` 'Haga voluntariado'.** It is gender-neutral. NYC Service usually says 'Sea voluntario' or 'Hágase voluntario', which are gendered. The noun 'Voluntariado' is another option. This is a policy call.
- **"Listing":**
  - es 'opciones de participación': alternatives 'anuncios', 'fichas', 'entradas'
  - fr 'fiche': alternatives 'annonce', 'inscription'
  - ht 'lis la', as in 'chak non ki nan lis la' and 'Poko gen anyen nan lis la': alternative 'anons'
- **`involvement.about` ("Who you are"):**
  - es 'Quiénes son ustedes': alternative 'Sobre su organización'.
  - ht 'Prezante òganizasyon ou' turns the label into an instruction ("Present your organization"): alternative 'Kiyès nou ye'.
- **es `login.emailLabel` 'Reciba por correo electrónico un enlace para iniciar sesión'.** It is the label above the email field. Alternative: 'Enviarme un enlace para iniciar sesión por correo electrónico'.
- **es US Latin American wording** ('venció', 'ingresó', 'Comuníquese con'). Confirm against the city's Spanish style guide.
- **fr 'e-mail' / 'Adresse e-mail' vs 'courriel'.** Neither word was in the catalog before this round. This is a house-style call.
- **fr `involvement.formIntro` 'participer dans le domaine {dimension}'.** It avoids the de/d’ change before a vowel, but reads a little like a label ('dans le domaine Logement'). Alternatives: 'dans le domaine « {dimension} »', 'sur le thème « {dimension} »'.
- **fr `outreach.intro` 'où vous pouvez participer'.** Acceptable; some reviewers will prefer 'auxquels vous pouvez participer'.
- **fr `involvement.none` 'Aucune fiche pour cette dimension pour le moment.'** It repeats 'pour', but matches the catalog's existing 'Aucun commentaire pour le moment'. Alternative: 'Pas encore de fiche pour cette dimension.'
- **ht "Ring" = 'sèk'** (`portrait.legendSafe`, `legendOvershoot`). 'sèk' also means 'dry'. Alternatives: 'wonn', 'sèk wonn la'.
- **ht `involvement.optional` '(si ou vle)'.** This is plain Kreyòl. '(opsyonèl)' is common on NYC agency forms.
- **ht `involvement.checked` 'Lyen an tcheke nan dat {date}'.** In ht the date shows in numbers only ('2026-10-16'), because Intl has no Haitian Creole date data. This is a deliberate fallback (`formatCheckedDate` in `components/involvement/InvolvementListings.tsx`). Confirm the wording reads well before a numeric date.
- **ht `outreach.intro` 'ajans piblik' for "public bodies".** Check NYC's Kreyòl glossary, since community boards are not agencies.

<details><summary>Drafting notes (the review pass above checked each)</summary>

- **Terms reused from each catalog:**
  - es: rosquilla, base social / techo ecológico, déficit / extralimitación, jurisdicción, personal; usted register throughout
  - fr: donut, plancher social / plafond écologique, dépassement, territoire, personnel
  - ht: Doughnut la, vè mitan an, defisi / depasman, anplwaye, moderatè, konekte, jiridiksyon
- **`involvement.call`** matches `emergency.call` in each language: 'Llamar al {phone}', 'Appeler le {phone}', 'Rele {phone}'.
- **French typography:** U+00A0 before `:` `;` `?`, and the curly apostrophe ’ throughout.
- **`login.emailPlaceholder`** is localized: es 'nombre@example.org', fr 'vous@example.org', ht 'ou@example.org'.
- **Kept identical to English in this round:** only fr `involvement.filterLabel` and `involvement.dimensionLabel` ('Dimension' is the French word). In total, es has 5 strings identical to English, fr 17 and ht 4. The rest predate this round: placeholder-only strings such as '{agency}', and words that are the same in the language, such as fr 'portrait'.
- **Reasons the translators gave:**
  - 'Equipo'/'Équipe' for the staff badge, because 'Personal'/'Personnel' alone reads as the adjective.
  - 'Haga voluntariado' because it is gender-neutral.
  - fr 'e-mail' because it is expected to be more familiar to NYC's West African and Haitian French speakers.
  - fr 'dans le domaine {dimension}' to avoid elision before a vowel.

</details>

## Chinese (Traditional, Simplified), Korean

**Corrected in review:**

- **ko `login.newHere` and `login.startLink`:**
  - Before: '로그인하면 {link}할 수 있습니다.' with link '관할 구역의 프로필을 시작'
  - After: '로그인하면 {link}를 시작할 수 있습니다.' with link '관할 구역의 프로필 만들기'
  - Why: '프로필을 시작하다' is not natural Korean, and the link text on its own was a broken fragment ("…profile-OBJ start"). Screen readers often list links out of context. The link is now a normal action label ("Create a profile for your jurisdiction"), and the fixed particle 를 fits 만들기.
- **ko `login.errors.OAuthAccountNotLinked`:**
  - Before: '이 이메일 주소는 이미 다른 방법으로 로그인한 적이 있습니다. …'
  - After: '이 이메일 주소로 이미 다른 방법을 사용해 로그인한 적이 있습니다. …'
  - Why: the old sentence copied the English and said that the address had signed in. It now says that (you) already signed in with this address using another method.

zh-Hans and zh-Hant needed no correction.

**Open for the certified reviewer:**

- **`involvement.formIntro` and `formIntroGeneral` drop "good" in all three languages.** They ask whether people *can* take part through the organization, not whether it is a *good* way:
  - ko: '귀하의 단체를 통해 사람들이 {dimension} 영역에 참여할 수 있나요?'
  - zh-Hans: '您的组织能否让大家参与{dimension}方面的工作？'
  - The review accepted this for ko; an alternative is '{dimension} 분야 활동에 참여'.
  - For zh, this was noted while compiling this worksheet; the review pass did not raise it.
  - The ru drafts were corrected for the same omission.
- **"Moderators":**
  - ko 관리자 is the catalog's existing word (`pendingApproval`, `removedBody`), but it is also `common.admin`. Alternatives are 운영자 or 검토자; a change must go into all the discussion strings together.
  - zh 版主 is the existing term, but it is forum slang. 管理员 or 审核人员 would sound more official on a city site.
- **zh moderation words 批准 / 不批准 / 未获批准 (zh-Hant 未獲批准).** The common alternative set is 通过 / 拒绝 / 未通过. This is a policy choice.
- **"Enroll" in `involvement.kind.services`:**
  - ko '도움 받기 또는 등록': alternatives 신청 (apply) or 가입. '도움 받기·신청하기' would keep the two parts alike.
  - zh 报名/報名 fits programs and events. For benefits, NYC's Chinese enrollment pages tend to use 申请, 注册 or 登记.
  - Match each to NYC's own enrollment pages.
- **ko register.** The involvement and translation-request strings use -해 주십시오, and the login strings use -하십시오. Both are formal; this is house style.
- **zh-Hans `outreach.partnersTitle` '参与这些数据工作的组织'.** Understandable but stiff. Alternatives: 从事这项数据工作的组织, 协助这些数据研究的组织. (ko '이 데이터 작업에 참여하는 단체' was accepted.)
- **zh-Hans `outreach.intro` 核实.** It is slightly stronger than "check"; 审核 would match the "review" wording in `formIntro`. It was accepted, because staff do confirm each listing.
- **zh-Hant 電郵 vs 電子郵件.** NYC's Traditional Chinese pages often use 電子郵件. Choose one for the whole site.
- **zh-Hant "Programs" = 項目.** Hong Kong often says 計劃 for a programme, but this catalog already uses 計劃 for "plans".
- **zh-Hant `login.errors.OAuthAccountNotLinked`.** One sentence uses 連結 both as a noun (電郵連結, "email link") and as a verb (連結此登入方式). 關聯 or 綁定 would remove the ambiguity; zh-Hans uses 关联. It is not wrong.
- **Minor:**
  - zh-Hans `involvement.invalid` 填写项 could also be 字段 or 栏目.
  - zh-Hans "Get help" is 获取帮助 on the badge but 获得帮助 in `pitchListingHint`.
  - zh-Hant 欄位 leans toward Taiwan usage; Hong Kong forms also say 欄目 or 項目.
  - zh-Hant `doughnut.clickForDetails` 點擊查看詳情 was accepted (按此 means "click here").

<details><summary>Drafting notes (the review pass above checked each)</summary>

- **ko terms reused from the catalog:** 프로필, 영역, 사회적 기초 / 생태적 한계, 결핍 / 초과, 직원, 관리자, 관할 구역, 로그인, and 새로고침 (as in `common.reload`). Polite formal register throughout.
- **zh-Hans uses mainland vocabulary:** 创建, 服务器, 文件夹, 电子邮箱, 账户, 志愿服务, 重新加载. Punctuation is full-width, and “不足”/“超标” use the same quotes as the methodology text.
- **zh-Hant follows Hong Kong usage,** as docs/language-access.md asks: 數據, 電郵, 義工, 表格, 伺服器, 帳戶, 透過, 聯絡資料. It uses 「」 quotes and differs from zh-Hans in vocabulary as well as script. An OpenCC check found no wrong-script characters; its one hit, 准 in 批准, is correct in Traditional Chinese.
- **No string translated before this round was changed.**
- **Kept identical to English in this round:** `login.emailPlaceholder` (you@example.org). In total each of the three catalogs has three strings identical to English (`common.back`, `login.emailPlaceholder`, `emergency.planAgency`), all legitimate.

</details>

## Russian, Polish

**Corrected in review:**

- **ru `involvement.formIntro` and `formIntroGeneral`:**
  - Before: 'даёт людям возможность'
  - After: 'даёт людям хорошую возможность'
  - Why: the draft dropped "good" from "a good way". "Good" sets the bar a listing must meet, and the Polish draft kept it ('dobrą').
- **pl `involvement.pitchListing`:**
  - Before: 'Dlaczego Państwa organizacja to dobry sposób na zaangażowanie się?'
  - After: 'Dlaczego warto zaangażować się w działania Państwa organizacji?'
  - Why: the old text copied the English word for word ("an organization *is* a way"), which reads oddly in Polish. The new text keeps the meaning ("why is it worth getting involved in your organization's work").
- **pl `involvement.pitchListingHint`:**
  - Before: 'Co ludzie mogą robić z Państwa organizacją — …, dołączyć, …'
  - After: 'Co ludzie mogą robić razem z Państwem — …, dołączyć do organizacji, …'
  - Why: 'robić z [czymś]' reads as "do with/to your organization". 'razem z Państwem' means "together with you", as in the source. A bare 'dołączyć' also needs an object.
- **pl `translationRequest.intro`:**
  - Before: '…ilu czytelników prosi o każdy język.'
  - After: '…ilu czytelników prosi o tłumaczenie na każdy język.'
  - Why: 'prosić o język' ("ask for a language") is an odd pairing. It now matches `sent` ('tłumaczenie na język').

**Open for the certified reviewer:**

- **`outreach.intro`, "public bodies":**
  - ru 'государственные учреждения' suggests institutions such as offices or schools more than councils and boards. Alternatives: 'государственные органы', 'органы власти', or naming community boards with NYC's own Russian term (e.g. 'государственные учреждения и общественные советы').
  - pl 'instytucje publiczne' could name community boards if the city has an official Polish term for them.
- **`discussion.staff`:**
  - ru 'Сотрудник' is masculine, used as a generic job title. Alternatives: 'Команда портрета', 'Команда'.
  - pl 'Zespół' (team), with the tooltip 'Osoba z zespołu, który prowadzi ten portret'. Alternatives: 'Pracownik', 'Zespół portretu'.
- **pl staff terminology is split.** The new strings use 'pracownicy', but the existing `discussion.removeReason` uses 'personel'. Choose one.
- **`involvement.kind.*`:**
  - ru uses infinitives (Стать волонтёром / Получить помощь или записаться / Высказать своё мнение / Вступить в группу / Другие способы участия). The alternative is category nouns (Волонтёрство / Помощь и запись / Участие в обсуждениях / Группы / Другое).
  - pl uses nouns (Wolontariat / Pomoc i zapisy / Wyrażanie opinii / Działanie w grupie / Inne formy zaangażowania). Imperatives are the alternative.
- **`involvement.rateLimited` 'отсюда' / 'stąd'.** Alternatives: 'с этого подключения' or 'из этой сети'; 'z tego połączenia'. See "Across languages".
- **ru `login.title` 'Вход', and providers as 'Войти через …',** rather than a literal 'Продолжить с …'. This is standard Russian UI, but it is house style.
- **`involvement.formTitle`:**
  - ru 'Знаете, как ещё можно принять участие?' adds 'ещё' ("else"). This fits because the form sits below existing listings. Literal alternative: 'Знаете способ принять участие?'.
  - pl 'Znają Państwo inny sposób na zaangażowanie?' has no 'Czy' and adds 'inny' ("another"). Alternative: 'Czy znają Państwo sposób na zaangażowanie się?'.
- **`involvement.about`.** ru 'О вашей организации' and pl 'O Państwa organizacji' mean "about your organization" rather than "Who you are". This is accurate, because the field appears only when "My organization…" is chosen.
- **pl `involvement.contactName` 'Imię'** (first name). 'Imię i nazwisko' is the usual form label for "Your name".
- **pl `login.emailLabel` 'Logowanie przez link wysłany e-mailem'.** It labels an email input. Alternatives:
  - 'Adres e-mail, na który wyślemy link do logowania' (labels the field)
  - 'Wyślij mi link do logowania e-mailem' (informal, matches the source)
- **pl `doughnut.clickForDetails` 'Szczegóły po kliknięciu'.** Alternative: 'Kliknij, aby zobaczyć szczegóły'. Polish interfaces commonly use the imperative, and the catalog's buttons already do.
- **pl `login.newHere` 'Dla pracowników miasta: po zalogowaniu można {link}.'** This rephrases the source. Alternative: 'Czy są Państwo pracownikiem miasta? Po zalogowaniu można {link}.'
- **pl `login.checkHelp` '…nie dotarła po kilku minutach?'** Alternative: '…nie dotarła w ciągu kilku minut?'.

<details><summary>Drafting notes (the review pass above checked each)</summary>

- **ru terms reused from the catalog:** измерение, «бублик», социальный фундамент / экологический потолок, дефицит / превышение, модераторы, сотрудники, учётная запись, юрисдикция, Сайт, «Позвонить: {phone}». Mixed-person agreement ('его видите только вы и модераторы') is correct.
- **pl terms reused from the catalog:** wymiar, obwarzanek (declined, no quotes), fundament społeczny, pułap ekologiczny, niedobór / przekroczenie, moderatorzy, jurysdykcja, 'Zadzwoń: {phone}', Strona internetowa. The polite Państwo form is used throughout, capitalized as in the rest of the catalog.
- **Quote marks** follow each catalog: «…» in ru, „…” in pl.
- **pl `doughnut.clickForDetails`** was phrased to avoid the informal imperative.
- **Kept identical to English in this round:** `login.emailPlaceholder` (you@example.org). In total:
  - ru has four strings identical to English: `common.back`, `login.emailPlaceholder`, `emergency.dimensionImpact`, `emergency.planAgency`.
  - pl has the same four, plus `common.menu` and `progress.columns.status`, which are real Polish words.

</details>

## Arabic, Urdu, Bengali

**Corrected in review:**

- **ur `portrait.exploreIntroCore`:**
  - Before: 'ہر پہلو میں اس کا ڈیٹا، اس کے ذرائع، اور آپ کے کرنے کے کام شامل ہیں۔'
  - After: 'ہر پہلو میں اس کا ڈیٹا اور ذرائع شامل ہیں، اور یہ بھی کہ آپ کیا کر سکتے ہیں۔'
  - Why: 'آپ کے کرنے کے کام' ("your to-do things") reads clumsily to a native reader. The new wording matches the catalog's own 'آپ کیا کر سکتے ہیں' in `whatYouCanDo` and `panelEmpty`.
- **ur `involvement.formIntro` and `formIntroGeneral`:**
  - Before: '…وہ ہر چیز کا جائزہ لیتے ہیں۔'
  - After: '…وہ بھیجی گئی ہر چیز کا جائزہ لیتے ہیں۔'
  - Why: "every submission" had become "everything". بھیجی گئی ہر چیز is the draft's own term for "submission", and `thanks` already uses it.
- **bn `portrait.exploreIntroCore`:**
  - Before: '…এবং আপনি কী করতে পারেন।'
  - After: '…এবং আপনি কী করতে পারেন তা।'
  - Why: without তা, a clause sat in a list of nouns after আছে. তা makes it a noun phrase, as in `panelEmpty`.
- **bn `outreach.intro`:**
  - Before: '…ক্ষেত্র অনুযায়ী সাজানো। এখানে দেখানোর আগে কর্মীরা তালিকার প্রতিটি নাম যাচাই করেন।'
  - After: '…সেগুলো ক্ষেত্র অনুযায়ী সাজানো আছে। কোনো কিছু এখানে দেখানোর আগে কর্মীরা তা যাচাই করে নেন।'
  - Why, first sentence: the যেসব relative clause had no সেগুলো to complete it.
  - Why, second sentence: "check each name on the list" narrowed "check each listing", since staff check the whole listing. It now matches ar كل ما يُدرج and ur ہر چیز.

Arabic needed no correction.

**Open for the certified reviewer:**

- **`discussion.staff`:**
  - ar فريق العمل ("the team"); elsewhere the catalog says الموظفون for staff. Alternatives: من فريق العمل; موظف (the masculine form the draft avoided); فريق الصورة.
  - ur عملہ is a collective noun on one person's comment. Alternatives: عملے کا رکن, ٹیم.
  - bn কর্মী. Alternatives: কর্মকর্তা, টিমের সদস্য, কর্মী দল.
- **`involvement.kind.*` are imperatives shown as badges.** The alternative in each language is noun labels:
  - ar: تطوّعوا، احصلوا على المساعدة أو سجّلوا، أبدوا رأيكم، انضموا إلى مجموعة، شاركوا. Noun labels: تطوّع، المساعدة والتسجيل، إبداء الرأي، الانضمام إلى مجموعة، المشاركة.
  - ur: رضاکار بنیں، مدد حاصل کریں یا اندراج کروائیں، …. Noun labels: رضاکاری، مدد اور اندراج، رائے، گروپ، شرکت.
  - bn: স্বেচ্ছাসেবক হোন, ….
- **"Listing" and "enroll" have no established catalog term:**
  - ar uses قوائم and يُدرج; alternatives إدراج or فرصة مشاركة.
  - ur uses فہرست / درج, and اندراج کروائیں for "enroll".
  - bn uses নিবন্ধন for both "enroll" and "sign up".
- **ar `involvement.rateLimited` and `sendAnother`.** `rateLimited` says طلبات ("requests") where the English says "submissions". `sendAnother` is إرسال المزيد ("send more"); the alternative is إرسال اقتراح آخر. Both are acceptable but less precise.
- **ar buttons are verbal nouns** (موافقة / رفض; الإرسال إلى الموظفين). This follows the catalog's house style, e.g. الحفظ للاستخدام دون اتصال.
- **Bidi rendering.** ar `translationRequest.sent` puts a Latin-script language name inside RTL text (…طلب الترجمة إلى Español), and `login.microsoft` contains 'Microsoft (حساب العمل)'. The ur strings have the same pattern. Check both in the browser.
- **ur `involvement.checked` 'لنک کی جانچ: {date}'** is written as a label. Full-sentence alternative: 'لنک کی جانچ {date} کو کی گئی'.
- **ur `login.newHere` / `login.startLink`.** The link text was made an imperative ("After signing in, start a portrait…") where the English says "you can". This is acceptable, but it changes the sentence structure. bn makes the same change ('…শুরু করুন').
- **ur word choices.** کام کا اکاؤنٹ or دفتری اکاؤنٹ; سائن ان (the catalog's existing term) or لاگ ان.
- **bn `discussion.decline` প্রত্যাখ্যান করুন** is formal; it appears only on moderator buttons. Alternatives: বাদ দিন, অনুমোদন দেবেন না.
- **bn word choices to confirm:**
  - "public bodies" = সরকারি প্রতিষ্ঠান; alternative সরকারি সংস্থা.
  - "work account" = অফিসের অ্যাকাউন্ট; alternative কাজের অ্যাকাউন্ট.
- **bn `outreach.partnersTitle` (এই তথ্য নিয়ে কাজ করছে যেসব সংগঠন)** is a heading that ends on a relative clause. This is common in Bengali headings, but should be confirmed.
- **Digits.** bn `login.checkBody` '15 মিনিট' matches the catalog's existing '5-এর মধ্যে', but NYC's Bengali materials usually use ১৫. See "Across languages".

<details><summary>Drafting notes (the review pass above checked each)</summary>

- **Only English lines were replaced;** no string translated before this round was changed.
- **Punctuation:** ar and ur use ، and ؟ with no Latin `? , ;`. bn uses । and the standard Latin `?`.
- **Script:** ur has no Arabic ي/ك/ه, and ar has no Urdu ی/ک/ہ. There are no stray invisible or bidi control characters.
- **ar terms reused from the catalog:** الصورة، بُعد، الدونات، الأساس الاجتماعي، السقف البيئي، المساحة الآمنة والعادلة، المشرفون، الموظفون، النطاق الإداري، تسجيل الدخول. The polite plural is used throughout, and '15 دقيقة' is the correct form for numbers 11–99.
- **ur's term for "submission"** is بھیجی گئی ہر چیز.
- **Kept identical to English in this round:** `login.emailPlaceholder` (you@example.org). In total:
  - ar and ur have three strings identical to English: `login.emailPlaceholder`, `emergency.dimensionImpact`, `emergency.planAgency`.
  - bn has those three plus `common.back` and `emergency.planBy`.

</details>

## Doc comments

The drafts brought this round's doc comments in line with `en.ts` in all
eleven catalogs:

- they added the comments above `doughnut.clickForDetails` and `portrait.exploreIntroCore`
- they corrected the one above `discussion.declined` ('only its author sees it' -> 'only its author and the moderators see it')

The following gaps are outside this round and were left unchanged:

- No translated catalog has the comment above `common.updateAvailable`.
- ko, pl, ru, zh-Hans and zh-Hant lack the comments above `dimensions`, `scales` and `nouns`. The other six catalogs have them.
- Every catalog has a one-line header in place of `en.ts`'s translator brief.
