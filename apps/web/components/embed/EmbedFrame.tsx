'use client';

import { useEffect, useRef } from 'react';
import { PortraitDoughnut } from '@/components/doughnut/PortraitDoughnut';
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
  hostBase,
}: {
  tenantSlug: string;
  tenantName: string;
  dimensions: PublishedDimension[];
  parentOrigin: string | null;
  hostBase: string;
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
        linkBase={`${hostBase}/${tenantSlug}/dim`}
      />
      <p className="mt-1 text-center text-[11px] text-black/50">
        <a href={`${hostBase}/${tenantSlug}`} target="_blank" rel="noreferrer" className="underline">
          Full portrait & discussion
        </a>
      </p>
    </div>
  );
}
