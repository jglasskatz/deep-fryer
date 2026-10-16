# deep-fryer — Design Spec v7: the core view, feature flags, any city with a key or a payment

**Status:** Draft for implementation on `claude/production-pwa-billing`,
2026-10-16. Source: the owner's notes —

> make sure the spirit of the SC donut repo is still the core product view …
> Deep fry should let us easily make donuts just by entering any city and an
> api key OR a payment, and I need an estimate of how much in API tokens it
> takes to build a donut … make sure the emergency piece doesn't take away
> from the core functionality, make sure it is behind a feature flag.
> Everything beyond core should have a feature flag. Those must be tested …
> Translation should also be behind a feature flag / a button to request
> translation.

Related: the mobile viewer has its own spec (`docs/SPEC-mobile.md`), the
open-source plan is `docs/OPEN-SOURCE.md`, and the token estimate is
`docs/research-cost.md`. Decisions not made with the owner are marked **[P]**.

## 1. What "core" means

The Santa Cruz repository (github.com/jglasskatz/doughnut-santa-cruz) is the
reference. Its main view, `docs/index-d3.html`, is one screen:

- the doughnut, coloured by each dimension's status, with a hover tooltip
  (headline value, year, source);
- click a segment and a **detail panel beside the doughnut** shows the
  dimension: status, headline indicator with year and target, context, the
  primary source with its **snapshot inline**, and **ways to get involved**;
- jurisdiction pills to switch between the city, county, and neighbouring
  city; a status legend; links to deeper pages.

deep-fryer kept the renderer (Santa Cruz's "Classic View", vendored) but
lost that interaction: a click navigates to a separate dimension page, and
the evidence and actions are a page away. **Core** in deep-fryer is
therefore:

| Core (always on) | Why |
|---|---|
| The portrait view: doughnut + detail panel + dimension list + legend + family switcher (§2) | The Santa Cruz product view |
| Dimension pages: indicators, targets, sources, evidence snapshots, the dimension's curated actions | What the panel deep-links to; the evidence promise |
| Methodology page, open-data exports, embeds, install/offline | Make the portrait trustworthy and reusable |
| Building a portrait: sign in, any city, configure, research, review, publish (§4) | How a doughnut comes to exist |
| Progress against adopted targets | The original goal: municipalities "monitor their progress" **[P]** |
| Accounts, members, billing | Running it as a service |

Everything else is a **feature**, off unless turned on (§3).

## 2. The core view (portrait page)

- Desktop: the doughnut on the left, the **detail panel** on the right.
  Mobile: the doughnut, then the panel, then the dimension list.
- Selecting a dimension — a click or tap on the canvas, a row in the list, or
  `?dim=<slug>` in the URL (shareable, works without JavaScript) — fills the
  panel without leaving the page: name, ring, status in words, each
  indicator's value, year, target and geographic scale, the context
  paragraph, the source link with its evidence snapshot thumbnail, the
  dimension's curated actions ("What you can do"), and — when the
  `involvement` feature is on — its listings. A link opens the full
  dimension page (and its discussion, when `discussion` is on).
- Nothing selected: the panel explains how to read the doughnut and shows
  the status legend.
- The canvas keeps the Raworth-style look deep-fryer uses today (red wedges
  for shortfall and overshoot). Whether to switch to Santa Cruz's
  status-coloured D3 look is an open question **[P]** (§7).

## 3. Feature flags

### 3.1 The registry

One registry in `@deep-fryer/core` (`features.ts`) names every feature, its
default, and who can see it:

| Key | What it turns on | Default for a new portrait |
|---|---|---|
| `emergency` | `/{tenant}/emergency`, its nav link, staff curation, the worker's alert sync for the portrait | off |
| `policy_analysis` | `/{tenant}/admin/policy` and the `policy_analyze` job | off |
| `involvement` | Curated involvement listings and the organization form on dimension pages, the panel, and `/{tenant}/outreach`; `/{tenant}/admin/involvement`. The Get involved page itself stays: it predates the listings and shows the organizations research found, which are core | off |
| `discussion` | Comment threads, `/{tenant}/admin/discussion` | off |
| `translation` | The portrait's pages in the 11 Local Law 30 languages (otherwise English, with "Request a translation") | off |
| `family_compare` | Compare and Insights across an organization's portraits (on for the organization's pages when any of its portraits has it on, like translation) | off |
| `request_research` | (existing) residents asking for research from Insights | off |

Deployment-wide (an operator setting, not per portrait):

| Key | What it turns on | Default |
|---|---|---|
| `deep_fry` | The "Deep fry this page" item in the theme menu | on |

### 3.2 Resolution

`enabled(feature, portrait) = not disabled by the deployment AND the
portrait's setting (or the registry default when unset)`.

- Per portrait: tenant config key `features` (already exists for
  `request_research`), edited by owners at `/{tenant}/admin/settings`. The
  key becomes publicly readable (it holds only booleans), because public
  pages decide what to show from it.
- Deployment kill switch: `DF_DISABLED_FEATURES=emergency,policy_analysis`
  turns features off everywhere regardless of portrait settings — for
  self-hosters and for an operator who needs to switch something off fast.
- Migration 0011 writes every feature **on** for portraits that already
  exist, so nothing they show today disappears; new portraits start with the
  defaults above.

### 3.3 Enforcement — off means gone

When a feature is off for a portrait:

- its pages return **404** (public and staff), not an empty page;
- its links disappear from the header, family nav, admin nav, and the
  portrait page;
- its server actions refuse (a forged request cannot write), with the role
  checked first so an outsider learns nothing about which features a
  portrait has;
- the worker skips it (no alert fetches for that portrait, no policy jobs).

A dimension's own curated actions ("What you can do") come from research
and stay with the involvement feature off; only the curated listings and the
organization form go.

### 3.4 Tests (required)

- Unit: the resolver (defaults, portrait overrides, kill switch, unknown
  keys ignored), the env parser.
- Each feature: the page guard returns 404 when off; the nav builders omit
  its links when off and include them when on; its actions refuse when off.
- Worker: alert sync skips portraits with `emergency` off.
- Translation: the routing decision (prefixed path redirects to English when
  off; no switcher; request button shown).
- Stack end-to-end: one portrait with everything off shows only the core
  view; turning a feature on in settings makes it appear.
- A source scan (`apps/web/lib/feature-guards.test.ts`) fails when any page
  or route under a feature's folders, or any server action in a feature's
  module, does not check its feature.

## 3.5 Translation off: "Request a translation"

With `translation` off, a portrait's pages are English only: the language
switcher is hidden, and `/{lang}/{tenant}/…` redirects to `/{tenant}/…`.
Instead, a small **"Request a translation"** button (in the header, where
the switcher was) lets a reader pick a language and send the request — no
account, rate-limited like the involvement form. Staff see the counts per
language at `/{tenant}/admin/settings` ("Translation requests: Spanish 41,
Chinese 12 …"), which is the evidence for turning translation on. NYC
portraits keep translation **on** — Local Law 30 requires it.

The landing, pricing, and sign-in pages are not a portrait's pages; they
stay multilingual.

## 4. Any city, with an API key or a payment

The Santa Cruz CLI already does "enter a city and an API key":
`LLM_API_KEY=… node cli.js "Austin" "Texas"`. deep-fryer's hosted version:

1. **Start** (`/start`): the city's name and state/country — that is all.
   The boundary definition, data portals, and local targets default from
   the framework; the first research session (region context) fills in the
   region brief.
2. **Pay for the research**, one of:
   - **Your Anthropic API key.** Validated on entry (one call to the Models
     API), stored encrypted (AES-256-GCM, key in `DF_SECRETS_KEY`), never
     shown again (the page shows its last four characters), removable at any
     time. Research and policy sessions for the organization run on it;
     sessions are then not counted against a plan's allowance **[P]**.
   - **A payment.** Stripe checkout for a plan (existing), whose allowance
     covers a full portrait.
   - **The trial** (existing): one full pass free.
3. **Build my doughnut** — one button: plans and starts the full run (22
   sessions) and shows the estimate first ("about 22 sessions ≈ $20–80 of API
   usage on your key", `docs/research-cost.md`). The run page shows progress;
   staff review and publish as today.

Security: the key is encrypted at rest; only the worker decrypts it, into
the session subprocess environment (`sessionEnv`) for that organization's
sessions; it never reaches logs, transcripts, page data, exports, or the
client. Database: `organization_api_keys` with column grants so the app role
can read only the hint and dates; the worker reads ciphertext in the system
context.

Hosting after the trial still needs a plan **[P]** — the key pays for
research tokens, not for hosting, review tooling, and support.

## 5. Open source

See `docs/OPEN-SOURCE.md` for the audit (secrets, licenses, Doughnut
Economics attribution) and options. What can be prepared in the repository
(license files, NOTICE, self-hosting README, CONTRIBUTING, SECURITY) is
separate from what only the owner can do: choose the license, flip the
repository's visibility, rotate any secret that ever reached history.

## 6. The mobile viewer

See `docs/SPEC-mobile.md` (view and explore only; follow portraits). It
depends on §3: the app reads each portrait's features so it shows only what
the portrait has turned on.

## 7. Open questions for the owner

1. Is progress monitoring core (as assumed), or a feature?
2. Keep the Raworth-style red-wedge doughnut as the core visual, or adopt
   Santa Cruz's status-coloured look?
3. Should sessions on a customer's own API key count against a plan's
   allowance (as a fair-use cap) or not at all?
4. After the trial, does a key-only customer need a paid plan to keep the
   portrait hosted (as assumed)?
5. Defaults for new portraits: everything beyond core off (as assumed), or
   should `discussion` and `involvement` start on?
