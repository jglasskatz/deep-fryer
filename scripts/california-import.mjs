/** Reproduce the existing California portrait without conferring research approval. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pctToVizLevel } from '../packages/core/src/viz-level.js';
const root = new URL('../site/imports/california/', import.meta.url);
const pinned = {
  'doughnut.json': 'fa7dfd5504f2b5532495cd361ee1c0aaa494eb39246823f451d764ae5bdbab43',
  'raw_social.csv': '1dd48802a4c2c0a796c4a2a9bb0f9465590161dbdf37ff8b1ce107bd2f718ddc',
  'raw_ecological.csv': '8e45e5018d659615e9ed38b92dbc4b175490824ef8951258171ad25c4284dfd0',
};
export const californiaSourceFiles = ['manifest.json', ...Object.keys(pinned)];
export function parseWorksheet(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let n = 0; n < text.length; n++) {
    const char = text[n];
    if (char === '"') {
      if (quoted && text[n + 1] === '"') { field += '"'; n++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(field.replace(/\r$/, '')); field = '';
      if (char === '\n') { rows.push(row); row = []; }
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed worksheet quote');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift();
  return rows.filter(r => r.some(Boolean)).map(r => {
    if (r.length !== headers.length) throw new Error('Worksheet column mismatch');
    return Object.fromEntries(headers.map((key, index) => [key, r[index]]));
  });
}
export function californiaPortrait() {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  if (manifest.repository !== 'https://github.com/jglasskatz/ca-doughnut' || manifest.commit !== '6ff5033d020291985e47548509dc0ee1d2547488' || manifest.approved !== false) throw new Error('California import provenance changed');
  const source = Object.fromEntries(Object.entries(pinned).map(([name, digest]) => {
    const bytes = readFileSync(new URL(name, root));
    if (createHash('sha256').update(bytes).digest('hex') !== digest || manifest.files[name]?.sha256 !== digest || manifest.files[name]?.bytes !== bytes.length) throw new Error(`California import changed: ${name}`);
    return [name, bytes.toString('utf8')];
  }));
  const snapshot = JSON.parse(source['doughnut.json']);
  const dimensions = [];
  for (const ring of ['social', 'ecological']) {
    const worksheet = parseWorksheet(source[`raw_${ring}.csv`]);
    const used = new Set();
    for (const category of snapshot[ring]) {
      const indicators = category.indicators.map(record => {
        const row = worksheet.find(r => r.Abreviation === record.name);
        if (!row || used.has(row)) throw new Error(`California worksheet match missing or duplicated: ${record.name}`);
        used.add(row);
        const percent = ring === 'social' ? record.shortfall_pct : record.overshoot_pct;
        const metric = ring === 'social' ? 'shortfall' : 'overshoot';
        const fallback = ring === 'ecological' && !row.Overshoot && percent !== null;
        const caveats = [
          'Imported from the existing California portrait; source links and reported percentages have not been independently revalidated.',
          ...(fallback ? ['The original importer used the category Average column because this indicator’s Overshoot was blank. This is not a separately supplied indicator overshoot; the indicator score remains unknown.'] : []),
          ...(percent === null ? ['No overshoot percentage was supplied for this indicator. Its native observation is retained; missing is not zero.'] : []),
          ...(record.name === 'Homelessness' ? ['35.9% is the imported shortfall score, not the percentage of Californians experiencing homelessness. The worksheet does not supply a native point-in-time count.'] : []),
          ...(record.name === 'Ozone Layer' ? ['Global ozone-layer observation, not a California-specific measurement.'] : []),
        ];
        return {
          indicator_slug: record.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          name: record.name, value: record.value, unit: percent === null && record.unit !== '%' ? record.unit || '' : '', year: record.year,
          value_label: percent === null || fallback ? 'Source value · indicator overshoot unknown' : `Imported ${metric}`,
          target: record.target, source: record.source, source_url: record.source_url,
          geography: record.name === 'Ozone Layer' ? 'Global observation · California source portrait' : 'California source portrait · scope varies by measure',
          status: 'legacy-source', notes: record.description, quality_flags: caveats,
          evidence_path: null, pdf_path: null, level_pct: fallback ? null : percent,
          imported_percentage: { metric, value: percent, origin: fallback ? 'category-average-fallback' : percent === null ? 'not-supplied' : 'indicator-column' },
          source_worksheet: { value: row.California || null, unit: row.Unit || '', target: row.Desirable || null, period: row['Year (Measured / Published)'], notes: row.Notes },
          legacy_record: record, worksheet_record: row,
        };
      });
      const pcts = indicators.map(i => i.level_pct);
      const complete = pcts.length > 0 && pcts.every(Number.isFinite);
      const average = complete ? pcts.reduce((sum, n) => sum + n, 0) / pcts.length : null;
      const { indicators: originalIndicators, ...legacyCategory } = category;
      dimensions.push({ slug: category.slug, name: category.name, ring,
        level: average === null ? null : pctToVizLevel(average), imported_average_pct: average,
        context: 'Imported percentages describe different constructs. They are not additive or a validated ranking. Wedges use the mean of the supplied percentages only when both indicators have a score, mapped through Deep Fryer’s display scale (capped at 150).',
        actions: category.actions, indicators, legacy_category: legacyCategory,
      });
    }
    if (used.size !== worksheet.length) throw new Error('California worksheet coverage mismatch');
  }
  if (dimensions.length !== 21 || dimensions.flatMap(d => d.indicators).length !== 42) throw new Error('California indicator coverage mismatch');
  return {
    slug: 'california', name: snapshot.region.name, group: 'California',
    region: 'Statewide California portrait. Source periods vary from 2005 to 2025; some measures use regional or global observations.',
    population: snapshot.region.population, status: 'legacy-source',
    notice: 'Imported California data, not newly verified or approved. All 42 indicators and their source links are retained from ca-doughnut. Reported shortfalls and overshoots are shown separately from native measurements. Missing scores remain unknown; inherited category-average values and uncertain source dates are flagged.',
    data_import: { kind: 'california-legacy', imported_at: manifest.imported_at, source_path: 'imports/california/' },
    provenance: { ...manifest, kind: 'legacy-source', source_file: manifest.files['doughnut.json'].source_path,
      source_sha256: pinned['doughnut.json'], scoring: 'Arithmetic mean of complete imported percentage pairs, mapped using pctToVizLevel; incomplete pairs remain unscored.', legacy_region: snapshot.region },
    dimensions,
  };
}
