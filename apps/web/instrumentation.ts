/**
 * Runs once when the server process starts. Production refuses to boot with
 * a configuration that would be unsafe or silently broken (lib/env.ts) —
 * failing the deploy beats serving a city's admin surface in dev mode. The
 * process exits non-zero so the container restarts/fails visibly instead of
 * idling half-started.
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
  }
}
