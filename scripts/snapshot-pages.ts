/** Freeze explicitly selected public portraits; CI never needs the research database. */
import { readFile, writeFile, mkdir, copyFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { framework } from '@deep-fryer/contract';
import { pctToVizLevel, type FindingPayload } from '@deep-fryer/core';
import { getDb, publishedDoughnut } from '@deep-fryer/db';
import type { PublishedPortrait } from '../apps/web/lib/portrait.js';

const sourceIndex = process.argv.indexOf('--santa-cruz');
if (sourceIndex < 0 || !process.argv[sourceIndex + 1]) throw new Error('Usage: node --env-file=.env.local --import tsx scripts/snapshot-pages.ts --santa-cruz <source-checkout>');
const santaCruz = path.resolve(process.argv[sourceIndex + 1]!);
const destination = path.resolve('site');
const catalog = JSON.parse(await readFile(path.join(destination, 'catalog.json'), 'utf8'));
await mkdir(path.join(destination, 'data'), { recursive: true });
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const artifacts: Record<string, { sha256: string; bytes: number }> = {};

async function evidence(root: string, relative: string | undefined): Promise<string | null> {
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
  const extension = path.extname(relative).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.pdf'].includes(extension)) throw new Error(`Unsupported public evidence type: ${extension}`);
  const target = `evidence/shared/${digest(bytes).slice(0, 24)}${extension}`;
  await mkdir(path.dirname(path.join(destination, target)), { recursive: true });
  await copyFile(source, path.join(destination, target));
  artifacts[target] = { sha256: digest(bytes), bytes: (await stat(source)).size };
  return target;
}

const portraits: any[] = [];
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

for (const { slug } of catalog.portraits.filter((p: any) => p.status === 'published')) {
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

const campaign = 'research/carmel-monterey-2026-10-18';
for (const slug of ['carmel', 'monterey-county']) {
  const directory = path.join(campaign, slug);
  const config = JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8'));
  const dimensions = [];
  const hashes: Record<string, string> = {};
  for (const dimension of framework.dimensions) {
    const raw = await readFile(path.join(directory, 'findings', `${dimension.slug}.json`), 'utf8');
    const reviewText = await readFile(path.join(directory, 'reviews', `${dimension.slug}.json`), 'utf8');
    hashes[dimension.slug] = digest(raw + reviewText);
    const reviews = JSON.parse(reviewText);
    const indicators = [];
    for (const row of JSON.parse(raw) as FindingPayload[]) {
      const review = reviews.find((r: any) => r.indicator_slug === row.indicator_slug);
      if (!review) throw new Error(`Unreviewed research finding: ${slug}/${row.indicator_slug}`);
      if (row.kind === 'gap') indicators.push({ indicator_slug: row.indicator_slug, name: dimension.indicators.find(i => i.slug === row.indicator_slug)?.name ?? row.indicator_slug,
        value: null, unit: '', year: null, status: 'gap', notes: row.reason, search_context: row.nearest_data,
        review_note: review.verifier_note, geography: 'Not measured', evidence_path: null, pdf_path: null });
      else {
        const snapshot = await evidence(path.resolve('apps/web/public/evidence', slug), row.evidence.snapshot_path);
        indicators.push({ ...row, status: review.content_supported === 'pass' && snapshot ? 'source-supported-draft' : 'uncertain',
          geography: slug === 'carmel' && row.geographic_scale === 'county' ? 'Monterey County proxy — not Carmel city limits' : row.geographic_scale,
          evidence_path: snapshot, pdf_path: await evidence(path.resolve('apps/web/public/evidence', slug), row.evidence.pdf_path),
          review_note: review.verifier_note });
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
    notice: 'Research preview — not an approved portrait. Luna researched; Sol 6.1 independently checked the sources. Supported drafts, missing evidence and gaps are labeled per indicator. Colored wedges show only archived, source-supported draft scores; unarchived dimensions stay unknown. No human approval is implied.',
    provenance: { kind: 'session-research', researcher: 'gpt-6-luna', reviewer: 'gpt-6.1-sol', hashes, approved: false }, dimensions });
}
const ledger = JSON.parse(await readFile(path.join(campaign, 'cost-ledger.json'), 'utf8'));
const data = { schema_version: 1, captured_at: new Date().toISOString(), portraits, cost_scenarios: ledger };
await writeFile(path.join(destination, 'data/portraits.json'), JSON.stringify(data, null, 2) + '\n');
await writeFile(path.join(destination, 'data/evidence-manifest.json'), JSON.stringify(artifacts, null, 2) + '\n');
console.log(JSON.stringify({ portraits: portraits.length, evidence_files: Object.keys(artifacts).length, evidence_bytes: Object.values(artifacts).reduce((n, artifact) => n + artifact.bytes, 0) }));
process.exit(0);
