import { buildResearchPages } from './build-research-pages.mjs';
import { readFile, writeFile, mkdir, copyFile, cp, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { validatePublicInvolvement } from './public-involvement.mjs';
import { dimensionState, dimensionStatus, hasValue, regionSummary } from '../site/portrait-presentation.js';
import { validateRelease, escapeHtml as h, inside, publicAssetPath, indicatorAssets } from './pages-contract.mjs';
const source = path.resolve('site');
const output = path.resolve('dist/pages');
// Use the same value/unit rules as the server application and emit that exact
// formatter for browser hover summaries; keep TypeScript out of the public runtime.
const formatterCode = ts.transpileModule(await readFile('packages/core/src/format.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
}).outputText;
const { formatIndicatorValue } = await import(`data:text/javascript;base64,${Buffer.from(formatterCode).toString('base64')}`);
function indicatorValue(indicator) {
  return formatIndicatorValue(indicator.kind === 'observation' && indicator.value !== null
    ? Number(indicator.value.toFixed(1)) : indicator.value, indicator.unit);
}
const text = await readFile(path.join(source, 'data/portraits.json'), 'utf8');
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
for (const name of ['site.css', 'site.js', 'portrait-presentation.js']) await copyFile(path.join(source, name), path.join(output, 'assets', name));
await copyFile('apps/web/components/doughnut/doughnut-renderer.js', path.join(output, 'assets/doughnut-renderer.js'));
await mkdir(path.join(output, 'data'), { recursive: true });
await copyFile(path.join(source, 'data/portraits.json'), path.join(output, 'data/portraits.json'));
await copyFile(path.join(source, 'data/evidence-manifest.json'), path.join(output, 'data/evidence-manifest.json'));
for (const asset of requiredAssets) { await mkdir(path.dirname(inside(output, asset)), { recursive: true }); await copyFile(inside(source, asset), inside(output, asset)); }
await writeFile(path.join(output, '.nojekyll'), '');
const status = { published: 'Published portrait', 'legacy-source': 'Existing source portrait', 'research-preview': 'Research preview', 'source-supported-observation': 'Observed · no scoring target', 'source-supported-draft': 'Source-supported draft · not approved', uncertain: 'Uncertain · evidence incomplete', gap: 'Data gap' };
function portraitBadge(portrait) {
  return portrait.research_update ? '<span class="tag research-preview">Updated research preview</span>' : `<span class="tag ${h(portrait.status)}">${h(status[portrait.status])}</span>`;
}
function shell(title, prefix, body, data) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Explore social and ecological wellbeing through evidence-backed doughnut portraits."><title>${h(title)} · deep-fryer</title><link rel="stylesheet" href="${prefix}assets/site.css"></head><body><a class="skip" href="#main">Skip to content</a><header><a class="brand" href="${prefix}"><span aria-hidden="true">◉</span> deep-fryer</a><nav><a href="${prefix}#portraits">Portraits</a><a href="${prefix}policies/">Policy evidence</a><a href="${prefix}#method">Method</a><a href="https://github.com/jglasskatz/deep-fryer">Source code ↗</a></nav></header><main id="main">${body}</main><footer>Built with deep-fryer · <a href="${prefix}data/portraits.json">Download this data snapshot</a> · <a href="${prefix}data/evidence-manifest.json">Evidence checksums</a><p>Snapshot captured ${h(release.captured_at)}. Source years vary by indicator.</p></footer>${data ? `<script id="portrait-data" type="application/json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script><script type="module" src="${prefix}assets/site.js"></script>` : ''}</body></html>`;
}
const groups = [...new Set(release.portraits.map(p => p.group))];
const cards = groups.map(group => `<section><h2>${h(group)}</h2><div class="cards">${release.portraits.filter(p => p.group === group).map(p => `<a class="card" href="${p.slug}/">${portraitBadge(p)}<h3>${h(p.name)}</h3><p>${h(regionSummary(p))}</p><span class="card-link">Explore portrait →</span></a>`).join('')}</div></section>`).join('');
await writeFile(path.join(output, 'index.html'), shell('Doughnut portraits', '', `<section class="hero"><p class="eyebrow">PEOPLE · PLACE · PLANET</p><h1>A good life.<br>Within our planet’s limits.</h1><p class="lead">Explore what communities need to thrive, where ecological pressures are too high, and what the evidence can—and cannot—tell us.</p><a class="button" href="#portraits">Explore the portraits ↓</a><div class="hero-ring" aria-hidden="true"></div></section><div id="portraits">${cards}</div><section class="method"><p class="eyebrow">LONGITUDINAL RESEARCH</p><h2>Argentina through time.</h2><p>A partial social Doughnut and ecological trends, with fixed benchmarks, explicit gaps and original sources. Follow the evidence from 2013 onward.</p><a class="button" href="research/argentina/">Explore the research portrait →</a></section><section id="method" class="method"><p class="eyebrow">HOW TO READ A PORTRAIT</p><h2>The space between two boundaries.</h2><p>The inner ring describes social foundations. The outer ring describes ecological ceilings. Colored wedges show shortfalls or overshoots against the portrait’s documented thresholds. Slate segments mark available values without a score. Grey segments mark data gaps. Neither is treated as zero or as a safe result.</p><p>Every dimension includes all of its indicators, source dates, geography and available evidence. Updated portraits combine the existing baseline with independently checked research amendments. Each indicator retains its own review status. Findings without a defensible target remain unscored; updated findings remain provisional until reviewed for publication.</p><p>A doughnut portrait brings local evidence together to help communities discuss priorities and find ways to take part. Explore a dimension to see its measures, sources, limitations and ways to get involved.</p></section>`));
function supportingSources(indicator) {
  if (!indicator.supporting_evidence?.length) return '';
  return `<details class="supporting-sources"><summary>Supporting source exhibits</summary><ul>${indicator.supporting_evidence.map(source => `<li>${h(source.label)} · <a href="${h(source.source_url)}" rel="noopener noreferrer">Original source ↗</a> · <a href="../${h(source.evidence_path)}">Archived screenshot</a>${source.pdf_path ? ` · <a href="../${h(source.pdf_path)}">Archived PDF</a>` : ''}</li>`).join('')}</ul></details>`;
}
function dimensionLinks(portrait) {
  return `<section class="dimension-explorer" aria-labelledby="explore-heading"><h2 id="explore-heading">Explore the dimensions</h2><p>Select a dimension to read its values, sources and ways to get involved.</p><div class="dimension-groups">${['social', 'ecological'].map(ring => `<section><h3>${ring === 'social' ? 'Social foundation' : 'Ecological ceiling'}</h3><div class="dimension-links">${portrait.dimensions.filter(d => d.ring === ring).map(d => {
    const first = d.indicators.find(hasValue) || d.indicators[0];
    const value = first ? `${indicatorValue(first)}${first.year ? ` (${first.year})` : ''}` : 'Data needed';
    const state = dimensionState(d);
    return `<a href="#dim-${d.slug}" aria-label="${h(d.name)}" aria-describedby="summary-${d.slug}" aria-controls="detail-panel" data-evidence-state="${state}"><span class="dimension-name">${h(d.name)}</span><span id="summary-${d.slug}" class="dimension-summary"><span class="dimension-status ${state}">${h(dimensionStatus(d))}</span><span class="dimension-headline">${h(value)}</span></span></a>`;
  }).join('')}</div></section>`).join('')}</div></section>`;
}
function indicatorDetails(i) {
  const unscored = i.kind === 'observation' && hasValue(i);
  const limitation = unscored ? 'Value available, but no defensible scoring target. It is not scored.'
    : i.status === 'uncertain' ? 'Evidence is incomplete. Treat this finding as provisional.'
    : !hasValue(i) ? 'No acceptable value is available for this measure.' : '';
  return `<section class="indicator"><div>
    <span class="tag ${h(i.status)}">${h(status[i.status])}</span><h3>${h(i.name)}</h3>
    <p class="value">${h(indicatorValue(i))}</p>
    <p class="meta">${i.year ? `${i.kind === 'observation' ? 'Period ending' : 'Data year'}: ${h(i.year)} · ` : ''}${h(i.geography || 'Geography: see source notes')}</p>
    ${limitation ? `<p class="evidence-caution">${h(limitation)}</p>` : ''}
    ${i.quality_flags?.length ? `<p class="missing">${i.quality_flags.map(h).join(' · ')}</p>` : ''}
    ${i.target != null ? `<p class="target">Target: ${h(formatIndicatorValue(i.target, i.unit))}</p>` : ''}
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
  <ul class="status-legend" aria-label="Chart legend"><li><span class="legend-swatch within" aria-hidden="true"></span>Green: within target</li><li><span class="legend-swatch outside" aria-hidden="true"></span>Red: shortfall or overshoot</li><li><span class="legend-swatch unscored" aria-hidden="true"></span>Slate: value available, no score</li><li><span class="legend-swatch unknown" aria-hidden="true"></span>Grey: data needed</li><li><span class="legend-swatch selected" aria-hidden="true"></span>Blue: selected dimension</li></ul>
  <details class="chart-explanation"><summary>What the rings and scores mean</summary><p>Inner ring: social foundation. Outer ring: ecological ceiling.</p><p>A dimension may contain several measures. Its wedge shows the published aggregate or worst supported draft score. A missing measure remains a gap even when another measure is available. Unscored values have no wedge score.</p></details></div>
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

