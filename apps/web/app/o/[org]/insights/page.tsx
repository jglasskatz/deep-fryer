import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatIndicatorValue } from '@deep-fryer/core';
import { DENOMINATORS } from '@deep-fryer/research';
import { insightContributions } from '@/lib/insights-contributions';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { SampleDataNotice } from '@/components/sample-data/SampleDataNotice';
import { LinkedInsights } from '@/components/insights/LinkedInsights';
import { comparisonScores, insightGeometry, insightMode, insightValue, INSIGHT_MODES } from '@/lib/insights-modes';
import { RequestResearchForm } from '@/components/insights/RequestResearchForm';
import { getPortrait, evidenceUrl } from '@/lib/data';
import { tenantBySlug } from '@deep-fryer/db';
import { userDb } from '@/lib/db';
import { getAuth, getRole } from '@/lib/auth';
import { portraitFeaturesById, requireOrganizationFeature } from '@/lib/features';
import { familyByOrgSlug, type FamilyMember } from '@/lib/family';
import { anySampleData } from '@/lib/sample-data';
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

/**
 * viz_level (-100 safe … 0 boundary … 150 far outside) → cell color: a green
 * or red whose strength is the distance from the boundary, which reads on
 * both themes' backgrounds. A cell with no data is not coloured here but
 * given NO_DATA_CELL, a neutral class that dark mode remaps (an inline black
 * tint would vanish into the dark page).
 */
const NO_DATA_CELL = 'bg-black/[0.06]';
function cellColor(level: number): string {
  if (level <= 0) {
    const t = Math.min(1, -level / 100);
    return `rgba(46,125,50,${0.15 + 0.5 * t})`;
  }
  const t = Math.min(1, level / 150);
  return `rgba(198,40,40,${0.15 + 0.65 * t})`;
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
  searchParams: Promise<{ dim?: string; mode?: string }>;
}) {
  const { org } = await params;
  const { dim: selectedSlug, mode: requestedMode } = await searchParams;
  const mode = insightMode(requestedMode);
  const [family, { m, href }] = await Promise.all([familyByOrgSlug(org), getI18n()]);
  if (!family || family.members.length < 2) notFound();
  // Compare and Insights are a feature (SPEC-v7 §3), on when any of the family's portraits has it.
  await requireOrganizationFeature(family.organization.id, 'family_compare');
  const FAMILY = family.members;
  const whole = family.whole;
  const { singular: noun, plural: nouns } = nounForms(m, family.noun);
  const base = href(`/o/${family.organization.slug}/insights`);
  const dimName = (d: PublishedDimension) => dimensionLabel(m, d.slug, d.data.name);
  const state = (level: number) =>
    level <= 0 ? m.insights.insideSafeZone : fmt(m.insights.beyondBoundary, { n: Math.round(level) });

  const [entries, sample] = await Promise.all([
    Promise.all(FAMILY.map(async (m) => [m.slug, await getPortrait(m.slug)] as const)),
    anySampleData(FAMILY.map((m) => m.slug)),
  ]);
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

  const scoresFor = (dimension: string) => comparisonScores(mode, FAMILY.map(member => ({ slug: member.slug, level: dimFor(member.slug, dimension)?.viz_level ?? null })), whole);
  const dimensionLink = (slug: string) => `${base}?dim=${encodeURIComponent(slug)}&mode=${mode}#dimension`;
  const modeLabels = { absolute: 'Published score', 'vs-city': 'Versus whole jurisdiction', 'vs-target': 'Versus target', rank: 'Member rank' };
  const modeNote = mode === 'vs-city'
    ? 'Difference in normalized score points from the published whole-jurisdiction score. Negative is lower pressure, positive is higher pressure. A missing reference stays unknown.'
    : mode === 'rank'
      ? 'Rank 1 has the lowest published pressure score. Equal scores share a rank; missing scores and the whole jurisdiction are excluded. Rank does not mean the target is met.'
      : mode === 'vs-target'
        ? 'Distance in normalized score points from the target, which is zero. These values equal the published scores because that scale is already centered on the target.'
        : 'Published dimension scores on the doughnut’s −100…150 scale. Zero is the target; lower is less pressure. These are normalized scores, not raw indicator values.';

  const contributions = selected ? insightContributions(FAMILY, portraits, whole, selected.slug, Object.keys(DENOMINATORS).filter(key => DENOMINATORS[key] === 'sum')) : [];

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
      canRequest.set(m.slug, (await portraitFeaturesById(tenantId)).request_research);
    }
  }

  return (
    <>
      <SiteHeader variant="org" family={family} familyView="insights" org={family.organization} />
      <LinkedInsights><main id="main" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold">
          {fmt(m.insights.title, { noun, org: family.organization.name })}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[color:var(--color-muted)]">{fmt(m.insights.intro, { noun })}</p>
        {/* One seeded portrait (scripts/seed-demo-data.ts) among the family labels the whole page. */}
        {sample ? (
          <SampleDataNotice labels={m.sampleData} name={family.organization.name} org className="mt-4 max-w-3xl" />
        ) : null}

        {spreads.length > 0 && (
          // No tint behind this card: the muted heading is 4.6:1 on the page but
          // falls to 4.4:1 on even a 2 % black wash (WCAG 1.4.3 asks 4.5:1).
          <section className="mt-6 rounded-lg border border-black/10 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--color-muted)]">
              {m.insights.biggestDivides}
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              {spreads.slice(0, 4).map(({ d, worst, best }) => (
                <li key={d.slug}>
                  <Link href={dimensionLink(d.slug)} className="font-medium underline">
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

        <section lang="en" dir="ltr" className="mt-8 rounded-lg border border-black/10 p-4" aria-labelledby="comparison-mode">
          <h2 id="comparison-mode" className="text-base font-semibold">Comparison baseline</h2>
          <nav aria-label="Comparison baseline" className="mt-3 flex flex-wrap gap-2">
            {INSIGHT_MODES.map(value => <Link key={value} href={`${base}?mode=${value}${selected ? `&dim=${encodeURIComponent(selected.slug)}` : ''}`} aria-current={mode === value ? 'page' : undefined} className={`min-h-11 rounded border px-3 py-2 text-sm ${mode === value ? 'border-[color:var(--color-accent)] bg-black/5 font-semibold' : 'border-black/15 hover:bg-black/5'}`}>{modeLabels[value]}</Link>)}
          </nav>
          <p className="mt-3 text-sm text-[color:var(--color-muted)]">{modeNote}</p>
          <p className="mt-2 text-xs text-[color:var(--color-muted)]">Portraits may use different source years or indicator definitions. Check the evidence before treating a score difference as a difference in residents’ outcomes.</p>
        </section>
        <section className="mt-8">
          <h2 className="text-xl font-semibold">{m.insights.matrix}</h2>
          <p lang={mode === 'rank' || mode === 'vs-city' ? 'en' : undefined} dir={mode === 'rank' || mode === 'vs-city' ? 'ltr' : undefined} className="mt-1 text-sm text-[color:var(--color-muted)]">{mode === 'rank' ? 'Blue cells show member ranks; grey means no comparable rank.' : mode === 'vs-city' ? 'Green is below the whole-jurisdiction score; red is above it. Grey means a score or reference is unavailable.' : m.insights.matrixIntro}</p>
          {/* What the row markers mean, for everyone: a title tooltip alone is out of reach of
              keyboard and touch. Screen readers get the ring in each row's link instead. */}
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            <span aria-hidden>●</span> {m.common.socialFoundation}
            <span className="mx-2">·</span>
            <span aria-hidden>○</span> {m.common.ecologicalCeiling}
          </p>
          <div tabIndex={0} role="region" aria-label={m.insights.matrix} className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/15">
                  <th className="py-2 pe-3 text-start font-medium">{m.insights.dimension}</th>
                  {FAMILY.map((member) => (
                    <th key={member.slug} data-insight-member={member.slug} className="px-1 py-2 text-center font-medium">
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
                    data-insight-dimension={d.slug}
                    className={`border-b border-black/5 ${
                      selected?.slug === d.slug ? 'bg-black/[0.04]' : ''
                    }`}
                  >
                    <td className="py-1.5 pe-3">
                      <Link href={dimensionLink(d.slug)} className="flex min-h-11 items-center hover:underline">
                        {/* The glyph is decoration; the ring is said in text, so the link reads
                            "Social foundation: Food" rather than "black circle Food". */}
                        <span
                          aria-hidden
                          className="me-1 text-xs text-[color:var(--color-muted)]"
                          title={d.ring === 'social' ? m.common.socialFoundation : m.common.ecologicalCeiling}
                        >
                          {d.ring === 'social' ? '●' : '○'}
                        </span>
                        <span className="sr-only">
                          {d.ring === 'social' ? m.common.socialFoundation : m.common.ecologicalCeiling}:{' '}
                        </span>
                        {dimName(d)}
                      </Link>
                    </td>
                    {FAMILY.map((member) => {
                      const level = scoresFor(d.slug).get(member.slug) ?? null;
                      const cellLabel = `${member.name}: ${mode === 'rank' && member.slug === whole ? 'whole-jurisdiction context; not ranked' : level === null ? m.insights.noData : insightValue(level, mode)}`;
                      return (
                        <td key={member.slug} data-insight-member={member.slug} className="px-1 py-1.5">
                          <Link
                            href={dimensionLink(d.slug)}
                            title={cellLabel}
                            aria-label={`${dimName(d)} — ${cellLabel}`}
                            className={`flex min-h-11 items-center justify-center rounded-sm text-xs font-medium tabular-nums ${level === null ? NO_DATA_CELL : ''}`}
                            style={level === null ? undefined : { backgroundColor: mode === 'rank' ? 'rgba(50,110,170,.2)' : cellColor(level) }}
                          >{level === null ? '—' : insightValue(level, mode)}</Link>
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
                const level = scoresFor(selected.slug).get(member.slug) ?? null;
                const geom = level === null ? null : insightGeometry(level, mode, FAMILY.length - (whole ? 1 : 0));
                return (
                  <div key={member.slug} data-insight-dimension={selected.slug} data-insight-member={member.slug} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 text-right font-medium">{member.short}</span>
                    <div className="relative h-5 flex-1 rounded bg-black/[0.04]">
                      <div
                        className="absolute top-0 h-full w-px bg-black/40"
                        style={{ left: `${insightGeometry(0, mode, FAMILY.length - (whole ? 1 : 0)).zeroX}%` }}
                      />
                      {geom && (
                        <div
                          className="absolute top-0.5 h-4 rounded-sm"
                          style={{
                            left: `${geom.left}%`,
                            width: `${Math.max(geom.width, 0.5)}%`,
                            backgroundColor:
                              mode === 'rank' ? 'rgba(50,110,170,.8)' : (level ?? 0) <= 0 ? 'rgba(46,125,50,0.8)' : 'rgba(198,40,40,0.8)',
                          }}
                        />
                      )}
                      {level === null && (
                        <span
                          dir="auto"
                          className="absolute left-2 top-0 text-xs leading-5 text-[color:var(--color-muted)]"
                        >
                          {mode === 'rank' && member.slug === whole ? <span lang="en">Context</span> : m.insights.dataGap}
                        </span>
                      )}
                    </div>
                    <span className="w-12 shrink-0 tabular-nums text-xs text-[color:var(--color-muted)]">
                      {level === null ? '—' : insightValue(level, mode)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p lang="en" dir="ltr" className="mt-2 text-xs text-[color:var(--color-muted)]">{modeNote}</p>

            {contributions.length > 0 ? <section lang="en" dir="ltr" className="mt-8" aria-labelledby="contributions-heading">
              <h3 id="contributions-heading" className="text-lg font-semibold">Member contributions</h3>
              <p className="mt-1 text-sm text-[color:var(--color-muted)]">Additive counts are summed, not averaged. The whole-jurisdiction figure is published independently. Only matching data years, units and scoring references are combined; source definitions still need review.</p>
              {contributions.map(row => <div key={row.reference} data-insight-dimension={selected.slug} className="mt-4 rounded-lg border border-black/10 p-4">
                <h4 className="font-semibold">{row.name}</h4>
                <p className="mt-1 text-sm">{row.year ?? 'Year unknown'} · Published whole: {formatIndicatorValue(row.cityValue, row.unit)}</p>
                {row.total === null ? <p className="mt-2 text-sm text-[color:var(--color-muted)]">{row.unavailable}</p> : <>
                  <p className="mt-2 text-sm font-medium">Sum of members: {formatIndicatorValue(row.total, row.unit)}</p>
                  <div aria-hidden="true" className="mt-3 flex h-7 overflow-hidden rounded bg-black/5">{row.parts.map((part, index) => <div key={part.slug} data-insight-member={part.slug} title={`${part.name}: ${formatIndicatorValue(part.value, row.unit)}`} style={{ width: `${row.total! > 0 ? 100 * part.value / row.total! : 0}%`, backgroundColor: ['#2563a0', '#8a4277', '#327052', '#9b6524', '#5b5e9d', '#317a83'][index % 6] }} />)}</div>
                  <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">{row.parts.map(part => <li key={part.slug} data-insight-member={part.slug}><span className="font-medium">{part.name}</span>: {formatIndicatorValue(part.value, row.unit)}</li>)}</ul>
                </>}
              </div>)}
            </section> : null}

            <h3 className="mt-8 text-lg font-semibold">{m.insights.researchBehind}</h3>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {FAMILY.map((member) => {
                const d = dimFor(member.slug, selected.slug);
                if (!d) return null;
                return (
                  <div key={member.slug} data-insight-dimension={selected.slug} data-insight-member={member.slug} className="rounded-lg border border-black/10 p-4">
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
                            <span className="text-end font-semibold tabular-nums">
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
      </main></LinkedInsights>
    </>
  );
}
