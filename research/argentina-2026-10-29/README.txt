ARGENTINA LONGITUDINAL RESEARCH — 29 OCTOBER 2026

Deliverables
  argentina-working-paper.html — substantive Argentina findings and limitations.
  methods-paper.html — applied measurement, benchmark and policy-inference paper.
  data/portrait-series.json — shared application schema version 1.0.0.
  data/{indicators,observations,events,sources,endpoints}.json — inspectable components.
  data/published-historical-reference.json — separate original Fanning 1992–2015 ratios.
  data/modeled-reference.json — UNEP 2020–2024 source outputs with projected inputs,
    excluded from empirical history.

Working temporal interpretation
  Baseline 2013–2023. Main milestone: Milei inauguration, 10 December 2023.
  Macri election/inauguration, Fernández inauguration, COVID isolation, documented
  February 2023 drought, Milei election, and selected policy publications are marked
  independently. The analysis uses this declared temporal interpretation; other turning points can be studied separately.
  Annual 2023 and H2 2023 overlap the two latest administrations. They are reference
  periods, not pure untreated controls. Policy markers do not identify causal effects.

Evidence status
  Main bundle: 26 indicators, 696 observation-period rows, 205 explicit nulls,
  82 archived source records and 15 dated events at this version.
  Modern main values are retrospective statistical estimates. No empirical policy-effect
  estimate or numeric policy forecast is claimed. Explicit missing rows remain null.
  UNEP material values with projected inputs and old Fanning BAU sheets are not allowed
  to substitute for observations. BAU sheets are not imported.

Partial benchmark view
  Fixed published social thresholds from Fanning et al. (2021 online / 2022 issue),
  Table 1: life expectancy 74 years; electricity 95%; employment 94%; equality 70 points.
  Equality is 100 minus urban Gini and refers to second-semester EPHC-S2 income surveys;
  other benchmark sectors use annual national estimates. This is mixed coverage.
  Our value/threshold normalization is an explicitly labelled adaptation, not the
  original authors' global-minimum-adjusted normalization. No ecological quota is
  invented. Native-unit ecological trends and coverage are presented separately.

Critical comparability limits
  * Comparable INDEC full-semester poverty table begins H2 2016. The discontinued
    2013–2015 series is not filled. Q2 2016 is not a replacement for H1 2016.
  * INDEC cautions about statistics for 2007–2015. H2 2019 excludes Gran Resistencia;
    H2 2020 excludes Ushuaia–Rio Grande. COVID survey changes are flagged.
  * Latest poverty H1 2026 is provisional: 32.3% people, 90% CI [30.8,33.7]. The
    producer reports no significant change from H1 2025, despite a 0.7-point rise.
  * GCB publisher-site preliminary workbook is the actual numerical vintage used;
    inaccessible ICOS final-workbook requests returned licence HTML, preserved as
    access-page evidence and excluded from numerical extraction.
  * GCB territorial fossil/cement CO2 ends 2024; consumption CO2 ends 2023. Neither
    includes land-use CO2 or other greenhouse gases. Per-capita values use archived
    WDI population and the publisher's MtC-to-MtCO2 factor 3.664.
  * UNEP's linked 2024 annex warns of projected inputs from 2020 and recommends
    2019 as the last year for correlation analysis. Later values are separate.
  * WDI forest stock ends 2024; PM2.5 ends 2023; water stress ends 2022; renewable
    final energy ends 2021; basic water and sanitation end 2016 in this archive.
  * The 2024 WDI electricity-access decline to 98.4% is retained; its substantive
    versus measurement/revision interpretation remains unresolved.

Reproduction (no network required after source archive exists)
  Python packages: xlrd==2.0.2, openpyxl==3.1.5, et-xmlfile==2.0.0.
  These exact versions are pinned in scripts/requirements.txt. No new install is needed
  in the current session; all three are in the temporary dependency directory.
  The current scripts also look in /private/tmp/argentina-research-deps for these.
  Alternatively install in an isolated environment and invoke that Python:
    python scripts/build_dataset.py
    python scripts/write_papers.py
    python scripts/verify_research.py

The source retrieval script downloads exact bytes and refuses to overwrite differing
existing bytes. Use a NEW dated directory for an update or new source vintage. The
reviewed data/sources.json is the authoritative final manifest. Retrieval records under
data/source-records mirror the final normalized manifest, including the exact retrieval
metadata and correctly identified CSV/access-page formats. Original source IDs persist.

Release dates remain null when unestablished. Dataset-level WDI last-updated dates are
stored separately and are not misrepresented as individual observation release dates.
All sources include exact URLs, archived relative paths, retrieval timestamps and SHA256.
Derived PDF-to-text files are convenient reading aids, not independent primary sources.

Review
  Numerical extraction, source integrity, local links and shared schema were checked.
  Independent source review checked INDEC poverty values, confidence intervals and
  the producer's year-on-year significance statement, Fanning thresholds/normalization,
  the UNEP projection cutoff, 221 WDI/derived rows and 52 carbon rows. The two wording
  corrections from that review (preliminary carbon vintage and GDP versus household
  income) are incorporated. See data/independent-review.json for scope and limitations.
  These are working manuscripts, not peer-reviewed publications or an approved policy
  recommendation. No unsupported causal interpretation is an authorized finding.

Visual QA PNGs are private at /private/tmp/deep-fryer-private-20261029/argentina-paper-qa.
The browser QA script requires Node22+ with built-in WebSocket and a local Chrome binary.
It writes QA screenshots privately; render-verification.json records viewport checks only.

Figures and print editions
  Standalone SVG figures: figures/*.svg, generated by scripts/plot_figures.py
  with matplotlib==3.6.2 (used from an existing local Python environment).
  Regenerate HTML after figures: python scripts/write_papers.py.
  Print from repository root: node research/argentina-2026-10-29/scripts/print-papers.mjs
  This reuses installed Chromium through scripts/chromium-path.mjs; no browser install.
  Output goes to output/pdf/; reviewed copies publish from papers/.
  All 18 final pages were rendered with Poppler and visually inspected.
