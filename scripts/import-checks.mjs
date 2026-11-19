/** Checks for portrait data that arrives from outside the research pipeline.
 *
 * Hand-edited portraits start from a copy of another place's data. These
 * checks find what that leaves behind: rows that still belong to the place
 * they were copied from, and one filler record repeated across dimensions.
 * They read legacy rows (`indicator`, `value`, `source`, `sourceUrl`).
 */

const fingerprint = row => JSON.stringify([row.indicator ?? row.name ?? '', row.value ?? null, row.source ?? '', row.sourceUrl ?? row.source_url ?? '']);

/** Groups of two or more rows that state the same indicator, value, target and source. */
export function repeatedPlaceholders(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.indicator ?? '', row.value ?? null, row.target ?? null, row.source ?? '']);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].filter(group => group.length > 1);
}

/** How much of a candidate portrait is identical to a portrait the collection already has. */
export function closestExistingPortrait(rows, portraits) {
  const candidate = rows.map(fingerprint);
  let closest = { slug: null, identical: 0, total: candidate.length };
  for (const portrait of portraits) {
    const existing = new Set(portrait.dimensions.flatMap(d => d.indicators.map(i => fingerprint({ indicator: i.name, value: i.value, source: i.source, sourceUrl: i.source_url }))));
    const identical = candidate.filter(key => existing.has(key)).length;
    if (identical > closest.identical) closest = { slug: portrait.slug, identical, total: candidate.length };
  }
  return closest;
}
