/**
 * The most significant digits a displayed number keeps. A double carries
 * 15 to 17 significant decimal digits, and arithmetic noise (0.1 + 0.2 =
 * 0.30000000000000004) lives in the 16th and 17th. Every decimal of 15 digits
 * or fewer survives the trip into a double and back, so rounding to 15 drops
 * the noise without dropping any digit a source could have written.
 */
const MAX_SIGNIFICANT_DIGITS = 15;

/**
 * One rule for showing indicator values everywhere (SPEC v3 W1/W4): a number
 * never appears without its unit. Percent-style units attach directly
 * ("61.2% of renter households"); everything else gets a space
 * ("13,361 homes/year"). Non-numeric values pass through with the unit
 * appended. Numeric values are not cut to a fixed number of decimal places:
 * each prints in its shortest form at up to 15 significant digits, so a
 * value read from a source keeps its digits and a calculated value loses only
 * floating-point noise. Negative zero prints as "0". Very small values use
 * scientific notation so a nonzero measurement never appears as zero.
 */
export function formatIndicatorValue(
  value: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '' ||
      (typeof value === 'number' && !Number.isFinite(value))) return 'Data needed';
  const num = typeof value === 'number' ? formatNumber(value) : String(value);
  const u = (unit ?? '').trim();
  if (!u) return num;
  if (u.startsWith('%')) {
    const rest = u.slice(1).trim();
    return rest ? `${num}% ${rest}` : `${num}%`;
  }
  return `${num} ${u}`;
}

function formatNumber(value: number): string {
  // `-0 === 0`, so this also turns negative zero into plain zero.
  if (value === 0) return '0';
  return value.toLocaleString('en-US', {
    maximumSignificantDigits: MAX_SIGNIFICANT_DIGITS,
    notation: Math.abs(value) < 0.000001 ? 'scientific' : 'standard',
  });
}
