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

let cached;
export function reviewedOverlayRelease() {
  if (cached) return structuredClone(cached.release);
  const release = overlayBaseline();
  const assets = new Map();
  const touched = new Set();
  const records = [];
  const verifiedRaw = new Set();
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
  release.research_overlay = { campaign: overlayConfig.campaign, baseline_sha256: overlayConfig.baseline_sha256,
    config_sha256: hash(readFileSync(configPath)), reviews: overlayConfig.reviews, applied: records, human_approval: false };
  if (overlayConfig.cost_ledger) {
    const costs = JSON.parse(bound(overlayConfig.cost_ledger.path, overlayConfig.cost_ledger.sha256).bytes);
    if (costs.actual_tokens !== null || costs.actual_billed_usd !== null) throw new Error('Session research has no actual billing telemetry');
    release.cost_scenarios.shared_campaigns = [...(release.cost_scenarios.shared_campaigns ?? []), costs];
  }
  release.captured_at = overlayConfig.generated_at ?? release.captured_at;
  cached = { release, assets: [...assets] };
  return structuredClone(release);
}

export function reviewedOverlayAssets() { reviewedOverlayRelease(); return new Map(cached.assets); }
export function validateReviewedOverlay(release) {
  if (!isDeepStrictEqual(release, reviewedOverlayRelease())) throw new Error('Public snapshot differs from its content-bound research overlay');
}
