import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrinciplePack, PrincipleWithCheck, Violation } from "@keel_flow/schema";

/**
 * Research-workflow principles, synthesized from published evidence on
 * AI-agent research systems and human verification disciplines (fact-checking,
 * systematic review, audit sampling). Sources and the full rationale live in
 * this package's README. The prose principles are ambient discipline —
 * injected into agent prompts via keel's principle digest; the checks run at
 * `keel verify`. Run-level enforcement (against a research run's actual
 * findings) belongs to the consuming system's research-verify gate.
 */

const FINDINGS_PATH = /(^|\/)(findings|research-outputs?)\//;
const APPROVAL_PATH = /(^|\/)approvals?\//;

export const researchPrinciples: PrincipleWithCheck[] = [
  // ---- Orchestration ----
  {
    id: "research-budget-declared",
    description:
      "A research plan declares its complexity tier and agent/tool-call budget before any search runs, and the run stays within it",
    rationale:
      "Unbudgeted orchestrators spawn excessive subagents for simple queries; token spend explains most performance variance, so spend must be matched to query value up front (Anthropic multi-agent research system)",
    severity: "warning",
  },
  {
    id: "delegation-carries-contract",
    description:
      "Every subagent delegation states objective, output format, tool guidance, and task boundaries",
    rationale:
      "Vague delegations produce duplicated work and coverage gaps; the four-field contract is the documented fix (Anthropic multi-agent lessons)",
    severity: "warning",
  },
  {
    id: "single-synthesizer",
    description:
      "Parallel agents only gather; exactly one agent composes conclusions and the report",
    rationale:
      "Parallel fan-out wins on breadth reads, but split decision-making produces conflicting conclusions — extra agents contribute intelligence, not actions (Anthropic; Cognition's 'Don't Build Multi-Agents')",
    severity: "critical",
  },

  // ---- Sourcing ----
  {
    id: "source-tiers-exhausted-in-order",
    description:
      "Source-priority tiers are binding: exhaust tier N before accepting tier N+1, and record the tier that satisfied each finding",
    rationale:
      "A finding's trust ceiling is its source's; without ordered tiers, agents settle for the first plausible page (evidence-hierarchy practice; ICD 203 source descriptors)",
    severity: "critical",
  },
  {
    id: "lateral-reading-gate",
    description:
      "Before a new publisher is trusted, run at least one search about the source itself and log its assessed identity",
    rationale:
      "Fact-checkers who read laterally beat PhD historians 2:1 at judging source trustworthiness; a page's self-presentation is not evidence about the page (Wineburg & McGrew; SIFT)",
    severity: "warning",
  },
  {
    id: "primary-source-for-statistics",
    description:
      "A statistic cites the original data publisher — the table, release, or paper — not a press release or aggregator, or is explicitly labeled secondary",
    rationale:
      "Press releases summarize with spin and drop definitions; tracing to the original is the 'T' in SIFT and standard fact-checking methodology (Full Fact)",
    severity: "critical",
  },
  {
    id: "provenance-independent-triangulation",
    description:
      "Contested claims need two sources whose citation chains do not resolve to the same upstream document",
    rationale:
      "Two sources that copy one flawed original are one source; circular reporting (citogenesis) defeats naive source-counting",
    severity: "warning",
  },
  {
    id: "search-trail-reproducible",
    description:
      "Research ships with its search trail: queries run, sources considered, and per-source include/exclude reasons, dated",
    rationale:
      "A search that cannot be re-run cannot be audited; PRISMA-S exists so someone else can reproduce the search, which is equally what makes agent research reviewable",
    severity: "warning",
  },

  // ---- Claims ----
  {
    id: "atomic-claims-independently-verified",
    description:
      "Output decomposes into atomic factual claims, each independently checkable against a fetched source",
    rationale:
      "Claim-level verification (FActScore/SAFE) is automatable and agrees with human annotators at a fraction of the cost; report-level vibes are not verification",
    severity: "critical",
  },
  {
    id: "citations-are-load-bearing",
    description:
      "A citation attaches only to the specific claim its page supports; per-claim search depth is bounded",
    rationale:
      "Citation volume correlates inversely with accuracy, and deeper retrieval measurably degrades it via noise — decorative citing hides unsupported claims ('Cited but Not Verified')",
    severity: "warning",
  },
  {
    id: "numbers-carry-epistemic-type",
    description:
      "Every quantitative claim carries unit, as-of date, and epistemic type: measured, estimate, projection, or goal — a projection presented as a measurement is a defect",
    rationale:
      "The commonest honest-looking error is quoting a target or forecast as an actual; forcing the type label makes the distinction machine-checkable",
    severity: "critical",
  },
  {
    id: "evidence-archived-at-access",
    description:
      "Every accepted source is snapshotted at retrieval time; citations store the archive alongside the live URL and access date",
    rationale:
      "Half of cited URLs eventually rot or drift; unarchived web research becomes unverifiable research (Perma/link-rot studies)",
    severity: "critical",
  },

  // ---- Delegation context (field-verified, deep-fryer NYC campaign 2026-08;
  // measurements in that repo's docs/strategy-findings.md) ----
  {
    id: "contract-travels-in-context",
    description:
      "A schema, spec, or output contract the delegate must conform to is included verbatim in the delegated context — never merely named",
    rationale:
      "A named artifact the agent cannot read is not a contract: sessions told to conform to finding.schema.json by name failed the schema gate on 100% of findings despite substantively sound research; inlining the schema took conformance to 100% (deep-fryer NYC campaign)",
    severity: "critical",
  },
  {
    id: "verifier-receives-claim-frame",
    description:
      "An independent verifier receives the claim's full frame — geography, period, unit, scale — not just the value and its source",
    rationale:
      "A borough claim was rejected as 'contradicted' by the same document's citywide figure because the verifier was never told which geography the claim covered; frame-blind verification is a systematic false-negative generator at multi-region scale (deep-fryer verifier-geography incident)",
    severity: "critical",
  },
  {
    id: "verified-discoveries-seed-reruns",
    description:
      "Reruns and follow-up sessions inject previously verified sources, corrections, and basis decisions as notes; from-scratch rediscovery is a defect, not diligence",
    rationale:
      "Fix-up sessions given audit corrections as reviewer notes resolved all four rejected findings in one pass and converged with independently verified values; the same sessions without notes had produced the errors (deep-fryer NYC fix-up runs)",
    severity: "warning",
  },
  {
    id: "verify-against-the-archived-exhibit",
    description:
      "When a source was snapshotted at retrieval, verification judges the claim against the archived exhibit first, refetching only to corroborate",
    rationale:
      "Refetch-only verification returned 'uncertain' on bot-blocked primary sources the researcher had already captured — suppressing measured accuracy on exactly the most authoritative tier — while auditors reading the captured exhibits adjudicated the same claims decisively (deep-fryer 403/tier-1 paradox)",
    severity: "warning",
  },

  // ---- Verification ----
  {
    id: "verifier-independent-and-grounded",
    description:
      "Verification is a separate pass by an agent that did not produce the work, makes fresh tool calls, and judges claims without seeing the draft's reasoning",
    rationale:
      "Same-model self-verification couples errors (57x odds in medical VQA); draft-only self-review degrades accuracy; factored, tool-grounded verification measurably reduces hallucination (Chain-of-Verification, CRITIC)",
    severity: "critical",
  },
  {
    id: "verification-staged-cheap-first",
    description:
      "Checks run deterministic → heuristic → model → human; expensive layers never run on work a cheaper layer already failed",
    rationale:
      "Fail-fast ordering keeps human attention for judgment calls instead of mechanically detectable failures",
    severity: "warning",
  },

  // ---- Honesty & the review gate ----
  {
    id: "gaps-outrank-guesses",
    description:
      "'No acceptable data exists' is a first-class, publishable result that scores above a plausible value from a non-compliant source",
    rationale:
      "Grading that rewards confident guessing over abstention is why models hallucinate; a gate must invert that reward (Kalai et al.; ICD 203 uncertainty standards)",
    severity: "critical",
  },
  {
    id: "review-disposes-each-flag",
    description:
      "Human review disposes of every flagged item individually, plus a random sample of auto-passed items; there is no bulk approve while flags are open",
    rationale:
      "Reviewing only what the machine flagged leaves the machine's miss rate unmeasured (ISA 530 sampling); bulk approval over open flags is rubber-stamping by construction",
    severity: "critical",
  },
  {
    id: "approval-binds-to-content",
    description:
      "Approval records a content hash of exactly what was reviewed; any change to the findings voids the approval",
    rationale:
      "An approval that survives content changes attests to nothing (stale-approval dismissal; 21 CFR Part 11 signature binding)",
    severity: "critical",
    check({ diff, cwd }): Violation[] {
      const violations: Violation[] = [];
      const findingsTouched = diff.files.filter(
        (f) => f.status !== "removed" && FINDINGS_PATH.test(f.path) && f.path.endsWith(".json"),
      );
      if (findingsTouched.length === 0) return violations;
      if (diff.files.some((f) => APPROVAL_PATH.test(f.path))) return violations;

      const root = cwd ?? process.cwd();
      for (const file of findingsTouched) {
        try {
          readFileSync(join(root, file.path), "utf8");
        } catch {
          continue;
        }
        violations.push({
          principleId: "approval-binds-to-content",
          file: file.path,
          severity: "warning",
          message:
            "Findings changed with no approval record updated — any prior approval is stale; re-run the research-verify gate and re-approve",
        });
      }
      return violations;
    },
  },
];

export const researchPack: PrinciplePack = {
  id: "@keel_flow/pack-research",
  version: "0.1.0",
  description:
    "Research-workflow principles: sourcing discipline, verification independence, gap honesty, and the human review gate.",
  principles: researchPrinciples,
};
