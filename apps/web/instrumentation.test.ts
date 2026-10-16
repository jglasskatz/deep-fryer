import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * What the web app says when it starts (instrumentation.ts): a misspelt name
 * in the feature kill switch is reported once, as a warning, and does not
 * stop the process.
 */
describe('register', () => {
  const saved = { runtime: process.env.NEXT_RUNTIME, disabled: process.env.DF_DISABLED_FEATURES };
  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of [
      ['NEXT_RUNTIME', saved.runtime],
      ['DF_DISABLED_FEATURES', saved.disabled],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('warns about kill-switch names that switch nothing off, naming the real ones', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.DF_DISABLED_FEATURES = 'emergencies,policy_analysis';
    const { register } = await import('./instrumentation');
    await register();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/"emergencies" is not a feature name.*emergency, policy_analysis/);
  });

  it('says nothing when every name is known', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.DF_DISABLED_FEATURES = 'emergency';
    const { register } = await import('./instrumentation');
    await register();
    expect(warn).not.toHaveBeenCalled();
  });
});
