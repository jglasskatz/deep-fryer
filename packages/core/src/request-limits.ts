import { z } from 'zod';

/**
 * The most entries a list or record read from a request may hold. zod
 * refuses an array longer than its declared maximum before it looks at a
 * single item, so with a maximum on every list no request can make the
 * server validate an unbounded collection; records have no such check of
 * their own, so they are read through boundedRecord below.
 *
 * Each ceiling comes from what the data model allows and sits well above
 * anything a real portrait sends, so no request that works today is refused.
 */
export const REQUEST_LIMITS = {
  /**
   * Dimensions in one portrait: the framework's 21, plus custom ones.
   * Reordering already refuses more than 200 (apps/web
   * dimension-admin-actions.ts). Lists and records keyed by dimension use it.
   */
  dimensions: 200,
  /**
   * Indicators on one dimension. A framework dimension has at most two, the
   * dimension editor stops adding at 30 and a custom dimension starts with at
   * most 30; research may add a few beyond those.
   */
  indicatorsPerDimension: 100,
  /**
   * Data gaps on one dimension: about one per indicator, plus one each time a
   * reviewer flags an indicator as a gap, which keeps the earlier ones.
   */
  gapsPerDimension: 500,
  /** Action lines (and sourced actions) on one dimension: research drafts at most five. */
  actionsPerDimension: 100,
  /** Geographic scales in one list: there are six, with room for repeats. */
  scales: 24,
  /** Named inputs to one indicator's scoring arithmetic: the engine writes three. */
  scoringInputs: 32,
  /** Tiers in a portrait's source priority: portraits use four. */
  sourceTiers: 20,
  /** Example sources named on one tier: portraits name up to four. */
  tierExamples: 50,
  /**
   * Threshold overrides in one portrait, one per threshold reference. The
   * framework defines 24 and the largest portrait configuration overrides
   * 13; 1,000 allows five scored indicators on each of 200 dimensions.
   */
  thresholdOverrides: 1000,
} as const;

/** At most `max` own enumerable keys, counted without listing them all. */
function entriesAtMost(value: object, max: number): boolean {
  let count = 0;
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key) && ++count > max) return false;
  }
  return true;
}

/**
 * z.record with a maximum number of entries, checked before any key or
 * value is validated: a record with more is refused with one issue. Anything
 * that is not an object goes on to z.record, which reports it as it always
 * has.
 */
export function boundedRecord<K extends z.core.$ZodRecordKey, V extends z.core.SomeType>(
  keyType: K,
  valueType: V,
  max: number,
) {
  return z
    .unknown()
    .refine(
      (value) => typeof value !== 'object' || value === null || Array.isArray(value) || entriesAtMost(value, max),
      { message: `Too big: expected record to have <=${max} entries` },
    )
    .pipe(z.record(keyType, valueType));
}
