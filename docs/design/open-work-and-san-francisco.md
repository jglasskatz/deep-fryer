---
title: Land the open work and add San Francisco
repo: /Users/joe/Dev/deep-fryer
status: approved
owner: Joe
created: 2026-11-19
ticket_prefix: ship
nodes: [pages-snapshot]
---

# Land the open work and add San Francisco

## Why

On 2026-11-19 the repository had finished work that had not reached `main`:
two review branches with no pull request, one draft pull request and ten
dependency updates. A collaborator had also built a San Francisco portrait in
a fork of the Santa Cruz prototype, and it was not in the public collection.

Joe decided, in conversation on 2026-11-19:

1. Review everything that is open and merge all of it that can be merged.
2. Publish the fork's **City of San Francisco** portrait. Do not publish its
   **SoMa** portrait: all 22 of its rows are the Watsonville portrait's rows
   with a new name, population and description.
3. Show San Francisco **exactly as the fork scores it**. Three ecological
   dimensions repeat one placeholder record and draw as "within target", and
   the freshwater score contradicts its own value and target. They stay as the
   author wrote them. A notice on the page says the data is unchecked.

Merging to `main` deploys the public collection. Each card below ends at a
merge, so each one ships.

## Rules for every card

- A pull request merges only when both required checks pass on a branch that
  is up to date with `main`. Nothing is force-pushed and no check is bypassed.
- A file from someone else's repository is parsed as data. It is never run.
- A portrait that has not been researched and approved here says so on its
  page, and its record keeps `approved: false`.

## Audit fixes reach main
<!-- keel:status=building -->
<!-- keel:ticket={"id":"ship-audit-fixes","scopes":["packages/research/src/egress.ts","apps/web/lib/invitations.ts","apps/web/app/o/**","packages/core/src/format.ts","site/**","scripts/**"]} -->

Pull request #20 carries the review branch `fix/audit-regressions-20261115`
unchanged. It blocks IPv4-mapped private addresses in every spelling, locks
and rechecks an invitation before granting membership, corrects the direction
and comparability of the compare page, keeps the precision of source numbers,
counts explicit missing-data text as a gap, and shows the reviewed housing and
equity context for the three Santa Cruz portraits.

**Acceptance check: A01.** An independent review of the diff finds no
correctness or security defect that would make the change worse than `main`.

**Acceptance check: A02.** Pull request #20 is merged with both required
checks passing, and the `main` run that follows deploys.

## California reaches the public collection
<!-- keel:status=building -->
<!-- keel:ticket={"id":"ship-california","scopes":["scripts/california-import.mjs","scripts/california-import.test.mjs","scripts/check-california-ui.mjs","scripts/check-pages-ui.mjs","site/imports/california/**","site/**","docs/pages.md"]} -->

Depends on: `ship-audit-fixes`.

Pull request #21 carries `codex/import-california-2026-11-14` with three
repairs made when it met the audit fixes: both branches' presentation tests
are kept, the baseline pin names the audited baseline, and the shared browser
check expects the renamed legend entry.

**Acceptance check: A03.** `/california/` is live in the public collection
with 21 dimensions and 42 indicators.

**Acceptance check: A04.** The eleven portraits that existed before the import
are byte-for-byte what `ship-audit-fixes` left; the import changes none of
them.

## San Francisco reaches the public collection
<!-- keel:status=building -->
<!-- keel:ticket={"id":"ship-san-francisco","scopes":["scripts/san-francisco-import.mjs","scripts/san-francisco-import.test.mjs","scripts/check-san-francisco-ui.mjs","scripts/legacy-data-literal.mjs","scripts/import-checks.mjs","scripts/portrait-imports.mjs","site/imports/san-francisco/**","site/catalog.json","scripts/build-pages.mjs","scripts/research-overlays.mjs","docs/pages.md","README.md","architecture/data.ts"]} -->

Depends on: `ship-california`.

The portrait is assembled at build time from
`BioKyle/doughnut-san-francisco-v1` at commit
`5cce9f1cc476052b88c316d847926e0ad34b4b00`, whose `docs/data.js` is kept
byte-for-byte in `site/imports/san-francisco/`. The file is read with a
parser that accepts only a single object literal. `manifest.json` beside it
records which jurisdictions are imported, which are not and why, and the
known problems in the data.

**Acceptance check: A05.** `/san-francisco/` is live with all 21 dimensions.
Every value, target, year, source, source link, action and score equals the
fork's record. No score is withheld, changed or flagged.

**Acceptance check: A06.** The page's notice is open by default. It says the
data comes from a community fork, has not been researched, source-checked or
approved here, and that the fork's SoMa portrait is not included. It links to
the original file, the import record and the pinned commit.

**Acceptance check: A07.** No SoMa portrait exists anywhere in the collection.
A test shows the reason still holds: the fork's SoMa rows match 22 of 22 rows
of the Watsonville portrait.

**Acceptance check: A08.** A test proves the reader refuses a data file that
contains anything other than literal values (a function call, a template
expression, a getter, a spread, a second statement).

**Acceptance check: A09.** The build fails if the pinned file's hash, the
pinned commit or the list of jurisdictions changes, and if the published
record is edited or marked approved.

**Acceptance check: A10.** The import record lists the four known problems
(three dimensions that repeat one placeholder record; a freshwater score that
contradicts its value and target) so they can be sent to the fork's author.
They are recorded, not displayed.

## Dependency updates reach main
<!-- keel:status=planned -->
<!-- keel:ticket={"id":"ship-dependency-updates","scopes":["package.json","pnpm-lock.yaml","apps/**/package.json","packages/**/package.json",".github/workflows/ci.yml"]} -->

Ten Dependabot pull requests are open (#4 to #13): five pinned GitHub
Actions and five npm updates, including `drizzle-orm` 0.36 to 0.45 and
`@keel_flow/pack-general-se` 0.2 to 0.4. Two were failing when last run.

**Acceptance check: A11.** Each update is either on `main` with both required
checks passing, or is listed with the failure it causes and left open. No
update is merged by weakening a test or a check.

## Policy evaluator reaches main
<!-- keel:status=planned -->
<!-- keel:ticket={"id":"ship-policy-evaluator","scopes":["site/policy-view/**","packages/core/src/policy*.ts","apps/worker/src/policy-evidence.ts","apps/worker/src/tasks/policy-analyze.ts","apps/web/components/policy/**","apps/web/lib/policy-actions.ts","research/policy-*/**","scripts/*policy*","scripts/build-pages.mjs","docs/pages.md"]} -->

Draft pull request #18 adds a source-gated policy evaluator and an evidence
atlas. Its current head was pushed with `[skip ci]`; its own description says
component tests, the production build and browser checks have not run for
that head, and that every curated record is AI-reviewed with
`human_approved: false`.

**Acceptance check: A12.** The branch is up to date with `main` and both
required checks pass on its actual head, including its browser check.

**Acceptance check: A13.** Every curated policy record still reads
`human_approved: false` and the page still says so. Merging the code approves
no finding.

**Acceptance check: A14.** Pull request #18 is merged, or is left open with
the specific failing check and what it would take to pass.
