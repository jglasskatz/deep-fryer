'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { PortraitDoughnut } from '@/components/doughnut/PortraitDoughnut';
import { DoughnutCredit } from '@/components/site-footer/DoughnutCredit';
import type { DoughnutLabels } from '@/lib/i18n/doughnut';
import type { PublishedDimension } from '@/lib/portrait';

/**
 * Embed body (SPEC.md §10): doughnut with stripped chrome, postMessage
 * resize to the validated parent origin; drilldowns open on the hosted page.
 *
 * An embed has no site footer, so it carries the Doughnut's attribution
 * itself (docs/OPEN-SOURCE.md §3.3, the same words as the footer's), and a
 * seeded portrait's "Sample data" notice comes in as `notice`. Both sit
 * inside the measured box, so the height posted to the host page includes
 * them and nothing is cut off at the iframe's bottom edge.
 */
export function EmbedFrame({
  tenantSlug,
  tenantName,
  dimensions,
  parentOrigin,
  portraitUrl,
  labels,
  credit,
  notice,
}: {
  tenantSlug: string;
  tenantName: string;
  dimensions: PublishedDimension[];
  parentOrigin: string | null;
  /** Absolute URL of the hosted portrait in the embed's language. */
  portraitUrl: string;
  labels: DoughnutLabels;
  /** m.footer.credit in the embed's language. */
  credit: string;
  /** Above the doughnut: the sample-data notice, when the portrait carries one. */
  notice?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !parentOrigin) return;
    const post = () => {
      window.parent.postMessage(
        { type: 'deep-fryer:resize', tenant: tenantSlug, height: el.offsetHeight },
        parentOrigin,
      );
    };
    post();
    const observer = new ResizeObserver(post);
    observer.observe(el);
    return () => observer.disconnect();
  }, [parentOrigin, tenantSlug]);

  return (
    <div ref={ref} className="p-2">
      {notice ? <div className="mb-2">{notice}</div> : null}
      <PortraitDoughnut
        tenantSlug={tenantSlug}
        tenantName={tenantName}
        dimensions={dimensions}
        size={640}
        linkBase={`${portraitUrl}/dim`}
        labels={labels}
      />
      {/* The widget's way to the full portrait, on cities' own sites: muted ink, not
          translucent black (3.9:1), so it reaches 4.5:1 on the embed's always-light page. */}
      <p className="mt-1 text-center text-xs text-[color:var(--color-muted)]">
        <a href={portraitUrl} target="_blank" rel="noreferrer" className="underline">
          {labels.fullPortrait}
        </a>
      </p>
      {/* Links open in a new tab, like the one above: a click inside the iframe must not navigate the city's page. */}
      <p className="mx-auto mt-1 max-w-xl text-center text-xs leading-snug text-[color:var(--color-muted)]">
        <DoughnutCredit text={credit} newTab />
      </p>
    </div>
  );
}
