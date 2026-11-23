'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { DoughnutRenderer } from '@/components/doughnut/doughnut-renderer.js';
import { doughnutPixelRatio } from '@/components/doughnut/Doughnut';
import {
  clampSliderProgress,
  interpolatePolicyLevels,
  POLICY_SLIDER_CASES,
  type PolicySliderItem,
} from './policy-slider-data';

const CANVAS_SIZE = 560;

export interface PolicyImpactSliderProps {
  /** Optional initial policy id (defaults to Santa Cruz drought water rationing). */
  initialPolicyId?: PolicySliderItem['id'];
  /** Optional initial slider position 0..100 (defaults to 0 = baseline). */
  initialProgress?: number;
}

function progressStateLabel(progress: number): string {
  if (progress === 0) return 'Before (baseline portrait)';
  if (progress === 100) return 'With policy (illustrative)';
  return `Comparing (${progress}% toward observed shift)`;
}

function directionBadge(direction: 'improves' | 'mixed'): { label: string; className: string } {
  if (direction === 'improves') {
    return {
      label: 'Directional improvement',
      className: 'border-green-200 bg-green-50 text-green-900',
    };
  }
  return {
    label: 'Mixed / tradeoff',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
  };
}

/**
 * Interactive Before ↔ After policy explorer for the landing page.
 * Uses the canonical canvas DoughnutRenderer directly and pairs real Santa Cruz
 * and New York City portrait baselines with source-checked retrospective policy
 * studies, explicit caveats, and primary citations.
 */
export function PolicyImpactSlider({
  initialPolicyId = 'sc-water-rationing',
  initialProgress = 0,
}: PolicyImpactSliderProps) {
  const initialIndex = Math.max(
    0,
    POLICY_SLIDER_CASES.findIndex((item) => item.id === initialPolicyId),
  );
  const [selectedId, setSelectedId] = useState<PolicySliderItem['id']>(
    POLICY_SLIDER_CASES[initialIndex]!.id,
  );
  const [progress, setProgress] = useState<number>(() => clampSliderProgress(initialProgress));

  const headingId = useId();
  const sliderId = useId();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<DoughnutRenderer | null>(null);

  const policy = useMemo(
    () => POLICY_SLIDER_CASES.find((item) => item.id === selectedId) ?? POLICY_SLIDER_CASES[0]!,
    [selectedId],
  );

  const levels = useMemo(() => interpolatePolicyLevels(policy, progress), [policy, progress]);

  const impactedNames = useMemo(() => {
    const bySlug = new Map(policy.baseline.map((d) => [d.slug, d.name]));
    return policy.impacts.map((impact) => ({
      ...impact,
      name: bySlug.get(impact.slug) ?? impact.slug,
    }));
  }, [policy]);

  // Create one DoughnutRenderer per policy baseline; slider drags only call setLevels.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new DoughnutRenderer({
      canvas,
      size: CANVAS_SIZE,
      pixelRatio: doughnutPixelRatio(window.devicePixelRatio),
      donutScale: 1.0,
      textSize: Math.round((CANVAS_SIZE / 640) * 13),
    });
    renderer.setColours(2, 1, '#883251', '#E096C6');
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [policy.id]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setLevels(
      levels.map((entry) => ({
        type: entry.type,
        name: entry.name,
        level: entry.level,
        colour: entry.colour,
      })),
    );
  }, [levels]);

  const statusText = progressStateLabel(progress);
  const valueText =
    progress === 0
      ? `Before policy: ${policy.sliderReadout.before}`
      : progress === 100
        ? `With policy: ${policy.sliderReadout.after}`
        : `${progress}% between baseline and observed shift`;

  return (
    <section
      aria-labelledby={headingId}
      className="border-t border-black/10"
    >
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted)]">
            Policy evidence explorer
          </p>
          <h2 id={headingId} className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Compare before and after real local policies
          </h2>
          <p className="mt-2 text-sm text-[color:var(--color-muted)]">
            Slide between a city&apos;s real baseline doughnut and source-checked retrospective policy
            outcomes from Santa Cruz and New York City — with research design, scope limits, and
            primary citations alongside the chart.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Researched city policies"
          className="mt-6 flex flex-wrap gap-2"
        >
          {POLICY_SLIDER_CASES.map((item) => {
            const active = item.id === policy.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedId(item.id)}
                className={`min-h-11 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[color:var(--color-accent)] text-white'
                    : 'border border-black/15 bg-white hover:bg-black/5'
                }`}
              >
                {item.shortLabel}
              </button>
            );
          })}
        </div>

        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-black/10 bg-white p-4 sm:p-5">
            <div className="mx-auto w-full" style={{ maxWidth: CANVAS_SIZE }}>
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={`${policy.place} doughnut showing ${policy.title} (${statusText}). Highlighted dimensions: ${impactedNames.map((i) => i.name).join(', ')}.`}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                className="block h-auto w-full"
              />
            </div>

            <div className="mt-4 border-t border-black/10 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={sliderId} className="text-sm font-medium">
                  Before ↔ With policy
                </label>
                <span className="text-xs font-medium text-[color:var(--color-muted)]" aria-live="polite">
                  {statusText}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  aria-pressed={progress === 0}
                  onClick={() => setProgress(0)}
                  className={`min-h-11 shrink-0 rounded px-3 py-2 text-xs font-medium ${
                    progress === 0
                      ? 'bg-black text-white'
                      : 'border border-black/20 hover:bg-black/5'
                  }`}
                >
                  Before
                </button>
                <input
                  id={sliderId}
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={progress}
                  aria-valuetext={valueText}
                  onChange={(event) => setProgress(clampSliderProgress(Number(event.target.value)))}
                  className="h-2 w-full cursor-pointer accent-[color:var(--color-accent)]"
                />
                <button
                  type="button"
                  aria-pressed={progress === 100}
                  onClick={() => setProgress(100)}
                  className={`min-h-11 shrink-0 rounded px-3 py-2 text-xs font-medium ${
                    progress === 100
                      ? 'bg-[color:var(--color-accent)] text-white'
                      : 'border border-black/20 hover:bg-black/5'
                  }`}
                >
                  With policy
                </button>
              </div>

              <p className="mt-3 text-xs text-[color:var(--color-muted)]">
                <span className="font-medium text-[color:var(--color-fg)]">Active view:</span>{' '}
                {progress < 50 ? policy.sliderReadout.before : policy.sliderReadout.after}
              </p>

              <p className="mt-2 text-xs text-[color:var(--color-muted)]">
                Wedge movement illustrates direction and study scale — none of these studies directly
                establishes a Doughnut threshold crossing.
              </p>
            </div>
          </div>

          <div
            role="tabpanel"
            aria-label={`${policy.title} evidence details`}
            className="rounded-xl border border-black/10 bg-white p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-black/15 px-2.5 py-0.5 font-medium">
                {policy.place}
              </span>
              <span className="rounded-full border border-black/15 px-2.5 py-0.5 text-[color:var(--color-muted)]">
                {policy.year}
              </span>
              <span className="rounded-full bg-[color:var(--color-accent)]/12 px-2.5 py-0.5 font-medium text-[color:var(--color-accent)]">
                {policy.evidenceGrade}
              </span>
            </div>

            <h3 className="mt-3 text-xl font-semibold tracking-tight">{policy.title}</h3>
            <p className="mt-1 text-xs text-[color:var(--color-muted)]">
              {policy.jurisdiction} · {policy.evidenceKind}
            </p>
            <p className="mt-3 text-sm text-[color:var(--color-muted)]">{policy.mechanism}</p>

            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              <div
                className={`rounded-lg border p-3 ${
                  progress === 0
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-black/10 bg-black/[0.02]'
                }`}
              >
                <dt className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-muted)]">
                  Baseline (Before)
                </dt>
                <dd className="mt-1 text-sm">{policy.baselineMetric}</dd>
              </div>

              <div
                className={`rounded-lg border p-3 ${
                  progress > 0
                    ? 'border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/5'
                    : 'border-black/10 bg-black/[0.02]'
                }`}
              >
                <dt className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-muted)]">
                  Observed shift (With policy)
                </dt>
                <dd className="mt-1 text-sm font-medium">{policy.observedShift}</dd>
              </div>
            </dl>

            <div className="mt-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-muted)]">
                Highlighted doughnut dimensions
              </h4>
              <ul className="mt-2 space-y-2">
                {impactedNames.map((impact) => {
                  const badge = directionBadge(impact.direction);
                  return (
                    <li
                      key={impact.slug}
                      className="rounded-lg border border-black/10 px-3 py-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-[color:var(--color-fg)]">
                          {impact.name}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1 text-[color:var(--color-muted)]">{impact.note}</p>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="mt-5 rounded-lg border-l-4 border-amber-500 bg-amber-50/70 p-3 text-xs text-[color:var(--color-fg)]">
              <p className="font-semibold">Scope &amp; caveat</p>
              <p className="mt-1 text-[color:var(--color-muted)]">{policy.caveat}</p>
            </div>

            <p className="mt-4 text-xs text-[color:var(--color-muted)]">
              <span className="font-semibold text-[color:var(--color-fg)]">Primary source: </span>
              <a
                href={policy.source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-[color:var(--color-accent)]"
              >
                {policy.source.title} ↗
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
