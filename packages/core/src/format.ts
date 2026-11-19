/**
 * One rule for showing indicator values everywhere (SPEC v3 W1/W4): a number
 * never appears without its unit. Percent-style units attach directly
 * ("61.2% of renter households"); everything else gets a space
 * ("13,361 homes/year"). Non-numeric values pass through with the unit
 * appended. Numeric values retain their source precision rather than being
 * rounded to a fixed number of decimal places. Very small values use
 * scientific notation so a nonzero measurement never appears as zero.
 */
export function formatIndicatorValue(
  value: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '' ||
      (typeof value === 'number' && !Number.isFinite(value))) return 'Data needed';
  const num =
    typeof value === 'number'
      ? value.toLocaleString('en-US', {
          maximumSignificantDigits: 21,
          notation: value !== 0 && Math.abs(value) < 0.000001 ? 'scientific' : 'standard',
        })
      : String(value);
  const u = (unit ?? '').trim();
  if (!u) return num;
  if (u.startsWith('%')) {
    const rest = u.slice(1).trim();
    return rest ? `${num}% ${rest}` : `${num}%`;
  }
  return `${num} ${u}`;
}
