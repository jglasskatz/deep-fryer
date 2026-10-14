import { describe, expect, it } from 'vitest';
import { safeHref } from './safe-url';

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
