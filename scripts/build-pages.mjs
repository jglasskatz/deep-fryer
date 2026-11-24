import { publicRelease } from './research-overlays.mjs';
import { portraitImports } from './portrait-imports.mjs';
import { buildResearchPages } from './build-research-pages.mjs';
import { readFile, writeFile, mkdir, copyFile, cp, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { validatePublicInvolvement } from './public-involvement.mjs';
import { dimensionState, dimensionStatus, displayIndicatorValue, hasValue, isNoisyHeatMean, regionSummary } from '../site/portrait-presentation.js';
import { validateRelease, escapeHtml as h, inside, publicAssetPath, indicatorAssets, assertNoLiveArchives } from './pages-contract.mjs';
import { isRenderable, publishedArchiveName } from '../site/published-name.js';
const source = path.resolve('site');
const output = path.resolve('dist/pages');
// Use the same value/unit rules as the server application and emit that exact
// formatter for browser hover summaries; keep TypeScript out of the public runtime.
const formatterCode = ts.transpileModule(await readFile('packages/core/src/format.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
}).outputText;
const { formatIndicatorValue } = await import(`data:text/javascript;base64,${Buffer.from(formatterCode).toString('base64')}`);
function indicatorValue(indicator) {
  return displayIndicatorValue(indicator, formatIndicatorValue);
}
const text = JSON.stringify(publicRelease(), null, 2) + '\n';
const release = validateRelease(JSON.parse(text));
const involvement = validatePublicInvolvement(JSON.parse(await readFile(path.join(source, 'data/involvement.json'), 'utf8')), release.portraits);
const manifest = JSON.parse(await readFile(path.join(source, 'data/evidence-manifest.json'), 'utf8'));
const requiredAssets = new Set(release.portraits.flatMap(p => p.dimensions.flatMap(d => d.indicators.flatMap(indicatorAssets))));
for (const asset of requiredAssets) {
  publicAssetPath(asset);
  const local = inside(source, asset);
  if (!(await realpath(local)).startsWith(await realpath(source) + path.sep)) throw new Error('Symlink escapes source root');
  const bytes = await readFile(local);
  if (manifest[asset]?.sha256 !== createHash('sha256').update(bytes).digest('hex') || manifest[asset]?.bytes !== bytes.length) throw new Error(`Evidence integrity mismatch: ${asset}`);
}
// Remove only this generated output after all data/evidence checks succeed.
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
await writeFile(path.join(output, 'assets/format.js'), formatterCode);
for (const name of ['site.css', 'site.js', 'portrait-presentation.js', 'policy-slider.js']) await copyFile(path.join(source, name), path.join(output, 'assets', name));
await copyFile('apps/web/components/doughnut/doughnut-renderer.js', path.join(output, 'assets/doughnut-renderer.js'));
await mkdir(path.join(output, 'data'), { recursive: true });
await writeFile(path.join(output, 'data/portraits.json'), text);
await copyFile(path.join(source, 'data/evidence-manifest.json'), path.join(output, 'data/evidence-manifest.json'));
for (const asset of requiredAssets) { await mkdir(path.dirname(inside(output, asset)), { recursive: true }); await copyFile(inside(source, asset), inside(output, asset)); }
for (const { directory, files } of portraitImports) {
  await mkdir(path.join(output, directory), { recursive: true });
  // A pinned third-party script (San Francisco's data.js) is published as text, never as a runnable file.
  for (const name of files) await copyFile(path.join(source, directory, name), path.join(output, directory, publishedArchiveName(name)));
}
await writeFile(path.join(output, '.nojekyll'), '');
const status = { published: 'Published portrait', 'legacy-source': 'Existing source portrait', 'research-preview': 'Research preview', 'source-supported-observation': 'Observed · no scoring target', 'source-supported-draft': 'Source-supported draft · not approved', uncertain: 'Uncertain · evidence incomplete', gap: 'Data gap' };
function portraitBadge(portrait) {
  return portrait.research_update ? '<span class="tag research-preview">Updated research preview</span>' : `<span class="tag ${h(portrait.status)}">${h(status[portrait.status])}</span>`;
}
// A community fork shares the checked imports' status, so its collection card says what it is before anyone opens it.
const cardBadge = portrait => portrait.data_import?.kind === 'community-fork' ? '<span class="tag legacy-source community-fork">Community data · not checked</span>' : portraitBadge(portrait);
function shell(title, prefix, body, data, extraScripts = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Explore social and ecological wellbeing through evidence-backed doughnut portraits."><title>${h(title)} · deep-fryer</title><link rel="stylesheet" href="${prefix}assets/site.css"></head><body><a class="skip" href="#main">Skip to content</a><header><a class="brand" href="${prefix}"><span aria-hidden="true">◉</span> deep-fryer</a><nav><a href="${prefix}#portraits">Portraits</a><a href="${prefix}policies/">Policy evidence</a><a href="${prefix}#method">Method</a><a href="https://github.com/jglasskatz/deep-fryer">Source code ↗</a></nav></header><main id="main">${body}</main><footer>Built with deep-fryer · <a href="${prefix}data/portraits.json">Download this data snapshot</a> · <a href="${prefix}data/evidence-manifest.json">Evidence checksums</a><p>Snapshot captured ${h(release.captured_at)}. Source years vary by indicator.</p></footer>${data ? `<script id="portrait-data" type="application/json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script><script type="module" src="${prefix}assets/site.js"></script>` : ''}${extraScripts}</body></html>`;
}
const policyAtlas = JSON.parse(await readFile(path.join(source, 'policy-view/policy-data.json'), 'utf8'));
const policyById = new Map(policyAtlas.policies.map(p => [p.id, p]));
function baselineFor(slug) {
  const portrait = release.portraits.find(p => p.slug === slug);
  if (!portrait) throw new Error(`Missing baseline portrait for policy slider: ${slug}`);
  return portrait.dimensions.map(d => ({
    slug: d.slug,
    name: d.slug === 'nitrogen-phosphorus-loading' ? 'Nitrogen & Phosphorus' : d.name.replace(/\b[a-z]/g, ch => ch.toUpperCase()),
    ring: d.ring,
    level: d.level,
    unscored: dimensionState(d) === 'unscored',
  }));
}
function sliderCase(spec) {
  const record = policyById.get(spec.id);
  if (!record) throw new Error(`Missing policy study in policy-data.json: ${spec.id}`);
  const baseline = baselineFor(spec.portraitSlug);
  const nameBySlug = new Map(baseline.map(d => [d.slug, d.name]));
  const primarySource = record.sources[spec.sourceIndex ?? 0];
  return {
    id: record.id,
    place: spec.place,
    title: record.title,
    shortLabel: spec.shortLabel,
    year: spec.year,
    jurisdiction: record.jurisdiction,
    mechanism: record.mechanism,
    baselineMetric: spec.baselineMetric,
    observedShift: spec.observedShift,
    evidenceGrade: record.tierLabel,
    evidenceKind: record.headline.kind,
    caveat: spec.caveat,
    source: { title: primarySource.title, url: primarySource.url },
    baseline,
    impacts: spec.impacts.map(impact => ({ ...impact, name: nameBySlug.get(impact.slug) ?? impact.slug })),
    sliderReadout: spec.sliderReadout,
  };
}
const landingPolicies = [
  sliderCase({
    id: 'sc-water-rationing',
    portraitSlug: 'santa-cruz',
    place: 'Santa Cruz, CA',
    shortLabel: 'SC · Water rationing',
    year: '2014 response',
    baselineMetric: '95% surface-water dependent; same-month 2013 service-area demand baseline',
    observedShift: '−26% average monthly water use (Jun–Nov 2014 vs Jun–Nov 2013; 47 gal/person/day residential)',
    caveat: 'Utility service-area result (not city limits or whole county) with no untreated comparison: drought, publicity, restrictions, and price responses cannot be separated, and ecological streamflow closure was not measured.',
    impacts: [
      { slug: 'freshwater-withdrawals', direction: 'improves', afterLevel: 24, note: 'Observed 26% average monthly demand savings across the utility service area (Jun–Nov 2014).' },
      { slug: 'water-sanitation', direction: 'mixed', afterLevel: -50, note: 'Affordability and fixed revenue-recovery fee pressures on lower-income households were not locally quantified.' },
    ],
    sliderReadout: { before: '2013 service-area baseline (0% emergency cut)', after: '−26% avg monthly use (47 gal/person/day)' },
  }),
  sliderCase({
    id: 'sc-adu-reform',
    portraitSlug: 'santa-cruz',
    place: 'Santa Cruz County, CA',
    shortLabel: 'SC · ADU reform',
    year: '2018–2021 + state laws',
    sourceIndex: 2,
    baselineMetric: '28 annual ADU building permits issued in 2017 (unincorporated county); Housing baseline unscored',
    observedShift: '28 → 103 annual ADU permits (2017 to 2024; 2024 count includes one tiny home on wheels)',
    caveat: 'Permitting output only — not completed or occupied homes, and no rent-reduction estimate. State/local laws shifted alongside demand and credit conditions; Housing stays unscored without an invented threshold.',
    impacts: [
      { slug: 'housing', direction: 'improves', afterLevel: null, note: 'Unscored baseline dimension: annual permits rose from 28 (2017) to 103 (2024), highlighted directionally without inventing a threshold score.' },
    ],
    sliderReadout: { before: '28 annual ADU permits (2017)', after: '103 annual ADU permits (2024)' },
  }),
  sliderCase({
    id: 'nyc-right-to-counsel',
    portraitSlug: 'nyc',
    place: 'New York City, NY',
    shortLabel: 'NYC · Right to Counsel',
    year: '2017 law (Local Law 136)',
    baselineMetric: '51.6% renter households cost-burdened · 101.9 unhoused per 10,000 residents (NYC baseline)',
    observedShift: '−1.0 pp eviction probability across housing-court cases during rollout (−8.4 pp IV local effect among induced tenants; 727,692 cases)',
    caveat: 'Early-rollout estimate, not current effectiveness: NYC Comptroller (May 2025) found representation fell from 71% (Q4 FY21) to 42% (Q4 FY24), and from 81% to 31% in the Bronx. No measured homelessness or long-run rent effect.',
    impacts: [
      { slug: 'housing', direction: 'improves', afterLevel: 86, note: '−1.0 pp reduced-form eviction probability across targeted ZIP cases (−8.4 pp IV local effect among represented compliers).' },
      { slug: 'peace-justice', direction: 'improves', afterLevel: 90, note: '+12.4 pp first-stage representation probability; +85 days to judgment in primary IV specification.' },
      { slug: 'social-equity', direction: 'mixed', afterLevel: 72, note: 'Larger estimated gains for high-risk tenants, but post-2021 representation gaps concentrated in the Bronx.' },
    ],
    sliderReadout: { before: 'Pre-rollout housing-court baseline (2016)', after: '−1.0 pp rollout eviction probability (−8.4 pp IV)' },
  }),
  sliderCase({
    id: 'nyc-clean-heat',
    portraitSlug: 'nyc',
    place: 'New York City, NY',
    shortLabel: 'NYC · Clean Heat',
    year: '2011–2015',
    baselineMetric: '6.26 µg/m³ annual mean PM2.5 (NYC portrait; 2011 pre-conversion NYCCAS surface)',
    observedShift: '−0.12 µg/m³ ambient PM2.5 (95% CI −0.15 to −0.09), −0.28 ppb SO₂, and −0.29 ppb NO₂ per 10 converted buildings/tract',
    caveat: 'Per-10-building tract coefficient is not a total citywide causal effect. A separate 48-apartment study found unchanged indoor PM2.5 (12.8 µg/m³, p = .99); avoided deaths cited by officials are modeled, not counted.',
    impacts: [
      { slug: 'air-pollution', direction: 'improves', afterLevel: 30, note: 'Adjusted ambient reductions of −0.12 µg/m³ PM2.5, −0.28 ppb SO₂, and −0.29 ppb NO₂ per 10 converted buildings/tract.' },
      { slug: 'health', direction: 'mixed', afterLevel: 100, note: 'Held steady: ambient pollution associations do not establish indoor exposure or counted mortality gains.' },
    ],
    sliderReadout: { before: '2011 pre-phaseout ambient baseline', after: '−0.12 µg/m³ PM2.5 per 10 converted buildings/tract' },
  }),
  sliderCase({
    id: 'nyc-universal-school-meals',
    portraitSlug: 'nyc',
    place: 'New York City, NY',
    shortLabel: 'NYC · School meals',
    year: '2017 citywide (2010–2013 eval)',
    baselineMetric: '16.8% food insecurity · 64.0% poor / 45.6% non-poor middle-school reference lunch uptake',
    observedShift: '+5.4 pp lunch participation for poor students (+11.0 pp non-poor); +0.032 to +0.083 SD math test scores',
    caveat: 'Evaluated earlier 2010–2013 middle-school provision, not the 2017 citywide rollout. Household food security, nutritional sufficiency, and meal-production ecological footprints were not measured.',
    impacts: [
      { slug: 'food', direction: 'improves', afterLevel: 82, note: '+5.4 pp lunch participation among poor middle-school students (+11.0 pp non-poor); food security itself not measured.' },
      { slug: 'education', direction: 'improves', afterLevel: 58, note: 'Math +0.032 SD (poor) / +0.083 SD (non-poor) and ELA +0.027 / +0.059 SD under DiD identifying assumptions.' },
    ],
    sliderReadout: { before: 'Means-tested lunch baseline (64.0% poor uptake)', after: '+5.4 pp poor / +11.0 pp non-poor lunch uptake' },
  }),
];
const initialPolicy = landingPolicies[0];
const policySliderSection = `<section id="policy-slider" class="policy-slider" aria-labelledby="policy-slider-heading"><p class="eyebrow">POLICY EVIDENCE EXPLORER</p><h2 id="policy-slider-heading">Compare before and after real local policies.</h2><p class="lead-sub">Slide between a city’s real baseline doughnut and source-checked retrospective policy outcomes from Santa Cruz and New York City — with research design, scope limits, and primary citations alongside the chart.</p><div class="policy-tabs" role="tablist" aria-label="Researched city policies">${landingPolicies.map((p, idx) => `<button type="button" role="tab" data-policy-id="${h(p.id)}" aria-selected="${idx === 0 ? 'true' : 'false'}">${h(p.shortLabel)}</button>`).join('')}</div><div class="policy-grid"><div class="policy-chart-card"><canvas id="policy-doughnut" width="560" height="560" role="img" aria-label="${h(initialPolicy.place)} doughnut showing ${h(initialPolicy.title)} (Before (baseline portrait))."></canvas><div class="policy-controls"><div class="policy-controls-head"><label for="policy-range">Before ↔ With policy</label><span id="policy-state" aria-live="polite">Before (baseline portrait)</span></div><div class="policy-range-row"><button type="button" class="policy-preset" data-policy-preset="0" aria-pressed="true">Before</button><input id="policy-range" type="range" min="0" max="100" step="1" value="0" aria-valuetext="Before policy: ${h(initialPolicy.sliderReadout.before)}"><button type="button" class="policy-preset" data-policy-preset="100" aria-pressed="false">With policy</button></div><p class="policy-active-line"><strong>Active view:</strong> <span id="policy-active-view">${h(initialPolicy.sliderReadout.before)}</span></p><p class="policy-disclaimer">Wedge movement illustrates direction and study scale — none of these studies directly establishes a Doughnut threshold crossing.</p></div></div><div class="policy-detail-card" role="tabpanel" aria-label="Policy evidence details"><div class="policy-badges"><span id="policy-place" class="policy-badge">${h(initialPolicy.place)}</span><span id="policy-year" class="policy-badge">${h(initialPolicy.year)}</span><span id="policy-grade" class="policy-badge grade">${h(initialPolicy.evidenceGrade)}</span></div><h3 id="policy-title">${h(initialPolicy.title)}</h3><p id="policy-scope" class="policy-scope">${h(initialPolicy.jurisdiction)} · ${h(initialPolicy.evidenceKind)}</p><p id="policy-mechanism" class="policy-mechanism">${h(initialPolicy.mechanism)}</p><dl class="policy-metrics"><div id="policy-baseline-box" class="policy-metric-box" data-active="true"><dt>Baseline (Before)</dt><dd id="policy-baseline">${h(initialPolicy.baselineMetric)}</dd></div><div id="policy-shift-box" class="policy-metric-box" data-active="false"><dt>Observed shift (With policy)</dt><dd id="policy-shift">${h(initialPolicy.observedShift)}</dd></div></dl><h4 class="policy-impacts-heading">Highlighted doughnut dimensions</h4><ul id="policy-impacts" class="policy-impacts">${initialPolicy.impacts.map(impact => `<li><div class="policy-impact-head"><strong>${h(impact.name)}</strong><span class="policy-direction ${h(impact.direction)}">${impact.direction === 'improves' ? 'Directional improvement' : 'Mixed / tradeoff'}</span></div><p>${h(impact.note)}</p></li>`).join('')}</ul><div class="policy-caveat"><strong>Scope &amp; caveat</strong><p id="policy-caveat">${h(initialPolicy.caveat)}</p></div><p class="policy-source"><strong>Primary source:</strong> <a id="policy-source" href="${h(initialPolicy.source.url)}" target="_blank" rel="noopener noreferrer">${h(initialPolicy.source.title)} ↗</a></p><p class="policy-atlas-link"><a href="policies/">Explore all 10 policy case studies and evaluator →</a></p></div></div></section>`;
const policySliderScripts = `<script id="policy-slider-data" type="application/json">${JSON.stringify(landingPolicies).replaceAll('<', '\\u003c')}</script><script type="module" src="assets/policy-slider.js"></script>`;
const groups = [...new Set(release.portraits.map(p => p.group))];
const cards = groups.map(group => `<section><h2>${h(group)}</h2><div class="cards">${release.portraits.filter(p => p.group === group).map(p => `<a class="card" href="${p.slug}/">${cardBadge(p)}<h3>${h(p.name)}</h3><p>${h(regionSummary(p))}</p><span class="card-link">Explore portrait →</span></a>`).join('')}</div></section>`).join('');
await writeFile(path.join(output, 'index.html'), shell('Doughnut portraits', '', `<section class="hero"><p class="eyebrow">PEOPLE · PLACE · PLANET</p><h1>A good life.<br>Within our planet’s limits.</h1><p class="lead">Explore what communities need to thrive, where ecological pressures are too high, and what the evidence can—and cannot—tell us.</p><a class="button" href="#portraits">Explore the portraits ↓</a><div class="hero-ring" aria-hidden="true"></div></section><div id="portraits">${cards}</div>${policySliderSection}<section id="method" class="method"><p class="eyebrow">HOW TO READ A PORTRAIT</p><h2>The space between two boundaries.</h2><p>The inner ring describes social foundations. The outer ring describes ecological ceilings. Colored wedges show shortfalls or overshoots against the portrait’s documented thresholds. Dark grey segments mark available values without a score. Grey segments mark data gaps. Neither is treated as zero or as a safe result.</p><p>Every dimension includes all of its indicators, source dates, geography and available evidence. Updated portraits combine the existing baseline with independently checked research amendments. Each indicator retains its own review status. Findings without a defensible target remain unscored; updated findings remain provisional until reviewed for publication.</p><p>A doughnut portrait brings local evidence together to help communities discuss priorities and find ways to take part. Explore a dimension to see its measures, sources, limitations and ways to get involved.</p></section>`, null, policySliderScripts));
function supportingSources(indicator) {
  if (!indicator.supporting_evidence?.length) return '';
  return `<details class="supporting-sources"><summary>Supporting source exhibits</summary><ul>${indicator.supporting_evidence.map(source => `<li>${h(source.label)} · <a href="${h(source.source_url)}" rel="noopener noreferrer">Original source ↗</a> · <a href="../${h(source.evidence_path)}">Archived screenshot</a>${source.pdf_path ? ` · <a href="../${h(source.pdf_path)}">Archived PDF</a>` : ''}</li>`).join('')}</ul></details>`;
}
function dimensionLinks(portrait) {
  return `<section class="dimension-explorer" aria-labelledby="explore-heading"><h2 id="explore-heading">Explore the dimensions</h2><p>Select a dimension to read its values, sources and ways to get involved.</p><div class="dimension-groups">${['social', 'ecological'].map(ring => `<section><h3>${ring === 'social' ? 'Social foundation' : 'Ecological ceiling'}</h3><div class="dimension-links">${portrait.dimensions.filter(d => d.ring === ring).map(d => {
    const first = d.indicators.find(hasValue) || d.indicators[0];
    const value = first ? `${first.value_label ? `${first.value_label}: ` : ''}${indicatorValue(first)}${first.year ? ` (${first.year})` : ''}` : 'Data needed';
    const state = dimensionState(d);
    return `<a href="#dim-${d.slug}" aria-label="${h(d.name)}" aria-describedby="summary-${d.slug}" aria-controls="detail-panel" data-evidence-state="${state}"><span class="dimension-name">${h(d.name)}</span><span id="summary-${d.slug}" class="dimension-summary"><span class="dimension-status ${state}">${h(dimensionStatus(d))}</span><span class="dimension-headline">${h(value)}</span></span></a>`;
  }).join('')}</div></section>`).join('')}</div></section>`;
}
function indicatorDetails(i) {
  const native = i.report_measurement ?? i.source_worksheet;
  const unscored = i.kind === 'observation' && hasValue(i);
  const limitation = unscored ? 'Value available, but no defensible scoring target. It is not scored.'
    : i.status === 'uncertain' ? 'Evidence is incomplete. Treat this finding as provisional.'
    : !hasValue(i) ? 'No acceptable value is available for this measure.' : '';
  return `<section class="indicator"><div>
    <span class="tag ${h(i.status)}">${h(status[i.status])}</span><h3>${h(i.name)}</h3>
    ${i.value_label ? `<p class="meta">${h(i.value_label)}</p>` : ''}
    <p class="value">${h(indicatorValue(i))}</p>
    ${isNoisyHeatMean(i) ? '<p class="value-note">Rounded to 1 decimal place from the CDC EJI tract-weighted county mean; exact value and method in Definition and limitations below.</p>' : ''}
    ${native ? `<section class="source-worksheet"><h4>${i.report_measurement ? `2025 report · page ${h(i.report_verification.page)}` : 'Original worksheet'}</h4>${native.definition ? `<p class="native-definition">Native measurement definition: ${h(native.definition)}</p>` : ''}<p>Native measurement: ${h(native.value == null ? 'Not supplied' : formatIndicatorValue(native.value, ['%', 'Yes/No'].includes(native.unit) ? '' : native.unit))}</p><p>Native target: ${h(native.target == null ? 'Not supplied' : formatIndicatorValue(native.target, ['%', 'Yes/No'].includes(native.unit) ? '' : native.unit))}</p><p>${i.report_measurement ? 'Measured period' : 'Measured / published'}: ${h(native.period)}</p>${native.notes ? `<p>${h(native.notes)}</p>` : ''}</section>` : ''}
    ${i.report_verification ? `<details class="original-import"><summary>Original import provenance</summary><p>Imported native value: ${h(i.source_worksheet.value ?? 'Not supplied')}</p><p>Imported measured / published: ${h(i.source_worksheet.period)}</p>${i.imported_percentage?.origin === 'category-average-fallback' ? `<p class="imported-percentage">Archived category average (not indicator overshoot): ${h(i.imported_percentage.value)}%</p>` : `<p>Imported indicator score: ${h(i.imported_percentage?.value == null ? 'Not supplied' : `${i.imported_percentage.value}%`)}</p>`}${i.legacy_record.source_url ? `<p><a href="${h(i.legacy_record.source_url)}" rel="noopener noreferrer">Original underlying source ↗</a></p>` : ''}</details>` : ''}
    <p class="meta">${i.year ? `${i.kind === 'observation' ? 'Period ending' : 'Data year'}: ${h(i.year)} · ` : ''}${h(i.geography || 'Geography: see source notes')}</p>
    ${limitation ? `<p class="evidence-caution">${h(limitation)}</p>` : ''}
    ${i.quality_flags?.length ? `<p class="missing">${i.quality_flags.map(h).join(' · ')}</p>` : ''}
    ${i.target != null && !i.source_worksheet ? `<p class="target">Target: ${h(formatIndicatorValue(i.target, i.unit))}</p>` : ''}
    <p class="sources">${i.source_url ? `<a href="${h(i.source_url)}" rel="noopener noreferrer">${h(i.source || 'Original source')} ↗</a>` : h(i.source || '')}${i.pdf_path ? ` · <a href="../${h(i.pdf_path)}">Archived PDF</a>` : ''}</p>
    ${i.notes || i.unscored_reason ? `<details class="evidence-details"><summary>Definition and limitations</summary>${i.unscored_reason ? `<p>${h(i.unscored_reason)}</p>` : ''}${i.notes ? `<p>${h(i.notes)}</p>` : ''}</details>` : ''}
    ${i.evidence_path ? `<details class="evidence-details"><summary>View archived source</summary><a class="exhibit" href="../${h(i.evidence_path)}"><img loading="lazy" src="../${h(i.evidence_path)}" alt="Archived source for ${h(i.name)}"><span>Open full evidence snapshot ↗</span></a></details>` : hasValue(i) ? '<p class="missing">Archived screenshot unavailable. Follow the original source.</p>' : ''}
    ${supportingSources(i)}
    ${i.scoring ? `<details class="evidence-details"><summary>Scoring calculation</summary><p>${h(i.scoring.worked_math || JSON.stringify(i.scoring))}</p></details>` : ''}
    ${i.review_note ? `<details class="evidence-details"><summary>Evidence review</summary><p>${h(i.review_note)}</p></details>` : ''}
    ${i.search_context ? `<details class="evidence-details"><summary>Search coverage</summary><p>${h(i.search_context)}</p></details>` : ''}
  </div></section>`;
}
function portraitNotice(portrait) {
  const preview = portrait.research_update || portrait.status === 'research-preview';
  if (portrait.data_import?.kind === 'community-fork') return `<details class="notice" open><summary>${portraitBadge(portrait)}<span>Community data · not checked or approved here.</span></summary><p>${h(portrait.notice)}</p><p>${portrait.data_import.downloads.map(file => `<a href="../${h(publishedArchiveName(file.path))}"${isRenderable(file.path) ? ' type="text/plain"' : ''}>${h(file.label)}${isRenderable(file.path) ? ' (source text)' : ''}</a>`).join(' · ')} · <a href="${h(portrait.provenance.repository)}/tree/${h(portrait.provenance.commit)}" rel="noopener noreferrer">Pinned commit ↗</a></p></details>`;
  if (portrait.data_import) return `<details class="notice" open><summary>${portraitBadge(portrait)}<span>${portrait.provenance.report_audit ? 'Checked against the 2025 report · not publication approved.' : 'Imported data · not newly verified or approved.'}</span></summary><p>${h(portrait.notice)}</p><p>${portrait.provenance.report_audit ? '<a href="../imports/california/report-audit.json">42-indicator report audit</a> · <a href="https://zenodo.org/records/17540639">2025 report ↗</a> · ' : ''}<a href="../imports/california/doughnut.json">Original app snapshot</a> · <a href="../imports/california/raw_social.csv">Social worksheet</a> · <a href="../imports/california/raw_ecological.csv">Ecological worksheet</a> · <a href="${h(portrait.provenance.repository)}/tree/${h(portrait.provenance.commit)}">Pinned source repository ↗</a></p></details>`;
  return `<details class="notice"><summary>${portraitBadge(portrait)}<span>${preview ? 'New findings await publication review.' : 'Sources, dates and coverage vary by measure.'}</span></summary>
    <p>${portrait.research_update ? 'This portrait combines an existing baseline with new findings. Baseline approval does not approve the amendments. Each measure retains its own review status.' : preview ? 'This is a provisional portrait. Findings require review before publication approval.' : 'Each measure links to its original source and available archived evidence.'} Values without a defensible target remain unscored; missing evidence remains a data gap.</p>
    <p>Open a dimension for source dates, geographic coverage and limitations. <a href="../#method">How to read the portrait</a>.</p></details>`;
}
function waysToParticipate(portrait, dimension) {
  const listings = involvement.filter(item => item.portrait_slug === portrait.slug && item.dimension_slugs.includes(dimension.slug));
  if (!dimension.actions?.length && !listings.length) return '';
  const kind = {volunteer:'Volunteer',services:'Get support',civic:'Have your say',organize:'Organize',other:'Take part'};
  return `<section class="ways-to-participate"><h3>Ways to get involved</h3>${dimension.actions?.length ? `<ul>${dimension.actions.map(action => `<li>${h(action)}</li>`).join('')}</ul>` : ''}${listings.length ? `<ul class="opportunities">${listings.map(item => `<li><span class="opportunity-kind">${h(kind[item.kind])}</span><h4><a href="${h(item.url)}" rel="noopener noreferrer">${h(item.name)} ↗</a></h4><p>${h(item.description)}</p><p class="meta">${h(item.geography)}</p><p class="participation-note">${h(item.participation_note)}</p><details><summary>Source and date checked</summary><p><a href="${h(item.source_url)}" rel="noopener noreferrer">Organizer’s source page ↗</a><br>Checked ${h(item.checked_at)}. Confirm current availability with the organizer.</p></details></li>`).join('')}</ul>` : ''}</section>`;
}
function portraitBody(portrait) {
  const available = portrait.dimensions.flatMap(d => d.indicators).filter(hasValue).length;
  const unscored = portrait.dimensions.filter(d => dimensionState(d) === 'unscored').length;
  const gaps = portrait.dimensions.flatMap(d => d.indicators).filter(i => !hasValue(i)).length + portrait.dimensions.filter(d => !d.indicators.length).length;
  const shortRegion = regionSummary(portrait);
  const details = portrait.dimensions.map(d => `<article class="dimension" id="dim-${d.slug}"><p class="eyebrow">${h(d.ring === 'social' ? 'Social foundation' : 'Ecological ceiling')}</p><h2>${h(d.name)}</h2><p class="dimension-score ${dimensionState(d)}">${h(dimensionStatus(d))}</p><p>${h(d.context || '')}</p>${!d.indicators.length ? '<p class="missing">No acceptable indicator is available for this dimension. Its score remains unknown.</p>' : ''}${d.indicators.map(indicatorDetails).join('')}${waysToParticipate(portrait, d)}</article>`).join('');
  return `<section class="portrait-heading"><a class="back" href="../">← All portraits</a><h1>${h(portrait.name)}</h1><p class="lead">${h(shortRegion)}</p>${portrait.region && shortRegion !== portrait.region ? `<details class="place-context"><summary>Geography and local context</summary><p>${h(portrait.region)}</p></details>` : ''}${portraitNotice(portrait)}</section>
  <section class="chart-section"><div class="chart-column"><div class="chart"><canvas id="doughnut" tabindex="-1" width="800" height="800" role="img" aria-label="Doughnut portrait for ${h(portrait.name)}. All dimensions and values are listed below."></canvas><div id="chart-tooltip" class="chart-tooltip" role="tooltip" hidden></div><p id="chart-hover" aria-live="polite">Select a segment or a dimension below to read its evidence.</p></div>${dimensionLinks(portrait)}</div>
  <div class="chart-key"><div id="panel-empty"><h2>Read the portrait</h2><p class="evidence-counts">${available} available values · ${gaps} data gaps<br>${unscored} dimensions with values but no score</p>
  <ul class="status-legend" aria-label="Chart legend"><li><span class="legend-swatch within" aria-hidden="true"></span>Green: within target</li><li><span class="legend-swatch outside" aria-hidden="true"></span>Red: shortfall or overshoot</li><li><span class="legend-swatch unscored" aria-hidden="true"></span>Dark grey: value available, score unknown</li><li><span class="legend-swatch unknown" aria-hidden="true"></span>Grey: data needed</li><li><span class="legend-swatch selected" aria-hidden="true"></span>Blue: selected dimension</li></ul>
  <details class="chart-explanation"><summary>What the rings and scores mean</summary><p>Inner ring: social foundation. Outer ring: ecological ceiling.</p>${portrait.data_import?.kind === 'community-fork' ? '<p>Wedges show the scores the source project assigned.</p>' : `<p>${portrait.data_import ? 'California wedges show the mean of both report percentages on Deep Fryer’s display scale, capped at 150. If either percentage is absent, the dimension remains unscored. The reported values are not a validated composite ranking.' : 'A dimension may contain several measures. Its wedge shows the published aggregate or worst supported draft score.'} A missing measure remains a gap even when another measure is available. Unscored values have no wedge score.</p>`}</details></div>
  <dialog id="detail-panel" class="detail-panel" aria-labelledby="panel-heading"><button type="button" class="panel-close" aria-label="Close dimension details">Close ×</button><div class="panel-content"></div></dialog></div></section><div class="dimension-list">${details}</div>`;
}
for (const portrait of release.portraits) {
  const related = release.portraits.filter(p => p.group === portrait.group);
  const hub = related[0].slug;
  const selector = `<section class="regional-navigation"><p class="eyebrow">Explore ${h(portrait.group)}</p><nav class="portrait-switcher" aria-label="${h(portrait.group)} portraits">${related.map(p => `<a href="../${p.slug}/" data-portrait="${p.slug}"${p.slug === portrait.slug ? ' aria-current="page"' : ''}>${h(p.name)}</a>`).join('')}</nav></section>`;
  const body = `${selector}<div id="selected-portrait">${portraitBody(portrait)}</div>${related.map(p => `<template id="portrait-${p.slug}">${portraitBody(p)}</template>`).join('')}`;
  await mkdir(path.join(output, portrait.slug), { recursive: true });
  await writeFile(path.join(output, portrait.slug, 'index.html'), shell(portrait.name, '../', body, { initial: portrait.slug, hub, portraits: related, statuses: status }));
}
await writeFile(path.join(output, '404.html'), shell('Page not found', './', '<h1>Page not found</h1><p><a href="./">Return to the portrait collection</a>.</p>'));
await writeFile(path.join(output, 'release.json'), JSON.stringify({ schema_version: 1, snapshot_sha256: createHash('sha256').update(text).digest('hex'), commit: process.env.GITHUB_SHA ?? null, portraits: release.portraits.map(p => p.slug), evidence_files: requiredAssets.size }, null, 2));

// Retrospective evidence stays separate from portrait scores and policy projections.
await cp(path.join(source, 'policy-view'), path.join(output, 'policies'), { recursive: true, errorOnExist: true, force: false });

console.log(`Built ${release.portraits.length} portraits with ${requiredAssets.size} checked evidence files in dist/pages.`);

const research = await buildResearchPages(output);
console.log(`Built Argentina research with ${research.indicators} indicators and ${research.sources} verified source archives.`);
assertNoLiveArchives(output);
console.log('No archived or imported file in research/, evidence/ or imports/ is published under a name a browser renders or runs.');

