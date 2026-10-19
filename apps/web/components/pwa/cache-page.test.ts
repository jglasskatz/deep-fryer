import { describe, expect, it } from 'vitest';
import { cachePageMessage } from './cache-page';

describe('cachePageMessage', () => {
  it('names the page being shown and its own static files, each file once per tab', () => {
    const sent = new Set<string>();
    const resources = [
      'https://app.example.gov/_next/static/chunks/main.js',
      'https://app.example.gov/_next/static/css/app.css?v=1',
      'https://app.example.gov/icons/icon.svg',
      'https://cdn.example/_next/static/chunks/other.js',
      'https://app.example.gov/manhattan?_rsc=1',
    ];
    expect(cachePageMessage('https://app.example.gov/manhattan?dim=food#panel', resources, sent)).toEqual({
      type: 'CACHE_PAGE',
      url: '/manhattan?dim=food',
      assets: ['/_next/static/chunks/main.js', '/_next/static/css/app.css?v=1'],
    });
    // The next in-app navigation lists only files loaded since.
    const later = [...resources, 'https://app.example.gov/_next/static/chunks/dim.js'];
    expect(cachePageMessage('https://app.example.gov/nyc/dim/housing', later, sent).assets).toEqual([
      '/_next/static/chunks/dim.js',
    ]);
  });
});
