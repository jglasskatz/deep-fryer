/** The public preview must be a rendering of the content-bound research review. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { findingPayloadSchema, previewObservationSchema, resolveThreshold, computeScoring } from '../packages/core/src/index.ts';
import { portraitFramework } from './portrait-framework.mjs';
const read = p => readFileSync(p, 'utf8');
const hash = s => createHash('sha256').update(s).digest('hex');
const release = JSON.parse(read('site/data/portraits.json'));
const catalog = JSON.parse(read('site/catalog.json'));
const publicArchives = JSON.parse(read('site/data/evidence-manifest.json'));
test('displayed research and profile remain bound to the independent review', () => {
  for (const portrait of release.portraits.filter(p => p.status === 'research-preview')) {
    assert.match(portrait.provenance.campaign, /^[a-z0-9-]+$/);
    const root = `research/${portrait.provenance.campaign}`;
    const manifest = JSON.parse(read(`${root}/review-manifest.json`));
    assert.equal(portrait.provenance.review_manifest_sha256, hash(JSON.stringify(manifest)));
    assert.equal(manifest.approved, false);
    assert.equal(manifest.reviewer, 'gpt-6.1-sol');
    const framework = portraitFramework(catalog.portraits.find(p => p.slug === portrait.slug));
    assert.deepEqual(manifest.framework_profiles[portrait.slug], { id: framework.profile, sha256: framework.sha256 });
    const directory = `${root}/${portrait.slug}`;
    const supportingText = read(`${directory}/supporting-evidence.json`);
    assert.equal(manifest.supporting_evidence_sha256[portrait.slug], hash(supportingText));
    const supporting = JSON.parse(supportingText);
    const publicEvidence = relative => {
      if (!relative) return null;
      const digest = manifest.evidence_sha256?.[portrait.slug]?.[relative];
      assert.match(digest ?? '', /^[a-f0-9]{64}$/, `Missing reviewed exhibit: ${relative}`);
      const publicPath = `evidence/shared/${digest.slice(0, 24)}${path.extname(relative).toLowerCase()}`;
      assert.equal(publicArchives[publicPath]?.sha256, digest, `Reviewed archive changed: ${relative}`);
      return publicPath;
    };
    const config = JSON.parse(read(`${directory}/config.json`));
    for (const dimension of portrait.dimensions) {
      const raw = read(`${directory}/findings/${dimension.slug}.json`);
      const reviewText = read(`${directory}/reviews/${dimension.slug}.json`);
      assert.deepEqual(manifest.portraits[portrait.slug][dimension.slug], { findings_sha256: hash(raw), reviews_sha256: hash(reviewText) });
      assert.equal(portrait.provenance.hashes[dimension.slug], hash(raw + reviewText));
      const reviews = JSON.parse(reviewText);
      const rows = JSON.parse(raw);
      assert.equal(dimension.indicators.length, rows.length);
      for (const input of rows) {
        const row = (input.kind === 'observation' ? previewObservationSchema : findingPayloadSchema).parse(input);
        const rendered = dimension.indicators.find(i => i.indicator_slug === row.indicator_slug);
        const review = reviews.find(r => r.indicator_slug === row.indicator_slug);
        assert.ok(rendered && review, `${portrait.slug}/${row.indicator_slug}`);
        assert.equal(rendered.review_note, review.verifier_note);
        assert.deepEqual(rendered.supporting_evidence ?? [], (supporting[row.indicator_slug] ?? []).map(s => ({ label: s.label, source_url: s.source_url, evidence_path: publicEvidence(s.snapshot_path), pdf_path: publicEvidence(s.pdf_path) })));
        assert.equal(rendered.evidence_path, publicEvidence(row.evidence?.snapshot_path));
        assert.equal(rendered.pdf_path, publicEvidence(row.evidence?.pdf_path));
        if (row.kind === 'gap') {
          assert.equal(rendered.value, null);
          assert.equal(rendered.status, 'gap');
          assert.equal(rendered.notes, row.reason);
          continue;
        }
        for (const key of ['kind', 'name', 'value', 'unit', 'year', 'target', 'level_pct', 'scoring', 'source', 'source_url', 'source_tier', 'confidence', 'geographic_scale', 'notes']) assert.deepEqual(rendered[key], row[key], `${portrait.slug}/${row.indicator_slug}/${key}`);
        const supportedStatus = row.kind === 'observation' ? 'source-supported-observation' : 'source-supported-draft';
        assert.equal(rendered.status, review.content_supported === 'pass' && rendered.evidence_path ? supportedStatus : 'uncertain');
        if (row.kind === 'observation') assert.equal(rendered.unscored_reason, row.unscored_reason);
        else {
          const spec = framework.dimensions.find(d => d.slug === dimension.slug).indicators.find(i => i.slug === row.indicator_slug);
          const threshold = resolveThreshold(spec.threshold_ref, config.threshold_overrides);
          assert.equal(row.target, threshold.target);
          assert.equal(row.level_pct, computeScoring(row.value, spec.threshold_ref, threshold).level_pct);
          assert.equal(row.scoring.threshold_ref, spec.threshold_ref);
          assert.equal(row.scoring.function, threshold.function);
          assert.deepEqual(row.scoring.inputs, computeScoring(row.value, spec.threshold_ref, threshold).scoring.inputs);
        }
      }
    }
  }
});
