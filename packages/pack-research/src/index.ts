import type { PrinciplePack, PrincipleWithCheck } from "@keel_flow/schema";

// Research-workflow principles are being synthesized from the methodology
// research pass; the pack ships empty until then so the workspace stays
// green. Shape follows keel pack conventions exactly.
export const researchPrinciples: PrincipleWithCheck[] = [];

export const researchPack: PrinciplePack = {
  id: "@keel_flow/pack-research",
  version: "0.1.0",
  description:
    "Research-workflow principles: sourcing discipline, verification independence, gap honesty, and the human review gate.",
  principles: researchPrinciples,
};
