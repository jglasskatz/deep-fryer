---
description: Show portrait completeness — findings, verification verdicts, gaps, staleness
---

Read `portrait/findings/*.json` and report a table: dimension → indicators
found / gaps / verification verdicts / newest data year, plus which
dimensions have no findings yet. Flag findings older than the recency policy
in `portrait/portrait-config.json` as stale. Suggest the next `/doughnut
research <dimension>` invocations for anything missing or stale.
