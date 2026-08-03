# deep-fryer — Design Spec v2

**Status:** Draft for approval. Supersedes SPEC v0 in full. Decisions in this document were made across the architecture sessions of July 2026; open questions are tracked at the bottom.

---

## 1. What this is

A multi-tenant SaaS for building and hosting Doughnut Economics portraits for municipalities.

This is a civic engagement and governance tool — a way for cities to see, discuss, and act on their social and ecological performance. AI does the research labor backstage; it never appears in the public experience. A resident sees a doughnut, evidence, actions, and a discussion.

Each tenant (city / county / regional body) gets:

- A public interactive doughnut at `app.deep-fryer.io/{slug}` and an embeddable widget for their own `.gov` site
- Per-dimension drilldowns: indicators, targets, **evidence** (source snapshots), and local action items
- A per-dimension public discussion board (Reddit-style: threads, up/downvotes, moderation)
- An admin surface where staff **review, verify, edit, and publish** research findings — this review flow is the core product experience and the primary onboarding for city staff
- A backstage research plane that populates and refreshes the portrait with fully sourced data

Customers are provisioned manually in v1 (no self-serve). Inference runs on our infrastructure and our API key, metered per tenant for later billing.

**The open-source counterpart:** the `doughnut-santa-cruz` repo is restructured as the OSS artifact — a Claude Code plugin plus shared schemas, methodology docs, and a static dashboard. Enthusiasts and evangelists can build a complete portrait themselves with their own Claude Code. deep-fryer **vendors the OSS plugin as its research runtime**, so the hosted product and the community tool run the identical workflow by construction. Community improvements flow into the product; product improvements ship to the community.

## 2. Glossary

| Term | Meaning |
|---|---|
| **Tenant** | A jurisdiction with its own doughnut. |
| **Member** | A user with a role on a tenant: `owner` / `editor` / `viewer`. |
| **Dimension** | One wedge of the doughnut. Framework default: 12 social + 9 ecological. Tenants may add/remove/rename; `canonical_slug` maps custom dimensions back to framework ones for cross-tenant comparison. |
| **Indicator** | A measurable metric inside a dimension. One or more per dimension. |
| **Finding** | An immutable research output for an indicator: value, year, source, evidence, scale, verification result. Produced by a research session; never mutated. |
| **Version** | A snapshot of a dimension's full data. Research runs and human edits each create new versions; `published_version_id` controls what the public sees. |
| **Evidence** | A snapshot (screenshot and/or PDF) of the source captured at retrieval time, stored per tenant, displayed next to the claim. |
| **Research run** | One `plan`/`apply` execution: a set of sessions producing findings for review. |
| **Session** | One Claude Agent SDK session researching one dimension (or the region context). The unit of audit: full transcript retained. |
| **Portrait config** | The per-tenant configuration that fully determines research behavior and scoring (§6). |

## 3. Architecture overview — three planes

```
 ┌────────────────────────────────────────────────────────────┐
 │ PUBLIC PLANE (no AI visible)                               │
 │  doughnut → dimension drilldown → evidence → actions →     │
 │  discussion board · embed widget                           │
 ├────────────────────────────────────────────────────────────┤
 │ REVIEW PLANE (admin; the product surface)                  │
 │  review cards · approve/edit/re-research/flag-gap ·        │
 │  draft/publish versions · config settings · audit          │
 ├────────────────────────────────────────────────────────────┤
 │ RESEARCH PLANE (backstage; OSS plugin as runtime)          │
 │  orchestrator (plan/apply) → sessions (1/dimension) →      │
 │  verifier → findings + evidence + transcripts              │
 └────────────────────────────────────────────────────────────┘
```

Data flows upward only through verification and review: research produces findings → verifier gates them → review approves them → publish makes them public. Nothing reaches the public plane without a human decision (per tenant review policy).

## 4. Stack

| Layer | Choice | Notes |
|---|---|---|
| Web framework | Next.js 15 (App Router, RSC), TypeScript | Public viewer + admin in one app |
| DB | Postgres via Supabase | |
| Auth | Supabase Auth (Google OAuth; email magic-link for public commenters if needed) | |
| ORM | Drizzle | Schema in TS, migrations in git |
| Storage | Supabase Storage, one bucket per tenant | Evidence snapshots, source PDFs |
| Viz | Canvas renderer (`doughnut.js`) from `doughnut-santa-cruz`, wrapped as a React component | **Decided:** the canvas visual (what the live SC site renders) is canonical. deep-fryer's M0 D3 port is replaced. |
| UI kit | Tailwind + shadcn/ui | |
| Web hosting | DigitalOcean (dockerized Next.js, App Platform or droplet) | Web app only; decided over Vercel — self-hosted containers |
| **Research runtime** | **Dockerized worker service on DigitalOcean** running the Claude Agent SDK in sandboxed containers | Kept separate from the web app: the queue decouples request/response from long-running agent sessions. The web app enqueues; the worker executes. |
| Research workflow | The OSS `doughnut` Claude Code plugin (vendored) | Identical artifact the community runs |
| Job queue | Postgres-backed queue (e.g. graphile-worker) | One infra dependency fewer than a hosted queue |
| MCP | Custom MCP server (later milestone) | Lets Claude Code users drive the hosted product |

## 5. Repos and the OSS boundary

**`doughnut-santa-cruz` → restructured as the OSS artifact** (rename candidate: `open-doughnut`):

```
open-doughnut/
├── plugin/                 # Claude Code plugin
│   ├── commands/           # /doughnut init | plan | research | status
│   ├── agents/             # dimension-researcher, region-context, verifier subagent defs
│   ├── skills/             # methodology, source-evaluation, evidence-capture
│   └── schemas/            # finding, portrait-config, framework JSON Schemas
├── framework/              # framework.json (dimensions, rings, lenses),
│                           # thresholds.json (targets + mapping fn refs + rationales)
├── dashboard/              # static canvas dashboard + JSON export loader
│                           # (the enthusiast path: research locally, deploy to Pages)
├── docs/                   # methodology, four lenses, adding-a-city
└── examples/santa-cruz/    # the SC portrait as reference data, sources/ INDEX preserved
```

Retired: `tools/research-agent.js`, `docs/agent-ui.js`, `agent-chat.js` (single-completion, no tools, no provenance — replaced wholesale), and the `ca-doughnut` repo (archived; its static-export and versioning ideas live on here).

**`deep-fryer` (closed)** consumes `open-doughnut` two ways: `framework/` + `plugin/schemas/` as a package dependency (the shared contract), and `plugin/` vendored into the worker image as the research runtime. CI pins the plugin version; upgrading it is a reviewed PR.

## 6. Configuration model

Design principle (agreed): **every human judgment is explicit, versioned configuration; prompts and code consume config and never embed judgment.** Config is data plus a *named* mapping function from a small fixed set implemented in code — no expression language. Three layers, each surfaced as normal settings UI in the product (nobody edits files):

| Layer | Contents | Edited by | Lives in |
|---|---|---|---|
| **Framework** | Rings, dimensions, indicators, lenses; default thresholds with rationales | OSS community / us, rarely | `open-doughnut/framework/`, seeded into DB |
| **Portrait** (per tenant) | Region definition & context notes; source-priority tiers; recency limits per dimension; geographic-scale acceptance per dimension; threshold overrides (**rationale required**, rendered on the public methodology page) | Tenant owner + us during onboarding | `tenant_config` table |
| **Behavior** (per tenant) | Review policy (what needs approval, who approves what, dual-review on edits y/n); moderation roles; notification prefs; transcript retention period; branding; embed origins | Tenant owner | `tenant_config` table |

Precedence: framework → portrait → per-finding human decisions. Each layer overrides, never mutates, the one below. A published portrait is fully reconstructable from `findings + config + review decisions` — the property a records request or skeptical journalist needs.

## 7. Data model

Carries forward v0's version-everything pattern (its best decision) with additions marked **new**.

```ts
tenants { id, slug, name, region, population, description,
          branding jsonb, embed_origins text[], created_at, archived_at? }

tenant_config {                                          // NEW — §6 portrait + behavior layers
  tenant_id fk, key text, value jsonb, updated_by fk, updated_at
  // keys: 'source_priority', 'recency', 'scale_policy',
  //       'threshold_overrides', 'review_policy', 'retention', ...
  pk (tenant_id, key)
}

tenant_members { tenant_id, user_id, role: owner|editor|viewer|moderator }   // NEW role: moderator

dimensions { id, tenant_id, ring, slug, canonical_slug?, display_order,
             published_version_id?, archived_at? }

dimension_versions {
  id, dimension_id, version_num, status: draft|published|archived,
  data jsonb,                    // shape below
  viz_level real,                // derived; -100..150
  origin enum,                   // NEW: 'research' | 'human' | 'import'
  research_run_id fk?,           // NEW: set when origin='research'
  change_note text,              // NEW: required when origin='human' (the rationale)
  created_by, created_at, published_at?
}

// DIMENSION DATA SHAPE (jsonb)
// { name, icon, description, context,
//   indicators: [{
//     name, value, unit, year, target,
//     level_pct,                        // computed by thresholds engine, arithmetic stored
//     scoring: { threshold_ref, function, inputs, worked_math },   // NEW: show-your-work
//     source, source_url, source_tier,  // NEW: which priority tier satisfied it
//     evidence: { snapshot_path, pdf_path?, captured_at },          // NEW: SC evidence pattern
//     confidence, geographic_scale,
//     supporting_source_url?            // NEW: required on human value edits
//   }],
//   gaps: [{ indicator, reason, scales_tried, searched_at }],       // NEW: gaps are findings
//   actions: string[], policy_spotlight?, justice_spotlight? }

// ---- Research plane ----                                          // NEW section

research_runs {
  id, tenant_id, status: planned|running|complete|failed,
  plan jsonb,                    // rendered session specs (prompt, tools, config hash) — inspectable pre-spend
  config_snapshot jsonb,         // frozen portrait config at plan time (reproducibility)
  requested_by, created_at, completed_at?,
  token_usage jsonb              // per-session metering → billing
}

research_sessions {
  id, run_id fk, dimension_id fk?,        // null for the region-context session
  kind: 'region_context' | 'dimension',
  status: queued|running|complete|failed,
  reviewer_notes text?,                   // injected on re-research
  transcript bytea,                       // compressed JSONL; admin/audit access only
  started_at, completed_at?
}

findings {                                // immutable; the audit spine
  id, session_id fk, dimension_id fk, indicator_slug,
  payload jsonb,                          // matches indicator shape above
  verification jsonb,                     // { url_ok, schema_ok, recency_ok, scale_ok,
                                          //   content_supported: pass|fail|uncertain, verifier_note }
  created_at
}

// ---- Discussion board ----                                        // NEW section

comments { id, tenant_id, dimension_id, parent_id?, author_id fk,
           body text, created_at, edited_at?, removed_at?, removed_by? }

comment_votes { comment_id, user_id, vote smallint,  pk(comment_id, user_id) }

moderation_actions { id, tenant_id, comment_id, actor_id, action: remove|restore|lock,
                     reason?, ts }

outreach_contacts / outreach_contact_versions   // unchanged from v0
custom_pages / custom_page_versions             // unchanged from v0
audit_log                                       // unchanged from v0
```

**Immutability contract:** rows in `findings` and research-origin `dimension_versions` are never updated. A human edit creates a new version (`origin='human'`, `change_note` required, `supporting_source_url` required for value changes — human edits meet the same provenance bar as research). The diff between a research version and the subsequent human version *is* the reviewer overlay, reconstructable forever.

## 8. The research plane

Runs on the worker service; executes the vendored OSS plugin via the Claude Agent SDK. Terraform-shaped:

**Plan.** `POST /api/research/plan` renders, without spending tokens: the session list (phase-0 region-context + one per selected dimension), each session's full prompt (assembled from plugin skills + portrait config), tool allowlist, and output schema. Stored on `research_runs.plan`; an admin can inspect it before `apply`. Predictable session count = predictable cost envelope = meterable pricing.

**Apply.** Worker spawns sessions, each in an ephemeral container: network egress through an allowlist proxy (no paywall circumvention; every fetched URL logged at infra level — provenance enforced below the model), filesystem scoped to a per-session workspace, no access to other tenants. The region-context session runs first; its brief (geography, governance, data portals, institutions — the automated Santa Cruz context doc) is injected into all dimension sessions. Inside a session, the plugin's subagents handle per-lens source discovery and extraction; **the session must exhaust source-priority tier N before accepting tier N+1**, and every finding records the tier that satisfied it.

**Evidence capture** (formalizing SC's `sources/` pattern): for every accepted source, the session captures a page screenshot and, where applicable, the PDF, stored to tenant storage with `captured_at`. This is the anti-link-rot and anti-staleness record, and it is what the public drilldown displays next to each claim.

**Verify.** Before any finding reaches review: deterministic checks (schema, URL resolves, year within recency policy, scale within scale policy), then the verifier subagent independently fetches each `source_url` and judges whether the page supports the claimed value (`content_supported: pass|fail|uncertain`). A research agent can hallucinate a plausible citation; it cannot make the fetched page contain the number. Failures are never dropped — they surface as red-flagged review cards with the verifier's reasoning. **Data gaps are first-class findings** ("no city-level data exists; tried tiers 1–3") and produce gap cards, not errors.

**Rerun.** User-directed only, from review: select dimensions, attach reviewer notes (injected verbatim into the new session), `plan` → `apply`. Recency policy drives staleness flags in the admin overview, which is the year-over-year loop: next year the product proposes a targeted refresh of what's stale, and portrait versions compare side-by-side.

**Scoring.** The thresholds engine (in `core`, config from §6) computes `level_pct` from value + target via the named mapping function, storing the worked arithmetic. The session proposes; the review card shows the math; the human approves. `viz_level` derives from indicator `level_pct`s (v0's deriver, now fed by the thresholds engine; default aggregation `worst_of`).

**Transcripts.** Full session JSONL, compressed, in `research_sessions.transcript`. Admin/audit access only — the default review surface is findings + evidence, not transcripts. Retention period is tenant behavior config (municipal records requirements vary); export supported.

## 9. The review plane (the product)

Admin at `/{tenant}/admin`. The review queue is the primary experience:

- **Review cards**, one per dimension per run: proposed indicator values with worked scoring math, clickable sources, inline evidence snapshots, verification status, confidence, scale + tier badges, and gap cards. Transcript link for audit-role users.
- **Actions:** Approve (creates/promotes the draft version) · Edit (new human version; change_note + supporting source required) · Re-research (with notes) · Flag gap (publishes an honest data-gap wedge — gray, not hidden).
- **Publish** promotes per tenant review policy (default: everything human-gated; dual-review configurable).
- Draft/publish, version timeline, revert — v0's design, unchanged.
- Settings surfaces all §6 config as forms. Overview shows staleness flags and most-discussed dimensions.

Action items and narrative content ("what needs doing / how to get involved") are drafted by research sessions from approved data and flow through the same review queue as a card type.

## 10. The public plane

- `GET /{tenant}` — the doughnut. `GET /{tenant}/dim/{slug}` — drilldown: value, target, plain-language context, **evidence snapshot beside each claim**, actions, and the dimension's discussion thread. `GET /{tenant}/outreach`, `/{tenant}/pages/{slug}` — as v0.
- **Discussion:** threaded comments per dimension, up/downvote, sort by top/new. Sign-in required to post/vote (Supabase Google OAuth). `moderator`+ can remove/restore/lock with logged reasons. Native build (~3 tables + RLS) — we already own auth and tenancy; embedding a third-party comment service would add a second auth system to avoid a week of work. Keyed on `(tenant_id, dimension_id)`: stable across versions and years by construction. Rate limits + per-tenant "require approval for first post" toggle as the v1 anti-spam floor.
- **Embed:** v0's protocol unchanged (iframe + loader script, `embed_origins` CSP allowlist, postMessage resize). Embeds include the drilldown; discussion links out to the hosted page.
- **Methodology page** (`/{tenant}/methodology`): auto-generated from config — thresholds with rationales, overrides with their required rationales, source-priority tiers, last-refreshed dates. No AI-assistance disclosure in v1 (deliberate decision; revisit if a customer, records requirement, or trust concern calls for it).
- No AI chrome anywhere on this plane. No model names, no "researched by," no sparkles.

## 11. Auth & RLS

As v0 (Supabase, Google OAuth, RLS policies per role; public reads via a `published_doughnut(slug)` function) with additions: `moderator` role; comment RLS (authors edit own, moderators remove within tenant); `transcript`/audit access restricted to `owner` + internal staff.

## 12. Milestones

- **M0 — Contract + skeleton** (partially done): monorepo, schema *including §7 additions* (migrating now is 10× cheaper than after data exists), canvas viz port (React wrapper around `doughnut.js`, replacing the D3 port), create-tenant CLI, framework seed, public doughnut from published versions.
- **M1 — Editing + publishing:** admin CRUD, version timeline/revert, thresholds engine in `core` feeding `viz_level`, config settings UI, audit log. Migrate SC data in — *with* its evidence (`sources/` screenshots → tenant storage) so the drilldown pattern is real from day one.
- **M2 — OSS restructure:** reshape `doughnut-santa-cruz` per §5; extract shared contract; plugin v0 (`init|plan|research|status`) runnable by an enthusiast end-to-end; deep-fryer consumes the contract package.
- **M3 — Research plane:** worker service + queue; plan/apply; region-context + dimension sessions via vendored plugin; sandbox egress policy; evidence capture; verifier; findings + transcripts; metering. Dogfood: full Santa Cruz re-research through the product.
- **M4 — Review plane:** review queue + cards, approve/edit/re-research/flag-gap flows, staleness overview, review policy config. **This is the product milestone — budget accordingly.**
- **M5 — Public engagement:** discussion board + moderation; drilldown evidence display polish; methodology page; embed (v0's M2 scope).
- **M6+ — not v1:** MCP server for the hosted product, billing, custom domains, self-serve, cross-tenant benchmarking, analytics, i18n.

Ordering rationale: research (M3) before review (M4) so the review UI is built against real findings, not fixtures; OSS restructure (M2) before research because the plugin *is* the research runtime.

## 13. Non-goals for v1

Self-serve signup · billing · custom domains · public third-party API · cross-tenant analytics · i18n · mobile-native apps · live session spectating (visibility is post-hoc audit by decision) · automatic scheduled re-research (reruns are user-directed by decision).

## 14. Decisions log & open questions

- **A. AI disclosure** — resolved: none in v1; revisit if needed.
- **B. Public commenter identity** — resolved: a signed-in account with a display name is sufficient for now; verified-resident affordances deferred indefinitely.
- **C. OSS license** — open. Decide at M2 (MIT for adoption vs. share-alike given the DEAL ecosystem's CC BY-SA norms).
- **D. Evidence snapshot rendering** — resolved: Playwright in the worker as the starting implementation; iterate freely if cost or reliability disappoints.
