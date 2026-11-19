/** Reproduce the community San Francisco portrait from its pinned fork, without approving it.
 *
 * The fork is a hand-edited copy of the Santa Cruz project's `docs/data.js`.
 * Its scores are shown exactly as the fork assigns them. Every decision about
 * the import lives in `site/imports/san-francisco/manifest.json`: which
 * jurisdictions are imported, which are left out and why, and the problems
 * found in the data, recorded for the fork's author rather than displayed.
 * This module checks the facts each recorded decision and issue rests on, so
 * a new pin cannot inherit an old one silently.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readJurisdictions } from './legacy-data-literal.mjs';
import { repeatedPlaceholders } from './import-checks.mjs';

const root = new URL('../site/imports/san-francisco/', import.meta.url);
const pinned = {
  repository: 'https://github.com/BioKyle/doughnut-san-francisco-v1',
  commit: '5cce9f1cc476052b88c316d847926e0ad34b4b00',
  sha256: '2a18eca99b39838bbe054b80c106d9032eb289056d3f25b6e34e15ada020f531',
};
const placeholderRecord = { indicator: 'Regional environmental baseline', value: 'Compliant with state limits', source: 'EPA / NOAA Region 9' };
const issueIds = ['repeated-placeholder', 'freshwater-score-contradicts-target', 'projected-source', 'publisher-home-page-links'];
export const sanFranciscoSourceFiles = ['manifest.json', 'data.js'];
export const dimensionSlug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The committed manifest text and data bytes, as the build reads them. */
export function sanFranciscoFiles() {
  return { manifestText: readFileSync(new URL('manifest.json', root), 'utf8'), bytes: readFileSync(new URL('data.js', root)) };
}

/** The pinned file as plain data, for the importer and for the checks on its exclusions. */
export function sanFranciscoSource(files = sanFranciscoFiles()) {
  const manifest = JSON.parse(files.manifestText);
  if (manifest.repository !== pinned.repository || manifest.commit !== pinned.commit || manifest.approved !== false) throw new Error('San Francisco import provenance changed');
  const file = manifest.files?.['data.js'];
  if (createHash('sha256').update(files.bytes).digest('hex') !== pinned.sha256 || file?.sha256 !== pinned.sha256 || file?.bytes !== files.bytes.length) throw new Error('San Francisco import changed: data.js');
  return { manifest, jurisdictions: readJurisdictions(Buffer.from(files.bytes).toString('utf8')) };
}

const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const numeric = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) ? Number(value) : NaN;

/** Throws unless each recorded known issue still holds in the pinned rows, and no new one of the same kind is unrecorded. */
function checkKnownIssues(issues, rows) {
  if (!Array.isArray(issues) || issues.length !== issueIds.length || !sameSet(issues.map(issue => issue.id), issueIds)) throw new Error('San Francisco known issues changed');
  for (const issue of issues) if (typeof issue.issue !== 'string' || !issue.issue.trim()) throw new Error(`San Francisco known issue lacks a description: ${issue.id}`);
  const byId = Object.fromEntries(issues.map(issue => [issue.id, issue]));
  const row = slug => rows.find(item => item.slug === slug)?.row;
  // Every fact an issue states about a row must still be what the pinned row says.
  for (const issue of issues) for (const slug of issue.dimensions ?? []) {
    if (!row(slug)) throw new Error(`San Francisco known issue names no dimension: ${slug}`);
    for (const [field, value] of Object.entries(issue.observed ?? {})) if (row(slug)[field] !== value) throw new Error(`San Francisco known issue ${issue.id} no longer matches ${slug}.${field}`);
  }

  // (a) One filler record stands in for several dimensions.
  const groups = repeatedPlaceholders(rows.map(item => item.row));
  const placeholder = byId['repeated-placeholder'];
  if (groups.length !== 1 || !sameSet(groups[0].map(r => dimensionSlug(r.name)), placeholder.dimensions ?? [])
    || Object.entries(placeholderRecord).some(([field, value]) => placeholder.observed?.[field] !== value)) throw new Error('San Francisco placeholder issue no longer matches the source');

  // (b) An ecological value at or under its own ceiling cannot be an overshoot.
  const contradicted = rows.filter(({ ring, row: r }) => ring === 'ecological' && Number.isFinite(numeric(r.value)) && Number.isFinite(numeric(r.target))
    && numeric(r.value) <= numeric(r.target) && r.level > 0).map(item => item.slug);
  if (!sameSet(contradicted, byId['freshwater-score-contradicts-target'].dimensions ?? [])) throw new Error('San Francisco score contradiction issue no longer matches the source');

  // (c) A projection is named as the source.
  const projected = rows.filter(({ row: r }) => /projected/i.test(r.source ?? '')).map(item => item.slug);
  if (!sameSet(projected, byId['projected-source'].dimensions ?? [])) throw new Error('San Francisco projected-source issue no longer matches the source');

  // (d) Publisher home or section pages: at most one path segment, no query, no file.
  const documentLinks = rows.filter(({ row: r }) => {
    const url = new URL(r.sourceUrl);
    return url.pathname.split('/').filter(Boolean).length > 1 || url.search || /\.[a-z0-9]{2,5}$/i.test(url.pathname);
  });
  if (documentLinks.length) throw new Error(`San Francisco source-link issue no longer holds: ${documentLinks.map(item => item.slug).join(', ')}`);
}

export function sanFranciscoPortrait(files) {
  const { manifest, jurisdictions } = sanFranciscoSource(files);
  // A jurisdiction added to the fork later needs its own recorded decision.
  if (!sameSet(Object.keys(jurisdictions), Object.keys(manifest.jurisdictions))) throw new Error('San Francisco import has a jurisdiction without a recorded decision');
  const imported = Object.entries(manifest.jurisdictions).filter(([, decision]) => decision.import);
  if (imported.length !== 1 || imported[0][0] !== 'city_san_francisco') throw new Error('San Francisco import selection changed');
  for (const [key, decision] of Object.entries(manifest.jurisdictions)) if (!decision.import && !decision.reason?.trim()) throw new Error(`San Francisco exclusion lacks a reason: ${key}`);
  if ('score_withheld' in manifest || 'flags' in manifest) throw new Error('San Francisco scores are shown as the source assigns them; nothing is withheld or flagged');
  const [key, decision] = imported[0];
  const source = jurisdictions[key];
  const rows = ['social', 'ecological'].flatMap(ring => source[ring].map(row => ({ ring, slug: dimensionSlug(row.name), row })));
  checkKnownIssues(manifest.known_issues, rows);

  const dimensions = rows.map(({ ring, slug, row }) => ({
    slug, ring, name: row.name,
    // The fork's own score, unchanged.
    level: row.level,
    context: row.context ?? '', actions: row.actions ?? [],
    indicators: [{
      name: row.indicator ?? row.name, value: row.value ?? null, unit: '', year: row.year ?? null,
      target: row.target ?? null, source: row.source ?? '', source_url: row.sourceUrl ?? '',
      geography: 'See source context', status: 'legacy-source', notes: row.context ?? '',
      evidence_path: null, pdf_path: null, legacy_record: row,
    }],
  }));
  if (dimensions.length !== 21 || new Set(dimensions.map(d => d.slug)).size !== 21) throw new Error('San Francisco dimension coverage mismatch');

  return {
    slug: decision.slug, name: source.name, group: 'San Francisco', region: source.description, population: source.population,
    status: 'legacy-source',
    notice: 'This portrait was built by a community member in a fork of the Santa Cruz doughnut project. Its figures, targets and scores are the fork author’s. They have not been researched, checked against their sources or approved here. Source links lead to publishers’ websites, and no archived evidence is available. The fork’s SoMa portrait is not included, because its rows are still those of the Watsonville portrait it was copied from.',
    data_import: {
      kind: 'community-fork', imported_at: manifest.imported_at, source_path: 'imports/san-francisco/',
      downloads: [
        { label: 'Original data file', path: 'imports/san-francisco/data.js' },
        { label: 'Import record', path: 'imports/san-francisco/manifest.json' },
      ],
    },
    provenance: {
      kind: 'legacy-source', repository: manifest.repository, commit: manifest.commit, forked_from: manifest.forked_from,
      source_file: manifest.files['data.js'].source_path, source_sha256: pinned.sha256, jurisdiction: key, geography: decision.geography,
      approved: false, scoring: 'Scores are the source project’s own levels, shown unchanged.',
      known_issues: manifest.known_issues,
      excluded: Object.fromEntries(Object.entries(manifest.jurisdictions).filter(([, d]) => !d.import).map(([name, d]) => [name, d.reason])),
    },
    dimensions,
  };
}
