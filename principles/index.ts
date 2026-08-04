import { createPrincipleRegistry } from "@keel_flow/core";
import { generalSEPack } from "@keel_flow/pack-general-se";
import { agentTopologyPack } from "@keel_flow/pack-agent-topology";
import { researchPack } from "@keel_flow/pack-research";

export const keelPrinciples = createPrincipleRegistry([
  generalSEPack,
  agentTopologyPack,
  researchPack,
]);
