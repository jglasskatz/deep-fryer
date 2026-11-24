import { describe, expect, it } from 'vitest';
import { defaultPortraitConfig } from '@deep-fryer/contract';
import { renderPlan } from './plan.js';
import {
  STRATEGIES,
  latestStrategy,
  registryDrift,
  resolveStrategy,
  strategyEntry,
  strategyFingerprint,
  type StrategyEntry,
} from './strategies.js';

/**
 * Every published registry entry, by `name@version`, with the fingerprint of
 * what it fixes. Runs record the name and version they were planned with, so
 * an entry must never change after it is published: a new setting is a new
 * version. Add a line here for each new entry; never edit an existing line.
 */
const PUBLISHED: Record<string, string> = {
  'standard@1': '68964dcec8b45016',
  'deep@1': 'b75ed1874dd00bd0',
  'hybrid@1': 'f0c659492033b985',
  'operator-defaults@1': 'fa2a7736d925f075',
  'standard@2': '3457db7ea8c40a83',
  'deep@2': '0ca42210c21e3ef3',
  'hybrid@2': 'd3f17309e3c767ee',
};

const config = defaultPortraitConfig('City of Santa Cruz', 'City of Santa Cruz municipal boundary');

describe('the strategy registry', () => {
  it('keeps every published entry exactly as it was published', () => {
    expect(registryDrift(STRATEGIES, PUBLISHED)).toEqual([]);
  });

  it('fails when an existing entry is changed instead of given a new version', () => {
    const standard = strategyEntry('standard', 1)!;
    const edited: StrategyEntry = { ...standard, caps: { ...standard.caps, verifier_max_turns: 20 } };
    const inPlace = STRATEGIES.map((e) => (e === standard ? edited : e));
    expect(registryDrift(inPlace, PUBLISHED)).toEqual([
      'standard@1 was changed after it was published; leave it as it was and add standard@3 instead',
    ]);

    // The same change as a new version passes once its fingerprint is recorded.
    const next: StrategyEntry = { ...edited, version: 3 };
    expect(registryDrift([...STRATEGIES, next], PUBLISHED)).toEqual([
      `standard@3 is new: record its fingerprint ${strategyFingerprint(next)}`,
    ]);
    expect(registryDrift([...STRATEGIES, next], { ...PUBLISHED, 'standard@3': strategyFingerprint(next) })).toEqual([]);
  });

  it('fails when a published entry is removed or a name and version is defined twice', () => {
    const withoutDeepV1 = STRATEGIES.filter((e) => !(e.name === 'deep' && e.version === 1));
    expect(registryDrift(withoutDeepV1, PUBLISHED)).toEqual(['deep@1 was removed, but runs planned with it still name it']);
    expect(registryDrift([...STRATEGIES, strategyEntry('deep', 1)!], PUBLISHED)).toEqual(['deep@1 is defined twice']);
  });

  it('cannot be changed while the program runs', () => {
    const deep = strategyEntry('deep', 1)!;
    expect(Object.isFrozen(STRATEGIES)).toBe(true);
    expect(() => {
      (deep.caps as { verifier_max_turns: number }).verifier_max_turns = 3;
    }).toThrow(TypeError);
    expect(() => {
      (deep.models as { verifier_model: string }).verifier_model = 'something-else';
    }).toThrow(TypeError);
    expect(deep.caps.verifier_max_turns).toBe(12);
  });

  it('holds today’s settings as standard v1 and deep v1', () => {
    expect(strategyEntry('standard', 1)).toEqual({
      name: 'standard',
      version: 1,
      models: { session_model: 'claude-sonnet-5', subagent_model: null, verifier_model: 'claude-opus-5', page_reader_model: 'claude-haiku-4-5-20251001' },
      caps: { session_max_turns: 60, verifier_max_turns: 12, audit_max_turns: 16 },
    });
    expect(strategyEntry('deep', 1)).toMatchObject({
      models: { session_model: 'claude-opus-5', subagent_model: 'claude-sonnet-5', verifier_model: 'claude-opus-5', page_reader_model: 'claude-haiku-4-5-20251001' },
      caps: { session_max_turns: 60, verifier_max_turns: 12, audit_max_turns: 16 },
    });
    expect(strategyEntry('hybrid', 1)).toEqual({
      name: 'hybrid',
      version: 1,
      models: {
        session_model: 'claude-sonnet-5',
        subagent_model: 'claude-sonnet-5',
        escalation_model: 'claude-opus-5',
        verifier_model: 'claude-opus-5',
        page_reader_model: 'claude-haiku-4-5-20251001',
      },
      caps: { session_max_turns: 60, verifier_max_turns: 12, audit_max_turns: 16, escalation_max_turns: 40 },
    });
  });

  it('resolves a name to its newest version and name@version to that version exactly', () => {
    expect(resolveStrategy('deep')).toBe(latestStrategy('deep'));
    expect(resolveStrategy('deep@1')).toBe(strategyEntry('deep', 1));
    expect(resolveStrategy('hybrid')).toBe(latestStrategy('hybrid'));
    expect(resolveStrategy('hybrid@1')).toBe(strategyEntry('hybrid', 1));
    expect(() => resolveStrategy('deep@9')).toThrow(/unknown research strategy "deep@9"; known: standard@1, deep@1, hybrid@1, operator-defaults@1/);
    expect(() => resolveStrategy('fast')).toThrow(/unknown research strategy/);
    expect(() => resolveStrategy('deep@0')).toThrow(/unknown research strategy/);
  });
});

describe('the strategy a plan records', () => {
  it('records a chosen strategy’s name, version, models and caps, whatever the operator’s settings say', () => {
    const plan = renderPlan({
      config,
      dimensions: [],
      strategy: 'deep',
      modelDefaults: { session_model: 'operator-researcher', verifier_model: 'operator-verifier', page_reader_model: 'operator-reader' },
    });
    expect(plan).toMatchObject({
      strategy: 'deep',
      strategy_version: 1,
      models: { session_model: 'claude-opus-5', subagent_model: 'claude-sonnet-5', verifier_model: 'claude-opus-5', page_reader_model: 'claude-haiku-4-5-20251001' },
      caps: { session_max_turns: 60, verifier_max_turns: 12, audit_max_turns: 16 },
    });

    const hybridPlan = renderPlan({ config, dimensions: [], strategy: 'hybrid' });
    expect(hybridPlan).toMatchObject({
      strategy: 'hybrid',
      strategy_version: 1,
      models: {
        session_model: 'claude-sonnet-5',
        subagent_model: 'claude-sonnet-5',
        escalation_model: 'claude-opus-5',
        verifier_model: 'claude-opus-5',
        page_reader_model: 'claude-haiku-4-5-20251001',
      },
      caps: { session_max_turns: 60, verifier_max_turns: 12, audit_max_turns: 16, escalation_max_turns: 40 },
    });
  });

  it('records operator-defaults v1 and the models the operator’s settings resolve to when no strategy is chosen', () => {
    const plan = renderPlan({
      config,
      dimensions: [],
      modelDefaults: { session_model: 'operator-researcher', subagent_model: null, verifier_model: '  ', page_reader_model: 'operator-reader' },
    });
    expect(plan.strategy).toBe('operator-defaults');
    expect(plan.strategy_version).toBe(1);
    // A blank setting is not a model: the entry's fallback stands in for it.
    expect(plan.models).toEqual({ session_model: 'operator-researcher', subagent_model: null, verifier_model: 'claude-opus-5', page_reader_model: 'operator-reader' });
    expect(plan.caps).toEqual({ session_max_turns: 60, verifier_max_turns: 12, audit_max_turns: 16 });

    // With no settings at all, the entry's own models.
    expect(renderPlan({ config, dimensions: [] }).models).toEqual(strategyEntry('operator-defaults', 1)!.models);
  });

  it('provides immutable Claude 5.5 v2 entries (standard@2, deep@2, hybrid@2) as explicit opt-ins while keeping v1 default', () => {
    expect(latestStrategy('standard')).toBe(strategyEntry('standard', 1));
    expect(latestStrategy('deep')).toBe(strategyEntry('deep', 1));
    expect(latestStrategy('hybrid')).toBe(strategyEntry('hybrid', 1));
    expect(latestStrategy('standard', { includeOptIn: true })).toBe(strategyEntry('standard', 2));
    expect(latestStrategy('deep', { includeOptIn: true })).toBe(strategyEntry('deep', 2));
    expect(latestStrategy('hybrid', { includeOptIn: true })).toBe(strategyEntry('hybrid', 2));

    expect(resolveStrategy('standard@2')).toEqual({
      name: 'standard',
      version: 2,
      models: {
        session_model: 'claude-sonnet-5-5',
        subagent_model: null,
        verifier_model: 'claude-opus-5-5',
        page_reader_model: 'claude-haiku-5-5',
      },
      caps: { session_max_turns: 60, verifier_max_turns: 4, audit_max_turns: 16 },
      optIn: true,
    });
    expect(resolveStrategy('deep@2')).toEqual({
      name: 'deep',
      version: 2,
      models: {
        session_model: 'claude-opus-5-5',
        subagent_model: 'claude-haiku-5-5',
        verifier_model: 'claude-opus-5-5',
        page_reader_model: 'claude-haiku-5-5',
      },
      caps: { session_max_turns: 60, verifier_max_turns: 4, audit_max_turns: 16 },
      optIn: true,
    });
    expect(resolveStrategy('hybrid@2')).toEqual({
      name: 'hybrid',
      version: 2,
      models: {
        session_model: 'claude-sonnet-5-5',
        subagent_model: 'claude-haiku-5-5',
        escalation_model: 'claude-opus-5-5',
        verifier_model: 'claude-opus-5-5',
        page_reader_model: 'claude-haiku-5-5',
      },
      caps: { session_max_turns: 60, verifier_max_turns: 4, audit_max_turns: 16, escalation_max_turns: 40 },
      optIn: true,
    });

    const planV2 = renderPlan({ config, dimensions: [], strategy: 'hybrid@2' });
    expect(planV2).toMatchObject({
      strategy: 'hybrid',
      strategy_version: 2,
      models: {
        session_model: 'claude-sonnet-5-5',
        subagent_model: 'claude-haiku-5-5',
        escalation_model: 'claude-opus-5-5',
        verifier_model: 'claude-opus-5-5',
        page_reader_model: 'claude-haiku-5-5',
      },
      caps: { session_max_turns: 60, verifier_max_turns: 4, audit_max_turns: 16, escalation_max_turns: 40 },
    });
  });

  it('copies the entry into the plan, so a stored plan never shares the registry’s objects', () => {
    const plan = renderPlan({ config, dimensions: [], strategy: 'standard@1' });
    expect(plan.caps).not.toBe(strategyEntry('standard', 1)!.caps);
    expect(plan.models).not.toBe(strategyEntry('standard', 1)!.models);
    expect(() => renderPlan({ config, dimensions: [], strategy: 'standard@7' })).toThrow(/unknown research strategy/);
  });
});
