# Repository integration validation — 2026-10-26

## Scope and result
Private additive patch against `jglasskatz/deep-fryer` main commit
`d189a966649ffb4c876879a9bcd27f88b51f7809`. No push, public deployment,
database approval or paid AI call. This report covers the retrospective atlas,
not subsequent evaluator-extension work.

The existing Pages builder copies `site/policy-view/` to `/policies/`. Navigation,
architecture registration, release docs, research records and independent review
are included. The dedicated structural tests are wired into `pnpm pages:test`.
Native units, jurisdictions and causal caveats remain separate from portrait
scores and the staff analyzer's prospective `projected_value` contract.

## Passed
- Pinned pnpm 9.12.0 frozen-lockfile install: 609 packages, lifecycle scripts
  disabled. Lockfile unchanged. Runtime Node 24.22.1; repository `.nvmrc` 24.3.0.
- `pnpm exec keel map --check`: exit 0; architecture schema valid.
- Keel verify architecture and principles checks: passed, no violations.
- `pnpm typecheck`: exit 0, all workspaces. Keel's typecheck and lint stages also
  passed. Keel spec result has no violations because no paid/spec checker was
  requested; this is NOT an LLM or human spec approval.
- `pnpm pages:test`: 18/18 tests passed after adding the study test to CI script.
- `pnpm pages:build`: exit 0; 11 portraits, 240 integrity-checked evidence files,
  plus the new standalone policy route.
- `node --test scripts/policy-study.test.mjs`: 4/4 passed; ten unique policies,
  real local slice identities, required claim framing, safe source URL protocols,
  browser payload equals JSON, local links exist, script syntax, reduced-motion
  styles and visible draft/incomplete-archive disclosures.
- Original dependency-free combined regression check: 13/13 passed.
- DOM-stub interaction test: city/dimension/evidence filtering, empty state and
  reset passed. This is logic-only, not browser layout/accessibility validation.
- Builder syntax, whitespace checks and patch application against pinned file
  contexts passed.
- Portrait SHA-256 unchanged:
  `d73bd707ac4047b4c6b2a503bf7669b8c44b7aa64deaf5ece6582b64d76d1603`.

## Failed / blocked — not an all-green release
- `pnpm exec keel verify --diff HEAD --json ...`: final exit **2**. HEAD names
  the pinned baseline; staged/local additions are included without creating a
  commit. Architecture/principles pass; tests-lint is blocked by `pnpm run test`.
  The remaining failure is the worker `sessionConcurrency` test in
  `src/tasks/research-apply.metering.test.ts`, exceeding its existing 5,000ms limit.
- A **clean detached worktree at the same baseline** reproduced that exact test
  timeout and an `alerts-sync` timeout under the same runtime and dependencies.
  Its tracked source was unchanged; dependency directories were linked to the
  installed pinned packages. Thus the remaining blocker reproduces without the
  policy patch. No timeout was increased, no assertion weakened and no unrelated
  worker source was edited to conceal it.
- Initial simultaneous independent test/Keel runs showed additional db/client
  and worker timeouts. Both finished before the sequential Keel retry. The final
  sequential result above, plus clean-baseline reproduction, is authoritative.
- `CI=true CHROMIUM_PATH=/usr/bin/chromium pnpm pages:check`: exit 1 before UI
  assertions. Chromium aborts with `socket() failed: Operation not permitted` and
  a crashpad path error. No browser layout, responsive, keyboard or accessibility
  pass is claimed. `check-pages-ui.mjs` was not reached because the first chained
  browser script failed. No sandbox bypass attempted.
- Database-dependent tests were skipped by existing test configuration; there
  was no test database or database-backed publication-gate run.

## Approval interruption resolved
The original install/poll session encountered an automatic approval-review error.
After the user explicitly approved resuming pinned setup and local Keel checks,
the old session was unavailable and no live installer or Keel binary was found.
The exact pinned install was retried and completed. No alternate install path was
used while approval was pending. The earlier “not run” bundle is superseded by
this report. Telemetry was disabled and spec-summary/API-key variables were unset
for Keel execution; no paid model calls or publication actions were invoked.

Source archives remain incomplete and the UI says so. Bounded independent source
checks, structural tests and Keel results are not hash-bound human publication
approval or causal replication. A permitted browser environment and resolution
of the baseline timeout are still needed before claiming a fully green release.
