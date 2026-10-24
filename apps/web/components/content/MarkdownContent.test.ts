import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownContent } from './MarkdownContent';

vi.stubGlobal('React', React);
const render = (body: string) => renderToStaticMarkup(React.createElement(MarkdownContent, { body }));

describe('civic page content', () => {
  it('renders headings, lists, paragraphs, literal code and safe source links', () => {
    const html = render('# Adopted plan\n\nPublic context.\n\n- [Read the source](https://city.example/plan)\n- Attend a hearing\n\n```\n<script>literal()</script>\n```');
    expect(html).toContain('<h2');
    expect(html).toContain('<ul');
    expect(html).toContain('href="https://city.example/plan"');
    expect(html).toContain('&lt;script&gt;literal()&lt;/script&gt;');
  });

  it('never executes raw HTML, JSX, imports or unsafe links', () => {
    const html = render('<img src=x onerror=alert(1)>\n{process.env.SECRET}\n\n[Click](javascript:alert)\n[Other](data:text/html,boom)');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    expect(html).toContain('&lt;img');
    expect(html).toContain('{process.env.SECRET}');
  });
});
