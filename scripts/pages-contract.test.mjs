import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateRelease, publicAssetPath, escapeHtml, inside } from './pages-contract.mjs';
const release = JSON.parse(await readFile('site/data/portraits.json', 'utf8'));
test('release preserves every requested portrait and all researched indicators', () => {
  validateRelease(release);
  assert.equal(release.portraits.length, 11);
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
