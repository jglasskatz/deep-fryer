import React, { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  planResearchAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/research-actions', () => ({ planResearchAction: mocks.planResearchAction }));
vi.mock('@/lib/use-action', () => ({
  useAction: () => ({
    run: (fn: () => Promise<void>) => fn(),
    pending: false,
    error: null,
  }),
}));

import { ReplanFailed } from './ReplanFailed';

function findButton(node: ReactNode): ReactElement<{ onClick?: () => Promise<void> }> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findButton(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => Promise<void> }>(node)) return null;
  if (node.type === 'button') return node;
  return findButton(node.props.children);
}

describe('ReplanFailed preserves failed run strategy', () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.planResearchAction.mockReset();
    mocks.planResearchAction.mockResolvedValue({ ok: true, data: { runId: 'new-run-1', sessionCount: 2 } });
  });

  it('forwards strategy (e.g. hybrid or deep) to planResearchAction when replanning failed dimensions', async () => {
    const tree = ReplanFailed({ tenantSlug: 'santa-cruz', dimensionIds: ['d1', 'd2'], strategy: 'hybrid' });
    const btn = findButton(tree)!;
    await btn.props.onClick!();
    expect(mocks.planResearchAction).toHaveBeenCalledWith({
      tenantSlug: 'santa-cruz',
      dimensionIds: ['d1', 'd2'],
      strategy: 'hybrid',
    });
    expect(mocks.push).toHaveBeenCalledWith('/santa-cruz/admin/research/new-run-1');
  });

  it('omits strategy when retrying a historic or operator-defaults run', async () => {
    const tree = ReplanFailed({ tenantSlug: 'santa-cruz', dimensionIds: ['d1'] });
    const btn = findButton(tree)!;
    await btn.props.onClick!();
    expect(mocks.planResearchAction).toHaveBeenCalledWith({
      tenantSlug: 'santa-cruz',
      dimensionIds: ['d1'],
    });
  });
});
