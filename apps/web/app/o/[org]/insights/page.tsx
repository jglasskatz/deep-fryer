import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatIndicatorValue } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { RequestResearchForm } from '@/components/insights/RequestResearchForm';
import { getPortrait, evidenceUrl } from '@/lib/data';
import { tenantBySlug } from '@deep-fryer/db';
import { userDb } from '@/lib/db';
import { getAuth, getRole } from '@/lib/auth';
import { configValue } from '@/lib/admin-data';
import { familyByOrgSlug, type FamilyMember } from '@/lib/family';
import { safeHref } from '@/lib/safe-url';
import type { PublishedPortrait, PublishedDimension } from '@/lib/portrait';
import { dimensionLabel, nounForms } from '@/lib/i18n/content';
import { fmt, rich } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string }>;
}): Promise<Metadata> {
  const [family, { m }] = await Promise.all([familyByOrgSlug((await params).org), getI18n()]);
  return { title: family ? fmt(m.insights.metaTitle, { org: family.organization.name }) : m.nav.insights };
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
  const [family, { m, href }] = await Promise.all([familyByOrgSlug(org), getI18n()]);
  if (!family || family.members.length < 2) notFound();
  const FAMILY = family.members;
  const whole = family.whole;
  const { singular: noun, plural: nouns } = nounForms(m, family.noun);
  const base = href(`/o/${family.organization.slug}/insights`);
  const dimName = (d: PublishedDimension) => dimensionLabel(m, d.slug, d.data.name);
  const state = (level: number) =>
    level <= 0 ? m.insights.insideSafeZone : fmt(m.insights.beyondBoundary, { n: Math.round(level) });

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
      const tenant = await userDb((db) => tenantBySlug(db, m.slug));
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
          {fmt(m.insights.title, { noun, org: family.organization.name })}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[color:var(--color-muted)]">{fmt(m.insights.intro, { noun })}</p>

        {spreads.length > 0 && (
          <section className="mt-6 rounded-lg border border-black/10 bg-black/[0.02] p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--color-muted)]">
              {m.insights.biggestDivides}
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              {spreads.slice(0, 4).map(({ d, worst, best }) => (
                <li key={d.slug}>
                  <Link href={`${base}?dim=${d.slug}#dimension`} className="font-medium underline">
                    {dimName(d)}
                  </Link>
                  {': '}
                  {fmt(m.insights.divide, {
                    worst: worst.m.name,
                    worstState: state(worst.level),
                    best: best.m.name,
                    bestState: state(best.level),
                  })}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-xl font-semibold">{m.insights.matrix}</h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">{m.insights.matrixIntro}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/15">
                  <th className="py-2 pe-3 text-start font-medium">{m.insights.dimension}</th>
                  {FAMILY.map((member) => (
                    <th key={member.slug} className="px-1 py-2 text-center font-medium">
                      <Link href={href(`/${member.slug}`)} className="hover:underline">
                        {member.short}
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
                    <td className="py-1.5 pe-3">
                      <Link href={`${base}?dim=${d.slug}#dimension`} className="hover:underline">
                        <span
                          className="me-1 text-xs text-[color:var(--color-muted)]"
                          title={d.ring === 'social' ? m.common.socialFoundation : m.common.ecologicalCeiling}
                        >
                          {d.ring === 'social' ? '●' : '○'}
                        </span>
                        {dimName(d)}
                      </Link>
                    </td>
                    {FAMILY.map((member) => {
                      const level = dimFor(member.slug, d.slug)?.viz_level ?? null;
                      const cellLabel = `${member.name}: ${level === null ? m.insights.noData : Math.round(level)}`;
                      return (
                        <td key={member.slug} className="px-1 py-1.5">
                          <Link
                            href={`${base}?dim=${d.slug}#dimension`}
                            title={cellLabel}
                            aria-label={`${dimName(d)} — ${cellLabel}`}
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
            <h2 className="text-xl font-semibold">{fmt(m.insights.unrolled, { name: dimName(selected) })}</h2>
            {selected.data.description ? (
              <p lang="en" className="mt-1 max-w-3xl text-sm text-[color:var(--color-muted)]">
                {selected.data.description}
              </p>
            ) : null}

            {/* A chart: its axis runs left to right in every language. */}
            <div dir="ltr" className="mt-4 space-y-2">
              {FAMILY.map((member) => {
                const d = dimFor(member.slug, selected.slug);
                const level = d?.viz_level ?? null;
                const geom = level === null ? null : barGeometry(level);
                return (
                  <div key={member.slug} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 text-right font-medium">{member.short}</span>
                    <div className="relative h-5 flex-1 rounded bg-black/[0.04]">
                      <div
                        className="absolute top-0 h-full w-px bg-black/40"
                        style={{ left: '40%' }}
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
                        <span
                          dir="auto"
                          className="absolute left-2 top-0 text-xs leading-5 text-[color:var(--color-muted)]"
                        >
                          {m.insights.dataGap}
                        </span>
                      )}
                    </div>
                    <span className="w-12 shrink-0 tabular-nums text-xs text-[color:var(--color-muted)]">
                      {level === null ? '—' : Math.round(level)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-[color:var(--color-muted)]">{m.insights.barsExplainer}</p>

            <h3 className="mt-8 text-lg font-semibold">{m.insights.researchBehind}</h3>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {FAMILY.map((member) => {
                const d = dimFor(member.slug, selected.slug);
                if (!d) return null;
                return (
                  <div key={member.slug} className="rounded-lg border border-black/10 p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={href(`/${member.slug}/dim/${d.slug}`)} className="font-semibold hover:underline">
                        {member.name}
                      </Link>
                      <Link
                        href={href(`/${member.slug}/dim/${d.slug}`)}
                        className="text-xs text-[color:var(--color-muted)] hover:underline"
                      >
                        {m.insights.fullDrilldown}
                      </Link>
                    </div>
                    <ul className="mt-2 space-y-3 text-sm">
                      {d.data.indicators.map((ind) => (
                        <li key={ind.name}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span lang="en">{ind.name}</span>
                            <span className="whitespace-nowrap font-semibold tabular-nums">
                              <bdi>{formatIndicatorValue(ind.value, ind.unit)}</bdi>{' '}
                              <span className="font-normal text-[color:var(--color-muted)]">
                                ({ind.year ?? m.insights.yearNA})
                              </span>
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                            {safeHref(ind.source_url) ? (
                              <a lang="en" href={safeHref(ind.source_url)} className="underline" rel="noreferrer" target="_blank">
                                {ind.source}
                              </a>
                            ) : (
                              <span lang="en">{ind.source}</span>
                            )}
                            {ind.source_tier !== undefined ? ` · ${fmt(m.insights.tier, { n: ind.source_tier })}` : ''}
                            {ind.confidence
                              ? ` · ${fmt(m.insights.confidence, { value: m.insights.confidenceLevels[ind.confidence] })}`
                              : ''}
                            {ind.evidence?.snapshot_path ? (
                              <>
                                {' · '}
                                <a
                                  className="underline"
                                  href={evidenceUrl(member.slug, ind.evidence.snapshot_path)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {m.insights.evidence}
                                </a>
                              </>
                            ) : null}
                          </div>
                          {ind.scoring?.worked_math ? (
                            <details className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                              <summary className="cursor-pointer">{m.insights.workedMath}</summary>
                              <code dir="ltr" className="block whitespace-pre-wrap">
                                {ind.scoring.worked_math}
                              </code>
                            </details>
                          ) : null}
                        </li>
                      ))}
                      {(d.data.gaps ?? []).map((g) => (
                        <li key={g.indicator} className="text-[color:var(--color-muted)]">
                          {rich(m.insights.gapLabel, {
                            indicator: (
                              <span lang="en" className="font-medium">
                                {g.indicator}
                              </span>
                            ),
                          })}
                          {g.reason.length > 180 ? (
                            <details className="mt-0.5 text-xs">
                              <summary className="cursor-pointer">
                                <span lang="en">{g.reason.slice(0, 160)}…</span> {m.insights.fullSearchTrail}
                              </summary>
                              <span lang="en" className="block whitespace-pre-wrap">
                                {g.reason}
                              </span>
                            </details>
                          ) : (
                            <span lang="en"> — {g.reason}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {canRequest.get(member.slug) && (
                      <RequestResearchForm
                        tenantSlug={member.slug}
                        tenantName={member.name}
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
          <p className="mt-8 text-sm text-[color:var(--color-muted)]">{fmt(m.insights.selectPrompt, { nouns })}</p>
        )}
      </main>
    </>
  );
}
