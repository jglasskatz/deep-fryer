# deep-fryer — Mobile viewer spec (iOS and Android)

**Status:** Draft for the owner, 2026-10-16. Nothing built. The owner's request:

> I want a mobile app as well for iOS and android that isn't to create
> donuts, but just to view and explore them. Users should be able to
> subscribe to different city donuts to see different ones. Make a spec for
> this (including the technical hurdles we'd need to overcome to make the app
> actually useful/ functional from the backend perspective) then run it by me.

This spec builds on SPEC-v4 (PWA, open data, RLS), SPEC-v5 (emergency view),
and SPEC-v6 (getting involved, discussion). It depends on SPEC-v7 §3
(per-portrait feature flags), and SPEC-v7 §6 links back to it. SPEC.md §13
listed "public third-party API" and "mobile-native apps" as non-goals. This
spec lifts both. Anything decided without the owner is marked **[P]**, and §5
turns each one into a numbered question with a recommended default.

---

## 0. Summary

- **What the app is.** A read-only companion to the public plane. People find
  a portrait (any listed city, or the NYC family and its five boroughs),
  follow it, and read it: the doughnut, its dimensions, evidence, progress,
  ways to get involved and, where the portrait has the feature turned on, the
  emergency view. It works offline and in all 12 public-plane languages. It
  does no research, no review, no admin, and shows no AI output.
- **Stack.** Expo (React Native, TypeScript) as `apps/mobile` in this
  monorepo. It reuses `@deep-fryer/core`, `@deep-fryer/contract`, and the
  language catalogs, which move into a package. React Native Skia draws the
  doughnut from a geometry module the web also uses, so both draw identical
  shapes. §2.2 also costs a cheaper option honestly: the existing PWA, plus
  web push, plus an Android Trusted Web Activity.
- **Most of the work is in the backend, and it is needed whatever client we
  choose.** The web app renders pages straight from the database. Its only
  JSON is the open-data endpoint `/api/v1/portraits/{slug}` (plus progress).
  That endpoint has:
  - no directory of portraits;
  - no change signal and no ETag;
  - no feature flags;
  - no CDN;
  - no notion of a device, or of a session that isn't a cookie.

  §3 lists 21 hurdles. These five matter most:
  1. a public read API that apps can depend on, with a typed contract;
  2. a per-portrait public revision number, so clients and caches know what
     changed;
  3. a caching model a CDN can serve, so the rush of app opens after a push
     doesn't land on the database;
  4. push notifications, none of which exists yet: a device registry,
     follows, an outbox written in the same transaction as the change,
     batched fan-out, and deduplicated alerts;
  5. sign-in on mobile, if we allow posting. Server actions and cookie
     sessions don't work from a native app, and Apple adds three
     requirements: Sign in with Apple, in-app account deletion, and
     reporting and blocking for user content.
- **Phases.** v0 backend API and flags (3–4 engineer-weeks), then v1 viewer
  in the stores (6–8), then v2 notifications (3–4), then optional v3 posting
  (4–5).

---

## 1. Product

### 1.1 Who it is for

| Who | Comes for | Needs most |
|---|---|---|
| Residents | "How is my borough doing?", what they can do, information on a storm day | Follow and notifications, status in plain words, ways to get involved, the emergency view, their own language, offline use |
| Journalists | Numbers they can cite | An evidence snapshot, source, version and publish date beside every value; shareable links; the CSV |
| Council and agency staff | A briefing on a phone between meetings, or comparing boroughs | Progress against adopted targets, family compare, offline use in a basement hearing room |
| Students | Learning the doughnut from real data | A short explainer, methodology, compare, no account needed |

### 1.2 Scope

| The app does | The app does not |
|---|---|
| Discover and search portraits; follow them | Create, configure, or research portraits ("not to create donuts") |
| Show the core view (SPEC-v7 §2): doughnut, detail panel, dimension list, legend, family switcher | Review, publish, edit, or manage members, billing, or settings. Staff use the web. |
| Show dimension pages with indicators, targets, sources, evidence, and actions | Policy analysis (staff plane, SPEC-v5 §2) or any AI-written text (SPEC §3: the public plane shows no AI) |
| Show progress, ways to get involved, the emergency view, and compare | Originate emergency alerts or replace official alert systems (SPEC-v5 §1) |
| Show discussion read-only; posting comes in v3 if the owner wants it | Translate research content, listings, comments, or alert text (docs/language-access.md) |
| Work offline; send notifications (v2) | Track users, show ads, or run analytics SDKs |

A staff member who signs in (v3) sees nothing extra. Admin links open the
web.

### 1.3 Screens

| # | Screen | Contents | Data (§3) | Feature flag |
|---|---|---|---|---|
| 1 | **Discover** | Search by name or region over the directory. Results are grouped by organization; NYC shows New York City, then Bronx, Brooklyn, Manhattan, Queens, and Staten Island in `family_order`. Each row has the name, region, population, "N of 21 outside the doughnut", the last publish date, and Follow. Families also get a "Follow all". | `GET /api/v1/directory` | — |
| 2 | **My portraits** | One card per followed portrait: a small doughnut, status counts, an "Updated" badge since the last visit, and offline state. Cards can be reordered. Pull to refresh. | Local store + directory revisions | — |
| 3 | **Portrait** | The SPEC-v7 §2 core view, laid out as on the web's mobile layout: doughnut, then the panel for the selected dimension, then the dimension list (SPEC-v6 §2.1), then the legend. Family pills switch between members. Links go to Progress, Get involved, Emergency, Compare, and Methodology. Tapping a wedge **selects** it rather than navigating away, because SPEC-v6 found mis-taps on a 300 px doughnut. Pinch zooms the doughnut. | Bundle | The Compare link needs `family_compare`; the Emergency link needs `emergency` |
| 4 | **Dimension** | Ring, status in words, and context. For each indicator: value with unit (`formatIndicatorValue`), year, target, geographic scale, source, confidence, and an evidence thumbnail. Then data gaps, "What you can do" (curated actions), listings, and the discussion. | Bundle; comments endpoint | Listings need `involvement`; discussion needs `discussion` |
| 5 | **Evidence** | The captured snapshot, zoomable (a preview first, then the full capture), its capture date, the original PDF, the source link (opens in the browser), and "Copy citation" (portrait, dimension, version, publish date, source). | `/files/…` derivatives (H8) | — |
| 6 | **Sources** | Every source in the portrait with its tier, year, and link. Mainly for journalists. | Bundle | — |
| 7 | **Get involved** | Curated actions for each dimension. Listings filtered by kind (volunteer, services, civic, organize, other) with "Checked by staff on …", tap-to-call phone numbers, and links. "Put your organization forward" opens the web form in the in-app browser [P]. | Bundle | Actions are core; listings need `involvement` |
| 8 | **Progress** | As in SPEC-v4 §4: on or off track, improving or worsening, baseline, latest value, target and its year, the pace required, a sparkline, and the data-gap list. | Bundle | Core, unless SPEC-v7 §7 Q1 says otherwise |
| 9 | **Emergency** | As in SPEC-v5 §3, in the same order: active alerts as issued (in English, linked to the NWS), how to get official alerts (sign-up link, tap-to-call emergency and information lines), threats by risk (selecting one marks its threatened dimensions on the doughnut), plans, and help and mutual aid. The SPEC-v5 offline rules apply. | Alerts endpoint + bundle | `emergency` |
| 10 | **Compare** | Within a family: doughnuts side by side and the indicator matrix (the logic now inside `apps/web/app/o/[org]/compare/page.tsx`, moved into core). For any two followed portraits from different families: dimension statuses only, labelled "measured independently" [P]. | Bundles | `family_compare` for family compare |
| 11 | **Discussion** (read) | Threads per dimension, sorted by top or new, with the Staff label (SPEC-v6 §3.3). Until v3, "Sign in on the web to comment" opens the web page. | Comments endpoint | `discussion` |
| 12 | **Settings** | Language (12), theme (light, dark, or system), notifications per portrait (v2), offline storage used plus a clear button, account (v3), and About: methodology, privacy policy, support email, and licenses (including the renderer's MIT notice). | — | — |

**First launch:** two explainer screens ("How to read the doughnut", copy
from the catalogs), then Discover. There is no account step. The app asks for
notification permission only when the person turns a notification on.

### 1.4 What "subscribe" means

The UI calls it **Follow**, because "subscribe" reads as paying [P].

| | v1 | v2 | v3 (optional) |
|---|---|---|---|
| Where the follow list lives | Only on the device | On the device. Mirrored to the server anonymously, only for portraits with a notification turned on. | Also on the account, so it moves between devices |
| What following does | Adds the portrait to My portraits, keeps its data offline, shows "Updated" badges | Adds notifications | Adds sync across devices |
| What the server knows | Nothing | A push token, platform, language, time zone, and which notifications each followed portrait should send. No account and no IP address. | The account's follow list |

Following an organization means following each of its portraits (NYC has
six). The app offers "Follow all" and also each borough on its own.

### 1.5 Notifications (v2)

| Kind | Fires when | Default | Example: interface text translated, content as published |
|---|---|---|---|
| New publication | Staff publish or revert dimensions. A burst is batched into one notification per portrait per 30 minutes, at most one a day [P]. | On for followed portraits | "Brooklyn: 4 dimensions updated" |
| Progress change | An indicator's progress status changes (for example from on track to off track) after a publication or a target change | On | "Brooklyn: 2 goals changed status" |
| Official alert | The NWS issues a new **warning** for the portrait's zones, and the portrait has `emergency` on | **Off until the person turns it on for that portrait** [P] | "National Weather Service · Brooklyn: Excessive Heat Warning until 8 PM Tue. Tap for official instructions." |

Rules:

- No marketing pushes, and never an "all clear".
- Every alert names and links its issuing authority, and the screen it opens
  offers the official sign-up (Notify NYC).
- A device gets one push per NWS alert, even when several followed portraits
  share its zone.
- Quiet hours run 21:00–08:00 in the device's time zone and apply to
  everything except alerts [P].
- Warnings use iOS's "time-sensitive" level. The app never uses Critical
  Alerts.
- If a portrait's `emergency` feature is turned off, its alert pushes stop
  at the next send.

### 1.6 Offline

Everything about a followed portrait is readable offline: the doughnut,
panel, and dimensions, progress, get involved, the emergency view's curated
content, and the last alerts fetched.

Saved alerts keep the SPEC-v5 §3 safeguards, using core's `alertIsCurrent`
and `ALERTS_STALE_AFTER_MS`:

- the screen says when alerts were last checked;
- it never says "no alerts" without that time;
- an alert whose end time has passed is shown as ended.

Evidence thumbnails for followed portraits download ahead of time on Wi-Fi.
Full screenshots and PDFs download only when opened. When the app is offline
or the data is stale, every screen shows "Published data as of {date} ·
checked {time}". The storage design is in H9.

### 1.7 Languages

The app uses the 12 public-plane languages in
`apps/web/lib/i18n/locales.ts` and the same rule as the web
(docs/language-access.md).

- **Translated:** the interface, explanations, statuses, and the framework's
  own vocabulary.
- **Shown as published (English):** research content, listings, comments, and
  alert text. These screens carry the English-content notice and the
  organization's language access contact (NYC: 311).

Arabic and Urdu lay out right to left; the doughnut stays left to right, as
on the web. The app follows the device language, the per-app language
setting on iOS and Android, or a choice made in Settings. How the
per-portrait `translation` flag applies is covered in H14 and question 10.

### 1.8 Accessibility

The target is WCAG 2.1 AA, which two rules require:

- NYC Local Law 26;
- the 2024 ADA Title II rule, which covers mobile apps that a public entity
  provides "directly or through contractual arrangements" and adopts WCAG
  2.1 AA, with compliance dates in 2026–2027 depending on population.

Specifics:

- **The doughnut** is a single image element. Its label is the summary
  `PortraitDoughnut.tsx` already generates ("Manhattan: 9 of 21 dimensions
  outside…"). The dimension list directly below it is the accessible route to
  every dimension (SPEC-v6 §2.1), and the panel announces each change of
  selection.
- **Screen readers (VoiceOver, TalkBack):** every control has a label, and
  status is always given in words, never by colour alone. On iOS, English
  content gets `accessibilityLanguage="en"` so it is read in an English voice
  inside a translated screen. React Native has no Android equivalent; this is
  a known gap.
- **Text size (Dynamic Type, font scale):** all text scales. Labels drawn on
  the canvas can't usefully grow past about 1.3×, so the panel and the list
  carry the text.
- **Touch targets:** at least 44 pt on iOS and 48 dp on Android.
- **Reduce Motion:** hazard and policy marking is static, as SPEC-v5 §1
  requires. Nothing flashes.
- **Audit:** real VoiceOver and TalkBack users test the app before v1 ships.

### 1.9 Discussion

Discussion is read-only through v2. Threads, Staff labels, and the rules for
held comments work as on the web. Posting is optional and comes in v3 [P].
Posting turns the app into a user-content app under store rules (H13) and
needs accounts on mobile (H12).

### 1.10 Links and sharing

Every screen shares its web URL, which works for people without the app. Web
URLs open the app when it is installed (H16).

---

## 2. Technical approach

### 2.1 Recommendation

Expo (managed workflow, current SDK) with React Native and strict TypeScript,
as `apps/mobile` in the pnpm workspace.

| Concern | Choice |
|---|---|
| Navigation and deep links | Expo Router. Its URL-shaped routes mirror the web's (`/{tenant}`, `/{tenant}/dim/{slug}`, `/o/{org}`). |
| Data | TanStack Query over typed fetchers. Every response is checked against the API contract's zod schemas (H5). |
| Offline store | expo-sqlite for bundles, the directory, and alerts; a file-system cache for images |
| Doughnut and sparklines | `@shopify/react-native-skia` |
| Push | expo-notifications for the permission prompt and the native APNs or FCM device token. Sending is done by our own worker (H10). |
| Secrets (v3) | expo-secure-store (Keychain on iOS, Keystore on Android) |
| Sign-in (v3) | expo-web-browser auth sessions (ASWebAuthenticationSession on iOS, Custom Tabs on Android), and expo-apple-authentication |
| Builds and updates | EAS Build/Submit or local CI builds. expo-updates ships JavaScript-only fixes and can be self-hosted [P]. |
| Tests | Vitest for logic (as in the rest of the repo), Maestro flows on simulators, golden-image tests for the doughnut |

What the app reuses from the repo:

| Package | What the app uses it for |
|---|---|
| `@deep-fryer/core`, through a new `@deep-fryer/core/client` subpath | `formatIndicatorValue`; progress statuses and labels; emergency helpers (`alertIsCurrent`, `ALERTS_STALE_AFTER_MS`); types (`DimensionData`, `Indicator`, `Ring`, `TenantBranding`); the SPEC-v7 feature registry; compare rows (moved out of the page) |
| `@deep-fryer/contract` | Framework dimensions and slugs, thresholds, and the new API JSON Schemas (H5) |
| `packages/i18n` (new, moved out of `apps/web/lib/i18n`) | The locales, the 12 catalogs, `fmt`, `fmtPlural`, `dimensionLabel`, `scaleLabel` |
| `packages/doughnut` (new, taken out of the vendored renderer) | The geometry and the list of drawing operations that both the web and the app execute (§2.3) |

Monorepo notes:

- **Import suffixes.** Core imports with `.js` suffixes (`./types.js`) for
  NodeNext. Metro needs a small resolver shim, or core needs a build step
  [P: shim].
- **Client-safe exports.** `packages/core/src/index.ts` also exports server
  code: `preflight`, `deploy-env`, `stripe-endpoint`, and `policy`, which
  calls `crypto.getRandomValues`. The `client` subpath exports only what a
  client needs.
- **React version.** React 19 across the web and the app.
- **pnpm.** Check the chosen Expo SDK's monorepo support. If Metro has
  trouble with pnpm's symlinked layout, fall back to `node-linker=hoisted`
  for the mobile package.

### 2.2 Alternatives

| Option | Shares TS code with the repo | Doughnut | Push and offline | Store risk | Cost to v1, after v0 | Verdict |
|---|---|---|---|---|---|---|
| **Expo / React Native** | Yes, directly | Skia port, nearly pixel-identical | Native and reliable | Low | 6–8 weeks | **Recommended** |
| Native Swift + Kotlin | No: formatting, progress, and i18n rewritten twice | Two ports (CoreGraphics and Android Canvas) | Best | Low | About 2× | Not worth it for a read-only viewer |
| Flutter | No (Dart) | Port to Flutter's canvas | Native | Low | About 1.3× | Good technology, wrong language for this repo |
| Capacitor wrapped around the web app | Yes | The web canvas as it is | Through native plugins | **High on iOS.** Apple Guideline 4.2 rejects repackaged websites, and a server-rendered Next app inside a WebView needs the network for every page. | 2–4 weeks | Not recommended |
| **The PWA as it is, plus web push and an Android TWA** | Yes | The web canvas as it is | Web Push works on Android. On iOS it works from 16.4 onward, and only after the person adds the site to the Home Screen. Offline comes from `sw.js`. | No iOS listing at all. Google Play accepts Trusted Web Activities. | About 3 weeks, including web push | **The honest cheap option** |

The honest case for the PWA:

- SPEC-v6 and SPEC-v7 already make the web portrait work on a phone (the
  panel and the list), and `public/sw.js` already handles offline.
- The backend in §3 (directory, follows, push) is needed for this option too,
  so none of it is wasted.

What the PWA lacks:

- an App Store listing, which is where residents and procurement teams look;
- reliable push on iOS, because most residents won't add a site to their
  Home Screen;
- native gestures and accessibility for the doughnut.

Recommendation: build v0 regardless, then the Expo app. But if the goal for
2026–27 is only "residents can follow a portrait and get notified", the PWA
with web push gets there in about a third of the time (question 1).

### 2.3 Drawing the doughnut natively

The renderer is `apps/web/components/doughnut/doughnut-renderer.js`, vendored
under MIT from doughnut-santa-cruz. It uses a small part of Canvas 2D:

- `arc`, `stroke`, and `fill`;
- two radial gradients;
- shadows under the labels;
- `setLineDash`;
- `fillText` and `measureText` in `"{n}px Arial"`;
- `roundRect` for the pills on marked dimensions;
- `isPointInPath` for hit-testing.

`Doughnut.tsx` sets the canonical colour mode with
`setColours(2, 1, '#883251', '#E096C6')`.

| Approach | Fidelity | Cost | Accessibility and gestures | Verdict |
|---|---|---|---|---|
| **Skia port with shared geometry** | The same shapes on both platforms by construction. Skia also draws Chrome's canvas, so pixels come out very close. | 1–1.5 weeks including tests | Native gestures; `Path.contains` for hit-testing | **Recommended** |
| WebView running the vendored file from a bundled local page | Pixel-identical | 2–3 days | Taps cross the bridge via `postMessage`; each screen pays WebView start-up time and memory; accessibility goes through the web view | Fallback if parity slips |
| Rewrite in react-native-svg | Approximate: a different rasterizer, and shadows and gradients differ | 1 week | Good | No |

Plan:

1. **Extract `packages/doughnut`.** It is pure TypeScript. Given
   `{social, ecological, levels, marks, size}`, it returns a list of drawing
   operations (arcs, rings, gradient specs, label positions, pills) and the
   hit regions. The existing drawing math moves across unchanged; the MIT
   header and the notes on our modifications go with it. The web keeps a
   Canvas 2D executor, so nothing visible changes. The app adds a Skia
   executor. Marked dimensions (`ImpactDoughnut`, `HazardDoughnut`) come
   along too.
2. **Golden-image parity tests.** Render fixtures with the web executor in
   Playwright's Chromium and with Skia headless (CanvasKit in Node), and fail
   CI when the pixel difference exceeds a set budget. Fixtures: the NYC six,
   Santa Cruz, a portrait with many gaps, right-to-left labels, and marked
   hazards. The renderer has no test today, so the web gains one too.
3. **Text.** Labels are translated, so they include Bengali, Arabic, Urdu
   Nastaliq, and Chinese and Korean. The browser's canvas shapes these
   scripts automatically. In Skia, use the Paragraph API with the system font
   manager, which handles shaping, bidirectional text, and fallback fonts.
   Bundle Arimo (metrically compatible with Arial, Apache-2.0), because
   Android has no Arial and Latin labels must measure the same. Check Urdu's
   line heights against the label band.
4. **Touch.** A tap selects a dimension and fills the panel; it doesn't
   navigate. The tap target is widened with the renderer's existing
   angle-based fallback on the label band. Pinch and double-tap zoom.
   There is no hover on a phone, so a long press shows the tooltip's content.
5. **Resolution.** Draw at the device's pixel ratio. The web canvas has a
   fixed 720 px intrinsic size that CSS scales, so the native drawing is
   sharper while the geometry stays identical.
6. **Timing.** SPEC-v7 §7 Q2 may switch the look to Santa Cruz's
   status-coloured D3 view. Port after that decision. The shared geometry
   module works for either look (question 12).

### 2.4 App architecture

- **Data flow.** On launch or return to the foreground, the app calls
  `GET /api/v1/directory` with its ETag and compares revisions with what it
  has. It then fetches the changed bundles for followed portraits. Screens
  always render from the local store; the network only refreshes it.
- **Deployments.** Each build has one API base URL (production or staging).
  Directory entries carry an `api_base` so the app can support more than one
  deployment later (H19).
- **Privacy.** No analytics SDK, no advertising IDs, and no tracking prompt.
- **Theme.** Light, dark, and system themes, with tokens that match
  `app/theme-dark.css`.
- **Offline and error states.** These are first-class: the cached copy plus a
  banner, as `sw.js` does today. A long-press "deep fry" easter egg that
  respects the deployment's `deep_fry` flag (SPEC-v7 §3.1) can come later;
  it is not in v1.

---

## 3. Backend hurdles

Today the web renders server-side from Postgres. Writes are Next server
actions, sessions are cookies, and the only JSON is the open-data endpoint.
Each hurdle below covers what exists today and what we propose; the table
says which phase needs it.

| # | Hurdle | Today | Proposal | Phase |
|---|---|---|---|---|
| H1 | Public read API apps can depend on | `/api/v1/portraits/{slug}` and progress only | Extend `/api/v1` (directory, bundle, alerts, comments) plus `/api/app/v1/config` | v0 |
| H2 | Portrait directory | None. Every non-archived tenant is public, trials included. | `organizations.listed` and a definer function; search on the device | v0 |
| H3 | Change signal | Publishing moves one dimension pointer at a time; reverts happen; there is no portrait-level event | A `portrait_revisions` counter bumped by triggers | v0 |
| H4 | Caching and load | `force-dynamic`, no ETag, no CDN, no cache in Caddy | ETag/304, `s-maxage`, immutable revision URLs, a CDN before v2 | v0 / v2 |
| H5 | Typed contract | `PublishedPortrait` is defined inside `apps/web` | JSON Schemas in contract, zod in core, OpenAPI | v0 |
| H6 | Feature flags in the API | `features` isn't public (v7 makes it public); the kill switch lives in env | Report resolved flags; omit off data; 404 off endpoints | v0 |
| H7 | RLS for anonymous JSON | Comment bodies, author ids, and voter ids are readable by the app role | Definer projections; RLS tests on the API output | v0 |
| H8 | Evidence on phones | Multi-MB full-page PNGs | WebP thumbnail and preview derivatives, and a backfill job | v0 |
| H9 | Offline sync and storage | `sw.js` page cache only | Revisions plus bundles in SQLite; LRU cache for images | v1 |
| H10 | Push notifications | Nothing exists | Device registry, outbox, batched fan-out, direct APNs and FCM | v2 |
| H11 | Alert pushes | `alerts_sync` can't tell a new alert from an updated one; the six NYC portraits duplicate alerts | Keep VTEC and references; dedupe per device | v2 |
| H12 | Sign-in on mobile | Cookie sessions and server actions | Bearer app tokens, PKCE in the system browser, email codes, Sign in with Apple | v3 |
| H13 | Discussion API and content rules | Server actions only; no way to report or block | Shared service functions, reports, blocks, terms | v3 |
| H14 | Localization | Catalogs live inside `apps/web` | `packages/i18n`; language-neutral API; push text written per locale | v0 / v2 |
| H15 | Versioning | — | Additive-only `/v1`, minimum app version, a 12-month overlap | v0 |
| H16 | Deep links | — | AASA and assetlinks with path exclusions | v1 |
| H17 | Privacy and analytics | No privacy or terms pages | `/privacy`, `/terms`, privacy labels for each phase | v0 |
| H18 | Store review risks | — | See the table in H18 | v1 / v3 |
| H19 | Self-hosted deployments | One app can't reach them | The app covers the hosted deployment only; leave room to federate | [P] |
| H20 | Operations | — | Developer accounts, signing keys, release cadence, crash reports | v1 |
| H21 | Cost | — | See the table in H21 | — |

### H1. A public read API apps can depend on

**What exists:**

- `apps/web/app/api/v1/portraits/[tenant]/route.ts` returns
  `published_doughnut()` as `deep-fryer.portrait/v1`. It is CORS-open, sends
  `cache-control: public, max-age=300`, runs `force-dynamic`, and sets
  `generated_at` to the current time.
- `progress.json` and `progress.csv` sit beside it.
- Involvement, emergency, outreach, family, discussion, and methodology exist
  only as server-rendered pages.
- Writes are server actions. A native client can't call them, because their
  ids change with every build.

**What the app is missing:** a directory, revisions or ETags, flags, the
organization and family, evidence URLs, and everything outside the doughnut
and progress. On evidence: today a client would have to know
`S3_PUBLIC_URL` and the `evidencePublicBase` layout to build a URL.

**Proposal:** extend `/api/v1` additively. It stays the open-data API, and the
app uses the same endpoints third parties do.

| Endpoint | Returns | Caching |
|---|---|---|
| `GET /api/v1/directory` | Listed organizations and their portraits. For each portrait: slug, name, short name, region, population, `family_order`, whether it is the family's whole-city portrait, revision, last publish date, status counts, resolved flags, available languages | ETag; `s-maxage=60`; stale-while-revalidate for 1 day |
| `GET /api/v1/portraits/{slug}` (exists; additions only) | Adds revision, flags, organization, and absolute evidence URLs | ETag; `s-maxage=300` |
| `GET /api/v1/portraits/{slug}/bundle?rev=N` | One consistent snapshot for offline use: portrait, progress, family, curated actions, listings (if `involvement`), outreach, the emergency config with hazards, plans, and resources (if `emergency`), and the methodology inputs (the public config keys) | If `rev` is current: `immutable`, 1 year. Otherwise a 302 to the current revision. |
| `GET /api/v1/portraits/{slug}/alerts` | Active alerts plus sync state (`last_success_at`, a stale flag) | `s-maxage=60`; 404 when `emergency` is off |
| `GET /api/v1/portraits/{slug}/dimensions/{dim}/comments?sort=&cursor=` | The public comment projection (H7), paginated by cursor | `s-maxage=30`; 404 when `discussion` is off |
| `GET /api/app/v1/config` | Minimum and latest app version per platform, deployment kill switches, an optional notice | `s-maxage=300` |

Build every endpoint from the functions the pages already use
(`getPortrait`, `tenantProgress`, `emergencyView`, and the v6 listings
reader), so a page and its API can never disagree. Each one reads inside
`userDb` with no user, so only the public RLS policies apply. The API output
drops two `tenants.branding` fields, `footer_html` (raw HTML) and `font`, and
sends `logo_url` only when it is https.

### H2. A directory of portraits

**Today:**

- Nothing lists portraits.
- `tenants_public_read` is `archived_at IS NULL`, so 30-day trials from
  `/start` are public even when nothing is published.
- Tenants have no coordinates (`region` is free text).

**Proposal:**

- **Listing rule.** Add `organizations.listed`, an owner setting that
  defaults to on for paid plans and off for trials [P]. A portrait appears
  in the directory when its organization is listed and it has at least one
  published dimension.
- **Enforcement.** A `SECURITY DEFINER public_directory()` function applies
  that rule, so the rule lives in the database.
- **Search.** Ship the whole directory (dozens to hundreds of rows, tens of
  KB) and search on the device. That avoids building a search endpoint, and
  search terms never leave the phone.
- **Pagination.** Add a cursor only once the directory passes about 1,000
  portraits.
- **"Near me".** This needs a centroid for each portrait, with the distance
  computed on the device. It is not in v1 [P].

### H3. A change signal

**Today:**

- Publishing moves `dimensions.published_version_id` one dimension at a time
  (`publishVersionFor` in `apps/web/lib/publish.ts`), and that includes
  reverts to older versions.
- There is no portrait-level "publication" event.
- Public content also changes through other paths: tenant fields; the public
  config keys (thresholds, progress baseline, emergency, and `features` after
  v7); hazards, plans, and resources; listings; outreach; and organization
  fields.

Versions never change once written, but the portrait as a whole does.

**Proposal:**

- **The counter.** Add `portrait_revisions(tenant_id, revision bigint,
  changed_at)`.
- **Triggers.** `SECURITY DEFINER` triggers on every public-plane table bump
  it inside the transaction that wrote the change. An organization change
  bumps each of its portraits. Alerts and comments are left out; they have
  their own endpoints and short cache lifetimes.
- **Uses.** The revision is the ETag, the bundle's cache key, the sync
  cursor the app stores, and the "fetch this" hint inside a push.
- **Test.** A schema test checks that every public-plane table has the
  trigger, in the same style as the dark-remap test.

### H4. Caching and load

**Today:**

- Every API call and every page render queries Postgres (`force-dynamic`).
- Caddy passes requests through without caching (`deploy/Caddyfile`).
- There is no ETag or Last-Modified, and no rate limit on reads.

**The risk:** a push to 50,000 devices makes many of them open the app within
a minute. That is hundreds of requests a second against one droplet, probably
at the worst time, such as during a storm.

**Proposal:**

1. **Conditional requests.** ETag = `"{slug}:{revision}:{schema}"`, and
   Last-Modified = `changed_at`. Answering a conditional request costs one
   indexed lookup and returns 304.
2. **Cache headers.** Every public read gets `s-maxage` plus
   `stale-while-revalidate`, and bundles use immutable revision URLs.
3. **A CDN before v2** [P]. Either put it in front of Caddy (and set Caddy's
   `trusted_proxies`, so the v6 rate limits still see residents' addresses,
   as docs/deploy.md warns), or write bundles to object storage on each
   revision and serve them through DigitalOcean Spaces' built-in CDN.
4. **Staggered pushes.** The fan-out is spread over a few minutes (H10).
5. **Jittered refreshes.** The app adds random delay to its background
   refreshes.

Rate limits are needed only on writes (device registration, comments). Those
can use counts kept in the database, as `involvement_submission_counts` does.
CORS stays `*` on `/api/v1` reads for third parties such as NYC Open Data.
`/api/app` sends no CORS headers: a native app doesn't need them, and
endpoints that take bearer tokens shouldn't be callable from browsers on
other sites.

### H5. A typed contract

**Today:** the portrait's shape is `PublishedPortrait` in
`apps/web/lib/portrait.ts`, an interface local to the web app laid over a
`jsonb` function result. The progress route maps its JSON by hand.

**Proposal:**

- Publish JSON Schemas for every response in
  `packages/contract/schemas/api/*.v1.schema.json`. Contract is already where
  the schemas external users rely on live.
- Mirror them in zod in core.
- Server tests check every endpoint's output against the schemas. The app
  checks responses when it receives them and again before caching them.
- Serve an OpenAPI document at `/api/v1/openapi.json` for third parties.

### H6. Feature flags in the API

**Today:** the `features` config key holds booleans but isn't publicly
readable (migration 0005). SPEC-v7 §3 adds the registry, makes the key
public, and adds a deployment kill switch, `DF_DISABLED_FEATURES`. That
switch lives in env, not in the database.

**Proposal:**

- The directory and the bundle report each portrait's **resolved** flags,
  meaning v7's `enabled(feature, portrait)`, and never the raw config. Only
  the server knows the kill switch.
- Data for an off feature is left out of the bundle, and that feature's
  endpoints return 404 ("off means gone", SPEC-v7 §3.3).
- Changing a flag bumps the portrait's revision.
- The app hides the screens, links, and notification switches for off
  features, and ignores flag keys it doesn't know.
- The notifier checks flags again at send time (H10).

### H7. RLS for anonymous JSON

**Today:** API reads run in `userDb` as `deep_fryer_app` with no user, so
only the public policies apply. Two gaps matter more once data is served as
JSON:

- `comments_public_read` and `comment_votes_public_read` are both
  `USING (true)` (migration 0001).
- So the app role can read held and removed comment bodies, `author_id`s,
  and each vote's `user_id`.
- The web hides these in code (`dimensionThread` in
  `apps/web/lib/discussion.ts`). A JSON serializer that spreads the whole row
  (`...row`) would leak them.

**Proposal:**

- **Comments.** Add a `SECURITY DEFINER public_thread(tenant, dimension,
  sort, cursor)` that returns only the safe projection: pseudonym or display
  name, the body unless removed or held, score, lock state, and the staff
  flag. The API serializes only from it. A signed-in caller (v3) also gets
  their own held comments and votes.
- **Directory and flags.** Use definer functions, as described above.
- **New tables.** The push, device, and token tables give the app role no
  grants at all and are used only in the system context, as `accounts` and
  `sessions` already are.
- **Tests.** Extend `packages/db/src/rls.test.ts` to show that the bundle
  and thread for a portrait with drafts, unpublished hazards or listings, and
  held comments contain none of them.

### H8. Evidence on phones

**Today:**

- Each snapshot is a full-page PNG from Playwright
  (`page.screenshot({ fullPage: true })` in `apps/worker/src/evidence.ts`),
  often several MB. PDFs are optional.
- The objects are public and named by a content hash
  (`sha256(url + captured_at)`), never overwritten, and served at `/files/…`
  with immutable caching.
- The dimension page downloads the full PNG just to draw a 224 px-high
  thumbnail.

**Proposal:**

- **Smaller images.** At capture time the worker also writes two derived
  images: `<hash>.thumb.webp` (about 480 px wide) and `<hash>.preview.webp`
  (the first couple of screens at 1080 px). These are new objects; the
  original stays the record.
- **Backfill.** A one-time job creates the same images for all published
  evidence. It needs an image library in the worker, such as sharp.
- **URLs.** The API sends absolute `thumb_url`, `preview_url`,
  `snapshot_url`, and `pdf_url`, with byte sizes.
- **Keep evidence public.** It is the public record, and signed URLs would
  break CDN and offline caching. Keys of unpublished findings still appear
  nowhere public, so nothing changes there.
- **Shared with the web.** The panel thumbnails in SPEC-v7 need the same
  derived images. Build them once.

### H9. Offline sync and storage

**Proposal:**

- **Sync protocol.** Nothing new: the directory's revisions (H1, H3) say
  which bundles changed.
- **Bundles.** We estimate 100–300 KB of raw JSON per portrait; measure this
  on NYC. Bundles go in SQLite under Application Support, which the system
  doesn't purge, and are excluded from iCloud backup, as Apple's storage
  guidelines require for data that can be downloaded again.
- **Images.** These go in the Caches directory with an LRU cap (200 MB by
  default [P]). Full screenshots and PDFs are never downloaded ahead of time.
  Thumbnails for followed portraits download ahead of time on Wi-Fi only.
- **Unfollowed portraits.** Recently viewed ones stay in a small LRU (five
  portraits). Unfollowing a portrait deletes its data.
- **Background refresh.** On iOS it runs whenever the system allows. In v2, a
  publication also sends a data-only push that wakes a refresh. iOS limits
  how often these arrive, which is fine for an event that happens at most
  once a day.

### H10. Push notifications

**Today:** nothing exists. There is no device registry, `sw.js` has no push
handler, and the only notifications are staff emails
(`apps/worker/src/notify.ts`).

**Proposal:**

**Tables** (system context only, with no app-role grants):

- `push_devices`: id, secret hash, platform, unique token, locale, time
  zone, app version, `created_at`, `last_seen_at`, `invalid_at`.
- `push_subscriptions`: device, tenant, and three switches (publications,
  progress, alerts).
- `portrait_notify_state`: tenant, the revision last notified, and a
  snapshot of progress statuses.
- `push_events`: kind, tenant, unique dedupe key, created and sent times,
  and counts of recipients and failures. Counts only; there is no
  per-device delivery log [P].

**API:**

- `POST /api/app/v1/devices` returns `{device_id, device_secret}`.
- `PUT /devices/{id}` handles token rotation, locale, and time zone.
- `PUT /devices/{id}/subscriptions` replaces the device's whole list.
- `DELETE /devices/{id}` removes the device.

The device secret is stored in Keychain or Keystore. Registration is limited
per network address, using a keyed hash as v6 does.

**Enqueueing:**

- Jobs are added in the same transaction as the change, using
  graphile-worker's `add_job` from SQL.
- A publication enqueues `notify_publication` with
  `job_key = notify_pub:<tenant>` in replace mode and `run_at = now() + 30
  min`. A bulk "Publish reviewed" therefore collapses into one notification.
- The job compares the revision and the progress statuses (computed with
  `indicatorProgress`) with `portrait_notify_state`.

**Runner:** a third graphile runner, `notify`, alongside the alerts runner
in `apps/worker/src/runners.ts`, so a 40-minute research session never holds
up a push.

**Transports:**

- The worker calls APNs (HTTP/2, with a `.p8` token key) and FCM HTTP v1
  (with a service account) directly. No third-party push relay sees the
  content or who follows what [P; the alternatives are Expo's push service or
  FCM topics].
- FCM v1 sends one message per request, because the batch endpoints are
  retired. The worker fans out over HTTP/2 concurrency with a rate cap, so
  the rush of app opens spreads over a few minutes.

**Text:** written in each device's language from the shared catalogs (H14).
Only the interface text is translated; content such as indicator names and
alert event names stays as published.

**Quiet hours:** a non-alert push that falls between 21:00 and 08:00 in the
device's time zone waits until 08:00.

**Upkeep:**

- Delete a token when APNs answers 410 or FCM answers UNREGISTERED.
- Purge devices not seen for 90 days [P].
- Nothing else reveals an uninstall.

**Flags:** resolved at send time. If a feature is off, nothing is sent; the
subscriptions stay stored but inactive.

**Credentials and preflight:**

- `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_TOPIC` (the
  bundle id), and `FCM_SERVICE_ACCOUNT` go in the worker's environment only.
- `scripts/preflight.ts` proves them without a real user. For APNs, a send to
  a well-formed but unknown token must fail with BadDeviceToken, not
  InvalidProviderToken. For FCM, a `validate_only` send must succeed.

**Privacy:** no account, no IP address, and no per-device message history.
Deleting the device record deletes everything.

### H11. Alert pushes

**Today:**

- `alerts_sync` (every five minutes, `apps/worker/src/tasks/alerts-sync.ts`)
  upserts each portrait's alerts keyed by (tenant, source, source_id) and
  deletes the ones that have gone, so it can't tell a new alert from a
  refreshed one.
- `parseNwsAlerts` (`packages/core/src/emergency.ts`) throws away
  `references` and VTEC. The NWS issues updates and extensions under new ids
  that point back to the original, so without those fields an update looks
  like a new alert.
- The six NYC portraits share zones, so one warning can be stored six times.

**Proposal:**

- **Keep the fields.** Store `references`, `messageType`, and the VTEC
  event key (office, phenomenon, significance, and event number).
- **Detect inserts** with `RETURNING (xmax = 0)`.
- **Decide what to send.** Enqueue `notify_alert` only for a new VTEC event,
  not its updates; only if its severity passes the rule (warnings, Severe or
  Extreme [P]); and only for portraits with `emergency` on.
- **Deduplicate.** A device gets one push per VTEC key across all its
  portraits, with `apns-collapse-id` and FCM `collapse_key` set to that key.
- **Be honest about delay.** A push can arrive up to five minutes after the
  NWS issues an alert, plus fan-out time. The app says it may arrive after
  Wireless Emergency Alerts and Notify NYC, and that it is not an alerting
  system (SPEC-v5 §1).
- **Wording.** The title names the source ("National Weather Service"). The
  body is the event as issued, the area, and the expiry. There is never an
  all-clear. Tapping opens the emergency screen with the official
  instructions and the official sign-up.
- **Interruption level.** No Critical Alerts entitlement. Only warnings use
  iOS's time-sensitive level.

### H12. Sign-in on mobile (v3 only)

**Today:** Auth.js v5 keeps database sessions in an HTTP-only cookie
(`apps/web/auth.ts`). People sign in with Google, Microsoft Entra, or magic
links (valid 15 minutes, at most three outstanding), and changes go through
server actions. A native app can call none of this, and a magic link opens
the browser rather than the app.

**Proposal:**

- **App tokens.** Opaque 256-bit bearer tokens stored only as hashes (as
  invitations are) in `app_tokens`: user, label, created, last used, and
  expiry. Expiry is 90 days, extended on use [P]. The API looks up the token
  in the system context, then runs `withAuthContext(db, userId, …)`, so RLS
  is unchanged. `signOutEverywhere` and `deleteAccount`
  (`apps/web/lib/account-actions.ts`) revoke these tokens too.
- **Google and Microsoft.** Sign-in runs in a system-browser auth session
  (ASWebAuthenticationSession or Custom Tabs; Google refuses embedded
  WebViews):
  1. The app opens
     `/api/app/v1/auth/start?provider&code_challenge&state`, which calls
     Auth.js `signIn`.
  2. After the provider, `/api/app/v1/auth/finish` exchanges the fresh web
     session for a one-time code tied to the PKCE challenge, deletes that web
     session, and redirects back to the app.
  3. The app calls `POST /api/app/v1/auth/token {code, verifier}` and gets
     its token.

  This reuses the Auth.js providers and their registered redirect URIs, so
  no new OAuth clients are needed. The routes live under `/api`, because
  `app` isn't a reserved slug.
- **Email.** The sign-in email carries a 6-digit code next to the link, and
  the person types the code into the app. This works even when the email is
  read on another device. It uses the same table and throttle as magic
  links, with five attempts per code. A universal link can still open the
  app from the email link, as a convenience.
- **Sign in with Apple.** Required on iOS if Google is offered (App Store
  Guideline 4.8):
  - The app uses the native button (expo-apple-authentication). The server
    checks the identity token against Apple's keys and records it in
    `accounts` with provider `apple`.
  - People who hide their email get an `@privaterelay.appleid.com` address.
    The sending domain must be registered with Apple's relay, or our mail
    bounces.
  - Deleting an account must also revoke the person's Apple tokens through
    Apple's REST API.
- **Account deletion.** Deletion is available in the app (Guideline
  5.1.1(v)) and reuses `deleteAccount`'s behaviour: comments stay, shown as
  "Deleted account". Google Play also requires a web link for deletion;
  `/account` already provides one.
- **App Review.** Apple's reviewers need a working account. Use a
  review-only account with a fixed email code, switched on by env only while
  a review is in progress [P].

### H13. Discussion API and content rules (v3)

**Today:**

- Discussion runs through three server actions: `postComment`,
  `voteComment`, and `moderateComment` (`apps/web/lib/discussion-actions.ts`).
  They enforce 5 posts per minute, a 10,000-character limit, held first
  posts, and locks.
- Residents can't report a comment or block a person, and there are no terms
  of use.

**What the stores require:** Apple's Guideline 1.2 and Google Play's
user-generated-content policy require apps that host user content to have:

- a filter for objectionable material;
- a way to report content, with a timely response;
- a way to block abusive users;
- published contact details;
- terms that users accept.

**Proposal:**

- **One rule set.** Move the bodies of the server actions into shared server
  functions that both the server actions and the `/api/app/v1` routes call.
- **Reports.** Add `comment_reports` (comment, reason, reporter), feeding the
  v6 staff queue at `/{tenant}/admin/discussion`. The web gets a Report
  button too.
- **Blocks.** Add `user_blocks`. A block names a comment id; the server
  resolves the author, so ids never leave the server. The blocked author's
  comments are hidden from the blocker within that portrait.
- **Terms and age.** People accept the terms and confirm a minimum age (13
  [P]) before their first post. Optionally, comments that match a word list
  are held for review [P].
- **Moderation.** Customer contracts set a moderation response target of 24
  hours. deep-fryer staff are the fallback moderator, because Apple holds
  the publisher responsible [P].

### H14. Localization

**Today:** the catalogs are TypeScript objects in
`apps/web/lib/i18n/messages/*`, typed against `en.ts`. `format.ts` imports
React only for `rich`.

**Proposal:**

- **The package.** Move locales, catalogs, `fmt`, `fmtPlural`,
  `dimensionLabel`, and `scaleLabel` into `packages/i18n`. The web re-exports
  them; `rich` stays in the web. The worker imports the package to write push
  text.
- **Mobile strings.** Add an `app` section to `en.ts` for strings only the
  app uses, so the completeness and plural tests (`catalogs.test.ts`) cover
  them. The new strings need certified review before agencies rely on them
  (docs/language-access.md).
- **A language-neutral API.** The API sends slugs and published text, and
  the app translates framework vocabulary itself. A bundle is cached once,
  not 12 times.
- **Platform details:**
  - Declare all 12 languages for iOS's per-app language setting and
    Android 13's `localeConfig`.
  - Switching between a left-to-right and a right-to-left language inside
    the app needs an app reload, because React Native applies RTL at start.
  - Check that Hermes supports `Intl.PluralRules`, and add a polyfill if it
    doesn't.
- **Store listings.** Not all 12 languages are offered for App Store or Play
  listings. Check Bengali, Urdu, and Haitian Creole.
- **The `translation` flag.** The app's own interface belongs to the app, as
  the landing and sign-in pages do (SPEC-v7 §3.5), so it is always
  translated. Portrait vocabulary (dimension names, status words, the
  doughnut's labels, the legend) follows the portrait's flag. "Request a
  translation" calls the same endpoint the web uses [P; question 10].

### H15. Versioning and compatibility

Old app versions stay installed for years.

**Proposal:**

- The major version goes in the path (`/api/v1`), and changes within a
  version are additive only.
- Every response carries `schema`, as today's `deep-fryer.portrait/v1` does.
- The app ignores fields it doesn't know. It maps unknown enum values
  (statuses, hazard kinds, listing kinds, flag keys) to safe defaults or
  hides them.
- The app sends an `X-DF-App-Version` header. `/api/app/v1/config` returns
  `min_supported` and `latest` for each platform, which drive an update
  screen that either suggests or requires the update.
- A breaking change ships as `/api/v2`, and v1 keeps serving for at least 12
  months.
- CI replays recorded responses against the schemas of every supported app
  version.
- expo-updates shortens the tail of old versions. Its runtime version is
  pinned to the native build.

### H16. Deep links

**Proposal:**

- **Files.** Serve `/.well-known/apple-app-site-association` and
  `/.well-known/assetlinks.json` as `application/json`, with no redirect.
  `.well-known` can't be a slug, but test that the `[tenant]` route doesn't
  catch it first.
- **Paths.** Claim the public paths and exclude `/api`, `/*/admin`,
  `/login`, `/account`, `/start`, `/invite`, `/o/*/billing`, `/files`,
  `/embed`, and `/_next`. The iOS association file can list these
  exclusions. Android's intent filters can't express them well, so on
  Android the app opens unsupported paths in a Custom Tab.
- **Mapping.** A locale prefix sets the app's language for that view, and
  v7's `?dim=` parameter opens the panel.

### H17. Privacy and analytics

**Today:**

- There are no analytics.
- Caddy writes JSON logs that include IP addresses, with no stated retention.
- `privacy` and `terms` are reserved slugs (`packages/core/src/slugs.ts`),
  but neither page exists. Both stores require a privacy policy URL, and v3
  needs terms.

**Proposal:**

- **Pages.** Write `/privacy` and `/terms` in v0.
- **Data collected, by phase:**
  - v1: no analytics or crash-reporting SDK, so the App Store label can say
    "Data Not Collected".
  - v2: device identifiers (the push token) and "other data" (follows,
    language, time zone). None of it is linked to identity or used for
    tracking.
  - v3: email, name, user content, and user id, linked to identity and used
    only for app functionality.

  Google Play's Data safety form follows the same phases.
- **Logs.** Keep logs for 14 days [P].
- **Usage numbers.** Install and active-user counts come only from App Store
  Connect and the Play Console.

### H18. Store review risks

| Risk | Rule | Mitigation |
|---|---|---|
| Rejected as a website wrapper | Apple 4.2 (Minimum Functionality) | A native app with the Skia doughnut, offline use, and push. This is the reason not to ship Capacitor. |
| Sign-in options | Apple 4.8 | Sign in with Apple alongside Google (v3) |
| Account deletion | Apple 5.1.1(v); Google Play account deletion | Deletion in the app and on the web (v3) |
| User-generated content | Apple 1.2; Google Play UGC policy | Report, block, filter, terms, contact details, moderation (v3). Or stay read-only. |
| Reviewer can't sign in | Apple 2.1 | A review account (H12) |
| Looks like an official government app | Apple's impersonation and IP rules; Google Play's misrepresentation and government-information disclosure rules | deep-fryer is the seller. The listing says portraits are published by the participating organizations and alerts come from the National Weather Service. No city seals or marks without the customer's written permission. |
| Emergency alerts | Apple's Critical Alerts entitlement; push-notification rules | Don't request the entitlement. Never claim "official alerts". Name the source in every push. |
| Privacy labels wrong | Apple 5.1.2; Google Play Data safety | Labels for each phase (H17), checked at every release |
| Re-downloadable data in iCloud backup | iOS data storage guidelines | Exclude bundles and caches from backup |
| Screenshots of third-party sites | Apple 5.2 (intellectual property) | Evidence is archival, dated, attributed, and linked to its source |
| Age rating once posting is possible | Store questionnaires | Answer the user-content questions honestly; expect 12+ or Teen with posting |

### H19. Self-hosted deployments

`docs/deploy.md` lets a city run its own deployment. But one store app talks
to one API, and push needs the publisher's APNs and FCM keys, which a city
running its own deployment can't hold.

**Proposal:** the app covers the hosted deployment only [P]. Directory
entries carry `api_base`, so a federated directory (with a hosted push relay)
can be added if a self-hosting city wants to be in the app.

### H20. Operations

- **Developer accounts.** Apple Developer Program and Google Play Console,
  both as an organization. That needs a D-U-N-S number. Organization Play
  accounts skip the closed-testing requirement that new personal accounts
  face. Two admins, both with hardware 2FA [P who].
- **Signing.** The iOS distribution certificate, the APNs key, the Android
  upload key (with Play App Signing), and the FCM service account go in a
  password manager, never in the repo. The APNs key and the FCM account also
  go in the worker's env.
- **Releases.** A store release every 4–6 weeks, rolled out gradually (the
  App Store's 7-day phased release, Play's staged percentages).
  JavaScript-only hotfixes go out via expo-updates. Apple's review usually
  takes 1–2 days.
- **Yearly platform deadlines.** Google Play's target-API requirement and
  Apple's minimum Xcode and SDK both rise every year. Budget about a week a
  year.
- **Crash reporting.** The stores' built-in reports (Xcode Organizer, Play
  vitals) in v1. Add a self-hosted Sentry-compatible service later if needed
  [P].
- **Monitoring.** Track the push failure rate, API 5xx errors and the share
  of 304s, and the CDN hit rate. Preflight checks the push credentials and
  that the AASA and assetlinks files are reachable.
- **Support.** `SUPPORT_EMAIL` appears in the app and in the store listings.

### H21. Cost

| Item | Cost |
|---|---|
| Apple Developer Program | $99 a year |
| Google Play Console | $25 once |
| D-U-N-S number | Free; takes days to weeks |
| Builds | EAS's free tier or a paid plan (check current pricing), or GitHub Actions macOS runners |
| CDN | Small at city scale. Spaces' $5/month tier includes a CDN and 1 TiB of transfer; Cloudflare's free tier also works. |
| Push | APNs and FCM are free |
| Test devices | Two iPhones and three Android phones (one low-end), or a device cloud |
| Translation | Certified review of about 150 new strings in 11 languages, from the same vendor as the Local Law 30 review. Likely the largest cash item. |
| Accessibility audit | External audit before v1. Optional, but advisable for city customers. |
| Engineering | §4 |

---

## 4. Phased plan

Effort is in focused engineer-weeks for one engineer who knows this repo.
Calendar items run in parallel and don't shrink with more effort: the D-U-N-S
number, developer accounts, store reviews, and certified translation review.

| Phase | Scope | Must exist first | Effort | Done when |
|---|---|---|---|---|
| **v0: Backend and contract** | The H1 endpoints; H3 revisions; H4 ETags and cache headers; H5 schemas and OpenAPI; H6 resolved flags; H7 definer projections and RLS tests; H8 derived images and backfill; H14 `packages/i18n`; `packages/doughnut` with golden tests; `/privacy`, `/terms`, `.well-known`; the new nodes in the architecture map. **Start the D-U-N-S number and developer accounts now.** | SPEC-v7 §3 (flag registry, public `features`) | 3–4 weeks | Contract tests green. RLS tests show no drafts, unpublished rows, or held comments. Unchanged data returns 304. Golden tests show the web visually unchanged. |
| **v1: Viewer** | The §1.3 screens with read-only discussion; offline use; 12 languages; accessibility; deep links; store listings and submission | v0 in production; the SPEC-v7 Q2 look decided; the privacy policy live; developer accounts ready | 6–8 weeks, plus 1–2 calendar weeks for store setup and review | Accessibility audited. Followed portraits work in airplane mode. Parity tests pass. Approved in both stores. |
| **v2: Notifications** | H10 and H11; notification settings; quiet hours; updated privacy labels. Optionally, web push for the PWA through the same fan-out. | A CDN in front of the API; push credentials; the alert fields from H11 stored; the `notify` runner | 3–4 weeks | A batched publication push arrives end to end on staging devices. Alerts are deduplicated across the NYC six. A fan-out load test to 50,000 fake tokens against a mock passes. |
| **v3: Accounts and posting** (optional) | H12 and H13; an account screen; follow sync | `discussion` on for a live portrait; report and block on the web too; moderation commitments from customers; Sign in with Apple and the email relay set up; terms published | 4–5 weeks | Approved in both stores as a user-content app. Deleting an account revokes everything, Apple tokens included. |

**Totals:** about 10–12 engineer-weeks to v1 in the stores, and about 17–21
to v3. The PWA-first alternative (v0, plus a follow list and web push in the
web app, plus an Android TWA) takes about 6–8 engineer-weeks to reach
notifications on both platforms. On iOS that covers only people who add the
site to their Home Screen.

**Architecture map** (`architecture/data.ts`, added in v0):

- **New nodes:** `public-api` (frontend layer), `mobile-app` (a new `mobile`
  layer), `push-notifications` (research layer, in the worker), and the
  `doughnut` and `i18n` packages.
- **New connections:** `mobile-app` → `public-api`; `mobile-app` →
  `language-access`; `public-api` → `progress-engine`; `emergency-view` →
  `push-notifications`; `web-app` → `push-notifications` (publishing
  enqueues); `push-notifications` → `language-access`.
- **Context:** the public-plane context gains `public-api` and `mobile-app`.

---

## 5. Open questions for the owner

Each question has a recommended default, which is what we build if you don't
say otherwise.

1. **Store apps, or the PWA first?** *Default:* a native Expo app in both
   stores, since that's what you asked for. v0 is built so the PWA can use
   the same API and push later.
2. **Who publishes the apps (the seller name and the developer accounts)?**
   *Default:* deep-fryer's legal entity, with organization accounts (D-U-N-S
   number), you as account holder, and one backup admin.
3. **One app or one per city, and what is it called?** *Default:* one app
   listing every listed portrait, not white-labelled per city. The name
   follows SPEC-v3 open question E (domain and branding).
4. **Which portraits appear in Discover?** *Default:* those whose
   organization has listing on (on for paid plans, off for trials) and which
   have at least one published dimension. No "near me" in v1.
5. **Where does the follow list live?** *Default:* only on the device in v1.
   It is registered anonymously with the server only when the person turns
   on a notification (v2). Account sync is optional, in v3.
6. **Who holds the "who follows what" data needed for push?** *Default:* our
   own device registry, sending directly to APNs and FCM, with devices purged
   after 90 days of inactivity. The alternatives are Expo's push service or
   FCM topics, which hand that data to a third party.
7. **Alert pushes: on by default, and for which alerts?** *Default:* off
   until the person turns them on for a portrait. NWS warnings only (Severe
   or Extreme). The event name in English as issued, inside translated
   interface text. Every alert links to the official sign-up.
8. **Publication and progress notifications.** *Default:* both on for
   followed portraits. Publications batched (30 minutes, at most one a day
   per portrait). Quiet hours 21:00–08:00 in the device's time zone for
   everything except alerts.
9. **Discussion on mobile.** *Default:* read-only through v2. Posting
   (v3) only if discussion is a priority, because it brings the store's
   user-content obligations: report, block, terms, and moderation response
   times. If posting ships, sign-in is by email code, Sign in with Apple,
   and Google, with Microsoft for staff through the browser.
10. **How does the `translation` flag apply in the app?** *Default:* the
    app's own interface follows the person's language. Each portrait's
    screens follow that portrait's flag: English plus "Request a
    translation" when it's off, as on the web.
11. **Compare across families.** *Default:* family compare when
    `family_compare` is on. Any other two followed portraits can be compared
    on dimension status only, labelled "measured independently".
12. **The doughnut's look, and when to port it** (tied to SPEC-v7 Q2).
    *Default:* port only after that decision. Build the shared geometry so
    web and app draw identically whichever look wins.
13. **How much storage the app may use offline.** *Default:* followed
    portraits' data is always kept. Evidence thumbnails up to 200 MB in an
    LRU. Full screenshots and PDFs only when opened.
14. **Cities running their own deployment.** *Default:* not in the app. The
    app shows the hosted deployment only, and directory entries carry an API
    base so federation stays possible.
15. **A CDN in front of the hosted deployment** (a third party would see
    residents' IP addresses). *Default:* yes, before v2. Either Spaces' CDN
    for bundles only, or a CDN in front of Caddy with `trusted_proxies`
    configured.
16. **Crash reporting and analytics.** *Default:* none in v1. Only the
    stores' built-in crash reports and aggregate install counts, so the
    privacy label stays "Data Not Collected". Logs kept 14 days.
