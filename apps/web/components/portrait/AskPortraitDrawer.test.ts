import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AskPortraitDrawer, type AskPortraitDrawerProps } from './AskPortraitDrawer';

vi.stubGlobal('React', React);

const render = (props: AskPortraitDrawerProps) => renderToStaticMarkup(createElement(AskPortraitDrawer, props));

describe('AskPortraitDrawer', () => {
  const baseProps: AskPortraitDrawerProps = {
    tenantSlug: 'ithaca',
    tenantName: 'City of Ithaca',
    suggestedQuestions: [
      'What are the latest housing figures and targets in this portrait?',
      'Which indicators currently have documented data gaps?',
    ],
  };

  it('renders only the restrained trigger button when closed', () => {
    const html = render(baseProps);
    expect(html).toContain('Ask this portrait');
    expect(html).not.toContain('role="dialog"');
  });

  it('renders suggested questions and honest archived-source disclaimer when open', () => {
    const html = render({ ...baseProps, initialOpen: true, canIncludeDrafts: false });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Ask City of Ithaca');
    expect(html).toContain('What are the latest housing figures and targets in this portrait?');
    expect(html).toContain('archived sources');
    expect(html).not.toContain('Include unpublished drafts');
  });

  it('renders the member-only drafts checkbox only when canIncludeDrafts is true', () => {
    const html = render({ ...baseProps, initialOpen: true, canIncludeDrafts: true });
    expect(html).toContain('Include unpublished drafts and internal policy analyses');
  });

  it('renders grounded answers with safe clickable citations and neutralizes unsafe URLs', () => {
    const html = render({
      ...baseProps,
      initialOpen: true,
      initialResponse: {
        answer: 'Rent burden reached 46.2% in 2024 [1] across the city [2].',
        scope: 'public',
        grounded: true,
        citations: [
          {
            index: 1,
            chunkId: 'c1',
            title: 'Housing: Rent-burdened households',
            citationLabel: 'Housing: Rent-burdened households (US Census ACS, 2024)',
            citationUrl: 'https://data.census.gov/table/ACSDP5Y2024',
            sourceKind: 'indicator',
            dimensionSlug: 'housing',
            visibility: 'public',
          },
          {
            index: 2,
            chunkId: 'c2',
            title: 'Housing overview',
            citationLabel: 'Housing (Portrait dimension v1)',
            citationUrl: '/ithaca/dim/housing',
            sourceKind: 'indicator',
            dimensionSlug: 'housing',
            visibility: 'public',
          },
          {
            index: 3,
            chunkId: 'c3',
            title: 'Unsafe source',
            citationLabel: 'Malicious source label',
            citationUrl: 'javascript:alert(1)',
            sourceKind: 'indicator',
            dimensionSlug: 'housing',
            visibility: 'public',
          },
        ],
      },
    });
    expect(html).toContain('Grounded in 3 archived sources');
    expect(html).toContain('href="https://data.census.gov/table/ACSDP5Y2024"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain('href="/ithaca/dim/housing"');
    expect(html).toContain('Malicious source label');
    expect(html).not.toContain('javascript:');
  });

  it('labels ungrounded answers honestly', () => {
    const html = render({
      ...baseProps,
      initialOpen: true,
      initialResponse: {
        answer: "This portrait's archived sources do not contain enough information to answer that question.",
        scope: 'public',
        grounded: false,
        citations: [],
      },
    });
    expect(html).toContain('Not covered by archived sources');
    expect(html).not.toContain('Sources cited');
  });
});
