import { formatIndicatorValue } from './format.js';

/**
 * The most significant digits a calculated number keeps. A double carries 15
 * to 17 significant decimal digits, and arithmetic noise (0.1 + 0.2 =
 * 0.30000000000000004) lives in the 16th and 17th. Every decimal of 15 digits
 * or fewer survives the trip into a double and back, so rounding to 15 drops
 * the noise and nothing else.
 */
const CALCULATED_SIGNIFICANT_DIGITS = 15;

/**
 * Show a number the app calculated (a difference, a change, a ratio) with the
 * same unit rules as formatIndicatorValue, in its shortest form at no more
 * than 15 significant digits. Negative zero prints as "0".
 *
 * Only for values produced by arithmetic in the app. A value read from a
 * source or a published file goes through formatIndicatorValue, which keeps
 * every digit it has. This lives apart from format.ts because the public
 * site publishes that file as is, and its bytes stay unchanged.
 */
export function formatCalculatedValue(
  value: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  return formatIndicatorValue(typeof value === 'number' ? roundCalculated(value) : value, unit);
}

function roundCalculated(value: number): number {
  // NaN and Infinity stay as they are and read "Data needed".
  if (!Number.isFinite(value)) return value;
  // toPrecision turns -0 into "0", so negative zero comes back as 0.
  const rounded = Number(value.toPrecision(CALCULATED_SIGNIFICANT_DIGITS));
  // Only the largest doubles can round up past Number.MAX_VALUE; keep those.
  return Number.isFinite(rounded) ? rounded : value;
}
