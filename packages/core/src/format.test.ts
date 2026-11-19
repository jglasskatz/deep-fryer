import { describe, expect, it } from 'vitest';
import { formatIndicatorValue } from './format';

describe('formatIndicatorValue', () => {
  it('retains source precision for Gini values, measurements and targets', () => {
    expect(formatIndicatorValue(0.4936, 'Gini 0–1')).toBe('0.4936 Gini 0–1');
    expect(formatIndicatorValue(0.555, 'index 0–1')).toBe('0.555 index 0–1');
    expect(formatIndicatorValue(0.024, 'lb')).toBe('0.024 lb');
    expect(formatIndicatorValue(0.001, '%')).toBe('0.001%');
  });

  it('prints every digit a source value gave', () => {
    expect(formatIndicatorValue(14.7185217, '')).toBe('14.7185217');
    expect(formatIndicatorValue(14.7185217, 'tons CO2e per resident'))
      .toBe('14.7185217 tons CO2e per resident');
    expect(formatIndicatorValue(123456.789012345, '')).toBe('123,456.789012345');
  });

  it('drops floating-point noise from calculated values', () => {
    expect(formatIndicatorValue(0.1 + 0.2, '%')).toBe('0.3%');
    expect(formatIndicatorValue(1.1 * 3, 'units')).toBe('3.3 units');
    expect(formatIndicatorValue(28 / 15, '')).toBe('1.86666666666667');
    // Ratios that fill all 17 digits keep 15 of them.
    expect(formatIndicatorValue(0.02445486290781771, 'lb per resident per year'))
      .toBe('0.0244548629078177 lb per resident per year');
    expect(formatIndicatorValue(0.0009642343384170714, 'lb per resident per year'))
      .toBe('0.000964234338417071 lb per resident per year');
  });

  it('prints negative zero as zero', () => {
    expect(formatIndicatorValue(-0, '')).toBe('0');
    expect(formatIndicatorValue(-0, '%')).toBe('0%');
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
