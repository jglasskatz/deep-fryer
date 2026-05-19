# deep-fryer — Design Spec

**Status:** v0 (pre-implementation). Locked enough to start building M0. Open questions tracked at the bottom.

---

## 1. What this is

A multi-tenant SaaS for hosting Doughnut Economics portraits for municipalities. Each tenant gets:

- A public interactive doughnut chart at `app.deep-fryer.io/{slug}`
- An embeddable widget for their own website (`<script>` snippet, Calendly-style)
- A draft/publish admin UI for staff to edit indicators, dimensions, action items, and outreach contacts
- An AI research agent that drafts initial indicator data from public sources
- Per-tenant branding (logo, theme colors, copy)

Customers are city governments, county agencies, regional planning bodies, civic nonprofits. We provision them manually (no self-serve in v1).

## 2. Glossary

| Term | Meaning |
|---|---|
| **Tenant** | A jurisdiction with its own doughnut (e.g., City of Portland). |
| **Member** | A user (Google account) granted access to a tenant, with a role (`owner` / `editor` / `viewer`). |
| **Dimension** | One slice of the doughnut. The framework defaults are 12 social + 9 ecological. Tenants can add, remove, or tweak. |
| **Canonical slug** | Optional pointer from a dimension back to a framework dimension (`housing`, `climate_change`, etc.) so we can compare across tenants where it makes sense. |
| **Indicator** | A measurable metric inside a dimension (e.g., "% renters cost-burdened"). A dimension has one or more. |
| **Version** | A snapshot of a dimension (or contact) at a point in time. Edits create new versions; `published_version_id` controls what the public sees. |
| **Action item** | A concrete next step listed under a dimension (3–5 per dim). Lives inside the version's data blob. |
| **Outreach contact** | An external org/person tied to a tenant's data-gathering or community engagement work. |
| **Embed** | A stripped-chrome iframe view of the doughnut, dropped into a customer's own site. |

## 3. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, RSC), TypeScript |
| DB | Postgres via Supabase |
| Auth | Supabase Auth, Google OAuth provider |
| ORM | Drizzle (schema in TS, migrations as SQL in git) |
| File storage | Supabase Storage (one bucket per tenant, for source PDFs/screenshots) |
| Viz | D3.js (port `d3-doughnut.js` from `doughnut-santa-cruz`) |
| UI kit | Tailwind + shadcn/ui |
| MDX | Tenant-customizable drilldown pages |
| Hosting | Vercel |
| MCP | Custom MCP server (Node.js, `@modelcontextprotocol/sdk`) |
| AI | `@anthropic-ai/sdk` for the research agent |

## 4. Repo layout

```
deep-fryer/
├── apps/
│   └── web/                              # Next.js app (viewer + admin)
│       ├── app/
│       │   ├── (marketing)/              # landing page, pricing later
│       │   ├── (auth)/sign-in/
│       │   ├── [tenant]/                 # PUBLIC VIEWER
│       │   │   ├── page.tsx              # main doughnut
│       │   │   ├── outreach/page.tsx
│       │   │   ├── dim/[slug]/page.tsx   # drilldown
│       │   │   └── pages/[slug]/page.tsx # custom MDX pages
│       │   ├── [tenant]/admin/           # AUTH-GATED ADMIN
│       │   │   ├── dimensions/
│       │   │   ├── outreach/
│       │   │   ├── pages/
│       │   │   ├── settings/             # branding, members, embed config
│       │   │   ├── research/             # AI research agent UX
│       │   │   └── history/              # audit log / version timeline
│       │   ├── embed/[tenant]/           # STRIPPED EMBED VIEW
│       │   │   ├── route.ts              # serves the iframe HTML
│       │   │   └── doughnut/page.tsx
│       │   ├── architecture/             # arch-visualizer output (internal)
│       │   └── api/                      # API routes
│       │       ├── tenants/[slug]/doughnut/route.ts
│       │       ├── dimensions/[id]/route.ts
│       │       ├── outreach/[id]/route.ts
│       │       └── research/route.ts
│       └── components/
│           ├── doughnut/                 # ported d3 class + React wrapper
│           ├── admin-table/
│           ├── version-diff/
│           └── ...
├── packages/
│   ├── db/                               # Drizzle schema, migrations, client
│   │   ├── schema.ts
│   │   └── migrations/*.sql
│   ├── core/                             # types, Zod validators, viz_level deriver
│   ├── mcp/                              # custom MCP server binary
│   │   └── src/tools/
│   └── ai-research/                      # research agent
│       ├── prompts/
│       └── runners/
├── supabase/
│   ├── config.toml
│   └── seed.sql                          # framework dimension defaults
├── scripts/
│   ├── create-tenant.ts                  # manual provisioning CLI
│   └── invite-member.ts
├── docs/
│   ├── data-model.md
│   ├── embed-protocol.md
│   ├── adding-a-tenant.md
│   └── mcp.md
├── SPEC.md                               # this file
└── README.md
```

## 5. Data model

Drizzle schema lives in `packages/db/schema.ts`. Sketch (TypeScript-ish):

```ts
// AUTH (managed by Supabase, referenced via auth.users)

tenants {
  id            uuid pk
  slug          text unique not null      // url segment: 'portland', 'santacruz'
  name          text not null             // 'City of Portland'
  region        text                      // 'OR, USA'
  population    integer
  description   text
  branding      jsonb                     // { logo_url, primary_color, font, footer_html }
  embed_origins text[]                    // ['portland.gov', 'www.portland.gov']
  created_at    timestamptz
  archived_at   timestamptz nullable
}

tenant_members {
  tenant_id     uuid fk -> tenants
  user_id       uuid fk -> auth.users
  role          enum ('owner', 'editor', 'viewer')
  invited_at    timestamptz
  joined_at     timestamptz nullable
  pk (tenant_id, user_id)
}

dimensions {
  id                    uuid pk
  tenant_id             uuid fk -> tenants
  ring                  enum ('social', 'ecological')
  slug                  text                       // url-safe, unique per (tenant, ring)
  canonical_slug        text nullable              // 'housing', 'climate_change' if mapped to framework
  display_order         integer
  published_version_id  uuid fk -> dimension_versions nullable
  archived_at           timestamptz nullable
  unique (tenant_id, ring, slug)
}

dimension_versions {
  id            uuid pk
  dimension_id  uuid fk -> dimensions
  version_num   integer                            // monotonic per dimension
  status        enum ('draft', 'published', 'archived')
  data          jsonb                              // see DIMENSION DATA SHAPE below
  viz_level     real                               // derived; -100..150 scale for the chart
  created_by    uuid fk -> auth.users
  created_at    timestamptz
  published_at  timestamptz nullable
  unique (dimension_id, version_num)
}

// DIMENSION DATA SHAPE (jsonb)
// {
//   name: string,
//   icon: string,            // emoji or icon slug
//   description: string,     // 1-line plain-language explainer
//   context: string,         // 2-3 sentence narrative
//   indicators: [
//     {
//       name, value, unit, year, target,
//       shortfall_pct?, overshoot_pct?,
//       source, source_url, source_doc_path?,  // supabase storage path
//       confidence: 'high'|'medium'|'low',
//       geographic_scale: 'city'|'county'|'state'|'national',
//     }
//   ],
//   actions: string[],       // 3-5 action items
//   policy_spotlight?: string,
//   justice_spotlight?: string,
// }

outreach_contacts {
  id                    uuid pk
  tenant_id             uuid fk -> tenants
  published_version_id  uuid fk -> outreach_contact_versions nullable
  archived_at           timestamptz nullable
}

outreach_contact_versions {
  id              uuid pk
  contact_id      uuid fk -> outreach_contacts
  version_num     integer
  status          enum ('draft', 'published', 'archived')
  data            jsonb        // { org, person, phone, email, website, address, tags[], data_needs[], why, draft_message }
  created_by      uuid fk -> auth.users
  created_at      timestamptz
  published_at    timestamptz nullable
}

custom_pages {
  id                    uuid pk
  tenant_id             uuid fk -> tenants
  slug                  text
  published_version_id  uuid fk -> custom_page_versions nullable
  unique (tenant_id, slug)
}

custom_page_versions {
  id              uuid pk
  page_id         uuid fk -> custom_pages
  version_num     integer
  status          enum ('draft', 'published', 'archived')
  title           text
  mdx_body        text
  created_by      uuid fk -> auth.users
  created_at      timestamptz
  published_at    timestamptz nullable
}

audit_log {
  id          bigserial pk
  tenant_id   uuid fk -> tenants
  user_id     uuid fk -> auth.users nullable
  entity      text                     // 'dimension' | 'outreach_contact' | 'custom_page' | 'tenant' | 'member'
  entity_id   uuid
  action      text                     // 'edit_draft' | 'publish' | 'archive' | 'restore' | 'invite' | 'role_change'
  before      jsonb nullable
  after       jsonb nullable
  ts          timestamptz default now()
  // most edits are reconstructable from *_versions tables; audit_log captures non-versioned actions and is a convenience index
}
```

**Why versions tables for everything editable:** draft/publish workflow + history + rollback all fall out of one pattern. Public viewer reads `published_version_id`; admin reads/writes drafts. No `status` column to keep in sync across multiple rows.

**Why `viz_level` is denormalized on the version row:** the deriver is deterministic, but caching it avoids running the function on every read and keeps the chart endpoint fast.

## 6. The `viz_level` deriver

Lives in `packages/core/scoring.ts`. Maps the rich indicator data to a single number on a `-100..150` scale (matching `doughnut-santa-cruz` so the D3 class works unchanged):

```
-100 .. 0   → "doing well" (under social foundation = no shortfall; under ecological ceiling = no overshoot)
0 .. 50     → on track / approaching threshold
50 .. 100   → shortfall / overshoot
100 .. 150  → severe shortfall / severe overshoot
null        → unknown (renders as gray)
```

Algorithm v1 (simplest viable):

- For **social** dimensions: take the max `shortfall_pct` across indicators. Map 0%→0, 50%→100, 100%+→150.
- For **ecological**: same with `overshoot_pct`.
- If no indicators have a percentage, `viz_level = null`.

Easy to swap to a weighted average or other deriver later — the public chart endpoint only reads `viz_level`, so the change is one function.

## 7. Routes

### Public viewer (no auth)
- `GET /{tenant}` — main doughnut + dimension labels
- `GET /{tenant}/dim/{slug}` — drilldown for one dimension (indicators, actions, sources)
- `GET /{tenant}/outreach` — public-facing outreach directory
- `GET /{tenant}/pages/{slug}` — tenant-authored MDX page

### Embed (no auth, CSP-restricted)
- `GET /embed/{tenant}` — stripped chrome, just the doughnut + click-to-expand panel. Accepts query params:
  - `theme=light|dark|auto` (default `auto`)
  - `size=N` (clamped 320..1200, default responsive)
  - `dim={slug}` (open this dimension on load)
  - `accent=#hex` (override primary color)
- Response sets `Content-Security-Policy: frame-ancestors 'self' {tenant.embed_origins...};` so only allowlisted sites can iframe it.
- Loader script at `GET /embed.js` — injectable as `<script src="https://app.deep-fryer.io/embed.js" data-tenant="portland"></script>` — creates the iframe, handles `postMessage` resize events.

### Admin (auth required, member of tenant)
- `GET /{tenant}/admin` — overview: published-vs-draft summary, recent audit entries
- `GET /{tenant}/admin/dimensions` — list, reorder, add/remove
- `GET /{tenant}/admin/dimensions/{id}` — version timeline + draft editor
- `GET /{tenant}/admin/outreach`
- `GET /{tenant}/admin/pages`
- `GET /{tenant}/admin/settings` — branding, members, embed origins
- `GET /{tenant}/admin/research` — AI research agent UI
- `GET /{tenant}/admin/history` — full audit log

### API (auth required for writes; `tenant_id` checked via RLS)
- `GET /api/tenants/{slug}/doughnut` — published data for the viewer/embed (cacheable)
- `GET /api/tenants/{slug}/admin/doughnut` — draft + published combined for the admin
- `POST /api/dimensions` — create
- `PATCH /api/dimensions/{id}` — reorder, archive
- `POST /api/dimensions/{id}/versions` — save new draft
- `POST /api/dimensions/{id}/versions/{vid}/publish` — promote draft to published
- `POST /api/dimensions/{id}/versions/{vid}/revert` — make an old version the published one
- (similar shape for outreach, pages)
- `POST /api/research/start` — kick off AI research run
- `GET /api/research/{run_id}` — poll status / stream results

## 8. Embed protocol

Two ways a customer embeds:

**A. Raw iframe** (full control):
```html
<iframe src="https://app.deep-fryer.io/embed/portland?theme=dark&size=600"
        style="border:0; width:100%; height:700px;"></iframe>
```

**B. Script loader** (auto-sizing, recommended):
```html
<div data-deep-fryer="portland" data-theme="dark"></div>
<script src="https://app.deep-fryer.io/embed.js" async></script>
```

The loader:
1. Finds all `[data-deep-fryer]` elements
2. Injects an iframe pointing to `/embed/{tenant}` with the data-attributes as query params
3. Listens for `postMessage({ type: 'deep-fryer:resize', height })` from the iframe and resizes
4. Listens for `postMessage({ type: 'deep-fryer:navigate', url })` for "open in new tab" links

Allowlisting: the tenant settings page lets owners set `embed_origins`. The embed route emits `Content-Security-Policy: frame-ancestors 'self' <origins>;` so unallowed sites can't iframe.

Full protocol in `docs/embed-protocol.md` (to be written in M2).

## 9. Auth + Row-Level Security

Supabase Auth with Google OAuth provider. No password fallback in v1.

RLS policies (sketch):

```sql
-- Tenants: members can read their tenants
create policy tenants_select on tenants for select
  using (id in (select tenant_id from tenant_members where user_id = auth.uid()));

-- Published doughnut data is publicly readable (the public viewer)
-- by using a separate service role + filtered view, not by relaxing RLS on dimensions.

-- All writes require membership with role >= editor:
create policy dimensions_write on dimensions for all
  using (tenant_id in (
    select tenant_id from tenant_members
    where user_id = auth.uid() and role in ('owner', 'editor')
  ));

-- Owners only: tenant settings, member changes
create policy tenant_members_write on tenant_members for all
  using (tenant_id in (
    select tenant_id from tenant_members
    where user_id = auth.uid() and role = 'owner'
  ));
```

Public viewer/embed routes use a server-side anonymous client that calls a `published_doughnut(slug)` SQL function — bypasses RLS in a controlled way, returns only published versions. No tenant-isolation worry because the function takes `slug` as input.

## 10. MCP server

Lives in `packages/mcp/`. Exposes deep-fryer's domain through MCP tools — Claude (in any project) can connect and edit tenant data without grepping JSON or writing SQL.

**Tools (v1):**
- `list_tenants()`
- `get_tenant(slug)`
- `get_doughnut(slug, { include_drafts?: bool })`
- `list_dimensions(slug)`
- `get_dimension(slug, dim_slug)` — returns published + latest draft
- `create_dimension(slug, { ring, name, slug, canonical_slug? })`
- `update_dimension_draft(slug, dim_slug, partial_data)` — patches the draft jsonb
- `publish_dimension(slug, dim_slug)`
- `add_action_item(slug, dim_slug, text)`
- `list_outreach(slug)`
- `add_outreach_contact(slug, contact_data)`
- `start_research(slug, { dimensions?: string[] })` — kicks off the AI research agent
- `audit_log(slug, { entity?, since?, limit? })`

Tools call the same `/api/*` endpoints the admin UI uses; auth via a long-lived MCP token bound to a service account on the tenant. Token lives in `~/.deep-fryer/credentials` after `deep-fryer mcp login`.

Full surface in `docs/mcp.md` (to be written in M3).

## 11. AI research agent

Lives in `packages/ai-research/`. Generalizes the Node.js research agent from `doughnut-santa-cruz`.

**Inputs:** tenant `{ name, region, population, description }`, list of dimensions (with their `canonical_slug` if any), optional source documents (uploaded PDFs).

**Process:**
1. For each dimension, the agent generates a research prompt parameterized by the dimension's name + canonical_slug + tenant region.
2. Calls Claude (`claude-opus-4-7`) with web access or pre-uploaded source PDFs.
3. Returns structured indicator data conforming to the dimension data schema.
4. Saves results as a **draft version** on each dimension. Editor reviews and clicks Publish.

**UX:** admin clicks "Run research" → background job → results stream into the dimension list as drafts → editor reviews each.

**Cost:** runs on our Anthropic API key in v1; we eat the cost (probably $1-3 per tenant for a full portrait). Track usage per tenant for later billing.

## 12. Architecture page

Run the `architecture-visualizer` skill against the deep-fryer repo to generate `apps/web/app/architecture/page.tsx` + data file. Internal-only route (auth-gated to anyone who can sign in; not per-tenant). Re-run quarterly or when the topology shifts.

## 13. Phased build plan

### M0 — Walking skeleton (~1 week)
- Next.js app + Supabase project + Drizzle schema for `tenants`, `tenant_members`, `dimensions`, `dimension_versions`, `audit_log`
- Google sign-in flow
- `scripts/create-tenant.ts` CLI to provision a tenant + invite an owner
- Seed: framework defaults (12 social + 9 ecological dimension rows with empty data)
- `GET /{tenant}` renders the doughnut from published versions, port `d3-doughnut.js`
- Hello-world admin page that lists dimensions and lets you edit one indicator's value (draft → publish)
- Deploy to Vercel + Supabase, real DNS, ship a single test tenant (Santa Cruz)

### M1 — Full editing surface (~1-2 weeks)
- Admin pages for dimensions (full CRUD + version timeline + revert), outreach, custom MDX pages, settings (branding, members)
- Dimension reordering, add/remove dimensions (custom + framework)
- `viz_level` deriver wired up, recomputed on draft save
- Audit log UI
- Migrate Santa Cruz data from `doughnut-santa-cruz` JSON into deep-fryer for dogfooding

### M2 — Embed (~1 week)
- `/embed/{tenant}` route + `/embed.js` loader
- `embed_origins` allowlist + CSP enforcement
- Auto-resize via postMessage
- Theme/size/dim query params
- Embed-config UI in settings (preview snippet, copy-to-clipboard)
- Stand up a real demo customer page that embeds

### M3 — MCP (~1 week)
- `packages/mcp/` Node.js binary, distributed via npm or as a Claude Code MCP plugin
- Tool surface above
- `deep-fryer mcp login` CLI for token issuance
- `docs/mcp.md`
- Dogfood: do an entire Portland tenant onboarding via Claude + MCP

### M4 — AI research agent (~2 weeks)
- Generalize the SC research-agent for arbitrary tenant + dimension lists
- Background job runner (probably Vercel Queue or a simple Postgres-backed worker)
- Admin UI for "Run research" → progress → review drafts
- Source-document upload to Supabase Storage; agent reads them as Claude attachments
- Cost tracking per tenant

### M5+ — Polish, not v1
- Custom domains per tenant (CNAME + Vercel domain API)
- Stripe billing
- Public marketing site + self-serve waitlist
- Per-tenant analytics dashboard (Plausible or PostHog)
- Cross-tenant benchmarking view (uses `canonical_slug`)
- Architecture page generation (run arch-visualizer)

## 14. Non-goals for v1

- Self-serve signup
- Billing / subscriptions
- Custom domains
- A11y certification (we'll meet WCAG AA but not formally audit)
- Mobile-native apps
- Public API for third-party developers
- Cross-tenant analytics or benchmarking
- Multi-language i18n (English only)

## 15. Open questions (later)

- **Comments/collaboration on drafts** — does a city editor want to leave a note for a coworker on a draft change? Punt until customers ask.
- **Embed analytics** — do we phone home when an embed loads? Probably yes (anonymous count + referring domain), useful for sales. Decide at M2.
- **Versioning of dimension schema itself** — if we add a field to the dimension data shape later, existing version blobs need to handle it. Use Zod with `.partial()` defaults; document field additions in a `data-shape-changelog.md`.
- **Search across tenants** for the deep-fryer team (Stripe-style internal admin)? — defer until ≥5 tenants.
