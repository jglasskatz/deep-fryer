/**
 * Runs once when the server process starts. Production refuses to boot with
 * a configuration that would be unsafe or silently broken (lib/env.ts) —
 * failing the deploy beats serving a city's admin surface in dev mode.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionEnv } = await import('./lib/env');
    assertProductionEnv();
  }
}
