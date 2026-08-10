import { excerptAround, type Excerpt } from '@deep-fryer/core';
import {
  getDb,
  listSources,
  searchSources,
  sourceById,
  sourcesBySnapshotPaths,
  tenantBySlug,
  type Source,
  type SourceSearchHit,
} from '@deep-fryer/db';
import { getPortrait } from './data';
import type { PublishedPortrait } from './portrait';

/**
 * Source-library read layer — and the tiered-exposure choke point (SPEC.md
 * §10): full text is public only for tier-1/2 government sources (or an
 * explicit text_public override); tiers 3–4 render a quote-anchored excerpt;
 * the whole corpus is searchable in admin. Every public accessor here
 * redacts before returning — pages never touch Source.text directly.
 */

export function sourceTextIsPublic(s: Pick<Source, 'textPublic' | 'sourceTier'>): boolean {
  return s.textPublic ?? (s.sourceTier !== null && s.sourceTier <= 2);
}

export type PublicSourceBody =
  | { kind: 'full'; text: string }
  | { kind: 'excerpt'; excerpt: Excerpt }
  | { kind: 'none' };

export interface BibliographyGroup {
  dimensionSlug: string;
  dimensionName: string;
  sources: Source[];
}

/**
 * The public bibliography: exactly the sources cited by the published
 * portrait (joined via evidence.snapshot_path), grouped by dimension.
 * Uncited captures stay admin-only.
 */
export async function publicBibliography(
  tenantSlug: string,
): Promise<{ portrait: PublishedPortrait; groups: BibliographyGroup[] } | null> {
  const portrait = await getPortrait(tenantSlug);
  if (!portrait) return null;
  const db = getDb();
  const tenant = await tenantBySlug(db, tenantSlug);
  if (!tenant) return null;

  const paths = portrait.dimensions.flatMap((d) =>
    d.data.indicators.flatMap((ind) => (ind.evidence?.snapshot_path ? [ind.evidence.snapshot_path] : [])),
  );
  const byPath = await sourcesBySnapshotPaths(db, tenant.id, [...new Set(paths)]);

  const groups: BibliographyGroup[] = [];
  for (const d of portrait.dimensions) {
    const seen = new Set<string>();
    const dimSources: Source[] = [];
    for (const ind of d.data.indicators) {
      const src = ind.evidence?.snapshot_path ? byPath.get(ind.evidence.snapshot_path) : undefined;
      if (src && !seen.has(src.id)) {
        seen.add(src.id);
        dimSources.push(src);
      }
    }
    if (dimSources.length) {
      dimSources.sort(
        (a, b) => (a.sourceTier ?? 99) - (b.sourceTier ?? 99) || +b.capturedAt - +a.capturedAt,
      );
      groups.push({ dimensionSlug: d.slug, dimensionName: d.data.name, sources: dimSources });
    }
  }
  return { portrait, groups };
}

/** One source with its text redacted per the tier rule. `q` anchors the excerpt/highlight. */
export async function publicSource(
  tenantSlug: string,
  id: string,
  q?: string,
): Promise<{ source: Source; body: PublicSourceBody } | null> {
  const db = getDb();
  const tenant = await tenantBySlug(db, tenantSlug);
  if (!tenant) return null;
  const source = await sourceById(db, tenant.id, id);
  if (!source) return null;

  let body: PublicSourceBody = { kind: 'none' };
  if (source.text) {
    if (sourceTextIsPublic(source)) {
      body = { kind: 'full', text: source.text };
    } else if (q) {
      const excerpt = excerptAround(source.text, q);
      if (excerpt) body = { kind: 'excerpt', excerpt };
    }
  }
  return { source, body };
}

export async function adminSearchSources(
  tenantId: string,
  q: string,
): Promise<SourceSearchHit[]> {
  return searchSources(getDb(), tenantId, q);
}

export async function adminListSources(tenantId: string): Promise<Source[]> {
  return listSources(getDb(), tenantId);
}

/** snapshot_path → source id, for linking citations into the library. */
export async function sourceIdsForEvidence(
  tenantId: string,
  snapshotPaths: string[],
): Promise<Record<string, string>> {
  const byPath = await sourcesBySnapshotPaths(getDb(), tenantId, snapshotPaths);
  return Object.fromEntries([...byPath].map(([path, src]) => [path, src.id]));
}
