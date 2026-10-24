import { describe, expect, it } from 'vitest';
import { comparisonScores, insightGeometry, insightMode } from './insights-modes';
const scores = [{ slug: 'whole', level: 10 }, { slug: 'a', level: -25 }, { slug: 'b', level: 10 }, { slug: 'c', level: 10 }, { slug: 'd', level: 80 }, { slug: 'gap', level: null }];
describe('normalized Insights score comparisons', () => {
  it('defaults unknown modes and keeps absent measurements absent', () => {
    expect(insightMode('untrusted')).toBe('absolute');
    expect(comparisonScores('absolute', scores, 'whole').get('gap')).toBeNull();
    expect(comparisonScores('absolute', scores, 'whole').get('a')).toBe(-25);
  });
  it('subtracts the published whole score without synthesizing a missing whole', () => {
    expect(comparisonScores('vs-city', scores, 'whole').get('a')).toBe(-35);
    expect(comparisonScores('vs-city', scores, 'whole').get('whole')).toBe(0);
    expect([...comparisonScores('vs-city', scores, 'missing').values()].every(value => value === null)).toBe(true);
  });
  it('ranks available members with ties, excluding whole and gaps', () => {
    expect(Object.fromEntries(comparisonScores('rank', scores, 'whole'))).toEqual({ whole: null, a: 1, b: 2, c: 2, d: 4, gap: null });
  });
  it('makes the zero target explicit and places each scale correctly', () => {
    expect(comparisonScores('vs-target', scores, 'whole')).toEqual(comparisonScores('absolute', scores, 'whole'));
    expect(insightGeometry(100, 'vs-city', 5)).toEqual({ zeroX: 50, left: 50, width: 20 });
    expect(insightGeometry(5, 'rank', 5)).toEqual({ zeroX: 0, left: 0, width: 100 });
  });
});
