/** Freeze explicitly selected public portraits; CI never needs the research database. */
import { readFile, writeFile, mkdir, copyFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { portraitFramework } from './portrait-framework.mjs';
import { pctToVizLevel, findingPayloadSchema, previewObservationSchema, maxDataAgeYears, acceptedScales, resolveThreshold, computeScoring, type FindingPayload } from '@deep-fryer/core';
import { getDb, publishedDoughnut } from '@deep-fryer/db';
import type { PublishedPortrait } from '../apps/web/lib/portrait.js';

const sourceIndex = process.argv.indexOf('--santa-cruz');
if (sourceIndex < 0 || !process.argv[sourceIndex + 1]) throw new Error('Usage: node --env-file=.env.local --import tsx scripts/snapshot-pages.ts --santa-cruz <source-checkout>');
const santaCruz = path.resolve(process.argv[sourceIndex + 1]!);
function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}
const destination = path.resolve(option('--output', 'site'));
const catalog = JSON.parse(await readFile(path.join(destination, 'catalog.json'), 'utf8'));
await mkdir(path.join(destination, 'data'), { recursive: true });
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const artifacts: Record<string, { sha256: string; bytes: number }> = {};

async function evidence(root: string, relative: string | undefined, expectedHash?: string): Promise<string | null> {
  if (!relative) return null;
  // Older published records sometimes stored a disclosed capture failure in
  // this field. Preserve that original record but never turn it into a path.
  if (relative.startsWith('CAPTURE_FAILED')) return null;
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Evidence path escapes source root');
  const source = path.resolve(root, relative);
  if (!source.startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid evidence path');
  let bytes: Buffer;
  try {
    if (!(await realpath(source)).startsWith(await realpath(root) + path.sep)) throw new Error('Evidence symlink escapes source root');
    bytes = await readFile(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (expectedHash && digest(bytes) !== expectedHash) throw new Error(`Reviewed evidence changed: ${relative}`);
  const extension = path.extname(relative).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.pdf'].includes(extension)) throw new Error(`Unsupported public evidence type: ${extension}`);
  const target = `evidence/shared/${digest(bytes).slice(0, 24)}${extension}`;
  await mkdir(path.dirname(path.join(destination, target)), { recursive: true });
  await copyFile(source, path.join(destination, target));
  artifacts[target] = { sha256: digest(bytes), bytes: (await stat(source)).size };
  return target;
}

const portraits: Array<Record<string, unknown>> = [];
const legacyText = await readFile(path.join(santaCruz, 'docs/data.js'), 'utf8');
const legacy = vm.runInNewContext(`${legacyText}\nJSON.stringify(JURISDICTIONS)`, {}, { timeout: 1000 });
const legacyCommit = execFileSync('git', ['-C', santaCruz, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
for (const [key, slug, geography] of [['city_santa_cruz', 'santa-cruz', 'city'], ['santa_cruz_county', 'santa-cruz-county', 'county'], ['watsonville', 'watsonville', 'city']]) {
  const source = JSON.parse(legacy)[key!];
  if (!source) throw new Error(`Santa Cruz source missing ${key}`);
  const dimensions = [];
  for (const ring of ['social', 'ecological']) for (const row of source[ring]) {
    const snapshot = await evidence(path.join(santaCruz, 'docs'), row.screenshot);
    dimensions.push({ slug: row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), ring, name: row.name, level: typeof row.level === 'number' && Number.isFinite(row.level) ? row.level : null,
      context: row.context ?? '', actions: row.actions ?? [], indicators: [{ name: row.indicator ?? row.name, value: row.value ?? null, unit: '', year: row.year ?? null,
        target: row.target ?? null, source: row.source ?? '', source_url: row.sourceUrl ?? '', geography: 'See source context',
        status: 'legacy-source', notes: row.context ?? '', evidence_path: snapshot, pdf_path: null }] });
  }
  portraits.push({ slug, name: source.name, group: 'Santa Cruz', region: source.description, population: source.population,
    status: 'legacy-source', notice: 'Existing Santa Cruz portrait, preserved from its source project. These legacy entries have not been re-researched or newly approved in this release; source geography and vintages vary.',
    provenance: { kind: 'legacy-source', repository: 'https://github.com/jglasskatz/doughnut-santa-cruz', commit: legacyCommit, source_file: 'docs/data.js', source_sha256: digest(legacyText), jurisdiction: key, geography }, dimensions });
}

for (const { slug } of catalog.portraits.filter((p: { slug: string; status: string }) => p.status === 'published')) {
  const portrait = await publishedDoughnut<PublishedPortrait>(getDb(), slug);
  if (!portrait?.dimensions.length) throw new Error(`No published portrait for ${slug}; refusing an incomplete release`);
  const dimensions = [];
  for (const dimension of [...portrait.dimensions].sort((a, b) => a.display_order - b.display_order)) {
    const indicators = [];
    for (const row of dimension.data.indicators) indicators.push({ ...row,
      geography: row.geographic_scale, status: row.value === null ? 'gap' : 'published',
      evidence_path: await evidence(path.resolve('apps/web/public/evidence', slug), row.evidence?.snapshot_path),
      pdf_path: await evidence(path.resolve('apps/web/public/evidence', slug), row.evidence?.pdf_path),
    });
    dimensions.push({ slug: dimension.slug, ring: dimension.ring, name: dimension.data.name, level: dimension.viz_level,
      context: dimension.data.context, actions: dimension.data.actions, indicators,
      published_at: dimension.published_at, version_num: dimension.version_num });
  }
  portraits.push({ slug, name: portrait.tenant.name, group: 'New York City', region: portrait.tenant.region, status: 'published',
    notice: 'Snapshot of the existing published portrait. Each dimension retains all indicators and its published score; source dates and evidence availability are shown below.',
    provenance: { kind: 'published-db', source_sha256: digest(JSON.stringify(portrait)), versions: portrait.dimensions.map(d => ({ dimension: d.slug, version: d.version_num, published_at: d.published_at })) }, dimensions });
}

const campaign = option('--campaign', 'research/carmel-monterey-2026-10-23-sol-medium');
let campaignMetadata: { research_model?: string; research_reasoning_effort?: string; baseline?: string } = {};
try { campaignMetadata = JSON.parse(await readFile(path.join(campaign, 'campaign.json'), 'utf8')); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
// Older campaign snapshots used Luna. New runs record their actual research
// model and retain the prior campaign, so inherited findings stay attributable.
const researchModel = campaignMetadata.research_model ?? 'gpt-6-luna';
const researchLabel = researchModel === 'gpt-6.1-sol' ? 'Sol 6.1' : researchModel === 'gpt-6-luna' ? 'Luna' : researchModel;
const researchDescription = campaignMetadata.baseline
  ? `This pass used ${researchLabel}${campaignMetadata.research_reasoning_effort ? ` at ${campaignMetadata.research_reasoning_effort} effort` : ''} to extend earlier research; unchanged findings retain their prior sources.`
  : `${researchLabel} researched.`;
type ReviewManifest = { reviewer: string; reviewed_at: string; approved: false; supporting_evidence_sha256?: Record<string, string>; framework_profiles?: Record<string, { id: string; sha256: string }>; evidence_sha256?: Record<string, Record<string, string>>; portraits: Record<string, Record<string, { findings_sha256: string; reviews_sha256: string }>> };
let reviewManifest: ReviewManifest | null = null;
try { reviewManifest = JSON.parse(await readFile(path.join(campaign, 'review-manifest.json'), 'utf8')); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
if (process.argv.includes('--require-review-manifest') && !reviewManifest) throw new Error('Missing independent review manifest');
if (reviewManifest && (reviewManifest.reviewer !== 'gpt-6.1-sol' || reviewManifest.approved !== false || !reviewManifest.reviewed_at)) throw new Error('Invalid independent review manifest');
for (const slug of ['carmel', 'monterey-county']) {
  const profile = portraitFramework(catalog.portraits.find((p: { slug: string }) => p.slug === slug));
  if (reviewManifest && (reviewManifest.framework_profiles?.[slug]?.id !== profile.profile || reviewManifest.framework_profiles?.[slug]?.sha256 !== profile.sha256)) throw new Error(`Independent framework review is stale: ${slug}`);
  async function researchEvidence(relative: string | undefined) {
    if (!relative) return null;
    const expectedHash = reviewManifest?.evidence_sha256?.[slug]?.[relative];
    if (reviewManifest && !expectedHash) throw new Error(`Missing reviewed evidence binding: ${slug}/${relative}`);
    const exported = await evidence(path.resolve('apps/web/public/evidence', slug), relative, expectedHash);
    if (expectedHash && !exported) throw new Error(`Reviewed evidence missing: ${slug}/${relative}`);
    return exported;
  }
  const directory = path.join(campaign, slug);
  const config = JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8'));
  let supporting: Record<string, Array<{ label: string; source_url: string; snapshot_path: string; pdf_path?: string }>> = {};
  try {
    const raw = await readFile(path.join(directory, 'supporting-evidence.json'), 'utf8');
    if (reviewManifest && reviewManifest.supporting_evidence_sha256?.[slug] !== digest(raw)) throw new Error(`Independent supporting-evidence review is stale: ${slug}`);
    supporting = JSON.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (reviewManifest?.supporting_evidence_sha256?.[slug]) throw new Error(`Missing reviewed supporting evidence: ${slug}`);
  }
  const dimensions = [];
  const hashes: Record<string, string> = {};
  for (const dimension of profile.dimensions) {
    const raw = await readFile(path.join(directory, 'findings', `${dimension.slug}.json`), 'utf8');
    const reviewText = await readFile(path.join(directory, 'reviews', `${dimension.slug}.json`), 'utf8');
    if (reviewManifest) {
      const binding = reviewManifest.portraits[slug]?.[dimension.slug];
      if (binding?.findings_sha256 !== digest(raw) || binding?.reviews_sha256 !== digest(reviewText)) throw new Error(`Independent review is stale or missing: ${slug}/${dimension.slug}`);
    }
    hashes[dimension.slug] = digest(raw + reviewText);
    const reviews = JSON.parse(reviewText) as Array<{ indicator_slug: string; content_supported: 'pass' | 'fail' | 'uncertain'; verifier_note: string }>;
    const indicators = [];
    for (const rawFinding of JSON.parse(raw) as unknown[]) {
      const row = (rawFinding as { kind?: string }).kind === 'observation' ? previewObservationSchema.parse(rawFinding) : findingPayloadSchema.parse(rawFinding) as FindingPayload;
      const spec = dimension.indicators.find((i: { slug: string }) => i.slug === row.indicator_slug);
      if (!spec || (row.kind === 'observation' && spec.scoring !== 'unscored') || (row.kind === 'indicator' && spec.scoring === 'unscored')) throw new Error(`Finding disagrees with framework profile: ${slug}/${row.indicator_slug}`);
      const supportingEvidence = [];
      for (const item of supporting[row.indicator_slug] ?? []) supportingEvidence.push({ label: item.label, source_url: item.source_url,
        evidence_path: await researchEvidence(item.snapshot_path),
        pdf_path: await researchEvidence(item.pdf_path) });
      const review = reviews.find(r => r.indicator_slug === row.indicator_slug);
      if (!review) throw new Error(`Unreviewed research finding: ${slug}/${row.indicator_slug}`);
      if (row.kind === 'gap') indicators.push({ indicator_slug: row.indicator_slug, name: spec.name ?? row.indicator_slug,
        value: null, unit: '', year: null, status: 'gap', notes: row.reason, search_context: row.nearest_data,
        review_note: review.verifier_note, geography: 'Not measured', evidence_path: null, pdf_path: null, ...(supportingEvidence.length ? { supporting_evidence: supportingEvidence } : {}) });
      else {
        if (row.kind === 'indicator') {
        const threshold = resolveThreshold(spec.threshold_ref, config.threshold_overrides);
        if (!threshold || !spec || typeof row.value !== 'number' || row.target !== threshold.target || row.scoring.threshold_ref !== spec.threshold_ref || row.scoring.function !== threshold.function || row.level_pct !== computeScoring(row.value, spec.threshold_ref, threshold).level_pct || !isDeepStrictEqual(row.scoring.inputs, computeScoring(row.value, spec.threshold_ref, threshold).scoring.inputs)) throw new Error(`Research score disagrees with canonical threshold: ${slug}/${row.indicator_slug}`);
        }
        const snapshot = await researchEvidence(row.evidence.snapshot_path);
        indicators.push({ ...row, status: review.content_supported === 'pass' && snapshot ? (row.kind === 'observation' ? 'source-supported-observation' : 'source-supported-draft') : 'uncertain',
          quality_flags: [
            ...(row.confidence === 'low' ? ['Low confidence estimate'] : []),
            ...(new Date().getFullYear() - row.year > maxDataAgeYears(config.recency, dimension.slug) ? [`Outside the configured recency limit (${row.year})`] : []),
            ...(!acceptedScales(config.scale_policy, dimension.slug).includes(row.geographic_scale) ? ['Geography falls outside the configured scale policy'] : []),
          ],
          geography: slug === 'carmel' && row.geographic_scale === 'county' ? 'Monterey County proxy — not Carmel city limits' : row.geographic_scale,
          evidence_path: snapshot, pdf_path: await researchEvidence(row.evidence.pdf_path),
          review_note: review.verifier_note, ...(supportingEvidence.length ? { supporting_evidence: supportingEvidence } : {}) });
      }
    }
    // A preview may show only independently supported, archived scores. A
    // missing exhibit suppresses the entire dimension score, never guesses it.
    const numeric = indicators.filter(i => i.value !== null);
    const scored = numeric.filter(i => i.status === 'source-supported-draft') as Array<{ level_pct: number }>;
    const level = scored.length && scored.length === numeric.length ? pctToVizLevel(Math.max(...scored.map(i => i.level_pct))) : null;
    dimensions.push({ slug: dimension.slug, ring: dimension.ring, name: dimension.name, level, context: 'Provisional research. Gaps and missing archives remain unresolved.', actions: [], indicators });
  }
  portraits.push({ slug, name: config.region.name, group: 'Carmel & Monterey', region: config.region.definition, status: 'research-preview',
    notice: `Research preview — not an approved portrait. ${researchDescription} Sol 6.1 independently checked the sources. Supported drafts, unscored observations, missing evidence and gaps are labeled per indicator. Colored wedges show only archived, source-supported draft scores; unarchived or unscored dimensions stay grey. No human approval is implied.`,
    provenance: { kind: 'session-research', campaign: path.basename(campaign), researcher: researchModel,
      ...(campaignMetadata.research_reasoning_effort ? { research_reasoning_effort: campaignMetadata.research_reasoning_effort } : {}),
      ...(campaignMetadata.baseline ? { baseline_campaign: campaignMetadata.baseline } : {}), reviewer: 'gpt-6.1-sol', hashes, framework_profile: profile.profile, framework_profile_sha256: profile.sha256,
      ...(reviewManifest ? { review_manifest_sha256: digest(JSON.stringify(reviewManifest)), reviewed_at: reviewManifest.reviewed_at } : {}), approved: false }, dimensions });
}
const ledger = JSON.parse(await readFile(path.join(campaign, 'cost-ledger.json'), 'utf8'));
const data = { schema_version: 1, captured_at: new Date().toISOString(), portraits, cost_scenarios: ledger };
await writeFile(path.join(destination, 'data/portraits.json'), JSON.stringify(data, null, 2) + '\n');
await writeFile(path.join(destination, 'data/evidence-manifest.json'), JSON.stringify(artifacts, null, 2) + '\n');
console.log(JSON.stringify({ portraits: portraits.length, evidence_files: Object.keys(artifacts).length, evidence_bytes: Object.values(artifacts).reduce((n, artifact) => n + artifact.bytes, 0) }));
process.exit(0);
