# @deep-fryer/worker

The research plane's execution service (SPEC.md §8). The web app plans and
enqueues; this worker consumes the Postgres-backed queue (graphile-worker)
and runs sessions via the Claude Agent SDK, executing the vendored
open-doughnut plugin.

## What a run does

1. `research_apply` job arrives with a `runId` whose row already holds the
   rendered plan (inspectable pre-spend) and the frozen portrait config.
2. Phase 0: the region-context session produces the region brief.
3. One session per dimension, brief injected, with the `capture_evidence`
   MCP tool (Playwright screenshot + PDF into the tenant's storage bucket).
4. Every finding passes deterministic checks (schema/URL/recency/scale) and
   an independent verifier session that re-fetches the source and judges
   `content_supported`. Failures become red-flagged findings — never dropped.
5. Transcripts (gzipped JSONL) land on `research_sessions.transcript`;
   token usage per session lands on `research_runs.token_usage` for
   metering.

## Isolation & provenance (production deploy)

- One container instance per worker (App Platform worker or compose replica); `WORKER_CONCURRENCY=1`
  keeps one job (a research run or a policy analysis) per container at a
  time, and a research run keeps up to `RESEARCH_SESSION_CONCURRENCY`
  dimension sessions going inside it. Scale out with more replicas —
  sessions are independent.
- Outbound egress goes through the allowlist proxy (`HTTPS_PROXY`; compose
  sets it from `WORKER_HTTPS_PROXY`): no paywall circumvention, and every
  fetched URL is logged at the infrastructure level — provenance is enforced
  below the model. The sessions' CLI and Chromium read `HTTPS_PROXY`
  themselves; Node's own fetch (source checks, PDF downloads, the NWS feed)
  uses it only with `NODE_USE_ENV_PROXY=1`, which compose sets whenever a
  proxy is configured. Without a proxy, egress is limited only by the egress
  guard below (docs/deploy.md "Worker egress").
- The container filesystem is scratch-only; each session gets a temp
  workspace that is deleted afterward. Evidence goes to one S3-compatible
  bucket under a per-tenant prefix (`tenant-<slug>/`); the prefix is chosen
  by the worker from the run's tenant, never by the agent, and objects are
  never overwritten. (The bucket credentials themselves are bucket-wide — use
  a dedicated bucket and key for deep-fryer.)
- Egress guard (`packages/research/src/egress.ts`): every URL the worker
  fetches — source checks, page captures and all their subrequests and
  redirect hops, PDF downloads — must be https and resolve only to public
  addresses. The allowlist proxy remains the layer that pins connections.
- Session containment (`src/session.ts`): a session's tool allowlist is its
  entire tool surface — only the listed built-in tools exist (`tools`), they
  are pre-approved, and anything else is denied (`permissionMode: 'dontAsk'`),
  so no session has a shell or file access. The session's CLI subprocess gets
  a minimal environment (Anthropic/Claude Code settings, proxy and CA bundle,
  PATH/HOME/locale) — never `DATABASE_URL`, `S3_*`, `SMTP_URL`, or any other
  worker secret — because session input (fetched pages, pasted policy briefs)
  is untrusted text.
- The image runs as the unprivileged `node` user.

## Environment

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres (queue + rows) |
| `ANTHROPIC_API_KEY` | The deployment's key: every session a plan funds runs on it (metered per organization against the plan's allowance). Unset, plan-funded runs are refused in the web app before they are queued — compose tells the web app through `DF_RESEARCH_KEY_CONFIGURED`, never by giving it the key — and only sessions on an organization's own key run |
| `ANTHROPIC_MODEL` | Session model (default `claude-sonnet-5`) |
| `ANTHROPIC_SMALL_FAST_MODEL` | The page reader: Claude Code's WebFetch summarizes each fetched page with it, for researchers and the verifier alike (compose default `claude-haiku-4-5-20251001`). Pinned so an SDK update cannot swap it; a first-party API id (behind Bedrock, Vertex, Foundry or a gateway, the provider's own id). Never set it empty: the CLI treats that as unset and drops the pin |
| `VERIFIER_MODEL` | Verifier sessions, one per indicator finding (default `claude-opus-5`) |
| `RESEARCH_SUBAGENT_MODEL` | `source-scout` subagents for researcher sessions; unset or empty = scouts off (the default) |
| `RESEARCH_SESSION_CONCURRENCY` | Dimension sessions one research run keeps going at once (default 3; `1` = one after another) |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | Evidence storage (SeaweedFS in compose / Spaces / S3) |
| `OPEN_DOUGHNUT_PLUGIN_DIR` | Plugin location (set by the image) |
| `CHROMIUM_PATH` | Playwright browser binary |
| `WORKER_CONCURRENCY` | Jobs (research runs, policy analyses) per instance at once (default 1) |
| `HTTPS_PROXY`, `NODE_USE_ENV_PROXY` | The egress proxy (compose: `WORKER_HTTPS_PROXY`, with `NODE_USE_ENV_PROXY=1` set alongside it) |
| `DF_SECRETS_KEY` | Decrypts organizations' own Anthropic API keys for their sessions (same value as the web app) |
| `APP_URL`, `SMTP_URL`, `EMAIL_FROM` | Run-complete / flagged-finding emails to portrait owners, editors, and organization owners (per each portrait's notification settings) |
| `SUPPORT_EMAIL` | The contact a failed run's email names, and the contact in the NWS alerts feed's User-Agent (falls back to `EMAIL_FROM`'s address) |

## Local development

```bash
pnpm --filter @deep-fryer/worker dev
```

Without `S3_*` env, evidence lands in `apps/web/public/evidence/<tenant>/`
so the drilldown renders it. The web app queues plan-funded runs only with
`DF_RESEARCH_KEY_CONFIGURED=true` in its own environment (compose derives it
from `ANTHROPIC_API_KEY`); set it locally only when this worker has a key,
or the sessions fail at spawn and the run is marked failed. Planning works
end to end either way.
