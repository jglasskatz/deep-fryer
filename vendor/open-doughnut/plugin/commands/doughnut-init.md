---
description: Scaffold a portrait config for a new city (framework defaults + portrait-config.json to edit)
---

Create a `portrait/` directory in the current repo containing:

1. `portrait-config.json` — filled from the user's answers (region name and
   precise definition), with the default source-priority tiers, recency
   (5 years), and scale policy from the framework package. Validate against
   `schemas/portrait-config.schema.json`.
2. `findings/` — empty, one JSON file per dimension will land here.
3. `evidence/` — empty, snapshots land here.

Ask the user for: region name, precise boundary definition, and any local
context notes (institutions, data portals). Do not research anything yet.
