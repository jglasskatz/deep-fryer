import { frameworkDimension } from '@deep-fryer/contract';
import type { Indicator } from './types.js';

/*
 * Every indicator row in a dimension has a stable key, so a row can be named
 * as `<dimension slug>/<indicator key>` whatever its display name becomes. A
 * framework indicator's key is its framework slug (the slug research findings
 * carry); a custom indicator gets one derived from its name the first time it
 * is saved, and keeps it from then on, renames included.
 */

/** The shape of a key: the same shape research findings use for indicator slugs. */
export const INDICATOR_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * What a gap records in place of a key when it covers every indicator of the
 * dimension (the value such gaps have always stored). No indicator is given
 * this key.
 */
export const WHOLE_DIMENSION_GAP = 'all';

/** Derived keys are cut to this length before any de-duplicating suffix. */
const MAX_DERIVED_KEY_LENGTH = 64;

/** An indicator the dimension is known to have, such as a framework indicator: its key and display name. */
export interface KnownIndicator {
  key: string;
  name: string;
}

/** A dimension's framework indicators as known keys, or none for a dimension outside the framework. */
export function frameworkIndicatorKeys(dimensionSlug: string, canonicalSlug?: string | null): KnownIndicator[] {
  return (frameworkDimension(dimensionSlug, canonicalSlug)?.indicators ?? []).map((i) => ({ key: i.slug, name: i.name }));
}

export function isIndicatorKey(value: unknown): value is string {
  return typeof value === 'string' && INDICATOR_KEY_PATTERN.test(value);
}

/** Lower case, accents dropped, anything else between letters and digits a single hyphen. */
export function deriveIndicatorKey(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_DERIVED_KEY_LENGTH)
    .replace(/^-+|-+$/g, '');
  return base || 'indicator';
}

const normalName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

function firstUnused(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** The key matching `name` in `pool` that no other row has taken yet. */
function keyByName(pool: readonly KnownIndicator[], name: string, used: Set<string>): string | undefined {
  const wanted = normalName(name);
  return pool.find((p) => normalName(p.name) === wanted && !used.has(p.key))?.key;
}

/**
 * Give every indicator a key, unique within the list, in this order of
 * preference:
 *
 * 1. the key it already has, unless an earlier row has it (or it is
 *    WHOLE_DIMENSION_GAP);
 * 2. the key of the previous version's indicator with the same name;
 * 3. the key of a known indicator (the framework's) with the same name;
 * 4. one derived from its name, with a number added when taken. A known
 *    indicator's key counts as taken here even when no row holds it, so a
 *    row only ever gets a framework slug by having the framework's name
 *    (rule 3): a custom row is never scored as, or cleared as, a framework
 *    indicator because its name happens to spell that slug.
 *
 * A previous version written before keys existed is keyed by the same rules
 * first (against the known indicators only), so its framework rows match by
 * their framework slug. Names match ignoring case and repeated spaces. Rows
 * keep their order and every other field; a row already keyed is returned
 * as it was.
 */
export function assignIndicatorKeys(
  indicators: readonly Indicator[],
  previous: readonly Indicator[] = [],
  known: readonly KnownIndicator[] = [],
): Indicator[] {
  const previousKeyed =
    previous.length > 0 && previous.some((p) => !isIndicatorKey(p.key))
      ? assignIndicatorKeys(previous, [], known)
      : previous;
  const fromPrevious: KnownIndicator[] = previousKeyed.flatMap((p) =>
    isIndicatorKey(p.key) ? [{ key: p.key, name: p.name }] : [],
  );
  const knownKeys = known.filter((k) => isIndicatorKey(k.key));
  const reservedForKnown = new Set(knownKeys.map((k) => k.key));

  const used = new Set<string>([WHOLE_DIMENSION_GAP]);
  // Rows that bring their own key claim it first, so a row without one never
  // takes a key that a later row in the list already holds.
  const kept = indicators.map((ind) => {
    if (!isIndicatorKey(ind.key) || used.has(ind.key)) return null;
    used.add(ind.key);
    return ind.key;
  });

  return indicators.map((ind, i) => {
    if (kept[i]) return ind;
    const key =
      keyByName(fromPrevious, ind.name, used) ??
      keyByName(knownKeys, ind.name, used) ??
      firstUnused(deriveIndicatorKey(ind.name), new Set([...used, ...reservedForKnown]));
    used.add(key);
    return { ...ind, key };
  });
}
