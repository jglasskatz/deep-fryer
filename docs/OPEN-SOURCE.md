# Open-sourcing deep-fryer: audit and release plan

*Audit date: 2026-10-16.*

**Scope.** This audit covers the committed tree at `abae8f9` (branch `claude/production-pwa-billing`). It also covers the full history of every ref on GitHub: 76 commits across `main`, `claude/production-pwa-billing`, `claude/deep-fryer-design-spec-v2-7oojwt`, `claude/nyc-research-brief-6dhjpa`, `gh-pages` and `refs/pull/1/head`. Unreachable objects in the local clone are included too.

**Not covered:**

- Work that is uncommitted or was added after this audit, such as `docs/SPEC-v7.md`, `docs/research-cost.md` and the getting-involved files. Run §1.1 again on the release commit.
- GitHub issue and PR comments, and Actions logs.

**This is not legal advice.** Items marked **[Owner decision]** can only be decided by the copyright holder.

---

## Summary

| Question | Answer |
|---|---|
| Are there real secrets in the code or the history? | **No.** No live or real credentials were found in any ref, branch, PR ref or local unreachable object. Every string shaped like a key is a test fixture, a placeholder in the docs or a local-dev default (§1.2). **No secrets need rotating.** |
| Can we just switch the existing repo to public? | **Not recommended.** On every branch and on PR #1, the history contains internal NYC sales and political strategy notes (`docs/nyc-impact-research.md`, `docs/nyc-research-brief.md`). It also contains the owner's personal Gmail address as author on 30 commits. Publish a **new repo** built from a cleaned tree instead (§5, step 6). |
| Is anything licensed today? | **No.** deep-fryer has no LICENSE file, every `package.json` is `private` and none has a `license` field, so legally it is "all rights reserved". `doughnut-santa-cruz` also has no top-level LICENSE, even though its README says "MIT" and the repo has 6 forks. |
| Do any dependencies block a license? | Nothing blocks MIT, Apache-2.0 or AGPL-3.0. The one proprietary runtime dependency is `@anthropic-ai/claude-agent-sdk`. If you choose AGPL, it needs a linking exception (§2). |
| Is the Doughnut attributed? | **Attribution is required, and the product UI does not have it yet.** CC BY-SA on the diagram does not decide the code license (§3). |
| Recommendation | **[Owner decision]** Option (a): publish the whole monorepo as a new public repo. License the app **AGPL-3.0**, and license `packages/contract` and `vendor/open-doughnut` **Apache-2.0**. Separately, add an MIT LICENSE to `doughnut-santa-cruz` now (§4). |

---

## 1. Secrets and sensitive data

### 1.1 Method

gitleaks and trufflehog are not installed here. These checks were run instead:

- **Regex scan with ripgrep.** It ran over `git log -p --all` of the local clone (71 commits) and of a `git clone --mirror` of GitHub. The mirror has 76 commits and includes the three branches that exist only on the remote, `gh-pages`, and the PR #1 head. The patterns covered:
  - Anthropic keys (`sk-ant-`)
  - Stripe keys (`sk_|pk_|rk_` with `live|test`, and `whsec_`)
  - AWS access key IDs (`AKIA` and `ASIA`)
  - PEM private keys
  - GitHub tokens (`ghp_`, `gho_`, `ghs_`, `github_pat_`)
  - Google keys (`AIza`, `GOCSPX-`) and OAuth client IDs
  - Slack tokens and webhooks
  - OpenAI `sk-` keys
  - JWTs
  - SendGrid and Resend keys
  - Supabase keys and project URLs
  - `postgres://`, `smtps://` and `https://` URLs with embedded credentials
  - `*SECRET|TOKEN|PASSWORD|API_KEY = value` assignments
  - Runs of 32 or more hex or base64 characters
- **detect-secrets 1.5.0**, with its keyword, entropy and basic-auth plugins, over the full mirror history.
- **Filename scan** of every path ever committed, for `.env*`, `*.pem`, `*.key`, `*.p12`, `id_rsa`, dumps and `.npmrc`. The only matches are `.env.example`, which holds placeholders, and `.npmrc`, which holds only `auto-install-peers`.
- **Local unreachable objects:** leftover stash commits `c1607cc` and `bc7b8c2`, the amended commit `0a2de03`, and two blobs. These were never pushed, and none contains a secret.
- **Every email address and phone number** in the history was extracted and reviewed.

To repeat the scan on the release commit, run `gitleaks detect --log-opts="--all"` or `trufflehog git file://.`. Also turn on GitHub secret scanning with push protection once the repo is public.

### 1.2 Hits, and what they are

| String or pattern | Introduced in → path | What it is |
|---|---|---|
| `ANTHROPIC_API_KEY: 'sk-ant-test'` | `7d5c404` → `apps/worker/src/session.test.ts` | Test fixture |
| `STRIPE_SECRET_KEY: 'sk_live'`, `S3_SECRET_ACCESS_KEY: 'secret'`, `AUTH_SECRET: 'auth'`, `postgres://owner:pw@db/…` | `7d5c404` → `apps/worker/src/session.test.ts` | Test fixtures: the test checks that sessions never see these environment variables |
| `sk_live_x` | `9918cf0` → `packages/core/src/deploy-env.test.ts` | Test fixture |
| `sk_test_dummy`, `whsec_test_secret` | `61888e5` → `apps/web/lib/stripe.test.ts` | Test fixtures |
| `sk_test_123` | `fc52e17` → `.github/workflows/ci.yml`, `apps/web/lib/stripe-mock.test.ts` | Dummy key for `stripe-mock`, which never contacts Stripe |
| `price_1PgafmB7WZ01zgkW6dKueIc5` | `fc52e17` → `apps/web/lib/stripe-mock.test.ts` | A Stripe price ID inside a mock. IDs are not secrets. |
| `STRIPE_SECRET_KEY=sk_live_…` | `docs/deploy.md` | Placeholder in the docs, truncated with an ellipsis |
| `access_token: 'eyJ…'` | `9918cf0` → `packages/core/src/preflight.test.ts` | JWT-shaped placeholder, truncated |
| 64-hex `7c01cf57…` | `ede42fc` → `packages/research/src/gate.test.ts` | SHA-256 used as an approval-hash fixture |
| `AUTH_SECRET = 'test-secret'` | `7d5c404` → `apps/web/lib/emergency-actions.rls.test.ts` | Test fixture |
| `POSTGRES_PASSWORD: postgres`, `postgres://postgres:postgres@…` | `e2c1517` → `docker-compose.yml`; `ci.yml`; `.env.example`; docs | Local-dev and CI defaults. The current `docker-compose.yml` requires `${POSTGRES_PASSWORD:?set …}`. |
| `https://user:pw@nyc.gov/` | `5cff890` → `packages/core/src/emergency.test.ts` | Test that the URL validator rejects embedded credentials |
| `smtps://user:pass@smtp.example.gov` | `6e11425` → `.env.example` | Placeholder |
| `service_role` | `a87bdd8` → `packages/db/migrations/0001_rls_policies.sql` | Postgres role name in a comment, not a key |

**Verdict: no real secrets. No rotation and no history rewrite are needed for secrets.**

### 1.3 Sensitive, but not secret

| Item | Where | Risk | Action |
|---|---|---|---|
| NYC pitch and political strategy | `docs/nyc-impact-research.md`, added in `52c9864`, on every branch | **High (reputational).** It is framed as a pitch to the Mayor's office ("Don't lead with Raworth…", how to pre-empt "doughnut = degrowth" attacks, the mayor's political positioning). It is not confidential data, but it is business- and politically-sensitive, and DEAL could read it as unfriendly. | Remove from the tree **and** keep it out of the public history. This is the main reason to publish a new repo rather than switching the existing one to public. |
| Orchestrator brief | `docs/nyc-research-brief.md`, `6509dab` | Medium. It is an internal agent prompt ("The audience is the mayor's office"). It also says research runs "on this session's own credentials … no API key needed", which goes against Anthropic's rule for third-party products (see §5, step 8). | Remove, or rewrite it as a generic guide to running a research campaign. |
| Review notes on unpublished NYC data | `docs/review-briefs/*.md`, `2dc66d8` | Low to medium. It lists rejected and contested values that could be quoted as if they were official NYC figures. | Remove from the public tree. |
| Owner's personal email | Commit author on 30 commits | Low. It is your address, but publishing exposes it. | A new repo with a single commit made under your GitHub noreply address avoids this. |
| Keel session telemetry | `.keel/sessions/*.jsonl` (6 files) | Low. It is tool noise with no secrets. | Remove, and add `.keel/sessions/` to `.gitignore`. |
| Real municipal contacts used as CLI examples | `clerk@cityofithaca.org` and `(607) 274-6570` in `scripts/create-tenant.ts`, `docs/deploy.md` and `docs/language-access.md` | Low. These are public office contacts, but someone pasting the example would invite a real clerk. | Replace them with `example.gov` placeholders. NYC 311 `(212) 639-9675` in tests is a public number and is fine. |
| Notes about the sales funnel | `SPEC.md` §5 ("`deep-fryer` (closed)"), SPEC-v3 §0/W1 ("for the pitch"), SPEC-v5 §5 (notebook items such as "meet w/ candidates"), SPEC-v6 ("NYC: the Mayor's administration") | Low. These are design history, not secrets. | **[Owner decision]** Either keep them as design history under `docs/design/` with a note, or remove the pitch and candidate lines. |
| `scripts/export-nyc.ts` | Hard-codes a `Co-Authored-By` trailer and pushes into the `doughnut-santa-cruz` checkout | Low | Generalize it, or move the NYC scripts to `examples/nyc/`. |
| `gh-pages` branch | Santa Cruz static dashboard, plus 6 PNG screenshots of Santa Cruz and Watsonville government reports | Low | Leave it out of the new repo. The same content is already public in `doughnut-santa-cruz`. |

`docs/strategy-findings.md`, `docs/measurement.md` and `docs/translation-review-v5.md` contain no confidential material. They are useful to the community, so keep them.

---

## 2. Third-party licenses

### 2.1 Dependencies

`pnpm licenses list --json -r` found 573 package entries, including dev and build tooling:

| License | Count | Notes |
|---|---|---|
| MIT | 464 | |
| Apache-2.0 | 49 | Includes `drizzle-orm`, `playwright-core`, `@aws-sdk/client-s3`, `typescript` and `sharp` |
| ISC | 28 | Includes `next-auth` and `@auth/drizzle-adapter` |
| BSD-2-Clause and BSD-3-Clause | 14 | ESLint internals, `qs`, `source-map` |
| MPL-2.0 | 4 | `axe-core` (dev only, lint), `lightningcss` (build time). The copyleft applies per file and only to those files if modified, so it has no effect on deep-fryer. |
| **Unknown → proprietary** | 3 | `@anthropic-ai/claude-agent-sdk` and its two platform binaries: "© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements…" (Commercial Terms). See below. |
| LGPL-3.0-or-later | 2 | `@img/sharp-libvips-*`, the prebuilt libvips that `sharp` loads dynamically (optional for Next). This only matters if you publish built images (see below). |
| Unlicense | 2 | `postgres` (the DB driver), `fast-sha256` |
| OFL-1.1 | 1 | `@fontsource-variable/inter` |
| CC-BY-4.0, CC0-1.0, Python-2.0, BlueOak-1.0.0, MIT-0, 0BSD | 1 each | `caniuse-lite` (build data), `language-subtag-registry`, `argparse`, `minimatch`, `nodemailer`, `tslib`. All permissive. |

**No GPL- or AGPL-licensed dependency** is present, so nothing is incompatible with AGPL-3.0, Apache-2.0 or MIT. All `@keel_flow/*` packages come from the public npm registry under MIT ("Copyright (c) 2026 jglasskatz"), so contributors' CI does not need a private registry.

**Direct runtime dependencies by workspace** (dev-only tooling not listed):

- `apps/web`: `next` MIT, `react`/`react-dom` MIT, `next-auth` ISC, `@auth/drizzle-adapter` ISC, `drizzle-orm` Apache-2.0, `graphile-worker` MIT, `nodemailer` MIT-0, `stripe` MIT, `zod` MIT, `server-only` MIT, `@fontsource-variable/inter` OFL-1.1.
- `apps/worker`: `@anthropic-ai/claude-agent-sdk` **proprietary**, `playwright-core` Apache-2.0, `graphile-worker`, `drizzle-orm`, `nodemailer`, `zod`.
- `packages/db`: `postgres` Unlicense, `drizzle-orm`.
- `packages/research`: `@aws-sdk/client-s3` Apache-2.0, `graphile-worker`, `zod`.
- `packages/core`: `zod`. `packages/contract`: none.

**The Claude Agent SDK** (proprietary, used by the worker only). An open-source project can depend on it: each user installs it from npm and accepts Anthropic's terms. Two consequences:

1. **If you choose AGPL**, add a GPLv3 §7 "additional permission" for combining with the SDK. Without it, anyone who conveys or runs a combined worker cannot satisfy the "Corresponding Source" requirement for the SDK part. Suggested text, adapted from the FSF's standard exception template:

   > Additional permission under GNU AGPL version 3 section 7: If you modify this Program, or any covered work, by linking or combining it with `@anthropic-ai/claude-agent-sdk` (or a modified version of that library), containing parts covered by the terms of Anthropic's Commercial Terms of Service, the licensors of this Program grant you additional permission to convey the resulting work.

   Apache-2.0 and MIT need nothing here.
2. **Do not publish prebuilt worker images** to a public registry. The image would bundle the SDK and its Claude Code binary, which would mean redistributing Anthropic's proprietary code. `docker compose up --build` builds images locally from npm, which avoids the question. Locally built images do the same for the LGPL libvips binary. If you ever do publish images, include the LGPL text and a pointer to the libvips source.

**Docker base images** are pulled by the user, not redistributed by you: `postgres:16` (PostgreSQL License), `chrislusf/seaweedfs` (Apache-2.0), `caddy` (Apache-2.0), `node:22-slim`, `mcr.microsoft.com/playwright` (Apache-2.0). They have no effect on your license.

### 2.2 Code and assets that are vendored or copied

| Asset | Origin and license | Obligation |
|---|---|---|
| `apps/web/components/doughnut/doughnut-renderer.js` | Vendored from `doughnut-santa-cruz/docs/doughnut.js`, which comes from Jeremy Johnson's `doughnut-economics-graph` (flodskum). **MIT.** The file header says "Copyright (c) 2021-23"; the upstream LICENSE file says 2021. | Keep the full MIT header, which is present and lists the modifications, and repeat it in NOTICE. MIT code can go into an AGPL, Apache or MIT repo. |
| `gh-pages:doughnut.js` (deep-fryer) and `doughnut-santa-cruz/docs/doughnut.js` | Same MIT code; the header is present | Same |
| Inter typeface | `@fontsource-variable/inter` 5.2.8, "Copyright 2016 The Inter Project Authors", **SIL OFL 1.1**, no Reserved Font Name | The font files ship in the web build, so include the OFL text in THIRD_PARTY_NOTICES. The font must not be sold on its own, which you don't do. |
| PWA icons (`apps/web/public/icons/*`) | Original work, made in commit `380f232` (simple concentric rings, not the DEAL artwork) | None |
| `public/embed.js`, `public/sw.js` | Original | None |
| Icon names in `framework.json` (`utensils`, `heart-pulse`, …) | Plain strings. No icon library is installed or bundled. | None. If you later add Lucide or similar, it is ISC. |
| Four-lens questions (`framework.json` lenses, `vendor/open-doughnut/plugin/skills/methodology.md`) | Paraphrase DEAL / Thriving Cities Initiative, *Creating City Portraits* (2020). `methodology.md` already credits DEAL. | Add a formal citation (§3.3). These are short phrases, but attribute them anyway. |
| Santa Cruz data and evidence | `scripts/import-santa-cruz.ts` reads them at runtime from a checkout of `doughnut-santa-cruz` and does not copy them into this repo. `apps/web/public/evidence/` is gitignored. | None in the main tree. Evidence screenshots of third-party pages stay in tenant storage, not in git. |
| `apps/web/lib/mock-data.ts` | Demo portrait labeled "City of Santa Cruz" | Label it "demo data, unofficial" so it isn't mistaken for the city's own portrait. |

**Ownership.** Every commit is by you, by Claude (whose output Anthropic's terms assign to you) or is a GitHub merge. **No third-party contributors**, so you can choose any license today without anyone's consent.

---

## 3. Doughnut Economics IP

*Note on sources: `doughnuteconomics.org` and Wikipedia were blocked from this environment's network. The DEAL terms below come from search-engine extracts of DEAL's own pages, so read the [license page](https://doughnuteconomics.org/license) once yourself before release.*

### 3.1 What DEAL says

- **Diagrams, CC BY-SA 4.0.** "The Doughnut, Overshoot Doughnut, and Embedded Economy diagrams are also available for you to use under the Creative Commons Attribution-ShareAlike 4.0 International Licence." The attribution DEAL requests for the Doughnut is:
  > Title: The Doughnut of social and planetary boundaries. Credit: Kate Raworth and Christian Guthier. CC-BY-SA 4.0. Citation: Raworth, K. (2017), Doughnut Economics: seven ways to think like a 21st century economist. London: Penguin Random House.

  In presentations, DEAL asks for "Raworth 2017". DEAL's newer 2025 diagrams, co-designed with Ruurd Priester, carry their own attributions; these matter only if you copy those diagrams. ([DEAL license page](https://doughnuteconomics.org/license))
- **Tools, CC BY-SA.** DEAL tools are CC BY-SA. Modified DEAL tools should carry "[Derived from DEAL - doughnuteconomics.org]". ([DEAL license page](https://doughnuteconomics.org/license), [Principles & Guidelines](https://doughnuteconomics.org/principles-and-guidelines))
- **Names.** DEAL states that "Doughnut Economics" and "Donut Economics" are trademarked "in order to prevent their misuse". DEAL also reserves "Doughnut Economics Action Lab", "DEAL", its logo and its branding. Using any of these must follow DEAL's Terms of Use and Licensing Rules. I could not confirm a registration with the USPTO, UKIPO or EUIPO, so treat DEAL's claim as real either way. ([Principles & Guidelines](https://doughnuteconomics.org/principles-and-guidelines), [Terms of Use](https://doughnuteconomics.org/terms-of-use))
- **Business policy.** It applies to organisations that earn most of their revenue from trading, and to consultants who work with business clients. Its rules:
  - No public claims that a business is "within the Doughnut", "a Doughnut Business", "aligned with Doughnut Economics" or "endorsed by DEAL".
  - Doughnut imagery may not be used in general business communications.
  - Consultants with business clients must first register with DEAL.

  ([Business & Enterprise](https://doughnuteconomics.org/themes/business-enterprise))
- **City portraits.** The method is DEAL / C40 / Circle Economy, *Creating City Portraits* (Thriving Cities Initiative, 2020), extended by the *Doughnut Unrolled* tools (2022), which include a *Data Portrait of Place* and a *Community Portrait of Place*. ([methodology PDF](https://doughnuteconomics.org/Creating-City-Portraits-Methodology.pdf), [White Rose record](https://eprints.whiterose.ac.uk/164833), [Doughnut Unrolled](https://doughnuteconomics.org/news/48)) deep-fryer produces the *data* half. `docs/measurement.md` already says so, and published portraits should say it too.

### 3.2 What this means for deep-fryer

1. **The code license is not constrained by CC BY-SA.** ShareAlike attaches to *Adapted Material*, meaning adaptations of the diagram artwork that you share. It does not attach to software that draws a ring chart. The repo contains no DEAL artwork files: the icons are original, and the renderer draws procedurally from MIT code. CC BY-SA 4.0 §2(b)(2) also says outright that it grants no trademark rights. AGPL, Apache-2.0 and MIT all work.
2. **Treat the rendered doughnut as an adaptation.** The public portrait deliberately reproduces the diagram's form: two rings, 12 + 9 named wedges and the "safe and just space". Whether a data-driven chart in that form legally counts as an adaptation is debatable, because the idea and the framework structure are not copyrightable but the specific visual expression is. The cheap and safe path for every doughnut you render (portrait pages, embeds, compare and insights views, offline pages, static exports) is:
   - credit Raworth and Guthier;
   - link CC BY-SA 4.0;
   - say what changed (for example, "wedges drawn from local data"; the NYC family replaces *ozone-layer depletion* with *extreme heat*);
   - offer the rendered graphic itself under CC BY-SA 4.0.

   Cities that publish portraits inherit this obligation. If the product renders the credit automatically, they comply by default.
3. **Portrait data and text are not adaptations.** Indicator values, evidence, rationales and actions are facts and original writing. Each tenant can choose the license for its CSV/JSON open data (CC BY 4.0 or ODbL are usual). **[Owner decision]** Pick the default the product suggests.
4. **If you ever bundle DEAL artwork or tool text** (for example, the official diagram SVG), keep those files under CC BY-SA 4.0 with credit. CC BY-SA 4.0 is [one-way compatible with GPLv3](https://creativecommons.org/2015/10/08/cc-by-sa-4-0-now-one-way-compatible-with-gplv3/), so a GPL-family codebase could absorb such files. An MIT or Apache codebase must keep them licensed separately. This is how it works mechanically; it is not a reason to choose one license over another.
5. **Name.** Do not put "Doughnut Economics" in a product name, repo name, domain or logo, or imply that DEAL endorses you. Descriptive use plus a line saying you are not affiliated is normal practice. Some current copy reads like a claim of alignment, so reword it:
   - `apps/web/app/layout.tsx` and `manifest.ts`: "Doughnut Economics portraits for cities"
   - `apps/web/app/page.tsx`: "Portraits follow the Doughnut Economics Action Lab city-portrait methodology"
   - The GitHub repo description
   - The `doughnut-santa-cruz` page title, "Santa Cruz Doughnut Economics"

   Suggested replacement: "portraits built on Kate Raworth's Doughnut of social and planetary boundaries, using the four-lens method from DEAL's *Creating City Portraits*; not affiliated with or endorsed by DEAL." Because DEAL claims a trademark and has a business policy, **send DEAL a short note before launch**: what the tool is, that it is open source, and how you attribute. It may also qualify for listing on DEAL's community platform. **[Owner]**

### 3.3 Attribution the product and the release must carry

**In the product UI**, as one shared component that appears wherever a doughnut is drawn and on `/[tenant]/methodology`:

> Doughnut diagram: Kate Raworth and Christian Guthier, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), adapted with local data (Raworth, *Doughnut Economics*, 2017). City-portrait method after DEAL's *Creating City Portraits*. Not affiliated with Doughnut Economics Action Lab.

**In the repo** (`NOTICE` and the README): the full DEAL credit line above; the *Creating City Portraits* citation (Fanning, Krestyaninova, Raworth et al., DEAL 2020); the trademark and non-affiliation sentence; the MIT notice for the renderer; and the OFL notice for Inter.

**Current gap:** nothing in `apps/web` credits Raworth or Guthier or links CC BY-SA. Only `README.md` line 9 names Raworth.

---

## 4. What to open source

### 4.1 Options

| | (a) Whole monorepo | (b) Open core | (c) "Build your own doughnut" starter |
|---|---|---|---|
| **What is public** | Everything: the web app (public and review planes), worker, packages, plugin, scripts and Docker deploy | `contract`, `core`, the renderer, `research`, the worker, the plugin and Docker self-hosting. Billing (Stripe, plans, quotas, webhook) stays closed. | `contract` (framework, thresholds, schemas), the plugin, the renderer and static viewer, an example portrait, and a CLI that takes a city and an API key. This is the `open-doughnut` repo that SPEC.md §5 already designs. |
| **What people can do with it** | Self-host the full product for their city: review queue, evidence, discussion, progress, emergency view, 11 languages | Run research and render it. Without the web app there is no review or publishing UI, and with the web app you are close to (a). | Research a city from a laptop with Claude Code and publish a static site, as the Santa Cruz and Petaluma forks do today |
| **Work to ship** | **Low.** Cleanup plus license files. Billing is already optional: without Stripe keys, organizations run on staff-set contracts. `docs/deploy.md` already tells deployers to `git clone` and `docker compose up`. | **High.** Billing runs through `packages/core/src/plans.ts`, the quota gate in `apps/web/lib/research.ts`, `packages/db/src/billing.ts`, migration `0003`, the webhook route and the billing pages. It would need new seams, a private overlay and two CI pipelines. | **Medium.** The M2 extraction: move the schemas into the plugin and make it a valid Claude Code plugin (check the manifest location; Claude Code normally expects `.claude-plugin/plugin.json`). Then package the `export-static` template as the viewer and port the Santa Cruz CLI to the contract. |
| **Ongoing maintenance** | One codebase, plus community issues, PRs and security reports | Two codebases kept in sync for good; every billing change crosses the seam | A second repo kept in sync with the vendored copy. CI pinning is already planned (`vendor/open-doughnut/README.md`). |
| **Business risk** | Anyone can host it. Under AGPL they must publish their changes; under Apache they need not. The moat becomes hosting, verified research, the review service and relationships with cities. | Little code leaks, but the closed part (Stripe glue) is not the moat, so the protection is mostly illusory. | Lowest. The hosted review and publishing product stays closed. |
| **Fits "folks who want to do it themselves"** | Cities with an IT team. Heavy for an individual (Postgres, S3, OAuth, SMTP, Docker). | Same as (a) | Best fit for individuals and activists |

### 4.2 Candidate licenses

| | AGPL-3.0 | Apache-2.0 | MIT |
|---|---|---|---|
| A host who modifies it and serves users over a network | Must offer the modified source to those users (§13) | No obligation | No obligation |
| Patent grant | Yes (GPLv3 §11) | Explicit, with patent retaliation | None explicit |
| A city self-hosting it unmodified | No obligation beyond keeping the notices | Same | Same |
| A vendor embedding it in a proprietary product | Blocked, unless they open their code or buy a commercial license from you (which needs a CLA) | Allowed | Allowed |
| Claude Agent SDK dependency | Needs the §7 exception (§2.1) | Fine | Fine |
| [Digital Public Goods](https://digitalpublicgoods.net/standard) eligibility | Yes (OSI-approved) | Yes | Yes |

**How US municipalities and procurement treat these licenses:**

- **What cities actually buy.** Cities mostly buy a *service* (hosting, support, a contract), not a license. Counsel reviews an open-source license the way it reviews any license. None of these three licenses asks the city to indemnify anyone, sets a governing law or venue, or auto-renews, which are the clauses municipal attorneys usually strike.
- **The real difference is familiarity with copyleft.** Apache-2.0 and MIT almost always pass without questions, and many counsel prefer Apache for its explicit patent grant. AGPL passes for unmodified use but can trigger review. Some organizations ban it outright: Google's policy says AGPL code ["MUST NOT be used"](https://opensource.google/docs/using/agpl-policy/). That mostly affects vendors and integrators, not the city itself.
- **AGPL in civic software.** AGPL is common and accepted here. CONSUL Democracy (AGPL-3.0) has been [adopted in Buenos Aires, Paris and New York](https://www.digitalpublicgoods.net/r/consul-democracy), and Barcelona's [Decidim](https://interoperable-europe.ec.europa.eu/collection/ajuntament-de-barcelona-barcelona-city-council/solution/decidim) is AGPL. One former CIO of the UC, SUNY and UMass systems said open-source licensing [never came up](https://lists.opensource.org/pipermail/license-discuss_lists.opensource.org/2019-May/020545.html) in procurement, and those systems bought AGPL-based open-core software (Canvas). Practitioners' guidance is that the copyleft obligation is the concern and that "viral" overstates it ([Centre Law Group](https://centrelawgroup.com/blog/agpl-and-government-contracting/)).
- **Any license is only as strong as the copyright behind it.** 45 of the 76 commits are authored by Claude. The US Copyright Office's [2025 report](https://copyright.gov/newsnet/2025/1060.html) says purely AI-generated material is not copyrightable, while human selection, arrangement and modification can be. Copyleft is enforced through copyright, so AGPL's leverage over heavily AI-generated parts may be weaker. Do not treat any license as the moat.

### 4.3 Recommendation [Owner decision]

**Option (a), published as a new public repository:**

- **AGPL-3.0-or-later** for the application: `apps/*`, `packages/core`, `db`, `research`, `pack-research`, `scripts`, `deploy`.
- **Apache-2.0** for `packages/contract` and `vendor/open-doughnut`. `architecture/data.ts` already calls these "the product/OSS boundary".
- The renderer stays **MIT** under Jeremy Johnson's notice.
- Add the Claude Agent SDK exception and a CLA.

**Also do now, at almost no cost:** add an MIT LICENSE to `doughnut-santa-cruz`. That puts the existing forks on solid ground and answers "for folks who want to do it themselves" today. Build (c) later as the M2 extraction, if demand appears.

Why this combination:

- **It matches what the code already is.** It is self-hostable, billing is optional, and the deploy guide starts with `git clone`, so (a) costs the least to ship.
- **AGPL fits a hosted business.** It stops a competitor from running a closed, improved hosted fork against you, while cities that self-host are unaffected. It also mirrors the ShareAlike norm of the DEAL ecosystem, which is the question SPEC.md §14 C left open.
- **Apache on the contract and plugin lets the community artifact travel.** DEAL, other tools and governments can embed the framework, schemas and research prompts without copyleft questions. That is the community artifact SPEC.md §5 always meant to be open.
- **(b) is not worth it.** It adds permanent maintenance cost to protect code that is not the moat.

**Choose Apache-2.0 for everything instead if:**

- you don't plan to defend a hosted business;
- you want GovTech vendors to build on it; or
- a target city's counsel says AGPL blocks them.

While you hold all the copyright (with a CLA), relicensing from AGPL to Apache later is easy. Going the other way cannot withdraw permissions already granted.

---

## 5. Release checklist

### Phase 0: do today, independent of everything else

- [ ] **[Owner]** Add `LICENSE` (MIT, matching its README) to `doughnut-santa-cruz`. Keep `doughnut-economics-graph/LICENSE`. Reword its page title so it does not use "Doughnut Economics" as a brand.

### Phase 1: blocking, before anything is public

1. [ ] **[Owner decision]** Choose the license or licenses (§4.3), whether to require a CLA (for example, the CLA Assistant GitHub app) or only a DCO, and the default data license for portraits.
2. [ ] Add license files:
   - root `LICENSE`, plus per-directory `LICENSE` files for `packages/contract` and `vendor/open-doughnut` if you split licenses;
   - a `"license"` SPDX field in every `package.json`;
   - the §7 exception (AGPL only), in `LICENSE` or `LICENSE-EXCEPTION`;
   - keep the MIT header in `doughnut-renderer.js`.
3. [ ] Add `NOTICE` and `THIRD_PARTY_NOTICES.md`:
   - the renderer's MIT notice;
   - the Inter OFL-1.1 text;
   - the DEAL diagram credit, the *Creating City Portraits* citation, and the trademark and non-affiliation sentence;
   - a note that the Claude Agent SDK is proprietary, installed by the user, and covered by Anthropic's Commercial Terms;
   - a dependency list from `pnpm licenses list --prod -r`.
4. [ ] **Add Doughnut attribution to the product** (§3.3): one component on every view that draws a doughnut, plus the methodology page, embeds and static export. Reword the "Doughnut Economics" copy listed in §3.2(5).
5. [ ] **Clean the tree:**
   - delete `docs/nyc-impact-research.md`, `docs/nyc-research-brief.md`, `docs/review-briefs/` and `.keel/sessions/`, and gitignore `.keel/sessions/`;
   - replace the Ithaca clerk's email and phone with `example.gov` placeholders;
   - generalize `scripts/export-nyc.ts` or move the NYC scripts to `examples/nyc/`;
   - label the Santa Cruz demo data as unofficial;
   - **[Owner decision]** whether to remove the pitch and candidate notes from the SPECs.
6. [ ] **Choose a stable release commit.** HEAD is a work-in-progress checkpoint ("In progress: getting-involved foundation"), other agents are still editing, and the committed `docs/deploy.md` already refers to `scripts/nyc-involvement.ts`, which is not committed. Merge to `main`, get CI green, then **run §1.1 again on that commit**.
7. [ ] **Publish a new repo, not a visibility switch.**
   - `git archive <release-commit> | tar -x -C ../deep-fryer-public`, then `git init`, then make one commit as `jglasskatz@users.noreply.github.com`, then push to a new public repo.
   - Either rename the private repo (for example to `deep-fryer-internal`) and publish the public one as `deep-fryer`, or use a new name.
   - This leaves behind the strategy docs, the personal email, PR #1, `gh-pages` and the branches that exist only on the remote. Rewriting history with `git filter-repo` is worse: GitHub keeps `refs/pull/*` and cached views of the old commits.
8. [ ] **Self-hoster README** (rewrite `README.md`):
   - what it is, with a screenshot;
   - a 10-minute Docker quickstart: `cp .env.example .env`; set `SITE_ADDRESS`, `APP_URL`, `AUTH_SECRET`, `POSTGRES_PASSWORD`, `STORAGE_SECRET_KEY` and one sign-in method; `docker compose up -d --build`; `docker compose run --rm migrate node --import tsx ../../scripts/create-tenant.ts …`;
   - **`ANTHROPIC_API_KEY` from the Claude Console** (or Bedrock or Vertex) for research. Anthropic [does not allow third-party products to use claude.ai or subscription login](https://code.claude.com/docs/en/agent-sdk/overview), so the docs must not suggest that path;
   - roughly what a full refresh costs (22 sessions; see `docs/strategy-findings.md`);
   - demo mode without a database, and the fact that on your own instance plans are simply quotas you set;
   - license, attribution and non-affiliation;
   - a link to the hosted version.
9. [ ] Add `SECURITY.md`:
   - supported versions;
   - private reporting through GitHub's "Report a vulnerability";
   - a response time;
   - what is in scope: RLS bypass, SSRF in evidence capture, auth and invitations, prompt injection into research sessions, XSS in discussion or embeds;
   - no bug bounty.

### Phase 2: before announcing

- [ ] `CONTRIBUTING.md`:
  - setup: pnpm 9, Node 20+, Postgres for the integration tests;
  - checks: `pnpm typecheck && pnpm test`, `keel verify`, and the rule that a PR updating a node's files must also update the map;
  - conventional commits;
  - which license each directory takes contributions under, and the CLA or DCO.
- [ ] `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) with a role contact address, not your personal Gmail.
- [ ] `.github/ISSUE_TEMPLATE/`: bug report, feature request, "help with my city's portrait", and a security entry that redirects to `SECURITY.md`. Add a PR template with a checklist (tests, map update, attribution kept).
- [ ] **CI for contributors.** Today's `ci.yml` needs **no secrets**: Postgres and `stripe-mock` run as services, the Stripe key is a dummy, and `@keel_flow/cli` comes from public npm. Keep it, and add:
  - a gitleaks or trufflehog action on PRs;
  - a license check that fails on new GPL or unknown licenses (`pnpm licenses list --prod --json` plus a small allowlist);
  - Dependabot.
- [ ] Move the SPEC history to `docs/design/` with a one-line note that it is historical.
- [ ] Do not push prebuilt worker images to public registries (§2.1).
- [ ] Optional: apply for the [Digital Public Goods registry](https://digitalpublicgoods.net/standard), which some donor- and multilateral-funded procurement looks for.

### Phase 3: switches only the owner can flip

- [ ] Create the public repo, or change visibility in **Settings → General → Danger Zone → Change repository visibility**. Treat this as irreversible: forks and clones persist.
- [ ] In **Settings → Code security**: turn on secret scanning with push protection, private vulnerability reporting and Dependabot alerts. Add branch protection on `main`.
- [ ] Send DEAL the note about name use and attribution (§3.2).
- [ ] **[Owner decision]** Trademark posture for the "deep-fryer" name and icon. An open-source license does not grant trademark rights, but a short `TRADEMARKS.md` makes it explicit that forks must rename.
- [ ] Rotation: **none required by this audit.** If a key was ever pasted into issue or PR comments or Actions logs (which were not scanned), rotate it in the provider's console.

---

## 6. "Are you able to make deep fry open source?"

**Partly.** An assistant working in this repo can do everything up to the switch:

- write the LICENSE, NOTICE, attribution component, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, templates and CI checks;
- remove the internal docs on a branch;
- run the secret and license scans again;
- build the clean single-commit export ready to push.

**Only you, as copyright holder and repository admin, can:**

- **choose and grant the license.** Licensing is a legal act of the rights holder;
- **make it public**, by creating the public repo or changing visibility. This is effectively irreversible;
- **rotate credentials** in the Stripe, Anthropic, Google and Microsoft consoles (none needed now);
- **decide on trademarks**, including talking to DEAL about the "Doughnut Economics" name and deciding how to protect "deep-fryer";
- **decide the business terms**: AGPL or Apache, CLA or not, what stays in the hosted offering.

A session's GitHub connection might technically be able to create a repository or push files. That should happen only on your explicit instruction, after you have chosen the license.

---

## Sources

- DEAL: [License and attribution](https://doughnuteconomics.org/license) · [Principles & Guidelines](https://doughnuteconomics.org/principles-and-guidelines) · [Business & Enterprise](https://doughnuteconomics.org/themes/business-enterprise) · [Terms of Use](https://doughnuteconomics.org/terms-of-use) · [Creating City Portraits (2020)](https://doughnuteconomics.org/Creating-City-Portraits-Methodology.pdf) · [White Rose record](https://eprints.whiterose.ac.uk/164833) · [Doughnut Unrolled](https://doughnuteconomics.org/news/48)
- Creative Commons: [CC BY-SA 4.0 legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode) · [CC BY-SA 4.0 one-way compatible with GPLv3](https://creativecommons.org/2015/10/08/cc-by-sa-4-0-now-one-way-compatible-with-gplv3/)
- Licensing and procurement: [Google AGPL policy](https://opensource.google/docs/using/agpl-policy/) · [CONSUL Democracy (DPGA)](https://www.digitalpublicgoods.net/r/consul-democracy) · [Decidim (Interoperable Europe)](https://interoperable-europe.ec.europa.eu/collection/ajuntament-de-barcelona-barcelona-city-council/solution/decidim) · [AGPL and Government Contracting (Centre Law Group)](https://centrelawgroup.com/blog/agpl-and-government-contracting/) · [OSI license-discuss: Government licenses](https://lists.opensource.org/pipermail/license-discuss_lists.opensource.org/2019-May/020545.html) · [Digital Public Goods Standard](https://digitalpublicgoods.net/standard)
- Anthropic: [Agent SDK overview (authentication)](https://code.claude.com/docs/en/agent-sdk/overview) · [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [US Copyright Office: Copyright and AI, Part 2 (2025)](https://copyright.gov/newsnet/2025/1060.html)
- Upstream renderer: [flodskum/doughnut-economics-graph](https://github.com/flodskum/doughnut-economics-graph) (MIT, Jeremy Johnson)
