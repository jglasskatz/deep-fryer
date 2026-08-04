'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { Doughnut, type DoughnutDimension } from './Doughnut';
import type { PublishedDimension } from '@/lib/portrait';

/**
 * Client wrapper: renders the published portrait and navigates to the
 * dimension drilldown on segment click.
 */
export function PortraitDoughnut({
  tenantSlug,
  dimensions,
  size = 720,
  linkBase,
}: {
  tenantSlug: string;
  dimensions: PublishedDimension[];
  size?: number;
  /** Defaults to /{tenant}/dim; embeds pass an absolute URL instead. */
  linkBase?: string;
}) {
  const router = useRouter();

  const { social, ecological } = useMemo(() => {
    const social: DoughnutDimension[] = [];
    const ecological: DoughnutDimension[] = [];
    for (const d of [...dimensions].sort((a, b) => a.display_order - b.display_order)) {
      const first = d.data.indicators[0];
      const entry: DoughnutDimension = {
        ring: d.ring,
        slug: d.slug,
        name: d.data.name,
        viz_level: d.viz_level,
        indicator: first?.name,
        value:
          first?.value === null || first?.value === undefined ? undefined : String(first.value),
        year: first?.year ?? undefined,
        source: first?.source || undefined,
      };
      (d.ring === 'social' ? social : ecological).push(entry);
    }
    return { social, ecological };
  }, [dimensions]);

  const handleSelect = useCallback(
    (dim: DoughnutDimension | null) => {
      if (!dim) return;
      const href = linkBase ? `${linkBase}/${dim.slug}` : `/${tenantSlug}/dim/${dim.slug}`;
      if (linkBase?.startsWith('http')) {
        window.open(href, '_blank', 'noopener');
      } else {
        router.push(href);
      }
    },
    [router, tenantSlug, linkBase],
  );

  return (
    <Doughnut social={social} ecological={ecological} size={size} onSelect={handleSelect} />
  );
}
