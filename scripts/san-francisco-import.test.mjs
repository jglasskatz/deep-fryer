import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sanFranciscoPortrait, sanFranciscoSource, sanFranciscoSourceFiles, sanFranciscoFiles, dimensionSlug } from './san-francisco-import.mjs';
import { readJurisdictions } from './legacy-data-literal.mjs';
import { closestExistingPortrait, repeatedPlaceholders } from './import-checks.mjs';
import { overlayBaseline, publicRelease } from './research-overlays.mjs';
import { validateRelease } from './pages-contract.mjs';

const portrait = sanFranciscoPortrait();
const { manifest, jurisdictions } = sanFranciscoSource();
const dimension = slug => portrait.dimensions.find(d => d.slug === slug);
const rows = key => ['social', 'ecological'].flatMap(ring => jurisdictions[key][ring]);
const editedManifest = edit => { const copy = structuredClone(manifest); edit(copy); return { ...sanFranciscoFiles(), manifestText: JSON.stringify(copy) }; };

test('the pinned source file is byte-identical to its manifest', () => {
  assert.deepEqual(sanFranciscoSourceFiles.toSorted(), ['data.js', 'manifest.json']);
  const bytes = readFileSync('site/imports/san-francisco/data.js');
  assert.equal(bytes.length, 79628);
  assert.equal(bytes.length, manifest.files['data.js'].bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '2a18eca99b39838bbe054b80c106d9032eb289056d3f25b6e34e15ada020f531');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files['data.js'].sha256);
  assert.equal(manifest.commit, '5cce9f1cc476052b88c316d847926e0ad34b4b00');
  assert.equal(manifest.approved, false);
});

test('San Francisco keeps all 21 source dimensions, values, sources and actions', () => {
  assert.equal(portrait.slug, 'san-francisco');
  assert.equal(portrait.status, 'legacy-source');
  assert.equal(portrait.provenance.approved, false);
  assert.equal(portrait.dimensions.filter(d => d.ring === 'social').length, 12);
  assert.equal(portrait.dimensions.filter(d => d.ring === 'ecological').length, 9);
  for (const row of rows('city_san_francisco')) {
    const imported = dimension(dimensionSlug(row.name));
    const [indicator] = imported.indicators;
    assert.equal(imported.indicators.length, 1);
    assert.deepEqual(indicator.legacy_record, row);
    assert.equal(indicator.value, row.value);
    assert.equal(indicator.target, row.target);
    assert.equal(indicator.year, row.year);
    assert.equal(indicator.source, row.source);
    assert.equal(indicator.source_url, row.sourceUrl);
    assert.equal(indicator.status, 'legacy-source');
    assert.equal(indicator.evidence_path, null);
    assert.deepEqual(imported.actions, row.actions);
  }
});

test('every score is the fork’s own: none withheld, changed or flagged', () => {
  const source = rows('city_san_francisco');
  assert.equal(source.length, 21);
  for (const row of source) {
    const imported = dimension(dimensionSlug(row.name));
    assert.equal(typeof row.level, 'number', row.name);
    assert.equal(imported.level, row.level, row.name);
    assert.equal('quality_flags' in imported.indicators[0], false, row.name);
  }
  assert.equal(portrait.dimensions.some(d => d.level === null), false);
  assert.equal('score_withheld' in manifest || 'flags' in manifest || 'score_withheld' in portrait.provenance, false);
  // The owner's decision, stated plainly: these draw exactly as the fork scores them.
  for (const slug of ['ocean-acidification', 'chemical-pollution', 'ozone-layer-depletion']) assert.equal(dimension(slug).level, 0, slug);
  assert.equal(dimension('freshwater-withdrawals').level, 42);
  assert.equal(dimension('peace-justice').level, 48);
});

test('the known issues are recorded for the fork’s author, still hold, and are not displayed', () => {
  assert.deepEqual(manifest.known_issues.map(issue => issue.id), ['repeated-placeholder', 'freshwater-score-contradicts-target', 'projected-source', 'publisher-home-page-links']);
  assert.deepEqual(portrait.provenance.known_issues, manifest.known_issues);
  const placeholders = repeatedPlaceholders(rows('city_san_francisco'));
  assert.equal(placeholders.length, 1);
  assert.deepEqual(placeholders[0].map(row => dimensionSlug(row.name)).toSorted(), ['chemical-pollution', 'ocean-acidification', 'ozone-layer-depletion']);
  for (const row of placeholders[0]) assert.deepEqual([row.indicator, row.value, row.source], ['Regional environmental baseline', 'Compliant with state limits', 'EPA / NOAA Region 9']);
  const water = dimension('freshwater-withdrawals').indicators[0];
  assert.deepEqual([water.value, water.target, dimension('freshwater-withdrawals').level], ['42', '45', 42]);
  assert.equal(dimension('peace-justice').indicators[0].source, 'Projected Synthesis');
  for (const row of rows('city_san_francisco')) assert.ok(new URL(row.sourceUrl).pathname.split('/').filter(Boolean).length <= 1, row.sourceUrl);
  // Recorded, not rendered: the notice and the dimensions carry no issue text.
  const shown = JSON.stringify({ notice: portrait.notice, dimensions: portrait.dimensions.map(({ indicators, ...d }) => ({ ...d, indicators: indicators.map(({ legacy_record, ...i }) => i) })) });
  for (const issue of manifest.known_issues) assert.equal(shown.includes(issue.issue), false, issue.id);
  for (const text of ['placeholder', 'Projected Synthesis', 'withheld', 'not shown']) assert.equal(portrait.notice.includes(text), false, text);
});

test('the import refuses a changed pin, a new jurisdiction, an approval or a stale issue', () => {
  const files = sanFranciscoFiles();
  const changedByte = Buffer.from(files.bytes); changedByte[changedByte.length - 2] ^= 1;
  for (const [label, input] of [
    ['data byte', { ...files, bytes: changedByte }],
    ['commit', editedManifest(m => { m.commit = '0'.repeat(40); })],
    ['hash', editedManifest(m => { m.files['data.js'].sha256 = '0'.repeat(64); })],
    ['approved', editedManifest(m => { m.approved = true; })],
    ['jurisdiction dropped', editedManifest(m => { delete m.jurisdictions.santa_cruz_county; })],
    ['SoMa imported', editedManifest(m => { m.jurisdictions.soma_sf = { import: true, slug: 'soma', geography: 'neighborhood' }; })],
    ['withholding returns', editedManifest(m => { m.score_withheld = { 'ocean-acidification': 'x' }; })],
    ['issue removed', editedManifest(m => { m.known_issues.pop(); })],
    ['placeholder issue wrong', editedManifest(m => { m.known_issues[0].dimensions.pop(); })],
    ['freshwater fact stale', editedManifest(m => { m.known_issues[1].observed.level = 0; })],
    ['projection wrong', editedManifest(m => { m.known_issues[2].dimensions = ['food']; })],
    ['issue blank', editedManifest(m => { m.known_issues[3].issue = ' '; })],
  ]) assert.throws(() => sanFranciscoPortrait(input), /San Francisco|Legacy data/, label);
});

test('SoMa stays out while its rows are another portrait’s', () => {
  assert.equal(manifest.jurisdictions.soma_sf.import, false);
  assert.match(portrait.provenance.excluded.soma_sf, /Watsonville/);
  // The frozen baseline holds Watsonville as imported from the commit the fork started from.
  const soma = closestExistingPortrait(rows('soma_sf'), overlayBaseline().portraits);
  assert.deepEqual(soma, { slug: 'watsonville', identical: 22, total: 22 });
  // The imported city is its own data, not a renamed copy.
  assert.equal(closestExistingPortrait(rows('city_san_francisco'), overlayBaseline().portraits).identical, 0);
  assert.equal(publicRelease().portraits.some(p => /soma/i.test(p.slug) || /soma/i.test(p.name)), false);
});

test('the release reproduces San Francisco and rejects edits and forged approval', () => {
  const release = publicRelease();
  assert.deepEqual(release.portraits.find(p => p.slug === 'san-francisco'), JSON.parse(JSON.stringify(portrait)));
  validateRelease(release);
  for (const mutate of [
    p => { p.dimensions[0].indicators[0].value = '1%'; },
    p => { p.dimensions.find(d => d.slug === 'ocean-acidification').level = null; },
    p => { p.dimensions.find(d => d.slug === 'freshwater-withdrawals').level = 0; },
    p => { p.dimensions.find(d => d.slug === 'peace-justice').indicators[0].quality_flags = ['flag']; },
    p => { p.provenance.known_issues = []; },
    p => { p.provenance.approved = true; },
    p => { p.status = 'published'; },
    p => p.dimensions.pop(),
  ]) {
    const modified = structuredClone(release);
    mutate(modified.portraits.find(p => p.slug === 'san-francisco'));
    assert.throws(() => validateRelease(modified));
  }
});

test('a legacy data file is read as data and anything executable is refused', () => {
  assert.deepEqual(readJurisdictions('// note\nconst JURISDICTIONS = { "a": { name: \'A\', level: -50, list: [1, true, null, `x`] } };'), { a: { name: 'A', level: -50, list: [1, true, null, 'x'] } });
  for (const text of [
    'const JURISDICTIONS = { a: process.exit(1) };',
    'const JURISDICTIONS = { a: `${1}` };',
    'const JURISDICTIONS = { get a() { return 1; } };',
    'const JURISDICTIONS = { a() { return 1; } };',
    'const JURISDICTIONS = { ...other };',
    'const JURISDICTIONS = { a: [...other] };',
    'const JURISDICTIONS = { a };',
    'const JURISDICTIONS = { ["a"]: 1 };',
    'const JURISDICTIONS = { a: 1, a: 2 };',
    'const JURISDICTIONS = { __proto__: {} };',
    'const JURISDICTIONS = { a: tag`x` };',
    'const JURISDICTIONS = { a: () => 1 };',
    'const JURISDICTIONS = {}; fetch("https://example.com");',
    'const JURISDICTIONS = {}, OTHER = 1;',
    'const OTHER = {};',
    'const JURISDICTIONS = {',
    'JURISDICTIONS = { a: 1 }',
    '({ a: 1 })',
    '',
    'let JURISDICTIONS;',
  ]) assert.throws(() => readJurisdictions(text), error => error.constructor === Error && /^Legacy data/.test(error.message), text);
});
