/** Reproducible, source-bound amendments to a frozen public snapshot.
 * The original campaign remains independently verifiable. No machine review
 * becomes a human approval, and unscored observations cannot acquire a wedge.
 */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { pctToVizLevel } from '../packages/core/src/viz-level.js';
import { importedPortraits, importedSlugs } from './portrait-imports.mjs';
import { portraitFramework } from './portrait-framework.mjs';

const repo = realpathSync(new URL('..', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = filename => JSON.parse(readFileSync(filename, 'utf8'));
const configPath = path.join(repo, 'site/research-overlays.json');
export const overlayConfig = json(configPath);
const campaign = path.join(repo, 'research', overlayConfig.campaign);
if (!/^[a-z0-9-]+$/.test(overlayConfig.campaign)) throw new Error('Invalid overlay campaign');
const bound = (relative, expected) => {
  const filename = realpathSync(path.resolve(campaign, relative));
  // Earlier reviewed exhibits may be reused, but no private workspace file
  // outside research or the existing public evidence archive can be read.
  if (![path.join(repo, 'research') + path.sep, path.join(repo, 'site/evidence') + path.sep].some(root => filename.startsWith(root))) throw new Error('Overlay evidence escapes permitted roots');
  const bytes = readFileSync(filename);
  if (!/^[a-f0-9]{64}$/.test(expected ?? '') || hash(bytes) !== expected) throw new Error(`Reviewed content changed: ${relative}`);
  return { bytes, filename };
};

export function overlayBaseline() {
  return JSON.parse(bound(overlayConfig.baseline, overlayConfig.baseline_sha256).bytes);
}

/** Reader-facing context for the dimensions whose legacy summary was
 * superseded by a reviewed indicator. The reviewed indicator notes stay exactly
 * as bound to their amendment hash; this text restates the same measurements
 * and qualifications in plain sentences for the place being described. Each
 * entry must name its indicator's reviewed value, so the two cannot drift.
 */
export const readerContext = Object.freeze({
  'santa-cruz:housing:0': 'The 2026 PIT report (page 13) gives 1,024 people experiencing homelessness in the City of Santa Cruz on the night of the point-in-time count. Street enumeration took place on January 29 and shelter occupancy was recorded from January 28. The report\'s own figures do not quite agree: 789 unsheltered plus 234 sheltered people make 1,023, and the incorporated-area and county subtotals also support 1,023, so the published total of 1,024 is shown as uncertain. The count covers a single night, leaves out some forms of homelessness and is not the number of people served over a year. This year the count newly included safe parking and sleeping records, which added 124 people in the city compared with earlier practice, so annual changes are not directly comparable. An earlier version of this page gave 1,850 for the city, but 1,850 was the 2024 COUNTY total, not Santa Cruz city. Housing cost burden is a separate measure that has not yet been reviewed. The earlier target for this dimension was written in words rather than as a number, so the count is shown without a score.',
  'santa-cruz-county:housing:0': 'The 2026 PIT report (page 13) gives 1,648 people experiencing homelessness across Santa Cruz County on the night of the point-in-time count: 1,290 unsheltered and 358 sheltered. Street enumeration took place on January 29 and shelter occupancy was recorded from January 28. The count covers a single night, leaves out some forms of homelessness and is not the number of people served over a year. This year the count newly included safe parking and sleeping records, which added 124 people in the City of Santa Cruz and 2 in Watsonville compared with earlier practice, so annual changes are not directly comparable. The 2024 county count was 1,850. Housing cost burden is a separate measure that has not yet been reviewed. The earlier target for this dimension was written in words rather than as a number, so the count is shown without a score.',
  'watsonville:housing:0': 'The 2026 PIT report (page 13) gives 303 people experiencing homelessness in Watsonville on the night of the point-in-time count: 179 unsheltered and 124 sheltered. Street enumeration took place on January 29 and shelter occupancy was recorded from January 28. The count covers a single night, leaves out some forms of homelessness and is not the number of people served over a year. This year the count newly included safe parking and sleeping records, which added 2 people in Watsonville compared with earlier practice, so annual changes are not directly comparable. Housing cost burden is a separate measure that has not yet been reviewed. The earlier target for this dimension was written in words rather than as a number, so the count is shown without a score.',
  'santa-cruz:social-equity:0': 'Household income inequality in the City of Santa Cruz, measured by the Gini index (0 means every household has the same income, 1 means one household has all of it), is 0.4936, with a 90% margin of error of ±0.0183. The figure is the American Community Survey five-year estimate for 2020–2024 (table B19083, city geography 1600000US0669112). It replaces an earlier figure that was unclear and appeared to be a county proxy or an approximation. The earlier target for this dimension was written in words and differed between portraits, so no numeric threshold has been set and the value is shown without a score.',
  'santa-cruz-county:social-equity:0': 'Household income inequality across Santa Cruz County, measured by the Gini index (0 means every household has the same income, 1 means one household has all of it), is 0.4864, with a 90% margin of error of ±0.0184. The figure is the American Community Survey one-year estimate for 2024 (table B19083, county geography 0500000US06087). Because the city figures use five-year estimates for 2020–2024, this value is not a like-for-like comparison with them. It replaces an earlier figure that was unclear and appeared to be an approximation. The earlier target for this dimension was written in words and differed between portraits, so no numeric threshold has been set and the value is shown without a score.',
  'watsonville:social-equity:0': 'Household income inequality in Watsonville, measured by the Gini index (0 means every household has the same income, 1 means one household has all of it), is 0.4282, with a 90% margin of error of ±0.0213. The figure is the American Community Survey five-year estimate for 2020–2024 (table B19083, city geography 1600000US0683668). It replaces an earlier figure that was unclear and appeared to be a county proxy or an approximation. Environmental justice in Watsonville, such as its pollution burden, is a separate question that this income measure does not capture. The earlier target for this dimension was written in words and differed between portraits, so no numeric threshold has been set and the value is shown without a score.',
});

let cached;
export function reviewedOverlayRelease() {
  if (cached) return structuredClone(cached.release);
  const release = overlayBaseline();
  const assets = new Map();
  const touched = new Set();
  const records = [];
  const verifiedRaw = new Set();
  const contextApplied = new Set();
  const catalog = json(path.join(repo, 'site/catalog.json'));
  const original = structuredClone(release);
  for (const declaration of overlayConfig.reviews) {
    const review = JSON.parse(bound(declaration.path, declaration.sha256).bytes);
    if (review.reviewer !== 'gpt-6.1-sol' || review.reasoning_effort !== 'high' || review.approved !== false || review.human_approval !== false || review.baseline_snapshot_sha256 !== overlayConfig.baseline_sha256) throw new Error('Overlay review scope is not authorized');
    const files = new Map(Object.entries(review.amendment_files).map(([relative, digest]) => [relative, JSON.parse(bound(relative, digest).bytes)]));
    const exhibits = Object.assign({}, ...Object.entries(review.evidence_manifests).map(([relative, digest]) => JSON.parse(bound(relative, digest).bytes)));
    const archive = relative => {
      if (!relative) return null;
      const entry = exhibits[relative];
      if (!entry) throw new Error(`Unreviewed public exhibit: ${relative}`);
      const { bytes, filename } = bound(relative, entry.sha256);
      if (bytes.length !== entry.bytes) throw new Error('Exhibit length mismatch');
      const extension = path.extname(relative).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.pdf'].includes(extension)) throw new Error('Unsupported public exhibit');
      const destination = `evidence/shared/${entry.sha256.slice(0, 24)}${extension}`;
      assets.set(destination, { source: filename, sha256: entry.sha256, bytes: bytes.length });
      return destination;
    };
    for (const decision of review.reviews.filter(item => item.verdict === 'accept')) {
      const file = files.get(decision.bound_amendment_file);
      if (!file || decision.bound_amendment_file_sha256 !== review.amendment_files[decision.bound_amendment_file] || file.baseline_snapshot_sha256 !== overlayConfig.baseline_sha256) throw new Error('Amendment review binding mismatch');
      const amendment = file.amendments.find(item => item.id === decision.id);
      if (!amendment) throw new Error('Reviewed amendment is absent');
      const beforePortrait = original.portraits.find(p => p.slug === amendment.portrait);
      const beforeDimension = beforePortrait?.dimensions.find(d => d.slug === amendment.dimension);
      const before = amendment.kind === 'append' ? null : beforeDimension?.indicators[amendment.indicator_index];
      if (!beforeDimension || !isDeepStrictEqual(before, amendment.before)) throw new Error(`Amendment baseline mismatch: ${amendment.id}`);
      const address = `${amendment.portrait}/${amendment.dimension}/${amendment.kind === 'append' ? 'append' : amendment.indicator_index}`;
      if (touched.has(address)) throw new Error(`Duplicate reviewed amendment: ${address}`);
      touched.add(address);
      for (const support of amendment.source_support) {
        const rawKey = `${support.raw_path}:${support.raw_sha256}:${support.stored_sha256}`;
        if (support.raw_path && !verifiedRaw.has(rawKey)) {
          const raw = bound(support.raw_path, support.stored_sha256 ?? support.raw_sha256).bytes;
          const decoded = support.raw_encoding?.startsWith('gzip') ? gunzipSync(raw, { maxOutputLength: 256 * 1024 * 1024 }) : raw;
          if (hash(decoded) !== support.raw_sha256) throw new Error(`Raw source mismatch: ${support.raw_path}`);
          verifiedRaw.add(rawKey);
        }
        if (support.snapshot_path) bound(support.snapshot_path, support.snapshot_sha256);
      }
      const portrait = release.portraits.find(p => p.slug === amendment.portrait);
      const dimension = portrait.dimensions.find(d => d.slug === amendment.dimension);
      const rendered = structuredClone(amendment.after);
      rendered.review_note = decision.reason;
      rendered.evidence_path = archive(rendered.evidence_path);
      rendered.pdf_path = archive(rendered.pdf_path);
      rendered.supporting_evidence = amendment.source_support.filter(s => s.snapshot_path).map(s => ({
        label: `${s.period || 'Source exhibit'} · ${s.scale || 'see geography notes'}`,
        source_url: s.url, evidence_path: archive(s.snapshot_path), pdf_path: archive(s.pdf_path),
      })).filter((s, i, all) => all.findIndex(other => other.source_url === s.source_url && other.evidence_path === s.evidence_path) === i);
      // Only presentation/provenance normalization occurs here. Measurements
      // and all scientific qualifications remain exactly as reviewed.
      if (rendered.status === 'source-supported-observation') {
        if (!Number.isFinite(rendered.value) || rendered.target != null || rendered.level_pct != null || rendered.scoring != null) throw new Error('Reviewed observation carries a score');
        rendered.kind = 'observation';
        rendered.target = null; rendered.level_pct = null; rendered.scoring = null;
        rendered.unscored_reason = rendered.unscored_reason || rendered.notes;
      }
      // A current independent review replaces inherited old review flags;
      // its reason and measurement caveats remain visible beside the value.
      delete rendered.quality_flags;
      rendered.research_review = { campaign: overlayConfig.campaign, amendment_id: amendment.id,
        review_sha256: declaration.sha256, amendment_file_sha256: decision.bound_amendment_file_sha256,
        approved: false, reviewer: review.reviewer, reasoning_effort: review.reasoning_effort };
      // These reviewed housing/equity replacements correct the legacy context's
      // geography, old values and unsupported comparisons, so the legacy
      // summary is replaced rather than left contradicting the indicator.
      // The original prose stays intact in the hash-bound frozen baseline.
      if (Object.hasOwn(readerContext, amendment.id)) {
        const context = readerContext[amendment.id];
        if (!context.includes(rendered.value.toLocaleString('en-US', { maximumFractionDigits: 4 }))) throw new Error(`Reader context omits the reviewed value: ${amendment.id}`);
        dimension.context = context;
        contextApplied.add(amendment.id);
      }
      if (amendment.kind === 'append') dimension.indicators.push(rendered);
      else dimension.indicators[amendment.indicator_index] = rendered;
      const count = (portrait.research_update?.amendments ?? 0) + 1;
      portrait.research_update = { campaign: overlayConfig.campaign, reviewer: review.reviewer, reasoning_effort: 'high', amendments: count };
      portrait.notice = 'Updated research preview. Sol 6.1 at high effort researched and independently reviewed the amendments. Each changed indicator is labeled as a supported draft, an unscored observation or unresolved evidence. Other indicators retain their earlier provenance. New research has not received human publication approval.';
      const numeric = dimension.indicators.filter(i => i.value !== null);
      dimension.level = numeric.length && numeric.every(i => ['source-supported-draft', 'published'].includes(i.status) && Number.isFinite(i.level_pct))
        ? pctToVizLevel(Math.max(...numeric.map(i => i.level_pct))) : null;
      if (amendment.dimension === 'ozone-layer-depletion') {
        const declared = catalog.portraits.find(p => p.slug === portrait.slug);
        const framework = portraitFramework(declared);
        if (framework.profile !== 'local-extreme-heat-v1') throw new Error('Heat migration lacks the explicit profile');
        dimension.slug = 'extreme-heat'; dimension.name = 'Extreme Heat'; dimension.level = null;
        dimension.context = 'Locally extreme heat exposure, shown without a numeric safety target. County measurements are labeled as proxies when displayed for a city.';
        dimension.actions = []; // Retire inherited ozone-specific refrigerant advice.
        rendered.indicator_slug = 'extreme-heat-days';
        // Keep the scientific qualifications visible; the profile migration
        // instruction is fulfilled above and belongs in provenance, not reader copy.
        rendered.notes = rendered.notes.replace(' Integration requires an explicit local-extreme-heat-v1 profile replacing the legacy ozone dimension for these three portraits only.', '');
        rendered.unscored_reason = 'No safe annual-day target was established for this heat-exposure measure.';
        portrait.provenance.framework_profile = framework.profile;
        portrait.provenance.framework_profile_sha256 = framework.sha256;
      }
      records.push({ id: amendment.id, portrait: portrait.slug, dimension: dimension.slug, review_sha256: declaration.sha256 });
    }
  }
  const unused = Object.keys(readerContext).filter(id => !contextApplied.has(id));
  if (unused.length) throw new Error(`Reader context has no accepted amendment: ${unused.join(', ')}`);
  release.research_overlay = { campaign: overlayConfig.campaign, baseline_sha256: overlayConfig.baseline_sha256,
    config_sha256: hash(readFileSync(configPath)), reviews: overlayConfig.reviews, applied: records, human_approval: false };
  // Campaign accounting is internal bookkeeping, never part of the public
  // portrait or its downloadable data. Preserve the frozen input for review.
  delete release.cost_scenarios;
  release.captured_at = overlayConfig.generated_at ?? release.captured_at;
  // The separately hash-bound imports do not alter the reviewed baseline.
  release.portraits.push(...importedPortraits());
  cached = { release, assets: [...assets] };
  return structuredClone(release);
}

export function reviewedOverlayAssets() { reviewedOverlayRelease(); return new Map(cached.assets); }
export function validateReviewedOverlay(release) {
  if (!isDeepStrictEqual(release, reviewedOverlayRelease())) throw new Error('Public snapshot differs from its content-bound research overlay');
}

/** Keep the large existing snapshot frozen; assemble the pinned imports only at build time. */
export function publicRelease() {
  const baseline = json(path.join(repo, 'site/data/portraits.json'));
  if (baseline.portraits.some(p => importedSlugs.has(p.slug))) throw new Error('An imported portrait must be assembled from its pinned source, not duplicated in the baseline');
  const release = { ...baseline, portraits: [...baseline.portraits, ...importedPortraits()] };
  validateReviewedOverlay(release);
  return release;
}
