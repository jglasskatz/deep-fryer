---
description: Execute the research plan — one dimension per subagent, findings + evidence + verification
---

Requires `portrait/plan.md` from `/doughnut plan`.

1. Run the region-context session first (agents/region-context.md); save the
   brief to `portrait/region-brief.md`.
2. For each planned dimension (or those named in $ARGUMENTS), run a
   dimension-researcher subagent with the brief injected. Save findings to
   `portrait/findings/<dimension>.json`, validated against
   `schemas/finding.schema.json`. Capture evidence screenshots into
   `portrait/evidence/` (use a browser tool when available; otherwise record
   the URL and mark evidence as missing in notes).
3. For every finding, run the verifier subagent (agents/verifier.md) and
   attach its verdict under a `verification` key alongside the finding.
4. Report: findings by verdict, data gaps, and anything needing human review.

Honesty rules from the skills apply: tiers are binding, gaps are findings,
never publish an unverified number as verified.
