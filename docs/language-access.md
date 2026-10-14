# Language access (NYC Local Law 30)

NYC Local Law 30 of 2017 requires covered agencies to translate commonly
distributed documents into the ten designated citywide languages and to
provide interpretation. deep-fryer's public plane — the pages residents
read — is available in English plus all ten: Spanish, Chinese (Traditional
and Simplified), Russian, Bengali, Haitian Creole, Korean, Arabic, Urdu,
French, and Polish. Every city gets them; most US cities' top requested
languages fall inside this set.

## What residents get

- **Every public page in their language** at its own URL: `/es/nyc`,
  `/zh-hant/o/nyc/progress`, `/ar/manhattan/dim/housing`. The globe menu in
  the header switches language on the page you are on; the choice is
  remembered, so a returning reader who chose Spanish lands on Spanish pages.
  `/{page}?hl=en` switches back to English.
- **Translated:** navigation, headings, explanations, status labels and
  their definitions, the doughnut's labels and accessible summary, the 21
  Doughnut Economics dimension names, geographic scales, discussion
  controls, the 404 page, the offline page, and embeds.
- **Not translated — published as researched:** indicator names, values and
  units, findings, sources, data-gap search trails, outreach listings, and
  resident comments. These are the city's published record; machine
  translation of them would put words in the record no one reviewed. Pages
  say so in a notice under the header, followed by the organization's
  **language access contact** (NYC: "For free help in your language,
  contact: 311" — 311 interprets in 175+ languages).
- **Right-to-left** layout for Arabic and Urdu (`dir="rtl"`, logical CSS),
  with charts kept left-to-right and English content isolated so it reads
  correctly inside RTL sentences.
- Search engines see each language version (`hreflang` alternates); the
  service worker caches each language's pages separately for offline use.

Staff surfaces — admin, review queue, billing, account, onboarding — are
English: they are the city's internal tools, not documents for the public.

## Setting the language access contact

Organization owners set it on the organization page (`/o/{org}`, "Language
access contact"). Ops can set it at provisioning:
`scripts/create-tenant.ts --language-help "(607) 274-6570"`;
`scripts/provision-nyc.ts` sets `311` for NYC.

## Embeds in another language

```html
<div data-deep-fryer="nyc" data-lang="es"></div>
<script async src="https://app.example.gov/embed.js"></script>
```

`data-lang` takes the URL prefix: `es`, `zh-hant`, `zh-hans`, `ru`, `bn`,
`ht`, `ko`, `ar`, `ur`, `fr`, `pl`.

## Certified translation — required before an agency relies on it

The shipped catalogs are complete, machine-assisted drafts written to
plain-language public-information standards; no certified translator has
reviewed them yet. Local Law 30 compliance means professional translation
(NYC agencies route this through their language access coordinator and
MOIA's guidance). The workflow is built for that:

1. Each language is one self-contained file,
   `apps/web/lib/i18n/messages/<code>.ts`, with the same keys as the English
   source `en.ts`. The header of `en.ts` is the translator brief: what
   placeholders are, how plural forms work, and the register to use.
2. Give the translator the English file and their language's file. They
   revise values only.
3. Drop the reviewed file back in. `pnpm --filter @deep-fryer/web test`
   fails if a key is missing or extra (typecheck), a `{placeholder}` was
   lost or invented, a plural form the language needs is missing, or the
   file is mostly English (`lib/i18n/messages/catalogs.test.ts`).
4. The offline page's text lives in `apps/web/public/sw.js` (`OFFLINE`), as
   the offline page cannot load app code; review it with the catalog.

## Terms for the certified reviewer

The drafts flag terms where no established translation was confirmed —
start review here:

- **Doughnut vocabulary** (all languages): *social foundation*, *ecological
  ceiling*, *safe and just space*, *shortfall*, *overshoot*, and some
  dimension names (Land Conversion, Freshwater Withdrawals, Nitrogen &
  Phosphorus Loading, Political Voice) — check against Doughnut Economics
  Action Lab materials in each language; Haitian Creole has none, so its
  terms are coined.
- **"Portrait"**: retrato (es), portrait (fr), портрет (ru), portret (pl),
  畫像/画像 (zh), 프로필 (ko), صورة (ar — may read as "photo"), خاکہ (ur).
- **"Borough"**: distrito municipal (es), arrondissement (fr), awondisman
  (ht), район (ru), dzielnica (pl), 行政區/行政区 (zh), 자치구 (ko),
  المنطقة (ar), بورو (ur) — match the term each NYC agency already uses.
- **Script and region**: Traditional Chinese follows Hong Kong usage
  (網絡, 數據, 氣候變化) for NYC's largely Cantonese-speaking readers;
  Bengali follows Bangladeshi usage (পানি); Polish and Russian phrase
  `{noun}` sentences to avoid case endings.

## Adding or changing text

Add the key to `en.ts` with a comment if the context is not obvious; the
typecheck then lists every language missing it. Never ship a key with
English copied into other languages — the catalog test rejects mostly-English
files, and readers would get a page that claims to be translated and is not.

## Not yet covered

- Research content translation (see above — deliberate).
- The rare error page (`app/error.tsx`, shown when a page fails to render)
  is English.
- Numbers keep one format (`12,345.6`) in every language so they match the
  open-data files and council packets exactly.
