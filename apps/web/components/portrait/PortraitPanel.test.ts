import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { InvolvementListingView } from '@deep-fryer/core';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { en } from '@/lib/i18n/messages/en';
import { panelLabels, portraitPanelViews } from '@/lib/portrait-panel';
import type { PublishedDimension } from '@/lib/portrait';
import { PortraitPanel } from './PortraitPanel';

/**
 * A listing's tap-to-call link in the portrait panel reads "Call 311", not
 * "Call311". The link is a flex container (a 44 px target), and in flex
 * layout each run of text is its own item whose edge spaces are dropped —
 * so the words and the number must be one item.
 */

vi.stubGlobal('React', React);

const housing: PublishedDimension = {
  slug: 'housing',
  ring: 'social',
  canonical_slug: null,
  display_order: 7,
  viz_level: 40,
  data: { name: en.dimensions.housing, icon: '', description: '', context: '', indicators: [], actions: [] },
  published_at: null,
  version_num: 1,
};

const listing: InvolvementListingView = {
  id: 'l1',
  name: 'Tenant hotline',
  description: 'Help with repairs and rent.',
  url: null,
  phone: '311',
  kind: 'services',
  dimension_slugs: ['housing'],
  link_checked_at: null,
  display_order: 0,
};

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

describe('the portrait panel’s call link', () => {
  it('keeps the space between "Call" and the number', () => {
    const [view] = portraitPanelViews([housing], {
      m: en,
      locale: 'en',
      evidenceUrl: (path) => `/evidence/ithaca/${path}`,
      listings: [listing],
    });
    const html = renderToStaticMarkup(
      createElement(
        AppRouterContext.Provider,
        { value: router },
        createElement(PortraitPanel, {
          view: view!,
          labels: panelLabels(en),
          doughnut: doughnutLabels(en),
          headingId: 'panel-heading',
          headingRef: null,
          fullHref: (slug) => `/ithaca/dim/${slug}`,
          closeHref: '/ithaca',
          onClose: () => {},
          discussion: false,
          englishNote: false,
        }),
      ),
    );
    const link = /<a class="inline-flex[^"]*" href="tel:311">(.*?)<\/a>/.exec(html);
    expect(link, 'a tap-to-call link').not.toBeNull();
    // Exactly one flex item, holding the whole phrase with its space.
    expect(link![1]).toBe('<span>Call <span dir="ltr">311</span></span>');
  });
});
