import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEAD_CHARS,
  DEFAULT_MAX_TOTAL_CHARS,
  DEFAULT_WINDOW_RADIUS,
  extractValuePassages,
} from './passages.js';

describe('extractValuePassages', () => {
  it('handles empty or whitespace-only source text', () => {
    const res = extractValuePassages({ sourceText: '   \n\t  ', value: 61.2 });
    expect(res.valueFound).toBe(false);
    expect(res.passages).toEqual([]);
    expect(res.documentHead).toBe('');
    expect(res.totalChars).toBe(0);
  });

  it('extracts a bounded ±1,500-char window around the matched numeric figure', () => {
    const before = 'A'.repeat(3_000);
    const middle = ' In The Bronx, 61.2% of renter households were cost-burdened in 2024. ';
    const after = 'B'.repeat(3_000);
    const sourceText = `${before}${middle}${after}`;

    const res = extractValuePassages({
      sourceText,
      value: 61.2,
      indicatorName: 'Cost-burdened renter households',
    });

    expect(res.valueFound).toBe(true);
    expect(res.passages).toHaveLength(1);
    expect(res.passages[0]!.matchKind).toBe('value');
    expect(res.passages[0]!.text).toContain('61.2%');
    // Window covers ±1,500 chars around "61.2" -> ~3,004 chars
    expect(res.passages[0]!.text.length).toBeLessThanOrEqual(DEFAULT_WINDOW_RADIUS * 2 + 10);
    expect(res.documentHead.length).toBe(DEFAULT_HEAD_CHARS);
  });

  it('matches thousands-separated, scaled, and rounded value forms', () => {
    const thousands = extractValuePassages({
      sourceText: 'Annual ridership totaled 1,250,000 trips across the transit network.',
      value: 1250000,
    });
    expect(thousands.valueFound).toBe(true);
    expect(thousands.passages[0]!.text).toContain('1,250,000');

    const scaled = extractValuePassages({
      sourceText: 'Table 2 (in millions): regional emissions stood at 1.2 in 2023.',
      value: '1.2 million',
    });
    expect(scaled.valueFound).toBe(true);
    expect(scaled.passages[0]!.text).toContain('1.2');

    const rounded = extractValuePassages({
      sourceText: 'Census ACS table reports 61.24% cost-burdened renter households.',
      value: 61.2,
    });
    expect(rounded.valueFound).toBe(true);
    expect(rounded.passages[0]!.text).toContain('61.24%');
  });

  it('merges overlapping hits and enforces the 6,000-char total cap', () => {
    const chunk = (n: number) => `${'x'.repeat(2_200)} Table ${n}: value is 14.6% here. ${'y'.repeat(2_200)}`;
    const sourceText = [chunk(1), chunk(2), chunk(3), chunk(4)].join('\n');

    const res = extractValuePassages({
      sourceText,
      value: 14.6,
    });

    expect(res.valueFound).toBe(true);
    expect(res.totalChars).toBeLessThanOrEqual(DEFAULT_MAX_TOTAL_CHARS);
    expect(res.passages.reduce((s, p) => s + p.text.length, 0)).toBe(res.totalChars);
    expect(res.passages[0]!.text).toContain('14.6%');
  });

  it('falls back to top keyword windows when the claimed value is absent', () => {
    const filler = 'Municipal procurement agenda and procedural minutes. '.repeat(120);
    const relevant =
      'Housing Affordability Section: Cost-burdened renter households paying more than 30% of income on rent in Bronx County reached 58.9%.';
    const sourceText = `${filler}\n${relevant}\n${filler}`;

    const res = extractValuePassages({
      sourceText,
      value: 61.2,
      indicatorName: 'Cost-burdened renter households',
      indicatorSlug: 'cost-burdened-renters',
      unit: '% of renter households',
    });

    expect(res.valueFound).toBe(false);
    expect(res.passages.length).toBeGreaterThan(0);
    expect(res.passages[0]!.matchKind).toBe('keyword');
    expect(res.passages[0]!.text).toContain('58.9%');
    expect(res.totalChars).toBeLessThanOrEqual(DEFAULT_MAX_TOTAL_CHARS);
  });

  it('falls back to leading head excerpt when neither value nor keywords appear', () => {
    const sourceText = '403 Forbidden — Access Denied by Web Application Firewall.';
    const res = extractValuePassages({
      sourceText,
      value: 20.2,
      indicatorName: 'Food insecurity',
    });

    expect(res.valueFound).toBe(false);
    expect(res.passages).toHaveLength(1);
    expect(res.passages[0]!.matchKind).toBe('head');
    expect(res.passages[0]!.text).toContain('403 Forbidden');
  });
});
