# Coordinated research and roadmap release

Branch: `codex/high-effort-roadmap`, based on `892295e`. This work was done
in an isolated worktree and a cloned local database. The original dirty
checkout, production accounts and production database were not changed.

## Research provenance

GPT-6.1 Sol at high effort inventoried all 11 portraits. A different Sol
agent reviewed 36 proposed amendments: 31 accepted and five returned for
revision. The initial reviewer authored the five corrections, so a third
Sol agent independently checked those corrections. All 36 final amendments
are accepted by a non-author machine reviewer. None carries human approval.

The public snapshot is reproducible from its frozen baseline, exact review
files, amendments and source exhibits. SHA-256 checks bind those inputs;
changing any displayed amendment or unchanged baseline field fails the
release contract. There are 240 referenced public evidence assets. All 11
portraits use Extreme Heat; Santa Cruz city and Watsonville clearly identify
their county heat measurements as proxies. Missing scoring targets remain
null. More data can improve an observation without justifying a scored wedge.

The shared cost ledger counts each research/review role once. Base sensitivity
for this round: $10.41 Standard / $20.61 Fast. With prior tracked Carmel and
Monterey rounds: $53.64 / $103.20. Actual tokens and billing remain unknown.
Engineering, hosting and earlier untracked SC/NYC research are excluded.
See `research/all-portraits-2026-10-23-sol-high/cost-ledger.json` for explicit
low/base/high quantities, dated rate assumptions and reproducible arithmetic.

## Independent UI and engineering review

GPT-6 Astra high implemented the UI and exercised the browser flows; GPT-6.1
Sol high independently reviewed the UI and backend. The orchestrator inspected
representative final screenshots, including the Extreme Heat side panel,
320px Insights, custom pages, the second-review gap outcome and contact-version
publication. Installed Chromium was reused; no browser was installed locally.

Desktop widths 1280–1440px and phone widths 320/390px were checked. Tests cover
hover summaries, click side panels without scrolling, modal focus/escape,
persistent dimension navigation, regional selection/history, actual evidence
URLs, mobile overflow, comparison modes, draft/public separation, contact
privacy, dimension lifecycle, narrative opt-in and exact-version publication.
Synthetic local review fixtures use visibly labeled sample findings; their
missing evidence image is not a claim about a real source. No test started a
paid research run, sent a real message or made a payment.

Independent release review found three defects, all fixed and regression
checked: flagging a gap rolled back under dual review rather than saving a
draft; framework-mapped dimensions silently ignored custom indicator names;
and removing the last indicator could retain the previous scored wedge.

## Checks

- All-package TypeScript and lint pass.
- Web production build passes.
- All new migrations applied to the isolated database. Drizzle snapshots
  0018–0021 form a complete chain; the generator reports no schema changes.
- Full package run passed 1,115 tests with six environment-dependent skips,
  except one theme-coverage test. Its two newly introduced class cases were
  repaired; all 17 focused theme/custom-page tests then passed. Required CI
  reruns the full suite with PostgreSQL and stripe-mock before merge/deploy.
- Public snapshot contract: 13 tests pass. The complete Pages browser check
  passes all 11 portraits, all evidence links and desktop/mobile interactions.
- Additional local product, management, custom-page and review browser checks
  pass against isolated fixtures. Mutating scripts require explicit opt-in.
- Keel architecture map passes. CI retains the diff verification report;
  critical verification results block release. Public build and browser checks
  are required independently of the server checks, and deployment consumes
  their exact checked artifact only after both jobs pass.

CI now retains the additional Pages UI screenshots under `test-results/pages-ui`.
Local coordinated screenshots are under `/private/tmp/deep-fryer-high-effort-visuals`.

## Scope boundaries

`docs/roadmap-audit-2026-10-23.md` maps requirements to implementation and
remaining draft proposals. Standing approved implementation gaps identified
there have code and checks. Native mobile and JEV remain explicitly draft
workstreams. A live self-service service still needs its server environment,
production credentials and payment/mail configuration; GitHub Pages hosts the
public snapshot, not the authenticated worker application. Public research
preview deployment does not grant scientific approval to the amendments.
