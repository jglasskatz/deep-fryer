import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestUpdateReload, resetUpdateRequestForTests, shouldReloadOnControllerChange } from './pwa-store';

/**
 * The page reloads when the service worker's controller changes only after
 * this tab's reader accepted an update — not when the first install claims
 * the page, which used to reload every first-time visitor's page a few
 * seconds in, losing anything they had typed.
 */
describe('update reload', () => {
  afterEach(() => resetUpdateRequestForTests());

  it('does not reload for a controller change nobody asked for (the first install, another tab)', () => {
    expect(shouldReloadOnControllerChange()).toBe(false);
  });

  it("reloads once this tab's reader pressed Reload, which asks the waiting worker to activate", () => {
    const worker = { postMessage: vi.fn() };
    requestUpdateReload(worker);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(shouldReloadOnControllerChange()).toBe(true);
  });
});
