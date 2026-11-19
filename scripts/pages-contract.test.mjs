import test from 'node:test';
import assert from 'node:assert/strict';
import { publicRelease } from './research-overlays.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateRelease, publicAssetPath, escapeHtml, inside, assertNoLiveArchives, FIRST_PARTY_RENDERABLE } from './pages-contract.mjs';
import { publishedArchiveName, isRenderable } from '../site/published-name.js';
const release = publicRelease();
test('archived files a browser renders or runs are published as text; other files keep their names', () => {
  for (const [name, published] of [
    ['raw/indec-poverty-topic.html', 'raw/indec-poverty-topic.html.txt'],
    ['raw/unep-material-app.js', 'raw/unep-material-app.js.txt'],
    ['raw/figure.svg', 'raw/figure.svg.txt'],
    ['raw/PAGE.HTML', 'raw/PAGE.HTML.txt'],
    ['raw/Bundle.Js', 'raw/Bundle.Js.txt'],
    ['raw/old.HTM', 'raw/old.HTM.txt'],
    ['raw/module.mjs', 'raw/module.mjs.txt'],
    ['raw/feed.xml', 'raw/feed.xml.txt'],
    ['raw/page.xhtml', 'raw/page.xhtml.txt'],
    ['raw/gcb-2025-national-fossil.access.html', 'raw/gcb-2025-national-fossil.access.html.txt'],
    ['raw/report.pdf', 'raw/report.pdf'],
    ['raw/REPORT.PDF', 'raw/REPORT.PDF'],
    ['raw/wdi.json', 'raw/wdi.json'],
    ['raw/table.csv', 'raw/table.csv'],
    ['raw/sheet.xlsx', 'raw/sheet.xlsx'],
    ['raw/sheet.xls', 'raw/sheet.xls'],
    ['raw/shot.png', 'raw/shot.png'],
    ['raw/page.html.txt', 'raw/page.html.txt'],
    ['raw/html', 'raw/html'],
    ['raw.html/readme', 'raw.html/readme'],
  ]) assert.equal(publishedArchiveName(name), published, name);
  assert.equal(isRenderable('data.js'), true);
  assert.equal(isRenderable('data.json'), false);
});
test('a built site that publishes a renderable archive is refused', () => {
  const site = mkdtempSync(path.join(tmpdir(), 'deep-fryer-archives-'));
  const put = file => { mkdirSync(path.dirname(path.join(site, file)), { recursive: true }); writeFileSync(path.join(site, file), '<script>alert(1)</script>'); };
  try {
    for (const file of [...FIRST_PARTY_RENDERABLE, 'research/argentina/raw/page.html.txt', 'research/argentina/raw/report.pdf', 'evidence/shared/abc.png', 'imports/san-francisco/data.js.txt', 'policies/index.html', 'index.html']) put(file);
    assertNoLiveArchives(site);
    for (const file of ['research/argentina/raw/page.html', 'research/argentina/raw/PAGE.HTM', 'research/argentina/raw/app.js', 'evidence/shared/drawing.svg', 'imports/san-francisco/data.js', 'research/other/index.html']) {
      put(file);
      assert.throws(() => assertNoLiveArchives(site), new RegExp(file.replaceAll('.', '\\.')), file);
      rmSync(path.join(site, file));
    }
    assertNoLiveArchives(site);
  } finally { rmSync(site, { recursive: true, force: true }); }
});
test('release preserves every requested portrait and all researched indicators', () => {
  validateRelease(release);
  assert.equal(release.portraits.length, 13);
  for (const slug of ['carmel', 'monterey-county']) {
    const portrait = release.portraits.find(p => p.slug === slug);
    assert.equal(portrait.status, 'research-preview');
    assert.equal(portrait.dimensions.flatMap(d => d.indicators).length, 24);
    assert.equal(portrait.provenance.approved, false);
  }
  const nyc = release.portraits.find(p => p.slug === 'nyc');
  assert.ok(nyc.dimensions.some(d => d.indicators.length > 1), 'Secondary indicators must survive export');
});
test('missing evidence and mislabeled Carmel proxies block scored drafts', () => {
  const missing = structuredClone(release);
  const portrait = missing.portraits.find(p => p.slug === 'carmel');
  const indicator = portrait.dimensions.flatMap(d => d.indicators).find(i => i.status === 'source-supported-draft');
  indicator.evidence_path = null;
  assert.throws(() => validateRelease(missing), /Unsupported draft/);
  const unlabeled = structuredClone(release);
  unlabeled.portraits.find(p => p.slug === 'carmel').dimensions.flatMap(d => d.indicators).find(i => i.geographic_scale === 'county').geography = 'city';
  assert.throws(() => validateRelease(unlabeled), /proxy/);
});
test('public file and HTML boundaries reject traversal and escape source text', () => {
  for (const value of ['../.env', '/etc/passwd', 'evidence/x/../../secret.png', 'evidence/x/file.html']) assert.throws(() => publicAssetPath(value));
  assert.throws(() => inside('/tmp/site', '../secret'));
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
  const unsafe = structuredClone(release);
  unsafe.portraits[0].dimensions[0].indicators[0].source_url = 'javascript:alert(1)';
  assert.throws(() => validateRelease(unsafe), /Unsafe source/);
  const supporting = structuredClone(release);
  const item = supporting.portraits[0].dimensions[0].indicators[0];
  item.supporting_evidence = [{ label: 'Population denominator', source_url: 'https://example.gov/population', evidence_path: '../secret.png' }];
  assert.throws(() => validateRelease(supporting), /Invalid evidence path/);
  item.supporting_evidence[0].evidence_path = 'evidence/shared/abc123.png';
  item.supporting_evidence[0].source_url = 'javascript:alert(1)';
  assert.throws(() => validateRelease(supporting), /Invalid supporting source/);
});
test('wedge tampering, approval relabeling and catalog substitution fail closed', () => {
  const score = structuredClone(release);
  score.portraits.find(p => p.slug === 'carmel').dimensions.find(d => d.slug === 'health').level = 150;
  assert.throws(() => validateRelease(score), /Draft wedge/);
  const approval = structuredClone(release);
  const dim = approval.portraits.find(p => p.slug === 'carmel').dimensions.find(d => d.slug === 'health');
  dim.level = null;
  dim.indicators.find(i => i.value !== null).status = 'published';
  assert.throws(() => validateRelease(approval), /publication approval/);
  const swapped = structuredClone(release);
  swapped.portraits.find(p => p.slug === 'manhattan').slug = 'unrequested-place';
  assert.throws(() => validateRelease(swapped), /release catalog/);
  const omitted = structuredClone(release);
  omitted.portraits.find(p => p.slug === 'carmel').dimensions.find(d => d.slug === 'health').indicators.pop();
  assert.throws(() => validateRelease(omitted), /coverage/);
  const wrongRing = structuredClone(release);
  wrongRing.portraits.find(p => p.slug === 'carmel').dimensions.find(d => d.slug === 'food').ring = 'ecological';
  assert.throws(() => validateRelease(wrongRing), /ring mismatch/);
});

test('local heat observations replace ozone only in the two authorized previews and stay unscored', () => {
  for (const slug of ['carmel', 'monterey-county']) {
    const portrait = release.portraits.find(p => p.slug === slug);
    assert.equal(portrait.dimensions.some(d => d.slug === 'ozone-depletion'), false);
    const dimension = portrait.dimensions.find(d => d.slug === 'extreme-heat');
    assert.equal(dimension.level, null);
    assert.equal(dimension.indicators[0].status, 'source-supported-observation');
    for (const patch of [{ value: null, status: 'uncertain', target: 10, level_pct: 100, scoring: { worked_math: 'invented scoring' } }, { value: null, status: 'uncertain' }, { level_pct: 0 }, { target: 0 }, { scoring: {} }, { unscored_reason: '' }, { status: 'source-supported-draft' }]) {
      const modified = structuredClone(release);
      Object.assign(modified.portraits.find(p => p.slug === slug).dimensions.find(d => d.slug === 'extreme-heat').indicators[0], patch);
      assert.throws(() => validateRelease(modified), /Unscored observation/);
    }
  }
  const forged = structuredClone(release);
  forged.portraits.find(p => p.slug === 'carmel').provenance.framework_profile = 'default';
  assert.throws(() => validateRelease(forged), /framework provenance/);
});

// A public-data download must not quietly restore the removed cost section.
test('public snapshots exclude internal research accounting', () => {
  assert.equal(Object.hasOwn(release, 'cost_scenarios'), false);
  const leaked = structuredClone(release);
  leaked.cost_scenarios = { actual_billed_usd: 123 };
  assert.throws(() => validateRelease(leaked), /content-bound/);
});
