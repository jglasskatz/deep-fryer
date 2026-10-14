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
  keeps one session per container at a time. Scale out with more replicas —
  sessions are independent.
- Outbound egress goes through the allowlist proxy (`HTTPS_PROXY`): no
  paywall circumvention, and every fetched URL is logged at the
  infrastructure level — provenance is enforced below the model.
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
- The image runs as the unprivileged `node` user.

## Environment

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres (queue + rows) |
| `ANTHROPIC_API_KEY` | Inference (our key — metered per tenant) |
| `ANTHROPIC_MODEL` | Session model (default `claude-sonnet-5`) |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | Evidence storage (SeaweedFS in compose / Spaces / S3) |
| `OPEN_DOUGHNUT_PLUGIN_DIR` | Plugin location (set by the image) |
| `CHROMIUM_PATH` | Playwright browser binary |
| `WORKER_CONCURRENCY` | Parallel sessions per instance (default 1) |
| `APP_URL`, `SMTP_URL`, `EMAIL_FROM` | Run-complete / flagged-finding emails to portrait owners, editors, and organization owners (per each portrait's notification settings) |

## Local development

```bash
pnpm --filter @deep-fryer/worker dev
```

Without `S3_*` env, evidence lands in `apps/web/public/evidence/<tenant>/`
so the drilldown renders it. Without `ANTHROPIC_API_KEY`, sessions fail at
spawn and the run is marked failed — plan/enqueue still works end to end.
