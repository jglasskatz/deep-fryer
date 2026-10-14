# deep-fryer — Design Spec v5: policy analysis, emergencies, theme

**Status:** In implementation on `claude/production-pwa-billing`, 2026-10-14.
Source: the owner's notebook page ("Donut"). Amends SPEC-v4; sections here
supersede their counterparts. As before, decisions not made with the owner
are marked **[P]** and are the first things to review.

The notebook has three clear asks, built here, and several open ones, for
which this spec lays the data model and names the open question (§5).

| Note | Becomes | Status |
|---|---|---|
| "Policy analysis view — flashing impacts to dimensions based on projected policy impacts; policy brief as input" | §2 Policy analysis (staff) | built |
| "emergency / disaster view — show threats in terms of risk/impact"; "emergency → for users to grab alerts, surfacing existing plans, making it more accessible" | §3 Emergency view (public) | built |
| "Hold down dark mode (or right click) and have option to deep fry the page" | §4 Theme and the fryer | built |
| "suggest solutions?", "mutual aid", "how to analyze a problem?", "let's make a plan for governing", "meet w/ candidates → find out needs for dash", "For S.C./Product — policy view" | §5 Foundations and open questions | foundation |

## 1. Principles carried forward

- **The public plane shows no AI.** Policy analyses are AI-drafted
  projections, so they live in the staff plane (§2). The emergency view is
  public and contains no AI output: official alerts, staff-curated hazards,
  plans, and resources.
- **Projections are never shown as measurements.** Anything projected is
  labeled as a projection, carries its assumptions and confidence, and is
  computed with the same scoring engine as published data so the two are
  comparable.
- **We are not an emergency alerting system.** The emergency view
  re-displays official alerts (National Weather Service) and points people
  to the official sign-up (NYC: Notify NYC). It never originates an alert
  and always names and links the issuing authority.
- **Language access (SPEC-v4 §7) applies to every new public page:** all
  chrome in the eleven languages; staff-entered content shown as entered,
  with the English-content notice.
- **Motion is optional.** Anything that flashes or moves pauses on demand,
  stays well under three flashes per second (WCAG 2.3.1), and is static when
  the reader prefers reduced motion (WCAG 2.2.2, 2.3.3).

## 2. Policy analysis view (staff plane)

**Who:** portrait editors and owners; organization owners.
**Where:** `/{tenant}/admin/policy` (list, new), `/{tenant}/admin/policy/{id}`.

**Input:** a policy brief — title plus pasted text (up to 60,000
characters), optional source URL. Briefs are untrusted text: the model
prompt fences them between tags with a random per-run boundary (so a brief
cannot close its own fence), the result is schema-validated, and nothing is
published from it. Analyses are readable by editors and owners only, at the
database as well as on the page (a brief can be unreleased policy text).

**Run:** creating an analysis is a research spend — one research session,
checked against the organization's plan under the same subscription lock as
research apply (SPEC-v4 §3) and counted in usage. The analysis and its
graphile-worker job `policy_analyze` are created in one transaction, so a
reserved session always has a job to run it. The job runs one Claude Agent
SDK session whose only tools are read-only web tools (`WebSearch`,
`WebFetch`) so quantitative estimates can cite sources; the session has no
shell or file access and never sees the worker's credentials. A queued
analysis can be cancelled by staff, and a `policy_sweep` cron settles any
analysis queued for 30 minutes whose job can no longer run; both settle it
failed, which releases the session (failed analyses are not counted).

**Output contract** (`packages/core/src/policy.ts`, zod-validated):

```
summary: string                       — plain-language overview (≤ 1,200 chars)
impacts: [{
  dimension_slug: framework slug      — one of the 21
  direction: improves | worsens | mixed | none
  magnitude: small | moderate | large
  confidence: high | medium | low
  rationale: string                   — why, in two to four sentences
  indicator?: string                  — the portrait's published indicator name, exact
  projected_value?: number            — that indicator's value if the policy is adopted
  projected_year?: number             — when
  sources: [{ title, url }]           — https only
}]
assumptions: string[]                 — ≤ 20, each ≤ 600 chars
risks: string[]                       — unintended effects and implementation risks; ≤ 20, each ≤ 600 chars
```

The prompt states every limit (a little under each ceiling) and asks for
plain English whatever the brief's language. Before validation the worker
fixes slips it can fix without inventing anything — drops non-https or
surplus sources (≤ 12 per impact), sets aside impacts on a dimension that is
not one of the 21, shortens over-long text at a word — and lists each change
with the result as an adjustment for staff; anything else invalid fails the
analysis.

**Projection math [P]:** for each impact with an `indicator` and
`projected_value`, the indicator's published scoring (threshold reference,
function, target/scale or band) re-scores the projected value with
`computeScoring`, and the dimension's projected `viz_level` is re-derived
with `deriveVizLevel` — the same engine that drew the published doughnut.
Impacts without a quantified projection change no wedge size; they are
"direction only".

**The flashing doughnut:** the doughnut alternates between *now* and *with
this policy* (2.4-second cycle, a slow alternation, not a strobe). In the
policy state every impacted dimension's name is drawn on a pill of its
direction's colour — green for improves, red for worsens, amber for mixed —
and its wedge, where it has one, takes the same colour; so direction-only
impacts flash too, a dimension with no shortfall or overshoot (no wedge) is
still marked, and a highlight is never mistaken for the red of an ordinary
wedge. Quantified impacts also change size — unless the change cannot show,
which the caption and the impacts table say in words with the actual cause:
another indicator is the dimension's worst (a dimension is drawn at its
worst indicator), the dimension is beyond the chart's range before and
after, or the change is smaller than one drawn step. Sizes are judged
against the levels published when the analysis ran; a dimension
republished since is named as such. Controls: pause/play, and a static
choice of *now* / *with policy*. Reduced-motion readers get the static
*with policy* view. The impacts table is the accessible equivalent of the
chart and lists every impact with its rationale, confidence, and sources.

**Not in v5 [P]:** publishing an analysis to the public plane (it would need
a review workflow like findings); comparing several policies; editing an
analysis's impacts by hand.

## 3. Emergency view (public plane)

**Where:** `/{tenant}/emergency` (translated like every public page),
staff curation at `/{tenant}/admin/emergency`.

**What residents see, in order:**

1. **Active alerts** for the portrait's area from the National Weather
   Service (`api.weather.gov`, CAP alerts by county and forecast-zone UGC
   code — both, since long-fuse alerts are issued by zone), each with
   event, severity, headline, areas, effective/expires, the official
   instructions, and a link to the NWS alert (the readable NWS page for its
   area, not the API record). Alerts are fetched by the
   worker every five minutes (`alerts_sync` cron); the page states when it
   last checked and says so plainly if the feed is stale. Alert text is shown
   as issued (English).
2. **Get official alerts** — the organization's official sign-up (NYC:
   Notify NYC) and emergency line (NYC: 911 / 311), from tenant config.
3. **Threats by risk** — staff-curated hazards, each rated likelihood (1–5)
   and severity (1–5); risk = likelihood × severity, banded low (1–4),
   moderate (5–9), high (10–16), very high (20–25) [P]. Each hazard lists the
   doughnut dimensions it threatens (with impact level), the plans that
   address it, and — when an active alert matches the hazard's NWS event
   types — an "active now" badge. Selecting a hazard flashes its threatened
   dimensions on the doughnut ("threats in terms of risk/impact"): each
   threatened dimension's name on a pill coloured by impact level (high,
   moderate, low), the same marking as §2.
4. **Existing plans** — the jurisdiction's adopted plans (hazard mitigation,
   heat, coastal storm…): title, agency, year, plain-language summary, link,
   and the languages each is published in ("surfacing existing plans,
   making them more accessible").
5. **Help and mutual aid** — staff-curated resources: cooling centers,
   shelters, hotlines, mutual-aid groups — name, phone (tap to call), link,
   what it offers, hazards it serves.

The page is a public page, so the service worker keeps it for offline use
once opened; it also offers a "save for offline" action that stores the
emergency page and the portrait's front page — useful when the network goes
down in a storm. Saved copies survive app updates and ordinary browsing. A
copy read later (saved, or served by the worker when the network fails or
is slow) re-checks itself on the device: once its alerts are older than the
stale threshold it says it is a saved copy and when alerts were last
checked, it never says "no alerts" without that time, and an alert whose
end time has passed is marked ended.

**Data (migration 0008):** `hazards`, `emergency_plans`,
`emergency_resources`, `emergency_alerts`; tenant config key `emergency`
(`{ nws_zones: string[], alerts_signup_url, alerts_signup_label,
emergency_phone, info_phone }`, public). Hazards, plans, and resources have
`published`; only published rows are public (RLS). Editors curate.

**NYC [P]:** `scripts/nyc-emergency.ts` proposes the NWS county and
forecast zones (numbers per the NWS service change notices SCN 99-37 and
SCN 10-45, which split Queens) (NYC061/NYZ072 Manhattan, NYC005/NYZ073 Bronx,
NYC085/NYZ074 Staten Island, NYC047/NYZ075 Brooklyn, NYC081/NYZ176/NYZ178
Queens — whole city: all of them), Notify NYC, and hazards from the NYC
Hazard Mitigation Plan's hazard list. Like the NYC portrait config, it is a
dry run until `--apply`; it writes hazards **unpublished** so ratings are a
staff decision, and it refuses to write any plan link that does not answer.

**The preflight (SPEC-v4) gains checks** that `api.weather.gov` answers for
the configured zones, that both county and forecast zones are listed, and
that every zone exists (its county, forecast, or fire-weather zone record
answers; an unknown zone fails naming the portraits that list it, a lookup
that gets no answer only warns) — the alerts endpoint accepts any
well-formed code, so a mistyped zone would otherwise read "no alerts"
forever.

## 4. Theme and the fryer

- **Dark mode:** light / dark / follow-system, chosen from a toggle in the
  header, remembered per device (localStorage, set before first paint so
  there is no flash; the browser's address/title bar colour follows an
  explicit choice too). Implemented with theme tokens; the fixed-opacity
  black/white utilities get a dark remap, and a test fails if a component
  uses one the remap does not cover — or writes a black/white colour
  (inline or arbitrary-value) where the remap cannot reach it.
- **The toggle never flashes the page:** a short press flips light/dark
  once and announces the new theme; held keys and repeated clicks (a screen
  reader repeating its activate command) still flip it at most once per
  burst (WCAG 2.3.1). Its description names the routes to the menu.
- **Deep fry the page:** press and hold the theme toggle (about 0.6 s, with
  a pointer or with Enter/Space), or right-click it, or press Shift+F10 /
  the Menu key while it has focus — a small menu offers **Match device**
  and **Deep fry this page**. Frying applies the meme treatment
  (saturation, contrast, sharpening, an orange cast, grain, a few stickers)
  to the whole page; the same menu (or Escape, unless a text field, dialog
  or IME composition is using it) un-fries it. It is per-visit, not
  remembered, never animates for reduced-motion readers, and is announced
  to screen readers. It's the product's name, after all.

## 5. Foundations and open questions

| Note | Foundation laid in v5 | Open question for the owner |
|---|---|---|
| "suggest solutions?" (emergency) | Hazards link to plans and resources; policy analyses produce dimension impacts that could be attached to a hazard | Should solutions be curated (staff), AI-suggested (staff plane only, like §2), or drawn from adopted plans? |
| "mutual aid" | `emergency_resources.kind = 'mutual_aid'`, published per portrait | Who curates and vets mutual-aid groups, and how are they kept current? Partnership with an existing directory? |
| "how to analyze a problem?" | The §2 engine maps any text to dimension impacts; a *problem* brief is the same input with a different prompt | Is this a staff tool (problem → affected dimensions → existing plans/policies), a public explainer, or a guided method (e.g. a doughnut "unrolled" worksheet)? |
| "let's make a plan for governing" | Adopted targets with due dates (progress engine, SPEC-v4 §4) + policy analyses (§2) are the parts of a plan: goals, and the policies projected to move them | A plan = selected goals + policies + owners + timeline? Who is it for — an administration, a council, a campaign? |
| "meet w/ candidates → find out needs for dash"; "For S.C./Product — policy view" | Policy analysis works for any portrait (Santa Cruz included) in the staff plane; candidates would need a non-staff role | Interview guide below. Can a candidate hold a role without being city staff (a "campaign" organization on a portrait it does not own)? |

**Candidate interview guide (draft):** what decisions would you use the
doughnut for in the first 100 days? Which dimensions matter most to your
platform, and which data do you not trust today? Would you share policy
analyses publicly, and with what review? What would make a dashboard part
of a weekly routine rather than a launch event? Who on your team would run
it? What would make you stop using it?
