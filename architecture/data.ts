import type { ArchitectureMap } from "@keel_flow/schema";
import { SCHEMA_VERSION } from "@keel_flow/schema";

// deep-fryer's keel architecture map. The bounded contexts are SPEC §3's
// three planes plus the shared contract; the research plane's agents and
// tools are first-class nodes so pack-research principles attach where the
// work happens. keel verify pattern-matches the 6-space `id:` lines — keep
// the formatting.
const data: ArchitectureMap = {
  schemaVersion: SCHEMA_VERSION,
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
    { from: "web-app", to: "research-worker", type: "uses", label: "enqueues planned runs" },
    { from: "research-worker", to: "dimension-researcher", type: "calls", label: "spawns per dimension" },
    { from: "research-worker", to: "verifier-agent", type: "calls", label: "spawns per finding" },
    { from: "dimension-researcher", to: "capture-evidence-tool", type: "tool-call", label: "snapshots accepted sources" },
    { from: "dimension-researcher", to: "shared-contract", type: "grounds-on", label: "finding schema + thresholds" },
    { from: "research-verify-gate", to: "web-app", type: "uses", label: "requires review-queue dispositions" },
  ],
  contexts: [
    { id: "public-plane", label: "Public plane", description: "No AI visible; published versions only", nodeIds: ["web-app"] },
    { id: "review-plane", label: "Review plane", description: "Human gate between research and publication", nodeIds: ["web-app", "research-verify-gate"] },
    { id: "research-plane", label: "Research plane", description: "Backstage research execution", nodeIds: ["research-worker", "dimension-researcher", "verifier-agent", "capture-evidence-tool"] },
    { id: "shared-contract-ctx", label: "Shared contract", description: "The product/OSS boundary", nodeIds: ["shared-contract"] },
  ],
};

export default data;
