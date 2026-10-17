import { describe, expect, it } from 'vitest';
import {
  ALL_PORTRAIT_FEATURES_ON,
  DEPLOYMENT_FEATURES,
  FEATURE_REGISTRY,
  PORTRAIT_FEATURES,
  deploymentFeatureEnabled,
  parseDisabledFeatures,
  resolvePortraitFeatures,
  unknownDisabledFeaturesMessage,
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

  it('offers self-serve start unless the deployment turns it off', () => {
    // On by default: anyone signed in may set up a portrait and buy a plan to build it.
    expect(DEPLOYMENT_FEATURES).toContain('self_serve');
    expect(deploymentFeatureEnabled('self_serve')).toBe(true);
    const { disabled, unknown } = parseDisabledFeatures('SELF_SERVE');
    expect(unknown).toEqual([]);
    expect(deploymentFeatureEnabled('self_serve', disabled)).toBe(false);
    // One switch does not touch the other deployment feature, nor any portrait's.
    expect(deploymentFeatureEnabled('deep_fry', disabled)).toBe(true);
    expect(resolvePortraitFeatures(ALL_PORTRAIT_FEATURES_ON, disabled)).toEqual(ALL_PORTRAIT_FEATURES_ON);
  });

  it('validates stored settings: any subset of the features, booleans only', () => {
    expect(featuresConfigSchema.safeParse({ request_research: true }).success).toBe(true);
    expect(featuresConfigSchema.safeParse({ ...ALL_PORTRAIT_FEATURES_ON }).success).toBe(true);
    expect(featuresConfigSchema.safeParse({ emergency: 'on' }).success).toBe(false);
    expect(featuresConfigSchema.safeParse({ nonsense: true }).success).toBe(false);
  });

  it('says which kill-switch names switch nothing off, naming the real ones', () => {
    // Plurals and hyphens are the likely slips: deploy.md names the features in prose.
    const message = unknownDisabledFeaturesMessage('emergencies, policy-analysis,deep_fry');
    expect(message).toContain('"emergencies", "policy-analysis" are not feature names and switch nothing off');
    for (const f of [...PORTRAIT_FEATURES, ...DEPLOYMENT_FEATURES]) expect(message).toContain(f);
    expect(unknownDisabledFeaturesMessage('emergancy')).toContain('"emergancy" is not a feature name and switches nothing off');
    for (const fine of ['', undefined, null, 'emergency, POLICY_ANALYSIS deep_fry']) {
      expect(unknownDisabledFeaturesMessage(fine)).toBeNull();
    }
  });
});
