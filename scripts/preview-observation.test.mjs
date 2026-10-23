import test from 'node:test';
import assert from 'node:assert/strict';
import { previewObservationSchema, findingPayloadSchema } from '../packages/core/src/validators.ts';
const observation = { kind: 'observation', indicator_slug: 'extreme-heat-days', name: 'Heat exposure', value: 14.5, unit: 'days/year', year: 2022, target: null, level_pct: null, scoring: null, source: 'CDC', source_url: 'https://www.cdc.gov/', source_tier: 1, evidence: { snapshot_path: 'evidence/heat.png', captured_at: '2026-10-23T00:00:00Z' }, confidence: 'medium', geographic_scale: 'county', unscored_reason: 'No adopted annual-day threshold verified.' };
test('unscored observations require explicit null scoring and cannot enter the approval pipeline', () => {
  assert.equal(previewObservationSchema.safeParse(observation).success, true);
  assert.equal(findingPayloadSchema.safeParse(observation).success, false);
  for (const patch of [{ target: 0 }, { level_pct: 0 }, { scoring: {} }, { unscored_reason: '' }, { approved: true }, { value: 'unknown' }]) {
    assert.equal(previewObservationSchema.safeParse({ ...observation, ...patch }).success, false);
  }
});
