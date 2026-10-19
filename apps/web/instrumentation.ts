/**
 * Runs once when the server process starts. Production refuses to boot with
 * a configuration that would be unsafe or silently broken (lib/env.ts) —
 * failing the deploy beats serving a city's admin surface in dev mode. The
 * process exits non-zero so the container restarts/fails visibly instead of
 * idling half-started.
 *
 * A misspelt name in the feature kill switch (DF_DISABLED_FEATURES) is only
 * a warning — a typo must not take the site down — but it is said here, once,
 * because otherwise the feature it meant simply stays on.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionEnv } = await import('./lib/env');
    try {
      assertProductionEnv();
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
    const { unknownDisabledFeaturesMessage } = await import('@deep-fryer/core');
    const unknown = unknownDisabledFeaturesMessage(process.env.DF_DISABLED_FEATURES);
    if (unknown) console.warn(unknown);
  }
}
