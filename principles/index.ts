import { createPrincipleRegistry } from "@keel_flow/core";
import { generalSEPack } from "@keel_flow/pack-general-se";
import { agentTopologyPack } from "@keel_flow/pack-agent-topology";
import { researchPack } from "@keel_flow/pack-research";

// pack-general-se 0.5.0 adds "small-changes", an info-only size suggestion.
// @keel_flow/core 0.2.0 marks the principles check failed on any violation,
// info included, so every large diff would report "FAIL Principles" while
// exiting 0. Leave it out until @keel_flow/core reports info as a pass.
const generalSE = {
  ...generalSEPack,
  principles: generalSEPack.principles.filter((p) => p.id !== "small-changes"),
};

export const keelPrinciples = createPrincipleRegistry([
  generalSE,
  agentTopologyPack,
  researchPack,
]);
