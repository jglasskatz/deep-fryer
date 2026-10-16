import { describe, expect, it } from 'vitest';
import {
  ALL_PORTRAIT_FEATURES_ON,
  DEPLOYMENT_FEATURES,
  FEATURE_REGISTRY,
  PORTRAIT_FEATURES,
  deploymentFeatureEnabled,
  parseDisabledFeatures,
  resolvePortraitFeatures,
} from './features.js';
import { defaultFeatures } from './config-defaults.js';
import { featuresConfigSchema } from './validators.js';

describe('feature flags', () => {
  it('keeps everything beyond core off for a new portrait, and describes every feature', () => {
    const resolved = resolvePortraitFeatures(defaultFeatures);
    expect(Object.values(resolved).every((on) => on === false)).toBe(true);
    // Unset (an old portrait's config, or none at all) means the registry default — also off.
    expect(resolvePortraitFeatures(null)).toEqual(resolved);
    for (const f of [...PORTRAIT_FEATURES, ...DEPLOYMENT_FEATURES]) {
      expect(FEATURE_REGISTRY[f].label.length).toBeGreaterThan(0);
      expect(FEATURE_REGISTRY[f].description.length).toBeGreaterThan(0);
    }
  });

  it('applies a portrait’s settings, ignoring values that are not booleans', () => {
    const resolved = resolvePortraitFeatures({ emergency: true, discussion: 'yes', translation: false });
    expect(resolved.emergency).toBe(true);
    expect(resolved.discussion).toBe(false);
    expect(resolved.translation).toBe(false);
  });

  it('lets the deployment switch a feature off everywhere, whatever the portrait says', () => {
    const { disabled, unknown } = parseDisabledFeatures(' Emergency, policy_analysis  deep_fry,emergncy ');
    expect([...disabled].sort()).toEqual(['deep_fry', 'emergency', 'policy_analysis']);
    expect(unknown).toEqual(['emergncy']);
    const resolved = resolvePortraitFeatures(ALL_PORTRAIT_FEATURES_ON, disabled);
    expect(resolved.emergency).toBe(false);
    expect(resolved.policy_analysis).toBe(false);
    expect(resolved.discussion).toBe(true);
    expect(deploymentFeatureEnabled('deep_fry', disabled)).toBe(false);
    expect(deploymentFeatureEnabled('deep_fry')).toBe(true);
    expect(parseDisabledFeatures(undefined).disabled.size).toBe(0);
  });

  it('validates stored settings: any subset of the features, booleans only', () => {
    expect(featuresConfigSchema.safeParse({ request_research: true }).success).toBe(true);
    expect(featuresConfigSchema.safeParse({ ...ALL_PORTRAIT_FEATURES_ON }).success).toBe(true);
    expect(featuresConfigSchema.safeParse({ emergency: 'on' }).success).toBe(false);
    expect(featuresConfigSchema.safeParse({ nonsense: true }).success).toBe(false);
  });
});
