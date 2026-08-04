import { describe, expect, it } from 'vitest';
import {
  defaultPortraitConfig,
  framework,
  frameworkDimension,
  getThreshold,
  thresholds,
} from './index.js';

describe('framework ↔ thresholds integrity', () => {
  it('every indicator threshold_ref resolves to a threshold', () => {
    for (const dim of framework.dimensions) {
      for (const ind of dim.indicators) {
        expect(getThreshold(ind.threshold_ref), ind.threshold_ref).toBeDefined();
      }
    }
  });

  it('every threshold is referenced by exactly one indicator', () => {
    const refs = framework.dimensions.flatMap((d) => d.indicators.map((i) => i.threshold_ref));
    expect(new Set(refs).size).toBe(refs.length);
    for (const key of Object.keys(thresholds.thresholds)) {
      expect(refs, `orphan threshold ${key}`).toContain(key);
    }
  });

  it('dimension slugs are unique and rings are the 12+9 split', () => {
    const slugs = framework.dimensions.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(framework.dimensions.filter((d) => d.ring === 'social')).toHaveLength(12);
    expect(framework.dimensions.filter((d) => d.ring === 'ecological')).toHaveLength(9);
  });

  it('every threshold carries a non-empty rationale (the methodology page renders it)', () => {
    for (const [ref, t] of Object.entries(thresholds.thresholds)) {
      expect(t.rationale.length, ref).toBeGreaterThan(20);
    }
  });

  it('band thresholds are well-formed and zero-target thresholds carry a scale', () => {
    for (const [ref, t] of Object.entries(thresholds.thresholds)) {
      if (t.function === 'band') {
        expect(t.low, ref).toBeDefined();
        expect(t.high, ref).toBeGreaterThan(t.low!);
      } else if (t.target === 0) {
        expect(t.scale, ref).toBeGreaterThan(0);
      }
    }
  });
});

describe('frameworkDimension resolver', () => {
  it('resolves canonical slug first, then own slug', () => {
    expect(frameworkDimension('housing')?.slug).toBe('housing');
    expect(frameworkDimension('my-custom-housing', 'housing')?.slug).toBe('housing');
    expect(frameworkDimension('waste-materials', null)).toBeUndefined();
  });
});

describe('defaultPortraitConfig', () => {
  it('scale-policy exceptions reference real framework dimensions', () => {
    const config = defaultPortraitConfig('X', 'X');
    for (const slug of Object.keys(config.scale_policy.per_dimension ?? {})) {
      expect(frameworkDimension(slug), slug).toBeDefined();
    }
  });
});
