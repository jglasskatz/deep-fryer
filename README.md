# deep-fryer

A multi-tenant SaaS platform for building and hosting Doughnut Economics portraits for municipalities. Cities get a customizable, embeddable doughnut visualization backed by an editable indicator dataset, action items per dimension, and an outreach directory.

Status: **pre-MVP** — see [`SPEC.md`](./SPEC.md) for the full design.

## What's a doughnut portrait?

A visual framework from Kate Raworth's *Doughnut Economics* showing two concentric rings:

- **Social Foundation** (inner ring) — 12 dimensions of human wellbeing nobody should fall below
- **Ecological Ceiling** (outer ring) — 9 planetary boundaries humanity shouldn't overshoot

The "doughnut" between them is the safe and just space for humanity. Cities use it as a planning lens.

## What deep-fryer is for

Municipalities want their own doughnut portrait. Today that means hiring consultants and getting a static PDF. With deep-fryer, a city gets:

- A live, interactive doughnut for their jurisdiction
- An admin UI for staff to update indicators, add action items, manage outreach contacts
- Embeddable widgets they paste into their existing `.gov` site
- An AI-assisted research agent that drafts initial indicator data from public sources

## Stack

- **Next.js 15** (App Router) — public viewer + admin UI in one app
- **Supabase** — Postgres, Google OAuth, Row-Level Security, Storage
- **Drizzle ORM** — typed schema, migrations as git-tracked SQL
- **D3.js** — doughnut visualization (ported from the Santa Cruz prototype)
- **Tailwind + shadcn/ui** — admin UI primitives
- **Custom MCP server** — Claude-editable surface over the same API the admin UI uses
- **Vercel** — hosting

## Repo layout

See [`SPEC.md`](./SPEC.md) for the full layout, data model, and phased build plan.

## Origins

deep-fryer is the third generation in a small family of doughnut projects:

1. [`doughnut-santa-cruz`](https://github.com/jglasskatz/doughnut-santa-cruz) — static HTML/JS prototype for the City of Santa Cruz. Source of the D3 viz and the data schema.
2. [`ca-doughnut`](https://github.com/jglasskatz/ca-doughnut) — single-tenant React + FastAPI build for California state-level data. Source of the admin UI and outreach model.
3. **deep-fryer** — generalized, multi-tenant, sellable. Cherry-picks the best of both.
