# Roadmap audit · 23 October 2026

Scope: compare `SPEC.md`, `docs/SPEC-v3.md` through `SPEC-v7.md`, and
`docs/SPEC-mobile.md` with the application at `892295e` and the changes in
this working tree. Source files and tests take precedence over an old spec's
status line. A configured setting is not evidence that its behavior exists.

The original `/Users/joe/Dev/deep-fryer` checkout was inspected read-only. Its
uncommitted work and `docs/SPEC-JEV.md` remain separate. The initial code
audit did not alter research data. A separately reviewed, hash-bound research
overlay was subsequently integrated by the parent agent; its machine review
is not human approval or database publication. No production accounts were
changed for this audit.

## Approved work found missing and addressed here

| Priority | Requirement | Initial evidence | Implementation in this branch |
|---|---|---|---|
| P0 | v3 W3.1: verify against captured exhibits before refetching | `packages/research/src/plan.ts` granted only WebFetch; `apps/worker/src/tasks/research-apply.ts` sent no archived bytes; plugin verifier instructed a live fetch | Tenant-scoped bounded archive reads; fixed read-only files in each independent verifier workspace; Read hook denies every other file; archive-first plugin prompt. Missing, empty, invalid, and >32 MiB exhibits are disclosed, with available exhibits retained. |
| P0 | Deterministic year validation | `packages/research/src/verify.ts` accepted negative data age, so future years passed | Future observations fail recency; current year and the exact policy boundary remain accepted. No model is asked to do date arithmetic. |
| P1 | v3 W3.2: inspectable per-run standard/deep models | Only `ANTHROPIC_MODEL`, `RESEARCH_SUBAGENT_MODEL`, and `VERIFIER_MODEL` controlled execution | New plans freeze researcher/scout/verifier IDs. Standard uses Sonnet, deep uses Opus with Sonnet scouts, both retain an independent Opus verifier. Historic plans keep env defaults. Staff form/API accept the preset. |
| P1 | v3 W3.4: sum absolute counts across boroughs | `packages/research/src/measure.ts` explicitly excluded traffic deaths and affordable-home counts as non-additive | Both use sum mode, require complete comparable numeric parts, and retain exact tolerance. Regression: 39 + 63 + 57 + 33 + 13 = 205. Zero city totals cannot hide nonzero borough totals. |
| P1 | v3 W3.6: dense-dimension splitting | `renderPlan()` always emitted one session per dimension | At most three listed indicators per session, no omissions or duplicated assignments. Quota/apply uses actual `plan.sessions.length`; standard framework still plans 22 sessions. Worker failures and progress now retain multiple session rows for one dimension. |
| P1 | v6 §2.1 / v7 core interaction in the static public preview | Selecting a panel hid the only dimension controls inside `#panel-empty`; links lacked status/value summaries | Persistent grouped >=44 px controls, spoken/text status and legend, shared formatter, selection state, history restoration, focus return. Reviewed independently at desktop and 390 px mobile. |

The coordinated implementation also completes the standing product gaps
below. “Implemented” describes this branch and the stated local checks;
it does not mean deployed, paid-run tested, or human-approved research.

## Existing behavior verified in code

| Area | Implementation evidence | Assessment |
|---|---|---|
| Core portrait, detail panel, sources/evidence, curated actions | `apps/web/components/portrait/PortraitCoreView.tsx`, `PortraitPanel.tsx`, `lib/portrait-panel.ts`, portrait/dimension route tests | Already implemented; no need for a second core viewer. |
| Immutable versions, manual edit provenance, publish/revert | `apps/web/lib/actions.ts`, `publish.ts`, `review-actions.ts`, `packages/db/src/queries.ts` and migrations | Human editing requires change notes and supporting sources; publication is human initiated. Optional dual-review policy is now enforced in actions and database triggers. |
| Research plan/apply, region context, findings, retries and per-model usage | `packages/research/src/plan.ts`, worker `session.ts`, `tasks/research-apply.ts` | Already present. This branch improves evidence, model pinning, dense contexts, and accounting. |
| Scale-aware negative controls | `packages/research/src/measure.ts:controlExempt`, `measure.test.ts` | v3 W3.3 already implemented: verified, accepted wider-scale findings are not counted as fabricated municipality claims. |
| Self-hosted auth/storage, app-role context and RLS | `apps/web/lib/auth.ts`, `packages/db/src/auth-context.ts`, migrations `0003`, `0015`, `packages/research/src/storage.ts` | The v2 Supabase architecture is superseded. Existing RLS tests must run against a migrated isolated database; source presence alone is not deployment verification. |
| Organizations, memberships, invitations, paid entitlement and billing | `packages/core/src/plans.ts`, `packages/db/src/billing.ts`, web billing/actions tests | Already implemented. Later owner direction and code prohibit free research and retire trials; do not reintroduce the v4/v7 trial wording. |
| Any-city setup, encrypted organization key, full build action | `/start`, `lib/org-actions.ts`, `lib/api-key-actions.ts`, `lib/research-actions.ts`, worker `org-key.ts` | Already built in committed code. Original-checkout onboarding/metering work is additional unmerged work, not proof that setup is wholly absent. |
| Progress, public JSON/CSV, methodology, embed | portrait progress/methodology and `/api/v1/portraits/[tenant]` routes; embed policy tests | Already implemented. Mobile's proposed revisions/bundles are additional capabilities. |
| PWA and offline emergency safeguards | `apps/web/public/sw.js`, PWA/i18n tests, emergency helpers | Already implemented. Native app offline synchronization is a different draft workstream. |
| Policy analysis, emergency alerts, theme | worker policy/alert tasks, core policy/emergency, admin/public routes and tests | v5 foundations exist; proposed planning/candidate workflows do not become approved features merely because these foundations exist. |
| Moderation, held-comment visibility, staff labels, involvement submissions | discussion/involvement modules, actions, RLS tests, admin routes | v6 flows already exist; no blanket rewrite warranted. |
| Feature defaults, kill switches, page/action/worker enforcement, translation requests | `packages/core/src/features.ts`, web feature guards/tests, worker alert tests, translation routing/tests | v7 functionality already implemented and covered. Defaults are off for non-core new-portrait features. |

## Standing product gaps completed in this branch

| Requirement | Implementation evidence | Result and boundary |
|---|---|---|
| v3 W3.5 / W4.1 tier audit and stored adjudication | `apps/worker/src/research-audit.ts`, `packages/core/src/finding-audits.ts`, migration `0018_finding_audits.sql`, web `machine-audit-{actions,data}.ts`, `ReviewAudits.tsx` | Independent archive-first review of flagged findings plus deterministic bounded tier-1 sample; versioned suggestions, reasons, usage, explicit human correct/re-research/reject actions. Idempotent reviews never auto-publish. Tier-1 audit checks the actual primary authority/construct rather than searching for an impossible tier 0. |
| v3 W4.3 Insights linked exploration and URL baselines | `components/insights/LinkedInsights.tsx`, `lib/insights-{modes,contributions}.ts` and tests | Linked matrix/bar/card states and absolute/city/target/rank URL modes. Normalized dimension scores are labeled separately from additive indicator totals; totals require complete matching unit/year/threshold/local scope. |
| v3 W4.2 route boundaries | Portrait/admin/compare/insights `loading.tsx` and `error.tsx`, shared route-state components | Loading, retry and recovery views are present. |
| v2 §6 / §9 dual review on edits | `lib/publish.ts`, custom/outreach publication actions, migration `0020_dual_review.sql` | Configured policy requires a distinct authenticated human publisher for a new human-authored dimension/custom-page/contact version. Database guards cover status/date and public pointer changes, and prevent forged app-role authorship. Reverting an already published version remains reversible. |
| v2 §8 configurable transcript retention | `packages/db/src/transcript-retention.ts`, tests, worker `tasks/privacy-sweep.ts` | Per-tenant cutoff removes only settled-session/policy-analysis transcript bytes. Findings, evidence, versions, usage and metadata remain. Active parent runs are retained; invalid policy falls back safely. Tested only against the isolated clone. |
| v2 §9 / v3 W1.4 research-drafted context/actions | Core/JSON finding contracts, researcher/verifier templates, worker `loadFindingExhibits`, `lib/draft-portrait.ts`, ReviewCard | Optional sourced draft within the existing research session, separately checked by the independent verifier. Explicit unchecked inclusion control; absent/uncertain narrative verification cannot be treated as verified. Bulk/machine approval preserves existing narrative. No extra hidden research session. |
| v2 §10 custom public pages | `custom-page-actions.ts`, `custom-pages.ts`, `/[tenant]/admin/pages`, `/[tenant]/pages/[slug]`, `MarkdownContent.tsx`, migration `0019` | Immutable drafts, exact-version publish/revert/unpublish, tenant/RLS guards and public-only readers. Safe Markdown escapes raw HTML/JSX. `custom_pages` defaults off and is checked on page/action/read paths. |
| v2 owner dimension add/archive/reorder and indicator edits | `dimension-admin-actions.ts`, `portrait-management.ts`, `/admin/manage`, `DimensionEditor.tsx`, migration `0021` | Owner-only structural actions, exact active-set order validation and audited reversible archive. Framework defaults seed null placeholders; custom dimensions can name their own measures. Editor supports indicator add/remove in immutable versions. Archived dimensions stay out of future plans/public reads. |
| v2 outreach contacts CRUD | `outreach-admin-actions.ts`, `/admin/outreach`, `OutreachContactsEditor.tsx`, migration `0021`, `data.ts:publishedOutreachContacts` | Staff maintain immutable drafts; exact-version publish/revert and archive/restore preserve history. Public projection contains only organization, website, description and tags. Person/email/phone/address/data needs/message remain staff-only. This does not replace v6 involvement listings. |
| Complete run costs and self-service reconciliation | `packages/core/src/run-costs.ts`, research run cost endpoint, `RunCostSummary.tsx`, `NewRunForm.tsx` | Researcher/verifier/audit/cache usage and in-flight/final summaries use actual sessions. Existing onboarding remains intact; implementation was reconciled without overwriting the original checkout. |
| Mobile-compatible public API preparation | `lib/public-api-metadata.ts`, `public-json.ts`, public API route/tests | Stable ETag/conditional responses and additive resolved flag metadata. This does not claim native-mobile implementation. |

The standing implementation gaps identified in this audit have corresponding
code in this branch. Upstream publication, evidence approval/deployment and
unaccepted draft scope remain below; none is silently marked complete.

## Drafts, proposals and external work

| Item | Evidence/status | Treatment |
|---|---|---|
| Native iOS/Android viewer | `SPEC-mobile.md` explicitly says “Draft for the owner” and lists sixteen product/operations choices; no `apps/mobile` exists | Native viewer, discovery, follows, revision counter, atomic bundles, image derivatives, push registry/outbox and store release remain unbuilt. ETag/flags preparation does not imply the app is built. Posting is optional v3, push v2. |
| Mobile document drift | Draft claims no privacy page and all unarchived trials public | Both are stale: `/privacy` exists, and migration `0015_portraits_private_until_published.sql` makes unpublished portraits private. Verify requirements individually. |
| SPEC-JEV triage | Original checkout's untracked `docs/SPEC-JEV.md` says draft, amends nothing, and preserves independent verification | Pilot scripts exist, but production triage, sidecars, table, fixtures and calibrated shadow mode do not. Do not silently send customer evidence to another provider or treat pilot agreement as human labels. Owner questions and staged validity gates remain. |
| Original unmerged work | Read-only git diff: onboarding helpers/create/dashboard, cost endpoint/UI, session metering, account/return-path checks, local microgrid/deploy scripts | Preserve and reconcile deliberately. This branch supplies tested roadmap work; an original dirty checkout is not disposable scaffolding. |
| NYC heat/consumption harmonization and publication | v3 W1 specifies gate-approved datasets and named hash-bound human approval | Dataset recertification, research runs, publication and pitch export are evidence/operational work. No audit may invent data or imply approval from code tests. |
| Deployment and payments | Docker/compose and scripts exist, but domain/TLS, accounts, real price catalog, mail and production secrets require environment-specific setup | Local tests do not establish live deployment or a successful real payment. Keep genuine price/account decisions explicit. |
| Open source and stores | `docs/OPEN-SOURCE.md` contains owner license/repository choices; mobile requires developer organizations and signing assets | No repository visibility, license choice, upstream publication, deployment, purchase or store submission was performed in this workstream. |

## Validation record

These are focused executed checks, not a sum of disjoint suites. The parent
agent records the complete coordinated branch run separately.

- Research package: 68 tests passed, including bounded archive reads,
  future-year boundaries, dense assignment/cost counts, frozen model policy,
  exact additive reconciliation and narrative contracts.
- Worker archive/session tests: 33 passed, covering fixed read-only files,
  traversal/symlink/other-file refusal, cleanup, additional action exhibits,
  scout policy, and missing/oversized archive disclosure.
- Worker cloned-DB metering and independent machine-audit integrations:
  18 passed. Checks cover stable tier-1 sampling, flagged workflow,
  idempotence, archive/key/model forwarding, malformed/failed audit usage,
  refused organization key stopping later calls, and storage/persistence
  failures preserving costs. Model calls were mocked; no paid run was made.
- Cloned-DB management/custom-pages/public-reader checks: 15 passed,
  including role/cross-tenant refusal, draft privacy, immutable versions,
  pointer consistency, reversible archives/reverts and exact public fields.
- Transcript retention: 3 cloned-DB tests passed. Draft-to-portrait mapping:
  15 passed, including explicit narrative opt-in and source retention.
- Worker/research/core/web TypeScript checks passed after the respective
  implementations. Final coordinated checks remain the parent record.
- Independent installed-Chromium review: static core at 1440/390 px;
  review/narrative at desktop/mobile; management and contact version previews
  at desktop, 320 and 390 px. Screenshots were visually inspected, including
  `/private/tmp/sol-independent-{desktop,mobile}.png`,
  `/private/tmp/sol-final-{review-desktop,review-mobile,narrative-desktop}.png`,
  and `/private/tmp/deep-fryer-high-effort-visuals/` management screenshots.
  Persistent dimension navigation, focus, explicit narrative inclusion,
  readable controls and fitting mobile forms were verified. Synthetic
  missing evidence images were fixture limitations, not source evidence.
- Astra's deterministic management lifecycle checks exercised create/order/
  archive/restore, indicator add/remove/save, contact draft/public/version2/
  revert/archive/restore and absence of private fields from public HTML.
- Independent five-correction research review:
  `research/all-portraits-2026-10-23-sol-high/reviews/corrections-independent-sol-high.json`
  binds exact amendment, baseline and evidence-manifest hashes. All 16
  archived assets matched hash/size; baseline objects, exhaustive field
  diffs and canonical supersession hashes passed. Waste and protected-area
  arithmetic were recomputed and broadband series/geography/year checked.
  All five corrections were accepted as unscored observations by this
  independent machine reviewer; human approval remains false.

Known practical limit: an archived PDF above 32 MiB (including the existing
67.21 MiB AMBAG document) is not loaded into a model workspace. The reason is
explicit, and an available screenshot can still be inspected. This branch
does not claim full-document verification when that archive was omitted.
