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
const reportAuditHash = 'f3b3041c0648e1cd768590ca1cf7dbc146620f8c0a20ed2ed3d32c869756a731';
export const californiaSourceFiles = ['manifest.json', ...Object.keys(pinned), 'report-audit.json'];
// Where each pinned file sat in the source repository and its size; both are
// published as provenance.
const pinnedOrigin = {
  'doughnut.json': { source_path: 'frontend/public/api/regions/california/doughnut.json', bytes: 29609 },
  'raw_social.csv': { source_path: 'data/raw_social.csv', bytes: 7334 },
  'raw_ecological.csv': { source_path: 'data/raw_ecological.csv', bytes: 5378 },
};
const sameKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
// The whole import record is copied into the public provenance, so every field
// it may hold has a check here and a record with any other field is refused.
const fileChecks = {
  source_path: (value, name) => value === pinnedOrigin[name].source_path,
  sha256: (value, name) => value === pinned[name],
  bytes: (value, name) => value === pinnedOrigin[name].bytes,
};
const recordChecks = {
  repository: value => value === 'https://github.com/jglasskatz/ca-doughnut',
  commit: value => value === '6ff5033d020291985e47548509dc0ee1d2547488',
  imported_at: value => value === '2026-11-14',
  approved: value => value === false,
  files: value => sameKeys(value, Object.keys(pinned)) && Object.entries(value).every(([name, entry]) =>
    sameKeys(entry, Object.keys(fileChecks)) && Object.entries(fileChecks).every(([key, check]) => check(entry[key], name))),
};
/** Refuse an import record with a missing, changed or unchecked field. */
export function checkCaliforniaRecord(manifest) {
  if (!sameKeys(manifest, Object.keys(recordChecks)) || !Object.entries(recordChecks).every(([key, check]) => check(manifest[key]))) throw new Error('California import provenance changed');
  return manifest;
}
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
  const manifest = checkCaliforniaRecord(JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')));
  const source = Object.fromEntries(Object.entries(pinned).map(([name, digest]) => {
    const bytes = readFileSync(new URL(name, root));
    if (createHash('sha256').update(bytes).digest('hex') !== digest || manifest.files[name]?.sha256 !== digest || manifest.files[name]?.bytes !== bytes.length) throw new Error(`California import changed: ${name}`);
    return [name, bytes.toString('utf8')];
  }));
  const snapshot = JSON.parse(source['doughnut.json']);
  const auditBytes = readFileSync(new URL('report-audit.json', root));
  if (createHash('sha256').update(auditBytes).digest('hex') !== reportAuditHash) throw new Error('California report audit changed');
  const audit = JSON.parse(auditBytes);
  if (audit.approved !== false || audit.indicators.length !== 42) throw new Error('California report audit coverage/approval changed');
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
        const verified = audit.indicators.find(i => i.name === record.name && i.ring === ring);
        if (!verified || !Number.isFinite(verified.score_pct)) throw new Error(`California report row missing: ${record.name}`);
        const caveats = [
          ...verified.caveats,
        ];
        return {
          indicator_slug: record.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          name: record.name, value: verified.score_text === 'No Overshoot' ? 'No overshoot' : `${verified.score_pct}%`, unit: '',
          year: /^\d{4}$/.test(verified.measurement.period) ? Number(verified.measurement.period) : verified.measurement.period,
          value_label: `Report ${metric}`,
          // A native target must not be attached to the imported percentage headline.
          // Preserve it with its native definition/value and in the unchanged legacy record.
          // The link opens the report's record page, not its 25 MB PDF download;
          // the cited page number stays in the source label.
          target: null, source: `California Doughnut Report (2025), p${verified.page}`, source_url: audit.report.record_url,
          geography: record.name === 'Ozone Layer' ? 'Global observation · California source portrait' : 'California source portrait · scope varies by measure',
          status: 'source-supported-draft', notes: `The headline is the report’s ${metric} result, not the native measurement. The definition, observation and target below are checked against the report. Original import data remain separately archived.`, quality_flags: caveats,
          review_note: `${audit.scope} ${verified.changes.join(' ')}`.trim(),
          evidence_path: audit.assets[ring], pdf_path: audit.assets.tables_pdf, level_pct: verified.score_pct,
          report_measurement: verified.measurement,
          report_verification: { doi: audit.report.doi, page: verified.page, checked_at: audit.checked_at, report_name: verified.report_name, score_text: verified.score_text, score_comparison: verified.score_comparison, approved: false },
          imported_percentage: { metric, value: percent, origin: fallback ? 'category-average-fallback' : percent === null ? 'not-supplied' : 'indicator-column' },
          source_worksheet: { definition: record.description, value: row.California || null, unit: row.Unit || '', target: row.Desirable || null, period: row['Year (Measured / Published)'], notes: row.Notes },
          legacy_record: record, worksheet_record: row,
        };
      });
      const pcts = indicators.map(i => i.level_pct);
      const complete = pcts.length > 0 && pcts.every(Number.isFinite);
      const average = complete ? pcts.reduce((sum, n) => sum + n, 0) / pcts.length : null;
      const { indicators: originalIndicators, ...legacyCategory } = category;
      dimensions.push({ slug: category.slug, name: category.name, ring,
        level: average === null ? null : pctToVizLevel(average), report_average_pct: average,
        context: 'Percentages are checked against the 2025 report and describe different constructs. They are not additive or a validated ranking. Wedges use the mean of the two reported indicator results, mapped through Deep Fryer’s display scale (capped at 150).',
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
    notice: 'All 42 indicators have been checked against the November 2025 California Doughnut Report, pages 84–85. Four omitted ecological results and seven missing native observations are restored. Reported scores remain separate from native measurements. Original imports and rounding differences are preserved. This checks report alignment, not the underlying studies, and does not grant publication approval.',
    data_import: { kind: 'california-legacy', imported_at: manifest.imported_at, source_path: 'imports/california/' },
    provenance: { ...manifest, kind: 'legacy-source', source_file: manifest.files['doughnut.json'].source_path,
      source_sha256: pinned['doughnut.json'], scoring: 'Arithmetic mean of the two report percentages, mapped using pctToVizLevel. Explicit No Overshoot maps to zero; missing is never inferred as zero.', legacy_region: snapshot.region,
      report_audit: { path: 'imports/california/report-audit.json', sha256: reportAuditHash, checked_at: audit.checked_at, report: audit.report, scope: audit.scope, approved: false } },
    dimensions,
  };
}
