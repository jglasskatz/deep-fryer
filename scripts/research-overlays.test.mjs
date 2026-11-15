import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overlayBaseline, reviewedOverlayRelease, validateReviewedOverlay } from './research-overlays.mjs';
const release = JSON.parse(readFileSync('site/data/portraits.json', 'utf8'));
test('every displayed amendment and unchanged baseline field reproduces from the exact independent reviews', () => {
  assert.deepEqual(release, reviewedOverlayRelease());
  assert.equal(release.research_overlay.human_approval, false);
  assert.equal(release.portraits.length, 11);
  assert.ok(release.research_overlay.applied.length >= 31);
  assert.equal(overlayBaseline().portraits.find(p => p.slug === 'bronx').dimensions.find(d => d.slug === 'chemical-pollution').indicators[1].value, 6.76);
});
test('a new value, forged review or changed unchanged-baseline field fails the content binding', () => {
  for (const mutate of [r => { r.portraits[0].dimensions[0].name = 'Changed'; },
    r => { r.research_overlay.human_approval = true; },
    r => { const i = r.portraits.flatMap(p => p.dimensions.flatMap(d => d.indicators)).find(i => i.research_review); i.value = 987654; }]) {
    const changed = structuredClone(release); mutate(changed);
    assert.throws(() => validateReviewedOverlay(changed), /content-bound/);
  }
});
test('related observations preserve numbers and sources while leaving every score null', () => {
  const observations = release.portraits.flatMap(p => p.dimensions.flatMap(d => d.indicators)).filter(i => i.research_review && i.status === 'source-supported-observation');
  assert.ok(observations.length >= 10);
  for (const item of observations) {
    assert.equal(item.kind, 'observation'); assert.ok(Number.isFinite(item.value));
    assert.equal(item.target, null); assert.equal(item.level_pct, null); assert.equal(item.scoring, null);
    assert.ok(item.evidence_path && item.unscored_reason && item.review_note);
  }
});
test('Santa Cruz-area housing context uses the corrected reviewed evidence, not superseded legacy claims', () => {
  const baseline = overlayBaseline();
  for (const slug of ['santa-cruz', 'santa-cruz-county', 'watsonville']) {
    const housing = release.portraits.find(p => p.slug === slug).dimensions.find(d => d.slug === 'housing');
    const previous = baseline.portraits.find(p => p.slug === slug).dimensions.find(d => d.slug === 'housing');
    assert.equal(housing.context, housing.indicators[0].notes);
    assert.notEqual(housing.context, previous.context);
    assert.match(housing.context, /2026 PIT report/);
    assert.match(housing.context, /annual changes are not directly comparable/);
    assert.doesNotMatch(housing.context, /highest per-capita homelessness rate|20\.4% decline/i);
    assert.equal(housing.level, null);
  }
  const city = release.portraits.find(p => p.slug === 'santa-cruz').dimensions.find(d => d.slug === 'housing');
  assert.equal(city.indicators[0].value, 1024);
  assert.equal(city.indicators[0].status, 'uncertain');
  assert.match(city.context, /1,024.*1,023/);
  assert.match(city.context, /1,850 was the 2024 COUNTY total, not Santa Cruz city/);
});
test('Santa Cruz-area equity context preserves reviewed Gini geography and periods without stale proxy claims', () => {
  const baseline = overlayBaseline();
  for (const [slug, value, period, geography, obsolete] of [
    ['santa-cruz', 0.4936, '2020–2024 ACS5 year', 'city', /Gini of 0\.483|California state index is 0\.65/],
    ['santa-cruz-county', 0.4864, '2024 ACS1 year', 'county', /Gini of 0\.50/],
    ['watsonville', 0.4282, '2020–2024 ACS5 year', 'city', /County Gini 0\.50/],
  ]) {
    const dimension = release.portraits.find(p => p.slug === slug).dimensions.find(d => d.slug === 'social-equity');
    const indicator = dimension.indicators[0];
    const previous = baseline.portraits.find(p => p.slug === slug).dimensions.find(d => d.slug === 'social-equity');
    assert.equal(dimension.context, indicator.notes);
    assert.notEqual(dimension.context, previous.context);
    assert.ok(dimension.context.includes(`B19083_E001=${value}`));
    assert.ok(dimension.context.includes(period));
    assert.doesNotMatch(dimension.context, obsolete);
    assert.equal(indicator.value, value);
    assert.equal(indicator.geography, geography);
    assert.equal(indicator.year, 2024);
    assert.equal(indicator.target, null);
    assert.equal(indicator.level_pct, null);
    assert.equal(dimension.level, null);
  }
});
