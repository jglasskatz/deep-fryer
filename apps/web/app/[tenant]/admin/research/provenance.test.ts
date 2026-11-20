import { describe, expect, it } from 'vitest';
import type { RunExecution } from '@deep-fryer/db';
import { fallbackSentence, findingProvenance, runProvenanceSentence, sessionModels } from './provenance';

const execution: RunExecution = { provider: 'anthropic', endpoint_host: 'api.anthropic.com', executor: 'shared_worker', host_region: null };
const fallback = (from: string, to: string) => ({ original_model: from, fallback_model: to, category: null });

describe('provenance wording', () => {
  it('names each fallback once, however often it happened', () => {
    expect(fallbackSentence({ refusal_fallbacks: [fallback('a', 'b'), fallback('a', 'b'), fallback('c', 'b')] }))
      .toBe('When a declined part of the work, b answered. When c declined part of the work, b answered');
    expect(fallbackSentence({})).toBeNull();
    expect(fallbackSentence(null)).toBeNull();
  });

  it('keeps only the model fields of a usage record', () => {
    expect(sessionModels({ input_tokens: 5, output_tokens: 1, model: 'm', by_model: {} })).toEqual({ model: 'm' });
    expect(sessionModels(undefined)).toBeNull();
    expect(findingProvenance({ execution: null, tokenUsage: null }, 's')).toEqual({ execution: null, session: null });
  });

  it('never prints a blank or "undefined" model from a damaged usage record', () => {
    const damaged = {
      input_tokens: 1, output_tokens: 1, model: '',
      refusal_fallbacks: 'not a list',
    } as unknown as Parameters<typeof sessionModels>[0];
    expect(sessionModels(damaged)).toEqual({});
    const partial = {
      input_tokens: 1, output_tokens: 1, model: 'm',
      refusal_fallbacks: [fallback('', 'b'), { fallback_model: 'b' }, null, fallback('a', 'b')],
    } as unknown as Parameters<typeof sessionModels>[0];
    expect(fallbackSentence(sessionModels(partial))).toBe('When a declined part of the work, b answered');
    expect(runProvenanceSentence({ execution, tokenUsage: { s: damaged! } }, ['s']))
      .toBe('Researched with a model that was not recorded on Anthropic, shared server');
  });

  it('lists every research model of a run, and leaves verification records out', () => {
    const run = {
      execution,
      tokenUsage: {
        a: { input_tokens: 1, output_tokens: 1, model: 'm1' },
        b: { input_tokens: 1, output_tokens: 1, model: 'm2' },
        c: { input_tokens: 1, output_tokens: 1, model: 'm3' },
        'verifier:a': { input_tokens: 1, output_tokens: 1, model: 'judge' },
      },
    };
    expect(runProvenanceSentence(run, ['a', 'b', 'c'])).toBe('Researched with m1, m2 and m3 on Anthropic, shared server');
    expect(runProvenanceSentence({ execution: null, tokenUsage: null }, ['a'])).toBe('Provider not recorded');
  });
});
