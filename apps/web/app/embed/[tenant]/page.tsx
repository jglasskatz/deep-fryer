import { notFound } from 'next/navigation';
import { EmbedFrame } from '@/components/embed/EmbedFrame';
import { getPortrait } from '@/lib/data';
import { embedOriginsFor } from '@/lib/embed-policy';
import { appUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

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

  const [portrait, allowedOrigins] = await Promise.all([
    getPortrait(tenant),
    embedOriginsFor(tenant),
  ]);
  if (!portrait) notFound();

  const parentOrigin = origin && allowedOrigins.includes(origin) ? origin : null;

  return (
    <main id="main">
      <EmbedFrame
        tenantSlug={tenant}
        tenantName={portrait.tenant.name}
        dimensions={portrait.dimensions}
        parentOrigin={parentOrigin}
        hostBase={appUrl()}
      />
    </main>
  );
}
