# deep-fryer — Design Spec v3

**Status:** Approved direction, 2026-08-07. Amends SPEC.md (v2) — sections here
supersede their v2 counterparts; everything else in v2 stands. Decisions below
were made with the owner during the v3 planning session; each is marked
**[D]**. Findings referenced throughout come from the v2 code review, the
strategy-measurement campaign (docs/strategy-findings.md), and the NYC
production runs.

## 0. Context

The NYC portrait family (city + five boroughs) is researched, audited,
published locally, and demo-deployed as a static page at
`jglasskatz.github.io/doughnut-santa-cruz/nyc/`. **[D]** The demo stays there
for the pitch; the long-run product is **fully self-hosted** — no Supabase,
no managed PaaS dependencies beyond a VM and object storage.

Four workstreams, independently shippable:

| WS | Name | Outcome |
|---|---|---|
| W1 | Pitch dataset completion | Coherent, gate-approved six-portrait family incl. heat + consumption wedges |
| W2 | Hardening + self-hosted architecture | Deployable product with two independent enforcement layers |
| W3 | Research-plane quality | Measured fixes from the strategy campaign productized |
| W4 | Review & insights depth | Machine audit in the product; accessible, comparable portraits |

---

## W1 — Pitch dataset completion **[D: both heat and consumption lens ship before the pitch]**

### 1.1 Cross-tenant harmonization (the 5 reconciliation flags)

One definition per indicator across the whole family, applied via targeted
re-research runs with reviewer notes (the §8 rerun path):

| Indicator | Decision |
|---|---|
| broadband-access | Fixed-line broadband subscription, ACS S2801, all tenants; definition stated in notes |
| ghg-reduction-vs-2005 / ghg-per-capita | MOCEJ GPC inventory, 2024 data year, all tenants |
| uninsured-rate | ACS county series (annual, uniform) over mixed CHS/ACS |
| tri-releases-per-capita | EPA Envirofacts multi-table method (per-county breakdown in worked_math) |
| pm25-annual | NYCCAS CD values, **population-weighted** borough rollup (not unweighted mean) |

Acceptance: `reconcile-nyc.ts` shows ≤1 flag exceeding tolerance, and that
flag is documented as a genuine definitional impossibility, not drift.

### 1.2 Extreme heat wedge

New **custom dimension** `extreme-heat` (ecological ring) on all six tenants —
the one ecological topic the administration has personally executive-ordered.
Indicators: heat-vulnerability index distribution (population-weighted, never
a mean rank), heat-exacerbated deaths (citywide, regional scale, labeled),
surface-temperature differential. Threshold refs added to
`threshold_overrides` with adopted-source rationales (June 2026 heat EO,
HealthyNYC).

### 1.3 Consumption-based climate lens

Custom indicator `consumption-ghg-per-capita` on climate-change: borough
household-weighted aggregation of the MOCEJ/EcoDataLab tract-level CBEI
(recency exception already in config), threshold ref target 5.9 tCO2e/cap
(C40 1.5°C 2030 trajectory), explicitly labeled **modeled** and
**consumption** — the territorial-vs-consumption dual label the methodology
promises. Boroughs rank in the opposite order from territorial; that is the
point, and the methodology page must say so.

### 1.4 Presentation rules (standing, all portraits) **[D]**

- **A number never appears without its unit.** One formatter
  (`formatIndicatorValue` in `@deep-fryer/core`) is the single source for
  value display across the web app, the static export, and any future
  surface: percent-style units attach ("61.2% of renter households"), other
  units follow with a space ("13,361 homes/year").
- **"How to get involved" is part of the visual.** Every dimension detail
  panel — main app drilldown and static export alike — carries engagement
  actions. Seeded for NYC from the impact research
  (`scripts/nyc-actions.ts`: real programs, adopted-law levers, borough
  variants); for all future portraits, research sessions draft actions per
  v2 §9 and they flow through the same review queue (W3 backlog item:
  action-drafting session type in the plugin).

### 1.5 Gate + export

- Run `research-verify --tenant <slug>` per tenant; named human approval,
  hash-bound (the records-request story).
- `pnpm export:nyc` — wraps `export-static.ts` + rebrand + commit/push to the
  demo repo, so the public page regenerates in one command after any publish.
  No CI automation while the demo lives on GH Pages **[D]**.

---

## W2 — Hardening + self-hosted architecture

### 2.1 Supabase removal **[D: drop Supabase entirely]**

| Concern | v2 (Supabase) | v3 (self-hosted) |
|---|---|---|
| Postgres | Supabase managed | Self-hosted Postgres 16 (compose/droplet); migrations unchanged |
| Auth | Supabase Auth (Google OAuth) | **Auth.js v5**, Google provider, JWT sessions; `users` table (uuid PK) in our Postgres; `tenant_members.user_id` → users.id |
| Evidence storage | Supabase Storage buckets | `TenantStorage` grows an **S3-compatible backend** (MinIO / DO Spaces) beside the existing local-disk backend; env-selected |
| Public data reads | PostgREST + anon key | None. The app is the only client; `published_doughnut()` stays as the internal read path |

Touchpoints: `apps/web/lib/auth.ts` (getAuth/getRole read the Auth.js
session), `app/login` + `app/auth/callback` (replaced by Auth.js routes,
which also closes the open-redirect finding), `apps/worker/src/storage.ts`
(S3 backend), `.env.example`, `docker-compose.yml` (drop Supabase vars, add
`AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `S3_*`). Supabase-specific code paths
are deleted, not maintained in parallel.

### 2.2 RLS: full defense-in-depth **[D]**

Two independent enforcement layers — app-layer checks stay, and the database
enforces the same contract:

1. **Roles.** Migrations run as the owner role. The app and worker connect as
   `deep_fryer_app` — non-owner, no BYPASSRLS. `FORCE ROW LEVEL SECURITY` on
   every tenant-scoped table (owner exemption was the v2 hole).
2. **Auth context.** The existing `auth.uid()` shim reads
   `current_setting('app.user_id', true)`. New `withAuthContext(userId, fn)`
   in `packages/db`: wraps work in a transaction that
   `set_config('app.user_id', $1, true)` first. Server actions and loaders
   run inside it; public pages run with no user set and reach only
   public-read policies.
3. **Policy repairs** (from the review):
   - `research_sessions.transcript` moves to its own table
     `research_session_transcripts` with an owner-only policy (the
     column-REVOKE was a documented no-op).
   - `comments` UPDATE policy: authors may edit `body`/`edited_at` only,
     never `removed_at`/`tenant_id`/`dimension_id` (WITH CHECK enforces);
     public read policy excludes removed bodies (tombstone at the DB layer).
   - `comment_votes.vote` CHECK IN (-1, 1); votes readable as aggregates only.
   - `audit_log` INSERT policy for members (writes currently depend on the
     bypass); `dimensions.published_version_id` gains an FK + trigger
     asserting the version belongs to the dimension and is published.
   - `postComment` verifies the dimension belongs to the tenant; first-post
     hold attributed to a system actor, not the author.
4. **Provisioning/queries**: `provisionTenant` becomes transactional;
   `appendDimensionVersion` allocates version numbers atomically
   (insert-select with conflict retry).

### 2.3 Web + worker hardening (deploy blockers from the review)

- **Dev mode**: refuses to activate when `NODE_ENV === 'production'` — a
  production boot without auth config fails loudly instead of granting
  anonymous owner.
- Security headers in `next.config`: CSP with `frame-ancestors 'none'`
  default; the embed route emits per-tenant `frame-ancestors` from
  `embed_origins` (replaces the bypassable query-param check).
- `source_url` validated `^https?://` at schema *and* render (kills the
  `javascript:` vector in ReviewCard and drilldowns).
- Server actions return `{ ok, error }` values instead of throwing (prod
  redaction currently swallows every validation message); `useAction`
  consumes the shape; per-form pending state in SettingsForms.
- Public comment payloads carry a per-tenant HMAC of `author_id`, not the
  raw auth id.
- Worker egress guard in `evidence.ts` + `verify.ts`: https-only, public-IP
  only (deny RFC1918/metadata), redirects re-checked; Chromium runs as a
  non-root user in the worker image (it cannot launch at all as built).
- Evidence objects keyed by `sha256(url + captured_at)` — reruns append, never
  overwrite an audit trail.

### 2.4 Deployment target

Droplet + `docker compose` (deploy.md Option B, minus Supabase): web, worker,
Postgres, MinIO, Caddy for TLS. Worker stays **manual/scheduled until Track 2
ships** **[D]** — request-research enqueues persist in Postgres and drain
when a worker starts; the insights form copy says so.

---

## W3 — Research-plane quality (from docs/strategy-findings.md)

1. **Evidence-first verification.** The worker copies the finding's captured
   snapshot/PDF into the verifier session workspace; `VERIFIER_TOOLS` gains
   `Read`; the verifier template instructs: judge against the captured
   exhibit first, refetch only to corroborate. Kills the tier-1 paradox
   (nyc.gov 403s → `uncertain` on the city's own documents) — the largest
   measured accuracy suppressor.
2. **Tiered strategy as run config.** The rendered plan carries
   `{ session_model, subagent_model, verifier_model }`; NewRunForm offers
   `standard` (Sonnet researchers) vs `deep` (Opus orchestrating Sonnet
   scouts) — measured at 0.33 vs 0.58 yield, ~3–4× dollar cost. Verifier
   pinned to Opus in both. Worker env vars remain only as defaults.
3. **Scale-aware negative controls.** A sourced, verified finding whose
   `geographic_scale` is an accepted non-borough scale is correct behavior,
   not fabrication (the Opus arm's aragonite finding). Controls exempt it.
4. **Sum reconciliation.** `DENOMINATORS` gains a `'sum'` type for absolute
   counts (traffic deaths, housing production): boroughs must *sum* to the
   city within tolerance — the check that validated 39+63+57+33+13 = 205.
5. **Automatic tier audit.** Post-run task samples N tier-1 findings per run
   through `renderTierAuditPrompt`; results stored as `finding_audits`
   rows (`source: 'tier_audit'`) and surfaced on ReviewCards.
6. **Dense-dimension splitting.** Plans split a dimension's indicator list
   across two sessions when it exceeds 3 indicators, rather than raising the
   60-turn cap (accuracy degrades with in-session tool-call count; splitting
   sidesteps it).

---

## W4 — Review & insights depth

### 4.1 Machine audit as product **[D: stored + one-click, policy-driven]**

New table:

```ts
finding_audits {
  id, finding_id fk, source: 'workflow' | 'tier_audit',
  disposition: 'approve' | 'edit' | 're_research' | 'reject',
  reason text, correction jsonb?,          // exact field-level fix when 'edit'
  created_at,
  applied_version_id fk?, applied_by fk?, applied_at?   // set on apply
}
```

- ReviewCards render the adjudication (disposition chip, reason, correction
  diff) beside the verifier verdict. AI stays admin-plane-only (§10 holds).
- **Apply** actions: `approve` → approveFindings; `edit` → approveFindings
  with the correction merged + auto change_note; `re_research` → planned run
  with the reason as reviewer notes; `reject` → excluded from the version.
- `review_policy` grows `audit_apply: 'per_card' | 'bulk'` **[D:
  policy-driven]**. `per_card` = one click per dimension card; `bulk` = one
  "apply all machine-approved" per run with a summary diff. Default:
  `per_card`.
- The session's audit workflow becomes a first-class post-run step writing
  `finding_audits` (the adjudication prompts from the NYC campaign, run per
  flagged finding), so the review queue is pre-triaged without any operator
  in the loop.
- "Publish reviewed" bulk action in admin replaces the ad-hoc
  `publish-reviewed.ts` script, honoring the same inclusion rule.

### 4.2 Accessibility & resilience

- A visually-hidden (screen-reader/keyboard) list of dimension links renders
  beside every doughnut canvas; canvas gets `role="img"` + a generated
  `aria-label` summary. The canvas is currently the *only* route to
  drilldowns and is invisible to assistive tech — unacceptable for a
  government customer.
- `loading.tsx` + `error.tsx` boundaries for tenant, admin, compare, and
  insights routes.

### 4.3 Insights v2

- Hover-linking: hovering a dimension highlights it across matrix, bars, and
  research cards; hovering a borough dims the other columns (small client
  layer over the existing server-rendered page).
- Baseline toggles: `?mode=absolute|vs-city|vs-target|rank` re-expresses the
  matrix and bars; URL-addressable so any view is shareable.
- Sum-mode rows render as stacked contribution bars, not weighted means.

### 4.4 Upstream sync

The vendored plugin fixes (schema-in-prompt, verifier geography line,
evidence-first verifier template) go back to the `open-doughnut` plugin as a
PR — the OSS artifact and the product must keep running the identical
workflow (§5 contract).

---

## Sequencing

| Phase | Contents | Effort |
|---|---|---|
| P1 (pre-pitch) | W1 fully; W3.3–3.4 (they gate W1 acceptance) | ~2 days incl. re-research runs |
| P2 (hardening) | W2.2 policy repairs + 2.3 web/worker fixes (Supabase-independent) | ~2 days |
| P3 (self-host) | W2.1 Supabase removal + 2.4 droplet deploy | ~3 days |
| P4 (product) | W4.1 audit-in-review, W4.2 accessibility, W3.1–3.2 | ~3 days |
| P5 (polish) | W4.3 insights v2, W3.5–3.6, W4.4 upstream PR | ~2 days |

P1 and P2 are parallelizable. Nothing in P3+ blocks the pitch.

## Open questions

- **E. Domain** — the long-run self-hosted deployment needs a name
  (`deep-fryer.io` product branding vs a civic-neutral NYC domain). Decide
  before P3 DNS/TLS setup.
- **F. OSS repo shape** — whether `open-doughnut` finally splits from
  `doughnut-santa-cruz` (v2 §5 rename candidate) before the upstream PR
  lands, or the PR targets the existing repo.
