---
description: Render the research plan (sessions, prompts, cost envelope) without spending tokens
---

Read `portrait/portrait-config.json` and the framework's dimension list.
Render, without doing any research:

- The session list: one region-context session plus one session per
  dimension (or per dimension the user names in $ARGUMENTS).
- Each session's full prompt, assembled from the plugin's agent templates
  with the portrait config substituted in.
- Write the plan to `portrait/plan.md` for inspection.

Show the user the session count and tell them to run `/doughnut research`
to execute, or edit `portrait-config.json` and re-plan.
