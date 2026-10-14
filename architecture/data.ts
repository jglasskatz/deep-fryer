import type { ArchitectureMap } from "@keel_flow/schema";

// deep-fryer's keel architecture map. The bounded contexts are SPEC §3's
// three planes plus the shared contract; the research plane's agents and
// tools are first-class nodes so pack-research principles attach where the
// work happens. keel verify pattern-matches the 6-space `id:` lines — keep
// the formatting.
// Type-only imports keep this file runtime-dependency-free so the keel CLI
// can load it under any module system; bump alongside @keel_flow/schema.
const data: ArchitectureMap = {
  schemaVersion: "0.4.0",
  layers: [
    { id: "frontend", label: "Web", description: "Next.js app: public + review planes", color: "#477020" },
    { id: "research", label: "Research plane", description: "Worker, queue, and plan/apply orchestration", color: "#883251" },
    { id: "agents", label: "Agents", description: "Research sessions executed via the Claude Agent SDK", color: "#4f46e5" },
    { id: "tools", label: "Tools", description: "In-session tools available to agents", color: "#0891b2" },
    { id: "packages", label: "Packages", description: "Shared contract, domain core, data access", color: "#0f766e" },
  ],
  nodes: [
    {
      id: "web-app",
      label: "Web app",
      layer: "frontend",
      tech: "Next.js 15 / React 19 (PWA)",
      description: "Public doughnut + drilldowns + progress + discussion, the admin review queue where research findings are dispositioned, organization hubs, onboarding, members, and billing pages. Server actions return { ok, error } results; Node-runtime middleware applies the nonce CSP and per-tenant embed frame-ancestors",
      keyFiles: ["apps/web/app", "apps/web/lib/review-actions.ts", "apps/web/middleware.ts", "apps/web/lib/action-result.ts"],
      keyFunctionality: ["published portraits", "review cards", "approve/edit/re-research/flag-gap", "§6 config forms", "family compare/insights/progress", "self-serve trial onboarding", "members + invitations", "security headers"],
      fileCount: 120,
      linesOfCode: "~13k",
      principles: {
        upholds: [
          { id: "review-disposes-each-flag", reason: "Review cards force per-dimension decisions; flagged findings carry the verifier's reasoning inline" },
          { id: "verification-staged-cheap-first", reason: "Reviewers only see findings that already passed deterministic checks and carry verifier verdicts" },
          { id: "errors-at-boundaries", reason: "Every server action is wrapped by action(): user-facing messages survive production redaction, internals are logged and genericized" },
          { id: "request-isolation", reason: "Every tenant-scoped action resolves the tenant and role through requireTenantRole/requireOrgRole before touching data" },
        ],
        violates: [],
      },
    },
    {
      id: "accounts",
      label: "Accounts",
      layer: "frontend",
      tech: "Auth.js v5 / Drizzle adapter",
      description: "Sign-in (Google, Microsoft Entra ID from the ID token alone, email magic link) with revocable database sessions; tenant and organization roles; email-bound invitations; dev mode refused in production. The production environment rules live in core (deploy-env) and are shared by the boot-time assertion and the operator preflight, which also verifies OAuth client credentials against the live providers",
      keyFiles: ["apps/web/auth.ts", "apps/web/lib/auth.ts", "apps/web/lib/invitations.ts", "apps/web/lib/member-actions.ts", "apps/web/lib/env.ts", "packages/core/src/deploy-env.ts", "packages/core/src/preflight.ts", "scripts/preflight.ts"],
      keyFunctionality: ["database sessions", "org owners own every portrait", "hash-only invitation tokens", "last-owner guard", "boot-time env assertion", "live-provider preflight"],
      fileCount: 8,
      linesOfCode: "~900",
      principles: {
        upholds: [
          { id: "wrong-way-impossible", reason: "Production cannot boot in anonymous-owner dev mode; invitations only work for the invited address" },
          { id: "single-source-of-truth", reason: "getRole() and SQL member_role() encode the same org-owner rule" },
        ],
        violates: [],
      },
    },
    {
      id: "billing",
      label: "Billing",
      layer: "frontend",
      tech: "Stripe / core plan catalog",
      description: "Plan catalog and entitlement rules (core), Stripe checkout, PO/net-30 invoicing, portal, staff contracts, and the transactional webhook; research is quota-gated at apply under a subscription row lock",
      keyFiles: ["packages/core/src/plans.ts", "apps/web/lib/stripe.ts", "apps/web/lib/billing-actions.ts", "apps/web/app/api/billing/webhook/route.ts", "apps/web/lib/research.ts", "packages/db/src/billing.ts"],
      keyFunctionality: ["hard research quotas (no overage)", "past_due stays active", "public plane never gated", "idempotent webhook ledger", "prices by Stripe lookup key"],
      fileCount: 10,
      linesOfCode: "~1.4k",
      principles: {
        upholds: [
          { id: "single-source-of-truth", reason: "Entitlement is read only from the subscriptions row; Stripe state reaches it only through syncSubscription" },
          { id: "gate-is-reproducible", reason: "Usage is computed from research runs, so every quota decision can be recomputed from the audit trail" },
        ],
        violates: [],
      },
    },
    {
      id: "progress-engine",
      label: "Progress engine",
      layer: "packages",
      tech: "@deep-fryer/core",
      description: "Baseline-to-target status per indicator from published history: target-year glidepaths, required annual pace, improving/worsening for undated goals; feeds the progress pages and open-data exports",
      keyFiles: ["packages/core/src/progress.ts", "apps/web/lib/progress.ts"],
      keyFunctionality: ["data-year series", "on/off track vs glidepath", "required annual change", "CSV/JSON export"],
      fileCount: 3,
      linesOfCode: "~450",
      principles: {
        upholds: [
          { id: "numbers-carry-epistemic-type", reason: "Statuses are computed over data years with units and target years, never publish dates" },
          { id: "single-source-of-truth", reason: "One pure engine computes statuses for pages, family matrices, and exports alike" },
        ],
        violates: [],
      },
    },
    {
      id: "service-worker",
      label: "Service worker",
      layer: "frontend",
      tech: "PWA (public/sw.js)",
      description: "Installable app; caches hashed assets and anonymous public portrait pages for offline use, never admin/account/billing/auth/API responses or any signed-in page",
      keyFiles: ["apps/web/public/sw.js", "apps/web/app/manifest.ts", "apps/web/components/pwa"],
      keyFunctionality: ["network-first public pages", "x-df-cache contract", "offline page", "update prompt"],
      fileCount: 6,
      linesOfCode: "~400",
      principles: {
        upholds: [
          { id: "request-isolation", reason: "Only responses the server marks x-df-cache: public are stored on the device" },
        ],
        violates: [],
      },
    },
    {
      id: "language-access",
      label: "Language access",
      layer: "frontend",
      tech: "Typed message catalogs + locale-prefixed routes",
      description: "The public plane in English and the ten NYC Local Law 30 languages (Chinese in both scripts): locale-prefixed URLs resolved by middleware, typed catalogs every translation must satisfy, RTL for Arabic and Urdu, framework vocabulary translated inside published content, an English-content notice with the organization's language access contact, localized embeds and offline page",
      keyFiles: ["apps/web/lib/i18n", "apps/web/components/i18n"],
      keyFunctionality: ["/{lang}/… routing + remembered choice", "hreflang alternates", "catalog completeness, placeholder, and plural checks", "language switcher", "language access contact (311)"],
      fileCount: 20,
      linesOfCode: "~4k",
      principles: {
        upholds: [
          { id: "single-source-of-truth", reason: "en.ts is the one source; every catalog is typed against it, and the embed loader and offline page are tested against the same locale list" },
          { id: "wrong-way-impossible", reason: "Middleware always overwrites the locale header, so a client cannot choose a page's language except through its URL" },
        ],
        violates: [],
      },
    },
    {
      id: "research-worker",
      label: "Research worker",
      layer: "research",
      tech: "graphile-worker / Claude Agent SDK (Playwright base image)",
      description: "Consumes the Postgres queue; runs region-context, dimension, and verifier sessions with per-plan tool allowlists. A run settles complete if any session succeeded, failed otherwise, then emails the portrait's owners, editors, and organization owners per its notification settings",
      keyFiles: ["apps/worker/src/tasks/research-apply.ts", "apps/worker/src/tasks/run-status.ts", "apps/worker/src/session.ts", "apps/worker/src/notify.ts", "apps/worker/Dockerfile"],
      keyFunctionality: ["plan execution", "session spawning", "transcripts", "token metering", "run settlement", "run-complete / failed / flagged emails"],
      fileCount: 10,
      linesOfCode: "~900",
      principles: {
        upholds: [
          { id: "single-synthesizer", reason: "Dimension sessions gather; only the review-approved version becomes the published conclusion" },
          { id: "delegation-carries-contract", reason: "Every session runs a rendered plan prompt with objective, output schema, tool allowlist, and boundaries" },
        ],
        violates: [],
      },
    },
    {
      id: "dimension-researcher",
      label: "Dimension researcher",
      layer: "agents",
      tech: "Agent SDK session",
      description: "Researches one dimension's indicators under binding tier/recency/scale config; emits finding or gap payloads",
      keyFiles: ["vendor/open-doughnut/plugin/agents/dimension-researcher.md"],
      keyFunctionality: ["tier-ordered sourcing", "worked scoring math", "gap findings"],
      fileCount: 1,
      linesOfCode: "~90",
      principles: {
        upholds: [
          { id: "source-tiers-exhausted-in-order", reason: "Prompt makes tiers binding and records the satisfying tier per finding" },
          { id: "evidence-archived-at-access", reason: "capture_evidence is required before a source may be cited" },
          { id: "gaps-outrank-guesses", reason: "Gap findings are schema-valid outputs, never errors" },
          { id: "numbers-carry-epistemic-type", reason: "Findings carry unit, year, and target vs measured distinction" },
        ],
        violates: [],
      },
    },
    {
      id: "verifier-agent",
      label: "Verifier",
      layer: "agents",
      tech: "Agent SDK session",
      description: "Independently re-fetches each finding's source and judges whether the page supports the claimed value",
      keyFiles: ["vendor/open-doughnut/plugin/agents/verifier.md"],
      keyFunctionality: ["fresh fetch", "content_supported verdict", "never sees the researcher's reasoning"],
      fileCount: 1,
      linesOfCode: "~40",
      principles: {
        upholds: [
          { id: "verifier-independent-and-grounded", reason: "Separate session, fresh WebFetch, blind to the draft transcript" },
          { id: "atomic-claims-independently-verified", reason: "One verdict per indicator claim" },
        ],
        violates: [],
      },
    },
    {
      id: "capture-evidence-tool",
      label: "capture_evidence",
      layer: "tools",
      tech: "MCP tool / Playwright",
      description: "Snapshots an accepted source page (and PDF) into tenant storage at retrieval time, behind the egress guard (https only, public IPs only, every redirect hop and subrequest re-checked); objects keyed by url + captured_at and never overwritten",
      keyFiles: ["apps/worker/src/evidence.ts", "packages/research/src/egress.ts", "packages/research/src/storage.ts"],
      keyFunctionality: ["full-page screenshot", "PDF archive", "captured_at provenance", "SSRF egress guard", "S3-compatible storage"],
      fileCount: 3,
      linesOfCode: "~300",
      principles: {
        upholds: [
          { id: "evidence-archived-at-access", reason: "The anti-link-rot record displayed beside each public claim" },
          { id: "wrong-way-impossible", reason: "An agent-chosen URL cannot reach internal addresses or overwrite an existing exhibit" },
        ],
        violates: [],
      },
    },
    {
      id: "research-verify-gate",
      label: "research-verify gate",
      layer: "research",
      tech: "CLI (tsx)",
      description: "Staged run-level gate: deterministic checks, verifier-rate thresholds, review completeness, and hash-bound human approval",
      keyFiles: ["scripts/research-verify.ts"],
      keyFunctionality: ["blocks until every dimension is dispositioned", "spot-check sample", "content-hash approvals"],
      fileCount: 1,
      linesOfCode: "~260",
      principles: {
        upholds: [
          { id: "approval-binds-to-content", reason: "Approval records sha256 of the findings set; drift voids it" },
          { id: "review-disposes-each-flag", reason: "Exit 2 lists undispositioned dimensions with the review-queue URL" },
        ],
        violates: [],
      },
    },
    {
      id: "shared-contract",
      label: "Contract",
      layer: "packages",
      tech: "@deep-fryer/contract",
      description: "Framework dimensions, default thresholds with rationales, and the finding/portrait-config JSON Schemas",
      keyFiles: ["packages/contract/framework/framework.json", "packages/contract/schemas/finding.schema.json"],
      keyFunctionality: ["targets with rationales", "research output schema"],
      fileCount: 6,
      linesOfCode: "~900",
      principles: {
        upholds: [
          { id: "single-source-of-truth", reason: "Thresholds and schemas have one home; product and OSS plugin consume the same artifact" },
        ],
        violates: [],
      },
    },
  ],
  connections: [
    { from: "web-app", to: "research-worker", type: "uses", label: "enqueues planned runs (quota-gated)" },
    { from: "web-app", to: "accounts", type: "uses", label: "sessions + roles" },
    { from: "web-app", to: "billing", type: "uses", label: "standing, usage, checkout" },
    { from: "billing", to: "research-worker", type: "uses", label: "apply-time research quota" },
    { from: "web-app", to: "progress-engine", type: "uses", label: "progress pages + open-data exports" },
    { from: "progress-engine", to: "shared-contract", type: "grounds-on", label: "thresholds + target years" },
    { from: "service-worker", to: "web-app", type: "uses", label: "caches anonymous public pages" },
    { from: "web-app", to: "language-access", type: "uses", label: "locale, catalogs, localized links" },
    { from: "research-worker", to: "dimension-researcher", type: "calls", label: "spawns per dimension" },
    { from: "research-worker", to: "verifier-agent", type: "calls", label: "spawns per finding" },
    { from: "dimension-researcher", to: "capture-evidence-tool", type: "tool-call", label: "snapshots accepted sources" },
    { from: "dimension-researcher", to: "shared-contract", type: "grounds-on", label: "finding schema + thresholds" },
    { from: "research-verify-gate", to: "web-app", type: "uses", label: "requires review-queue dispositions" },
  ],
  contexts: [
    { id: "public-plane", label: "Public plane", description: "No AI visible; published versions only", nodeIds: ["web-app", "progress-engine", "service-worker", "language-access"] },
    { id: "accounts-billing", label: "Accounts & billing", description: "Who may act, and what the organization's plan allows", nodeIds: ["accounts", "billing"] },
    { id: "review-plane", label: "Review plane", description: "Human gate between research and publication", nodeIds: ["web-app", "research-verify-gate"] },
    { id: "research-plane", label: "Research plane", description: "Backstage research execution", nodeIds: ["research-worker", "dimension-researcher", "verifier-agent", "capture-evidence-tool"] },
    { id: "shared-contract-ctx", label: "Shared contract", description: "The product/OSS boundary", nodeIds: ["shared-contract"] },
  ],
};

export default data;
