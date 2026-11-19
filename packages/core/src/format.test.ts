import { describe, expect, it } from 'vitest';
import { formatIndicatorValue } from './format';
import { formatCalculatedValue } from './format-calculated';

describe('formatIndicatorValue', () => {
  it('retains source precision for Gini values, measurements and targets', () => {
    expect(formatIndicatorValue(0.4936, 'Gini 0–1')).toBe('0.4936 Gini 0–1');
    expect(formatIndicatorValue(0.555, 'index 0–1')).toBe('0.555 index 0–1');
    expect(formatIndicatorValue(0.02445486290781771, 'lb per resident per year'))
      .toBe('0.02445486290781771 lb per resident per year');
    expect(formatIndicatorValue(0.0009642343384170714, 'lb per resident per year'))
      .toBe('0.0009642343384170714 lb per resident per year');
    expect(formatIndicatorValue(0.001, '%')).toBe('0.001%');
  });

  it('prints every digit of a stored value, even past 15 significant digits', () => {
    expect(formatIndicatorValue(14.7185217, '')).toBe('14.7185217');
    expect(formatIndicatorValue(0.0009642343384170714, 'lb')).toBe('0.0009642343384170714 lb');
    expect(formatIndicatorValue(0.1 + 0.2, '')).toBe('0.30000000000000004');
  });

  it('never rounds small nonzero values to zero', () => {
    expect(formatIndicatorValue(7.199e-7, 'lbs per resident per year'))
      .toBe('7.199E-7 lbs per resident per year');
    expect(formatIndicatorValue(-7.199e-7, 'units')).toBe('-7.199E-7 units');
    expect(formatIndicatorValue(Number.MIN_VALUE, '')).toBe('5E-324');
    expect(formatIndicatorValue(0, 'units')).toBe('0 units');
  });

  it('keeps familiar count, percent and qualitative formatting', () => {
    expect(formatIndicatorValue(13361, 'homes/year')).toBe('13,361 homes/year');
    expect(formatIndicatorValue(61.2, '% of renter households')).toBe('61.2% of renter households');
    expect(formatIndicatorValue('Meets standards', '')).toBe('Meets standards');
    expect(formatIndicatorValue(null, '%')).toBe('Data needed');
    expect(formatIndicatorValue(NaN, '%')).toBe('Data needed');
    expect(formatIndicatorValue(Infinity, '%')).toBe('Data needed');
  });
});

describe('formatCalculatedValue', () => {
  it('drops floating-point noise from values the app calculated', () => {
    expect(formatCalculatedValue(0.1 + 0.2, '%')).toBe('0.3%');
    expect(formatCalculatedValue(1.1 * 3, 'units')).toBe('3.3 units');
    expect(formatCalculatedValue(28 / 15, '')).toBe('1.86666666666667');
    expect(formatCalculatedValue(0.0009642343384170714, 'lb')).toBe('0.000964234338417071 lb');
  });

  it('prints negative zero as zero', () => {
    expect(formatCalculatedValue(-0, '')).toBe('0');
    expect(formatCalculatedValue(-0, '%')).toBe('0%');
  });

  it('keeps short values and the same unit rules as stored values', () => {
    expect(formatCalculatedValue(0.024, 'lb')).toBe('0.024 lb');
    expect(formatCalculatedValue(13361, 'homes/year')).toBe('13,361 homes/year');
    expect(formatCalculatedValue(61.2, '% of renter households')).toBe('61.2% of renter households');
    expect(formatCalculatedValue(-7.199e-7, 'units')).toBe('-7.199E-7 units');
    expect(formatCalculatedValue(Number.MAX_VALUE, '')).toBe(formatIndicatorValue(Number.MAX_VALUE, ''));
    expect(formatCalculatedValue(NaN, '%')).toBe('Data needed');
    expect(formatCalculatedValue(null, '%')).toBe('Data needed');
  });
});
