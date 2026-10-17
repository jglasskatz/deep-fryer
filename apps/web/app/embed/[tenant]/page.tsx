import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EmbedFrame } from '@/components/embed/EmbedFrame';
import { SampleDataNotice } from '@/components/sample-data/SampleDataNotice';
import { getPortrait } from '@/lib/data';
import { embedOriginsFor } from '@/lib/embed-policy';
import { appUrl } from '@/lib/env';
import { localizeDimensions } from '@/lib/i18n/content';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { getI18n } from '@/lib/i18n/server';
import { pageTitle } from '@/lib/page-meta';
import { portraitSampleData } from '@/lib/sample-data';

export const dynamic = 'force-dynamic';

/**
 * "Doughnut portrait · New York City": what a screen reader announces inside
 * the city's iframe. Never indexed, and canonical to the portrait itself in
 * the embed's language: an embed is a framed copy of that page, so search
 * engines are sent to the portrait (app/robots.ts also keeps them out).
 * Replaces the layout's alternates — an embed lists no language versions.
 */
export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const { tenant } = await params;
  const [portrait, { m, href }] = await Promise.all([getPortrait(tenant), getI18n()]);
  if (!portrait) return { title: m.notFound.title };
  return {
    title: pageTitle(m.doughnut.portrait, portrait.tenant.name),
    robots: { index: false, follow: true },
    alternates: { canonical: `${appUrl()}${href(`/${portrait.tenant.slug}`)}` },
  };
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

  const [portrait, allowedOrigins, { m, href }, sample] = await Promise.all([
    getPortrait(tenant),
    embedOriginsFor(tenant),
    getI18n(),
    portraitSampleData(tenant),
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
        credit={m.footer.credit}
        notice={sample ? <SampleDataNotice labels={m.sampleData} name={portrait.tenant.name} compact /> : undefined}
      />
    </main>
  );
}
