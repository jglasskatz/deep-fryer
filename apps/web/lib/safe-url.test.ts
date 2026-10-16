import { describe, expect, it } from 'vitest';
import { safeHref, sameSitePath } from './safe-url';

describe('safeHref', () => {
  it('passes http(s) and blocks script and data URLs', () => {
    expect(safeHref('https://data.cityofnewyork.us/x')).toBe('https://data.cityofnewyork.us/x');
    expect(safeHref('  http://example.gov ')).toBe('http://example.gov');
    expect(safeHref('javascript:alert(document.cookie)')).toBeUndefined();
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,<script>')).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
  });
});

describe('sameSitePath', () => {
  it('keeps paths on this site, with their query and fragment', () => {
    expect(sameSitePath('/nyc')).toBe('/nyc');
    expect(sameSitePath('/es/nyc/dim/food?x=1#get-involved')).toBe('/es/nyc/dim/food?x=1#get-involved');
    expect(sameSitePath('/')).toBe('/');
  });

  it('refuses whatever a browser would resolve to another site', () => {
    // As they arrive from `?next=`: %09, %0a, %0d and %5c already decoded.
    // Browsers drop tabs and newlines and read `\` as `/`, so each of these
    // becomes //evil.example.
    for (const bad of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/\t\\evil.example', '\t//evil.example', '/\\/evil.example']) {
      expect(sameSitePath(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('refuses anything that is not a path', () => {
    for (const bad of [undefined, null, '', 'nyc', 'https://evil.example', 'javascript:alert(1)']) {
      expect(sameSitePath(bad)).toBeNull();
    }
  });

  it('hands back the parsed path, with nothing a later reader could take differently', () => {
    expect(sameSitePath('/nyc\t/dim')).toBe('/nyc/dim');
    expect(sameSitePath('/a b?q=c d')).toBe('/a%20b?q=c%20d');
  });
});
