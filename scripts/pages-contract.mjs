import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pctToVizLevel } from '../packages/core/src/viz-level.js';
const catalog = JSON.parse(readFileSync(new URL('../site/catalog.json', import.meta.url), 'utf8'));
const framework = JSON.parse(readFileSync(new URL('../packages/contract/framework/framework.json', import.meta.url), 'utf8'));
export function publicAssetPath(value) {
  if (typeof value !== 'string' || !/^evidence\/[a-z0-9-]+\/[a-f0-9]+\.(png|jpg|jpeg|pdf)$/.test(value)) throw new Error(`Invalid evidence path: ${value}`);
  return value;
}
export function indicatorAssets(indicator) {
  return [indicator, ...(indicator.supporting_evidence ?? [])].flatMap(item => [item.evidence_path, item.pdf_path].filter(Boolean));
}
export function validateRelease(release) {
  if (release.schema_version !== 1 || !Array.isArray(release.portraits) || !release.portraits.length) throw new Error('Invalid portrait release');
  const slugs = new Set();
  if (release.portraits.length !== catalog.portraits.length) throw new Error('Portrait catalog coverage mismatch');
  for (const portrait of release.portraits) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(portrait.slug) || slugs.has(portrait.slug)) throw new Error('Invalid or duplicate portrait slug');
    slugs.add(portrait.slug);
    const declared = catalog.portraits.find(p => p.slug === portrait.slug);
    if (!declared || portrait.status !== declared.status) throw new Error('Portrait not authorized by release catalog');
    if (!['published', 'legacy-source', 'research-preview'].includes(portrait.status) || !portrait.notice || !portrait.provenance) throw new Error('Portrait provenance/status missing');
    if (!portrait.dimensions.length) throw new Error('Empty portrait');
    const dimensions = new Set();
    for (const dimension of portrait.dimensions) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dimension.slug) || dimensions.has(dimension.slug)) throw new Error('Invalid dimension slug');
      dimensions.add(dimension.slug);
      if (!['social', 'ecological'].includes(dimension.ring) || !Array.isArray(dimension.indicators)) throw new Error('Invalid dimension');
      if (!dimension.indicators.length && dimension.level !== null) throw new Error('Empty dimension cannot have a score');
      if (dimension.level !== null && (!Number.isFinite(dimension.level) || dimension.level < -100 || dimension.level > 150)) throw new Error('Invalid visualization level');
      for (const indicator of dimension.indicators) {
        if (!['published', 'legacy-source', 'source-supported-draft', 'uncertain', 'gap'].includes(indicator.status)) throw new Error('Indicator status missing');
        if (indicator.supporting_evidence !== undefined && !Array.isArray(indicator.supporting_evidence)) throw new Error('Invalid supporting evidence');
        for (const value of indicatorAssets(indicator)) publicAssetPath(value);
        for (const source of indicator.supporting_evidence ?? []) {
          if (!source.label || !source.evidence_path || !['https:', 'http:'].includes(new URL(source.source_url).protocol)) throw new Error('Invalid supporting source');
        }
        if (indicator.source_url && !['https:', 'http:'].includes(new URL(indicator.source_url).protocol)) throw new Error('Unsafe source URL');
        if (indicator.status === 'source-supported-draft' && (!indicator.evidence_path || !indicator.review_note)) throw new Error('Unsupported draft badge');
        if (indicator.status === 'gap' && indicator.value !== null) throw new Error('A gap cannot be a numeric claim');
        if (portrait.slug === 'carmel' && indicator.geographic_scale === 'county' && !indicator.geography?.includes('proxy')) throw new Error('Carmel county proxy not labeled');
        if (portrait.status === 'research-preview' && !['source-supported-draft', 'uncertain', 'gap'].includes(indicator.status)) throw new Error('Preview cannot imply publication approval');
      }
      if (portrait.status === 'research-preview') {
        const expected = framework.dimensions.find(d => d.slug === dimension.slug);
        if (!expected || dimension.ring !== expected.ring) throw new Error('Preview dimension ring mismatch');
        const ids = dimension.indicators.map(i => i.indicator_slug).sort();
        if (!expected || JSON.stringify(ids) !== JSON.stringify(expected.indicators.map(i => i.slug).sort())) throw new Error('Preview indicator coverage mismatch');
        const numeric = dimension.indicators.filter(i => i.value !== null);
        const supported = numeric.filter(i => i.status === 'source-supported-draft');
        if (supported.some(i => !Number.isFinite(i.level_pct))) throw new Error('Supported draft scoring is missing');
        const expectedLevel = supported.length && supported.length === numeric.length ? pctToVizLevel(Math.max(...supported.map(i => i.level_pct))) : null;
        if (dimension.level !== expectedLevel) throw new Error('Draft wedge disagrees with supported scores');
      }
    }
    if (portrait.status === 'research-preview' && (portrait.provenance.approved !== false || portrait.provenance.kind !== 'session-research' || portrait.dimensions.length !== framework.dimensions.length)) throw new Error('Invalid preview provenance or dimension coverage');
  }
  for (const { slug } of catalog.portraits) if (!slugs.has(slug)) throw new Error(`Required portrait missing: ${slug}`);
  return release;
}
export function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
export function inside(root, relative) {
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Path escapes site root');
  return resolved;
}
