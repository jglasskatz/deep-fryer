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
      tech: "Next.js 15 / React 19",
      description: "Public doughnut + drilldowns + discussion, and the admin review queue where research findings are dispositioned",
      keyFiles: ["apps/web/app", "apps/web/lib/review-actions.ts"],
      keyFunctionality: ["published portraits", "review cards", "approve/edit/re-research/flag-gap", "§6 config forms"],
      fileCount: 60,
      linesOfCode: "~6k",
      principles: {
        upholds: [
          { id: "review-disposes-each-flag", reason: "Review cards force per-dimension decisions; flagged findings carry the verifier's reasoning inline" },
          { id: "verification-staged-cheap-first", reason: "Reviewers only see findings that already passed deterministic checks and carry verifier verdicts" },
        ],
        violates: [],
      },
    },
    {
      id: "research-worker",
      label: "Research worker",
      layer: "research",
      tech: "graphile-worker / Claude Agent SDK",
      description: "Consumes the Postgres queue; runs region-context, dimension, and verifier sessions with per-plan tool allowlists",
      keyFiles: ["apps/worker/src/tasks/research-apply.ts", "apps/worker/src/session.ts"],
      keyFunctionality: ["plan execution", "session spawning", "transcripts", "token metering"],
      fileCount: 6,
      linesOfCode: "~600",
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
      description: "Snapshots an accepted source page (and PDF) into tenant storage at retrieval time",
      keyFiles: ["apps/worker/src/evidence.ts"],
      keyFunctionality: ["full-page screenshot", "PDF archive", "captured_at provenance"],
      fileCount: 1,
      linesOfCode: "~80",
      principles: {
        upholds: [
          { id: "evidence-archived-at-access", reason: "The anti-link-rot record displayed beside each public claim" },
        ],
        violates: [],
      },
    },
    {
      id: "research-verify-gate",
      label: "research-verify gate",
      layer: "research",
      tech: "Shared library + CLI (tsx)",
      description: "Staged run-level gate as one pure library (computeGateReport + contentHash) consumed by both the CLI and the verify web surface — their numbers cannot disagree",
      keyFiles: ["packages/research/src/gate.ts", "scripts/research-verify.ts"],
      keyFunctionality: ["blocks until every flag is dispositioned", "spot-check sample", "content-hash approvals interchangeable across CLI and web"],
      fileCount: 2,
      linesOfCode: "~500",
      principles: {
        upholds: [
          { id: "approval-binds-to-content", reason: "Approval records sha256 of the findings set; drift voids it — one hash implementation, golden-tested" },
          { id: "review-disposes-each-flag", reason: "Exit 2 lists undispositioned flags with the verify-mode URL" },
        ],
        violates: [],
      },
    },
    {
      id: "verify-mode",
      label: "Verification admin mode",
      layer: "frontend",
      tech: "Next.js 15 / React 19",
      description: "Expert review surface at /admin/verify: gate rollups, cross-dimension triage, claim-beside-evidence drawers, per-finding dispositions with machine-readable annotations, and hash-bound run approval",
      keyFiles: ["apps/web/app/[tenant]/admin/verify", "apps/web/lib/verify-actions.ts", "packages/db/migrations/0003_review_note_policies.sql"],
      keyFunctionality: ["per-finding verify/reject/needs-rework", "structured reason codes + free-form reviewer notes", "annotations seed reruns", "web approval writes the CLI's audit-row shape"],
      fileCount: 10,
      linesOfCode: "~1.5k",
      principles: {
        upholds: [
          { id: "review-disposes-each-flag", reason: "Approve refuses while flagged findings lack individual dispositions; the seeded spot-check sample must be inspected; dispositions are append-only history" },
          { id: "approval-binds-to-content", reason: "The web approval records the same content hash as the CLI; stale approvals surface as a red banner" },
          { id: "verified-discoveries-seed-reruns", reason: "Re-research serializes the run's dispositions and annotations into the next plan's reviewer notes as machine-readable JSON" },
          { id: "verify-against-the-archived-exhibit", reason: "The triage drawer renders each claim beside its archived evidence snapshot, captured-at date alongside" },
        ],
        violates: [],
      },
    },
    {
      id: "source-library",
      label: "Source library",
      layer: "research",
      tech: "Postgres FTS / tsvector",
      description: "Every evidence capture becomes a content-hashed, text-extracted sources row: quote-checked citations, admin full-text search, tiered public bibliography, immutable content-addressed exhibits",
      keyFiles: ["packages/db/src/sources.ts", "apps/worker/src/evidence.ts", "apps/web/lib/source-data.ts"],
      keyFunctionality: ["capture-time text extraction (HTML + PDF)", "content-addressed exhibits never overwritten", "quote_ok deterministic check", "websearch FTS with ranked headlines", "tier-derived public exposure"],
      fileCount: 5,
      linesOfCode: "~800",
      principles: {
        upholds: [
          { id: "evidence-archived-at-access", reason: "Capture stores snapshot, document, and extracted text under a content hash; re-captures of changed pages never overwrite old exhibits" },
          { id: "verify-against-the-archived-exhibit", reason: "evidence.quote is checked mechanically against the text archived at capture time, not the live page" },
        ],
        violates: [],
      },
    },
    {
      id: "progress-view",
      label: "Progress view",
      layer: "frontend",
      tech: "Next.js 15 / SQL as-of resolver",
      description: "The doughnut evolving over time: published_doughnut_asof reconstructs any past era from the immutable version history; deltas distinguish new-vintage progress from same-vintage revisions",
      keyFiles: ["apps/web/app/[tenant]/progress/page.tsx", "packages/core/src/progress.ts", "packages/db/migrations/0005_sources_policies.sql"],
      keyFunctionality: ["as-of portrait reconstruction", "era-by-era doughnuts", "vintage-honest delta table", "indicator sparklines on drilldowns"],
      fileCount: 6,
      linesOfCode: "~600",
      principles: {
        upholds: [
          { id: "numbers-carry-epistemic-type", reason: "Arrows are earned only when the data vintage advanced; a same-vintage change renders as 'revised', never as progress" },
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
    { from: "web-app", to: "research-worker", type: "uses", label: "enqueues planned runs" },
    { from: "research-worker", to: "dimension-researcher", type: "calls", label: "spawns per dimension" },
    { from: "research-worker", to: "verifier-agent", type: "calls", label: "spawns per finding" },
    { from: "dimension-researcher", to: "capture-evidence-tool", type: "tool-call", label: "snapshots accepted sources" },
    { from: "dimension-researcher", to: "shared-contract", type: "grounds-on", label: "finding schema + thresholds" },
    { from: "research-verify-gate", to: "web-app", type: "uses", label: "requires review-queue dispositions" },
    { from: "verify-mode", to: "research-verify-gate", type: "uses", label: "one shared gate report + content hash" },
    { from: "verify-mode", to: "research-worker", type: "uses", label: "annotations seed re-research plans" },
    { from: "capture-evidence-tool", to: "source-library", type: "uses", label: "writes text + content hash per capture" },
    { from: "verify-mode", to: "source-library", type: "uses", label: "quotes checked against archived text" },
    { from: "web-app", to: "source-library", type: "uses", label: "tiered public bibliography + admin search" },
    { from: "progress-view", to: "web-app", type: "uses", label: "reconstructed eras rendered with the shared doughnut" },
  ],
  contexts: [
    { id: "public-plane", label: "Public plane", description: "No AI visible; published versions only", nodeIds: ["web-app", "progress-view"] },
    { id: "review-plane", label: "Review plane", description: "Human gate between research and publication", nodeIds: ["web-app", "verify-mode", "research-verify-gate"] },
    { id: "research-plane", label: "Research plane", description: "Backstage research execution", nodeIds: ["research-worker", "dimension-researcher", "verifier-agent", "capture-evidence-tool", "source-library"] },
    { id: "shared-contract-ctx", label: "Shared contract", description: "The product/OSS boundary", nodeIds: ["shared-contract"] },
  ],
};

export default data;
