import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPlannedRunIn: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('./auth', () => ({
  requireTenantRole: vi.fn(async () => ({ tenant: { id: 'tenant-1', slug: 'santa-cruz' } })),
  getAuth: vi.fn(async () => ({ userId: 'user-1' })),
}));
vi.mock('./research', () => ({ createPlannedRunIn: mocks.createPlannedRunIn }));
vi.mock('./db', () => ({
  userDb: vi.fn(async (fn: (db: unknown) => Promise<unknown>) => {
    const fakeDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              id: '11111111-1111-4111-8111-111111111111',
              tenantId: 'tenant-1',
              slug: 'housing',
              plan: { sessions: [], config_hash: 'h', plugin_version: '1', strategy: 'standard', strategy_version: 1 },
              execution: { provider: 'anthropic', endpoint_host: 'api.anthropic.com', executor: 'shared_worker', host_region: null },
            },
          ]),
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(async () => []),
            })),
          })),
        })),
      })),
      insert: vi.fn(() => ({ values: vi.fn(async () => {}) })),
    };
    return fn(fakeDb);
  }),
}));

import { reResearchDimension } from './review-actions';

describe('reResearchDimension strategy wiring', () => {
  beforeEach(() => {
    mocks.createPlannedRunIn.mockReset();
    mocks.createPlannedRunIn.mockResolvedValue({ run: { id: 'planned-run-9' }, sessionCount: 1 });
  });

  it('forwards chosen strategy (hybrid, standard, deep) to createPlannedRunIn', async () => {
    for (const strategy of ['hybrid', 'standard', 'deep'] as const) {
      mocks.createPlannedRunIn.mockClear();
      const res = await reResearchDimension({
        tenantSlug: 'santa-cruz',
        runId: '11111111-1111-4111-8111-111111111111',
        dimensionId: '22222222-2222-4222-8222-222222222222',
        notes: 'Check the updated 2025 ACS table.',
        cause: 'out_of_date',
        strategy,
      });
      expect(res).toEqual({ ok: true, data: { runId: 'planned-run-9' } });
      expect(mocks.createPlannedRunIn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: 'tenant-1',
          dimensionIds: ['11111111-1111-4111-8111-111111111111'],
          strategy,
        }),
      );
    }
  });

  it('rejects unknown strategy values before planning anything', async () => {
    const res = await reResearchDimension({
      tenantSlug: 'santa-cruz',
      runId: '11111111-1111-4111-8111-111111111111',
      dimensionId: '22222222-2222-4222-8222-222222222222',
      notes: 'Use 2025 ACS.',
      cause: 'out_of_date',
      strategy: 'bogus' as never,
    });
    expect(res).toEqual({ ok: false, error: 'Choose the standard, hybrid, or deep research strategy.' });
    expect(mocks.createPlannedRunIn).not.toHaveBeenCalled();
  });
});
