import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ApiKeyForm, PROVIDER_KEY_GUIDES } from './ApiKeyForm';

vi.stubGlobal('React', React);

describe('ApiKeyForm', () => {
  it('renders the 3-step API key instructions with verified console links for all providers', () => {
    const html = renderToStaticMarkup(createElement(ApiKeyForm, { orgSlug: 'santacruz', onFile: [], canSave: true }));
    expect(html).toContain('How to get a key from Anthropic (3 steps)');
    expect(html).toContain('https://console.anthropic.com/settings/keys');
    expect(html).toContain('Anthropic Console');
    expect(html).toContain('Typical cost:');

    expect(PROVIDER_KEY_GUIDES.anthropic.consoleUrl).toBe('https://console.anthropic.com/settings/keys');
    expect(PROVIDER_KEY_GUIDES.openai.consoleUrl).toBe('https://platform.openai.com/api-keys');
    expect(PROVIDER_KEY_GUIDES.google.consoleUrl).toBe('https://aistudio.google.com/apikey');
  });
});
