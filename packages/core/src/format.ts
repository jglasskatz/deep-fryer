/**
 * One rule for showing indicator values everywhere (SPEC v3 W1/W4): a number
 * never appears without its unit. Percent-style units attach directly
 * ("61.2% of renter households"); everything else gets a space
 * ("13,361 homes/year"). Non-numeric values pass through with the unit
 * appended.
 */
export function formatIndicatorValue(
  value: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return 'Data needed';
  const num =
    typeof value === 'number'
      ? Number.isInteger(value)
        ? value.toLocaleString('en-US')
        : value.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : String(value);
  const u = (unit ?? '').trim();
  if (!u) return num;
  if (u.startsWith('%')) {
    const rest = u.slice(1).trim();
    return rest ? `${num}% ${rest}` : `${num}%`;
  }
  return `${num} ${u}`;
}
