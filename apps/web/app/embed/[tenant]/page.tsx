import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EmbedFrame } from '@/components/embed/EmbedFrame';
import { getPortrait } from '@/lib/data';
import { embedOriginsFor } from '@/lib/embed-policy';
import { appUrl } from '@/lib/env';
import { localizeDimensions } from '@/lib/i18n/content';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { getI18n } from '@/lib/i18n/server';
import { pageTitle } from '@/lib/page-meta';

export const dynamic = 'force-dynamic';

/** "Doughnut portrait · New York City": what a screen reader announces inside the city's iframe. */
export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const [portrait, { m }] = await Promise.all([getPortrait((await params).tenant), getI18n()]);
  return { title: portrait ? pageTitle(m.doughnut.portrait, portrait.tenant.name) : m.notFound.title };
}

/**
 * Embed view (SPEC.md §10): iframe target for the loader script. Who may
 * frame it is enforced by the browser through the CSP frame-ancestors the
 * middleware derives from the tenant's embed_origins — not by anything this
 * page can be told. The loader's `?origin=` is used only to address resize
 * messages, and only when it is on the allowlist.
 */
export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ origin?: string }>;
}) {
  const { tenant } = await params;
  const { origin } = await searchParams;

  const [portrait, allowedOrigins, { m, href }] = await Promise.all([
    getPortrait(tenant),
    embedOriginsFor(tenant),
    getI18n(),
  ]);
  if (!portrait) notFound();

  const parentOrigin = origin && allowedOrigins.includes(origin) ? origin : null;

  return (
    <main id="main">
      <EmbedFrame
        tenantSlug={tenant}
        tenantName={portrait.tenant.name}
        dimensions={localizeDimensions(m, portrait.dimensions)}
        parentOrigin={parentOrigin}
        portraitUrl={`${appUrl()}${href(`/${tenant}`)}`}
        labels={doughnutLabels(m)}
      />
    </main>
  );
}
