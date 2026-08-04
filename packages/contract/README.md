# @deep-fryer/contract

The shared contract between the hosted product and the OSS research workflow:
the framework (rings, dimensions, lenses, default indicators), default
thresholds with rationales, and the JSON Schemas for findings and portrait
config.

This package is the **vendored form of `open-doughnut/framework` +
`open-doughnut/plugin/schemas`** (SPEC.md §5). At M2 the contents move to the
`open-doughnut` repo and this package becomes a pinned dependency on it;
until then this directory is the source of truth. Nothing in here may import
from other deep-fryer packages — the contract flows outward only.

Layout:

- `framework/framework.json` — rings, lenses, the 21 default dimensions and
  their default indicators. Seeded into the DB per tenant at provisioning.
- `framework/thresholds.json` — default target per indicator, the named
  mapping function that scores it, and a human rationale. Tenants override
  per §6 (`threshold_overrides`, rationale required).
- `schemas/*.schema.json` — JSON Schemas enforced at the research boundary:
  a session's finding output, and the portrait-config layer.
- `src/index.ts` — typed loaders for the above.
