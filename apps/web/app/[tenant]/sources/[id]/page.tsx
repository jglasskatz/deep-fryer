import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { evidenceUrl, hasDatabase, getPortrait } from '@/lib/data';
import { publicSource } from '@/lib/source-data';

export const dynamic = 'force-dynamic';

/**
 * One archived source (SPEC.md §10): the extracted text beside the snapshot
 * exhibit. Tier 1–2 → full text; tiers 3–4 → the cited passage in ±context;
 * `?q=` anchors the highlight either way.
 */
export default async function SourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { tenant, id } = await params;
  const { q } = await searchParams;
  if (!hasDatabase()) notFound();
  const [portrait, result] = await Promise.all([getPortrait(tenant), publicSource(tenant, id, q)]);
  if (!portrait || !result) notFound();
  const { source, body } = result;

  // Full-text highlight: locate the quoted passage once, server-side.
  let full: { before: string; match: string; after: string } | null = null;
  if (body.kind === 'full') {
    if (q) {
      const { excerptAround } = await import('@deep-fryer/core');
      full = excerptAround(body.text, q, body.text.length);
    }
    full ??= { before: body.text, match: '', after: '' };
  }

  return (
    <>
      <SiteHeader variant="tenant" tenant={{ slug: portrait.tenant.slug, name: portrait.tenant.name }} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/sources`}>
            ← Source library
          </Link>
        </p>
        <h1 className="mt-2 text-xl font-bold">{source.title || source.url || 'Archived source'}</h1>
        <p className="mt-1 text-xs text-[color:var(--color-muted)]">
          {source.sourceTier ? `tier ${source.sourceTier} · ` : ''}
          archived {source.capturedAt.toISOString().slice(0, 10)} · {source.mediaType}
          {source.url ? (
            <>
              {' · '}
              <a className="underline" href={source.url} target="_blank" rel="noreferrer">
                live source
              </a>
            </>
          ) : null}
          {source.pdfPath ? (
            <>
              {' · '}
              <a
                className="underline"
                href={evidenceUrl(tenant, source.pdfPath)}
                target="_blank"
                rel="noreferrer"
              >
                original document
              </a>
            </>
          ) : null}
        </p>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            {full ? (
              <div className="max-h-[70vh] overflow-y-auto rounded border border-black/15 p-3 text-sm whitespace-pre-wrap">
                {full.before}
                {full.match ? <mark>{full.match}</mark> : null}
                {full.after}
              </div>
            ) : body.kind === 'excerpt' ? (
              <div className="rounded border border-black/15 p-3 text-sm whitespace-pre-wrap">
                <p className="mb-2 text-xs text-[color:var(--color-muted)]">
                  Excerpt around the cited passage — full text is available for government (tier
                  1–2) sources; for this source, read the original via the live link or the
                  archived snapshot.
                </p>
                …{body.excerpt.before}
                <mark>{body.excerpt.match}</mark>
                {body.excerpt.after}…
              </div>
            ) : (
              <p className="rounded border border-dashed border-black/25 p-3 text-sm text-[color:var(--color-muted)]">
                {source.text
                  ? 'Text for this source is available in its archived form via the snapshot; open the cited passage from a claim to see it in context.'
                  : 'No text could be extracted from this source — the snapshot is the archived record.'}
              </p>
            )}
          </div>
          <figure>
            <a href={evidenceUrl(tenant, source.snapshotPath)} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={evidenceUrl(tenant, source.snapshotPath)}
                alt={`Archived snapshot of ${source.title ?? source.url}`}
                className="max-h-[70vh] w-full rounded border border-black/15 object-contain object-top"
              />
            </a>
            <figcaption className="mt-1 text-xs text-[color:var(--color-muted)]">
              Snapshot captured {source.capturedAt.toISOString().slice(0, 10)} — the exhibit the
              claim was verified against.
            </figcaption>
          </figure>
        </div>
      </main>
    </>
  );
}
