# deep-fryer — Design Spec v4: shippable product

**Status:** Implemented on `claude/production-pwa-billing`, 2026-10-14. Amends
SPEC.md (v2) and SPEC-v3; sections here supersede their counterparts. v2 §13
listed self-serve signup and billing as non-goals — v4 lifts both, because
the goal is now a product municipalities can buy and run without us in the
loop. Decisions made while implementing are marked **[P]** (proposed): they
follow the existing specs' principles but were not made with the owner, and
are the first things to review.

## 1. What changed, in one table

| Area | Before (v3) | v4 |
|---|---|---|
| Accounts | Supabase Auth (Google) | Auth.js v5 on our Postgres, database sessions; Google, Microsoft Entra ID, email magic link (SPEC-v3 §2.1, done) |
| Customer | A tenant (portrait) | An **organization** owns one or more portraits; it is the billing account and the portrait family |
| NYC family | Hard-coded list in `lib/nyc-family.ts` | Organization `nyc` with six portraits; any multi-portrait organization gets compare / insights / progress |
| Billing | Non-goal | Plans with hard quotas; Stripe card checkout, annual invoice + PO, staff contracts |
| Monitoring | Snapshot only | Progress from published history against adopted targets and their due years |
| Delivery | Website | Installable PWA with offline public portraits |
| Storage | Supabase Storage | S3-compatible (SeaweedFS in compose / Spaces / S3), served same-origin |
| Deploy | Supabase + containers | Droplet + compose: Postgres, SeaweedFS, migrate job, web, worker, Caddy |
| Access control | RLS defined, app connects as owner | RLS **enforced**: user-driven queries run as `deep_fryer_app` with the caller's id |
| Notifications | Config only | Worker emails run-complete, failed-run, and flagged-finding notices |
| Languages | English | Public plane in English + the ten NYC Local Law 30 languages |

## 2. Organizations, roles, onboarding

- `organizations` (slug, name, billing email, tax-exempt, Stripe customer,
  `member_noun`) own `tenants` (`organization_id`, `family_order`,
  `short_name`). Migration 0002 gave every existing tenant its own
  organization; `scripts/provision-nyc.ts` regroups the NYC six.
- Roles: tenant roles are unchanged (owner / editor / moderator / viewer).
  Organization roles are **owner** (administers every portrait the
  organization holds — same rule in `getRole()` and SQL `member_role()`) and
  **billing** (plan, payment, invoices only). **[P]**
- Invitations are bound to the invited email (accepting requires signing in
  with it), store only a token hash, expire in 7 days, and count against the
  seat limit while pending.
- Self-serve: `/start` creates an organization + first portrait on a 30-day
  trial, one trial per person. Sales-led: `scripts/create-tenant.ts` with
  `--plan`. **[P]** — v2 said "provisioned manually"; trials make small
  towns possible without a sales call, and the trial's research allowance
  bounds the cost.
- The family "whole" portrait is the member whose slug equals the
  organization's (NYC: `nyc`); compare views treat it as context.

## 3. Billing **[P: catalog shape and limits]**

Rules that shaped it (`packages/core/src/plans.ts`):

1. **Hard quotas, never metered overage.** Municipal budgets are
   appropriations with not-to-exceed amounts. When research sessions run out,
   research pauses until renewal, upgrade, or a contract amendment.
2. **The public plane is never gated.** A lapsed subscription pauses
   research, new portraits, and invitations — never a published portrait.
3. **`past_due` stays active.** Government accounts payable routinely runs
   past net-30; Stripe dunning moves a truly unpaid invoice to `unpaid`,
   which pauses.
4. **Prices live in Stripe**, found by lookup key; nothing in code invents a
   price. `scripts/stripe-setup.ts` provisions products, prices from an
   owner-written sheet (`docs/billing/prices.example.json` — placeholder
   zeros), the customer portal, and the webhook.

| Plan | Portraits | Seats | Research sessions / yr | Sold |
|---|---|---|---|---|
| Trial | 1 | 3 | 30 over 30 days | `/start` |
| Community | 1 | 5 | 66 (3 full refreshes) | card monthly/annual, invoice annual |
| City | 3 | 15 | 200 | card or invoice, annual |
| Metro | 10 | 50 | 600 (quarterly refresh of a 6-portrait family) | invoice, annual |
| Enterprise | 25 | 200 | 1,500 | contract |

Mechanics: `subscriptions` (one per organization) is the entitlement source
of truth; the Stripe webhook records each event id and syncs the
re-retrieved subscription in one transaction. Research usage is computed
from runs (queued/running runs reserve their planned sessions; finished runs
count non-failed sessions) and checked at **apply**, under a row lock on the
subscription, so concurrent applies cannot overspend. Staff (`users.is_staff`)
set contract terms in-app for agreements invoiced outside Stripe.

## 4. Progress monitoring

- History = every once-published version; time = the **data year**; the
  latest publication of a data year wins.
- `tenant_config.progress = { baseline_year, baseline_label }`. NYC: 2025,
  "January 2026 baseline (latest data available at the start of the
  administration)" — docs/nyc-impact-research.md §1.
- Threshold overrides gain optional `target_year` (contract schema + zod).
  With a due year, status is on/off track against a straight glidepath from
  the baseline; without one, improving / worsening / no change. With only a
  baseline, the page shows the annual pace the target requires — the
  "choice ahead" framing. NYC due years: HealthyNYC 2030, class-size SY
  2029-30, Zero Waste 2030, LL97 caps 2030, Walk-to-a-Park 2030, LL148
  canopy 2040, LL66 2050. Rate targets, open aspirations (TCOL, universal
  broadband), and Vision Zero (date passed) carry none.
- Pages: `/{tenant}/progress` (with the data-gap list as a first-class
  section) and `/o/{org}/progress` (goals × portraits). Open data:
  `/api/v1/portraits/{slug}`, `progress.csv`, `progress.json` — CORS-open,
  for NYC Open Data and council packets.

## 5. PWA

`app/manifest.ts`, icons, and `public/sw.js`: hashed assets cache-first;
public navigations network-first with offline fallback; images
stale-while-revalidate. The server marks each page `x-df-cache: public|private`
(session cookie present → private, `no-store`); the worker caches only
public pages, and never admin, account, billing, auth, API, or RSC
responses. Updates wait for the user.

## 6. Hardening shipped (SPEC-v3 §2.2–2.3)

Done: Auth.js + users FK; dev mode refused in production (and boot-time env
assertion); nonce CSP; embed framing via CSP `frame-ancestors` from
`embed_origins`; `safeHref` on every source link; `{ ok, error }` server
actions; comment authors exposed as display names or per-tenant HMAC
pseudonyms; postComment tenant check; system-actor first-post holds; vote
CHECK; published-version FK + guard trigger; audit insert policy;
transactional provisioning; atomic version numbering; worker egress guard;
non-overwriting evidence keys; non-root worker and web images.

**Row-level security is enforced** (SPEC-v3 §2.2 items 1–3). Migration 0005
creates `deep_fryer_app` (NOLOGIN, NOBYPASSRLS) and grants it to the
connecting user. `withAuthContext` (packages/db) opens a transaction, sets
`app.user_id` (what `auth.uid()` reads) with `set_config(…, true)`, and
`SET LOCAL ROLE deep_fryer_app`, so both expire with the transaction and a
pooled connection never carries one request's identity into the next. The
web app's `userDb()` wraps every read and write a person drives — public
pages, admin, review, discussion, progress — and `systemDb()` (the owner
connection) is reserved for identity resolution, billing and the Stripe
webhook, invitation acceptance, middleware framing checks, and the worker.
Policies grant anonymous reads only of published material (non-archived
tenants, public config keys, published dimension versions and outreach,
lock/restore moderation). Transcripts stay a column, but the app role has no
column grant on it: only the review UI's transcript route (owner/editor,
system context) can read it. Display names cross the boundary through
`public_display_names()` (security definer, names only). A trigger
(migration 0006) keeps comment placement and authorship immutable for the
app role and separates author edits from moderator removals.
`packages/db/src/rls.test.ts` proves isolation as the app role.

**Notifications.** After every run settles the worker emails the portrait's
owners and editors plus the organization's owners — one message per
recipient — honoring the portrait's notification settings: a run summary
with the human-gate reminder and review-queue link, a flags-only notice when
run mail is off, and a failure notice. Mail failure never fails the run.

**Images.** The worker image is Playwright's own (`mcr.microsoft.com/playwright`),
pinned to the exact `playwright-core` version — a test fails CI if they
drift. Inter is bundled with the web app, so image builds need no access to
Google Fonts. The compose object store is SeaweedFS with two identities
generated at boot: the app (read/write/list on the evidence bucket only, no
bucket administration) and anonymous (object reads only, no listing).

## 7. Accessibility and NYC requirements

- WCAG 2.1 AA (NYC Local Law 26 of 2016): canvas doughnut has a text summary
  and a keyboard-reachable link list; skip link; statuses never by color
  alone; sparklines carry their values.
- Open data (NYC Local Law 11 of 2012): every published number is available
  as CSV/JSON.
- Language access (NYC Local Law 30 of 2017): the public plane is served in
  English plus the ten designated citywide languages (Chinese in Traditional
  and Simplified), at locale-prefixed URLs (`/es/nyc`), right-to-left for
  Arabic and Urdu. Chrome, explanations, statuses, and the framework's own
  vocabulary are translated; research content (indicators, findings,
  sources, comments) stays as published, with a notice and the
  organization's language access contact (NYC: 311). Catalogs are
  machine-assisted drafts pending certified review — see
  docs/language-access.md. **[P]** what is translated vs. published as-is;
  staff surfaces English-only.

## Open questions

- **G.** Plan limits and prices (§3) — owner decision; prices are unset.
- **H.** Whether residents may sign in with Microsoft (currently any
  provider is open to anyone; staff roles come only from invitations).
