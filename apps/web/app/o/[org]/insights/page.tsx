import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatIndicatorValue } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { RequestResearchForm } from '@/components/insights/RequestResearchForm';
import { getPortrait, evidenceUrl, hasDatabase } from '@/lib/data';
import { getDb, tenantBySlug } from '@deep-fryer/db';
import { getAuth, getRole } from '@/lib/auth';
import { configValue } from '@/lib/admin-data';
import { familyByOrgSlug, type FamilyMember } from '@/lib/family';
import { safeHref } from '@/lib/safe-url';
import type { PublishedPortrait, PublishedDimension } from '@/lib/portrait';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string }>;
}): Promise<Metadata> {
  const family = await familyByOrgSlug((await params).org);
  return { title: family ? `Insights · ${family.organization.name}` : 'Insights' };
}

export const dynamic = 'force-dynamic';

const VIZ_MIN = -100;
const VIZ_MAX = 150;

/** viz_level (-100 safe … 0 boundary … 150 far outside) → cell color. */
function cellColor(level: number | null): string {
  if (level === null) return 'rgba(0,0,0,0.06)';
  if (level <= 0) {
    const t = Math.min(1, -level / 100);
    return `rgba(46,125,50,${0.15 + 0.5 * t})`;
  }
  const t = Math.min(1, level / 150);
  return `rgba(198,40,40,${0.15 + 0.65 * t})`;
}

function barGeometry(level: number) {
  const clamped = Math.max(VIZ_MIN, Math.min(VIZ_MAX, level));
  const zeroX = (100 * -VIZ_MIN) / (VIZ_MAX - VIZ_MIN); // 40%
  const x = zeroX + (clamped / (VIZ_MAX - VIZ_MIN)) * 100;
  return { zeroX, left: Math.min(zeroX, x), width: Math.abs(x - zeroX) };
}

/**
 * Family insights (SPEC-v4 §2): every dimension × every portrait in one
 * matrix, an unrolled comparison per dimension, and the research behind each
 * number. Editors with the request_research feature can ask for more
 * research right here (quota-gated like every run).
 */
export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ dim?: string }>;
}) {
  const { org } = await params;
  const { dim: selectedSlug } = await searchParams;
  const family = await familyByOrgSlug(org);
  if (!family || family.members.length < 2) notFound();
  const FAMILY = family.members;
  const whole = family.whole;
  const noun = family.noun;
  const base = `/o/${family.organization.slug}/insights`;

  const entries = await Promise.all(
    FAMILY.map(async (m) => [m.slug, await getPortrait(m.slug)] as const),
  );
  const portraits = new Map(
    entries.filter(([, p]) => p !== null) as [string, PublishedPortrait][],
  );

  // Dimension list in display order from the citywide portrait.
  const cityDims = portraits.get(whole ?? FAMILY[0]!.slug)?.dimensions ?? [];
  const dimList = [...cityDims].sort((a, b) => a.display_order - b.display_order);
  const selected = selectedSlug
    ? dimList.find((d) => d.slug === selectedSlug)
    : undefined;

  const dimFor = (slug: string, dimSlug: string): PublishedDimension | undefined =>
    portraits.get(slug)?.dimensions.find((d) => d.slug === dimSlug);

  // Callouts: rank dimensions by member spread of viz_level.
  const spreads = dimList
    .map((d) => {
      const levels = FAMILY.filter((m) => m.slug !== whole)
        .map((m) => ({ m, level: dimFor(m.slug, d.slug)?.viz_level ?? null }))
        .filter((x): x is { m: FamilyMember; level: number } => x.level !== null);
      if (levels.length < 3) return null;
      const worst = levels.reduce((a, b) => (b.level > a.level ? b : a));
      const best = levels.reduce((a, b) => (b.level < a.level ? b : a));
      return { d, worst, best, spread: worst.level - best.level };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.spread - a.spread);

  // Admin affordance: role + per-tenant feature flag.
  const auth = await getAuth();
  const canRequest = new Map<string, boolean>();
  if (auth.devMode || auth.userId) {
    for (const m of FAMILY) {
      const tenant = await tenantBySlug(getDb(), m.slug);
      if (!tenant) continue;
      const tenantId = tenant.id;
      const role = await getRole(tenantId);
      if (role !== 'owner' && role !== 'editor') continue;
      const features = await configValue(tenantId, 'features');
      canRequest.set(m.slug, Boolean(features?.request_research));
    }
  }

  return (
    <>
      <SiteHeader variant="org" family={family} familyView="insights" org={family.organization} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold">
          {noun.charAt(0).toUpperCase() + noun.slice(1)} insights · {family.organization.name}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[color:var(--color-muted)]">
          Every dimension, every {noun}, one matrix — measured against the same thresholds,
          anchored in adopted local goals. Select a dimension for the unrolled comparison and the
          research behind each number.
        </p>

        {spreads.length > 0 && (
          <section className="mt-6 rounded-lg border border-black/10 bg-black/[0.02] p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--color-muted)]">
              Biggest {noun} divides
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              {spreads.slice(0, 4).map(({ d, worst, best }) => (
                <li key={d.slug}>
                  <Link href={`${base}?dim=${d.slug}#dimension`} className="font-medium underline">
                    {d.data.name}
                  </Link>
                  {': '}
                  {worst.m.name} sits {worst.level <= 0 ? 'inside the safe zone' : `${Math.round(worst.level)} beyond the boundary`}
                  {' while '}
                  {best.m.name} is {best.level <= 0 ? 'inside the safe zone' : `${Math.round(best.level)} beyond`}.
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-xl font-semibold">The matrix</h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            Green = inside the safe zone, red = shortfall/overshoot (darker is further out),
            gray = honest data gap. Click a row to unroll it.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/15 text-left">
                  <th className="py-2 pr-3 font-medium">Dimension</th>
                  {FAMILY.map((m) => (
                    <th key={m.slug} className="px-1 py-2 text-center font-medium">
                      <Link href={`/${m.slug}`} className="hover:underline">
                        {m.short}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dimList.map((d) => (
                  <tr
                    key={d.slug}
                    className={`border-b border-black/5 ${
                      selected?.slug === d.slug ? 'bg-black/[0.04]' : ''
                    }`}
                  >
                    <td className="py-1.5 pr-3">
                      <Link href={`${base}?dim=${d.slug}#dimension`} className="hover:underline">
                        <span className="mr-1 text-xs text-[color:var(--color-muted)]">
                          {d.ring === 'social' ? '●' : '○'}
                        </span>
                        {d.data.name}
                      </Link>
                    </td>
                    {FAMILY.map((m) => {
                      const level = dimFor(m.slug, d.slug)?.viz_level ?? null;
                      return (
                        <td key={m.slug} className="px-1 py-1.5">
                          <Link
                            href={`${base}?dim=${d.slug}#dimension`}
                            title={`${m.name}: ${level === null ? 'no data' : Math.round(level)}`}
                            className="block h-6 rounded-sm"
                            style={{ backgroundColor: cellColor(level) }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {selected && (
          <section className="mt-12" id="dimension">
            <h2 className="text-xl font-semibold">
              {selected.data.name} — unrolled
            </h2>
            {selected.data.description ? (
              <p className="mt-1 max-w-3xl text-sm text-[color:var(--color-muted)]">
                {selected.data.description}
              </p>
            ) : null}

            <div className="mt-4 space-y-2">
              {FAMILY.map((m) => {
                const d = dimFor(m.slug, selected.slug);
                const level = d?.viz_level ?? null;
                const geom = level === null ? null : barGeometry(level);
                return (
                  <div key={m.slug} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 text-right font-medium">{m.short}</span>
                    <div className="relative h-5 flex-1 rounded bg-black/[0.04]">
                      <div
                        className="absolute top-0 h-full w-px bg-black/40"
                        style={{ left: '40%' }}
                        title="boundary"
                      />
                      {geom && (
                        <div
                          className="absolute top-0.5 h-4 rounded-sm"
                          style={{
                            left: `${geom.left}%`,
                            width: `${Math.max(geom.width, 0.5)}%`,
                            backgroundColor:
                              (level ?? 0) <= 0 ? 'rgba(46,125,50,0.8)' : 'rgba(198,40,40,0.8)',
                          }}
                        />
                      )}
                      {level === null && (
                        <span className="absolute left-2 top-0 text-xs leading-5 text-[color:var(--color-muted)]">
                          data gap
                        </span>
                      )}
                    </div>
                    <span className="w-12 shrink-0 tabular-nums text-xs text-[color:var(--color-muted)]">
                      {level === null ? '—' : Math.round(level)}
                    </span>
                  </div>
                );
              })}
              <p className="text-xs text-[color:var(--color-muted)]">
                Bars measure distance from the boundary (the vertical line): left/green is inside
                the safe zone, right/red is shortfall or overshoot, on the doughnut&apos;s
                −100…150 scale.
              </p>
            </div>

            <h3 className="mt-8 text-lg font-semibold">The research behind it</h3>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {FAMILY.map((m) => {
                const d = dimFor(m.slug, selected.slug);
                if (!d) return null;
                return (
                  <div key={m.slug} className="rounded-lg border border-black/10 p-4">
                    <div className="flex items-baseline justify-between">
                      <Link href={`/${m.slug}/dim/${d.slug}`} className="font-semibold hover:underline">
                        {m.name}
                      </Link>
                      <span className="text-xs text-[color:var(--color-muted)]">
                        full drilldown →
                      </span>
                    </div>
                    <ul className="mt-2 space-y-3 text-sm">
                      {d.data.indicators.map((ind) => (
                        <li key={ind.name}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span>{ind.name}</span>
                            <span className="whitespace-nowrap font-semibold tabular-nums">
                              {formatIndicatorValue(ind.value, ind.unit)}{' '}
                              <span className="font-normal text-[color:var(--color-muted)]">
                                ({ind.year ?? 'year n/a'})
                              </span>
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                            {safeHref(ind.source_url) ? (
                              <a href={safeHref(ind.source_url)} className="underline" rel="noreferrer" target="_blank">
                                {ind.source}
                              </a>
                            ) : (
                              ind.source
                            )}
                            {' · tier '}
                            {ind.source_tier}
                            {' · confidence '}
                            {ind.confidence}
                            {ind.evidence?.snapshot_path ? (
                              <>
                                {' · '}
                                <a
                                  className="underline"
                                  href={evidenceUrl(m.slug, ind.evidence.snapshot_path)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  evidence
                                </a>
                              </>
                            ) : null}
                          </div>
                          {ind.scoring?.worked_math ? (
                            <details className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                              <summary className="cursor-pointer">worked math</summary>
                              <code className="block whitespace-pre-wrap">{ind.scoring.worked_math}</code>
                            </details>
                          ) : null}
                        </li>
                      ))}
                      {(d.data.gaps ?? []).map((g) => (
                        <li key={g.indicator} className="text-[color:var(--color-muted)]">
                          <span className="font-medium">{g.indicator}</span>: data gap
                          {g.reason.length > 180 ? (
                            <details className="mt-0.5 text-xs">
                              <summary className="cursor-pointer">
                                {g.reason.slice(0, 160)}… (full search trail)
                              </summary>
                              <span className="block whitespace-pre-wrap">{g.reason}</span>
                            </details>
                          ) : (
                            <span> — {g.reason}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {canRequest.get(m.slug) && (
                      <RequestResearchForm
                        tenantSlug={m.slug}
                        tenantName={m.name}
                        dimensionSlug={d.slug}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!selected && (
          <p className="mt-8 text-sm text-[color:var(--color-muted)]">
            Select a dimension above to unroll the {noun} comparison and inspect sources,
            evidence, and scoring — {hasDatabase() ? 'live from published research' : 'demo data'}.
          </p>
        )}
      </main>
    </>
  );
}
