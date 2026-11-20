import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DimensionData } from '@deep-fryer/core';
import { DimensionEditor, reviewEditNotice } from './DimensionEditor';

// Vitest compiles JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);
// Saving calls a server action; rendering never does.
vi.mock('@/lib/actions', () => ({ saveDimensionEdit: vi.fn() }));
vi.mock('@/lib/use-action', () => ({ useAction: () => ({ run: vi.fn(), pending: false, error: null }) }));

const data: DimensionData = { name: 'Housing', icon: '', description: 'd', context: 'c', indicators: [], actions: [] };
const render = (review?: Parameters<typeof DimensionEditor>[0]['review']) =>
  renderToStaticMarkup(createElement(DimensionEditor, { tenantSlug: 'nyc', dimensionId: 'd1', initial: data, review }));

describe('the editor opened from a review card', () => {
  it('says that saving records the reviewer’s cause, beside the change note', () => {
    const html = render({ runId: 'r1', cause: 'wrong_year' });
    expect(html).toContain('You opened this from a review card. Saving also records why you changed what research found: Wrong year.');
    expect(html.indexOf('You opened this from a review card')).toBeLessThan(html.indexOf('Change note'));
  });

  it('asks for the words in the change note when the cause is "Something else"', () => {
    expect(reviewEditNotice('other')).toBe(
      'You opened this from a review card. Saving also records why you changed what research found: Something else. Say what is wrong in the change note.',
    );
  });

  it('says nothing of the kind when opened any other way', () => {
    expect(render()).not.toContain('review card');
  });
});
