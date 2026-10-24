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
