import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CARBON_ROUTING,
  assessRunCarbon,
  classifyCarbonIntensity,
} from './carbon-intensity.js';

describe('carbon-intensity routing and warnings', () => {
  it('defaults to Google carbon-free routing with zero warning on low intensity', () => {
    expect(DEFAULT_CARBON_ROUTING.mode).toBe('carbon_free_first');
    expect(DEFAULT_CARBON_ROUTING.provider).toBe('google');

    const res = assessRunCarbon({
      mode: DEFAULT_CARBON_ROUTING.mode,
      regionId: DEFAULT_CARBON_ROUTING.regionId,
      sessions: 22,
      strategy: 'standard',
    });

    expect(res.effectiveProvider).toBe('google');
    expect(res.effectiveRegion.id).toBe('northamerica-northeast1');
    expect(res.classification.band).toBe('low');
    expect(res.classification.shouldWarn).toBe(false);
    expect(res.classification.warningHeadline).toBeNull();
    expect(res.estimatedGramsCo2).toBeLessThan(5);
  });

  it('warns ONLY when carbon intensity is medium or high', () => {
    expect(classifyCarbonIntensity(40, 95).shouldWarn).toBe(false);
    expect(classifyCarbonIntensity(99, null).shouldWarn).toBe(false);

    const med = classifyCarbonIntensity(175, 62);
    expect(med.band).toBe('medium');
    expect(med.shouldWarn).toBe(true);
    expect(med.warningHeadline).toContain('Medium carbon intensity');

    const high = classifyCarbonIntensity(340, 42);
    expect(high.band).toBe('high');
    expect(high.shouldWarn).toBe(true);
    expect(high.warningHeadline).toContain('High carbon intensity');
  });

  it('supports Vertex AI Batch low-carbon routing and flags deferral when scheduling on a high-carbon grid', () => {
    const batch = assessRunCarbon({
      mode: 'vertex_batch_low_carbon',
      regionId: 'us-west1',
      sessions: 22,
      strategy: 'hybrid',
    });
    expect(batch.useVertexBatch).toBe(true);
    expect(batch.effectiveProvider).toBe('google');
    expect(batch.classification.band).toBe('low');
    expect(batch.classification.shouldWarn).toBe(false);

    const deferred = assessRunCarbon({
      mode: 'schedule_low_carbon',
      regionId: 'openai-us-default',
      sessions: 22,
      strategy: 'standard',
    });
    expect(deferred.classification.band).toBe('high');
    expect(deferred.classification.shouldWarn).toBe(true);
    expect(deferred.deferIfHighCarbon).toBe(true);

    // Live grid spike overrides static region average
    const liveSpike = assessRunCarbon({
      mode: 'carbon_free_first',
      regionId: 'us-west1',
      sessions: 10,
      strategy: 'standard',
      liveIntensityGco2PerKwh: 280,
    });
    expect(liveSpike.classification.band).toBe('high');
    expect(liveSpike.classification.shouldWarn).toBe(true);
  });
});
