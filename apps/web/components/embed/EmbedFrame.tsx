'use client';

import { useEffect, useRef } from 'react';
import { PortraitDoughnut } from '@/components/doughnut/PortraitDoughnut';
import type { DoughnutLabels } from '@/lib/i18n/doughnut';
import type { PublishedDimension } from '@/lib/portrait';

/**
 * Embed body (SPEC.md §10): doughnut with stripped chrome, postMessage
 * resize to the validated parent origin; drilldowns open on the hosted page.
 */
export function EmbedFrame({
  tenantSlug,
  tenantName,
  dimensions,
  parentOrigin,
  portraitUrl,
  labels,
}: {
  tenantSlug: string;
  tenantName: string;
  dimensions: PublishedDimension[];
  parentOrigin: string | null;
  /** Absolute URL of the hosted portrait in the embed's language. */
  portraitUrl: string;
  labels: DoughnutLabels;
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
      <PortraitDoughnut
        tenantSlug={tenantSlug}
        tenantName={tenantName}
        dimensions={dimensions}
        size={640}
        linkBase={`${portraitUrl}/dim`}
        labels={labels}
      />
      <p className="mt-1 text-center text-[11px] text-black/50">
        <a href={portraitUrl} target="_blank" rel="noreferrer" className="underline">
          {labels.fullPortrait}
        </a>
      </p>
    </div>
  );
}
