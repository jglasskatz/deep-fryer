import { describe, expect, it } from 'vitest';
import {
  PROVIDER_META,
  RESEARCH_PROVIDERS,
  configuredDeploymentProviders,
  isResearchProvider,
  parseResearchProvider,
  providerForModel,
  resolveProviderEnvKey,
} from './providers.js';
import { baseModelId, emptyUsage, modelPricing, priceSessionUsage } from './model-pricing.js';
import { summarizeRunCosts } from './run-costs.js';
import { providerKeyVerdict } from './preflight.js';

describe('provider registry & providerForModel', () => {
  it('defines anthropic, openai, and google with complete metadata', () => {
    expect(RESEARCH_PROVIDERS).toEqual(['anthropic', 'openai', 'google']);
    for (const id of RESEARCH_PROVIDERS) {
      expect(isResearchProvider(id)).toBe(true);
      expect(PROVIDER_META[id].id).toBe(id);
      expect(PROVIDER_META[id].displayName.length).toBeGreaterThan(0);
      expect(PROVIDER_META[id].envKeys.length).toBeGreaterThan(0);
      expect(PROVIDER_META[id].firstPartyHost).toContain('.');
    }
    expect(isResearchProvider('bedrock')).toBe(false);
    expect(parseResearchProvider(' OPENAI ')).toBe('openai');
    expect(parseResearchProvider('gemini')).toBe('google');
    expect(parseResearchProvider('unknown')).toBeNull();
  });

  it('infers the provider from model IDs across Anthropic, OpenAI, and Google', () => {
    expect(providerForModel('claude-sonnet-5')).toBe('anthropic');
    expect(providerForModel('claude-opus-5')).toBe('anthropic');
    expect(providerForModel('claude-haiku-4-5-20251001')).toBe('anthropic');
    expect(providerForModel('sonnet')).toBe('anthropic');

    expect(providerForModel('gpt-5')).toBe('openai');
    expect(providerForModel('gpt-5-mini')).toBe('openai');
    expect(providerForModel('gpt-4.1-2025-04-14')).toBe('openai');
    expect(providerForModel('o1')).toBe('openai');
    expect(providerForModel('o3')).toBe('openai');
    expect(providerForModel('o4-mini')).toBe('openai');
    expect(providerForModel('chatgpt-4o-latest')).toBe('openai');

    expect(providerForModel('gemini-2.5-pro')).toBe('google');
    expect(providerForModel('gemini-2.5-flash')).toBe('google');
    expect(providerForModel('gemini-3.8-flash')).toBe('google');
    expect(providerForModel('models/gemini-2.5-pro')).toBe('google');

    expect(providerForModel('custom-local-model', 'openai')).toBe('openai');
    expect(providerForModel(undefined)).toBe('anthropic');
  });

  it('resolves deployment API keys from environment variables', () => {
    expect(resolveProviderEnvKey('anthropic', { ANTHROPIC_API_KEY: ' sk-ant-test ' })).toBe('sk-ant-test');
    expect(resolveProviderEnvKey('openai', { OPENAI_API_KEY: 'sk-openai' })).toBe('sk-openai');
    expect(resolveProviderEnvKey('google', { GOOGLE_API_KEY: 'AIzaFallback' })).toBe('AIzaFallback');
    expect(resolveProviderEnvKey('google', { GEMINI_API_KEY: 'AIzaPrimary', GOOGLE_API_KEY: 'AIzaFallback' })).toBe(
      'AIzaPrimary',
    );
    expect(configuredDeploymentProviders({ OPENAI_API_KEY: 'sk-1', GEMINI_API_KEY: 'AIza1' })).toEqual([
      'openai',
      'google',
    ]);
  });
});

describe('multi-provider model pricing & run costs', () => {
  const M = 1_000_000;

  it('prices all OpenAI and Google Gemini models including dated and models/ prefixed IDs', () => {
    for (const id of [
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.1',
      'gpt-4.1-2025-04-14',
      'gpt-4.1-mini',
      'o3',
      'o4-mini',
      'gemini-2.5-pro',
      'models/gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-3.8-flash',
    ]) {
      expect(modelPricing(id), id).not.toBeNull();
    }
    expect(baseModelId('gpt-4.1-2025-04-14')).toBe('gpt-4.1');
    expect(baseModelId('models/gemini-2.5-flash')).toBe('gemini-2.5-flash');

    const openaiUsage = {
      ...emptyUsage(),
      input_tokens: M,
      output_tokens: 500_000,
      cache_read_tokens: M,
      model: 'gpt-5',
      by_model: {
        'gpt-5': {
          input_tokens: M,
          output_tokens: 500_000,
          cache_read_tokens: M,
          cache_write_tokens: 0,
          web_search_requests: 0,
        },
      },
    };
    const pricedOpenAi = priceSessionUsage(openaiUsage);
    expect(pricedOpenAi.unpriced).toEqual([]);
    // $1.25 input + $5.00 output + $0.125 cache read = $6.375
    expect(pricedOpenAi.dollars).toBeCloseTo(6.375, 6);

    const geminiUsage = {
      ...emptyUsage(),
      input_tokens: M,
      output_tokens: M,
      cache_read_tokens: 0,
      model: 'gemini-2.5-flash',
      by_model: {
        'gemini-2.5-flash': {
          input_tokens: M,
          output_tokens: M,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          web_search_requests: 0,
        },
      },
    };
    const pricedGemini = priceSessionUsage(geminiUsage);
    expect(pricedGemini.unpriced).toEqual([]);
    // $0.30 input + $2.50 output = $2.80
    expect(pricedGemini.dollars).toBeCloseTo(2.8, 6);

    const summary = summarizeRunCosts(
      { s1: openaiUsage, 'verifier:s1': geminiUsage },
      {
        sessions: [{ id: 's1', kind: 'dimension', dimensionId: 'dim-1' }],
        findings: [{ id: 'f1', dimensionId: 'dim-1', payload: { kind: 'indicator' }, verification: { content_supported: 'pass' } }],
      },
    );
    expect(summary.coverage).toBe('complete');
    expect(summary.unpriced_models).toEqual([]);
    expect(summary.estimated_usd).toBeCloseTo(6.375 + 2.8, 6);
    expect(summary.cost_per_verified_finding_usd).toBeCloseTo(9.175, 6);
  });

  it('produces actionable preflight verdicts for OpenAI and Google keys', () => {
    expect(providerKeyVerdict('openai', 200, { data: [] }).status).toBe('pass');
    expect(providerKeyVerdict('openai', 401, { error: { message: 'Incorrect API key' } }).status).toBe('fail');
    expect(providerKeyVerdict('google', 400, { error: { message: 'API key not valid.' } }).status).toBe('fail');
    expect(providerKeyVerdict('google', 403, { error: { message: 'Forbidden' } }).status).toBe('fail');
    expect(providerKeyVerdict('google', 503, {}).status).toBe('warn');
  });
});
