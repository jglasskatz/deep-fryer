'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Ring } from '@deep-fryer/core';
import { DoughnutRenderer, type RendererHit } from './doughnut-renderer';

/**
 * The flashing doughnut (SPEC-v5 §2–3): one portrait drawn in two states —
 * "now" and an alternate state (with a policy; with a hazard's threatened
 * dimensions marked) — alternating slowly so the affected wedges flash.
 *
 * - Impacted wedges take a highlight colour in the alternate state, so a
 *   direction-only impact flashes even when its size cannot change; a
 *   quantified projection also changes the wedge's size.
 * - The cycle is 2.4 s (one change every 1.2 s) — far under the three flashes
 *   a second of WCAG 2.3.1 — and it pauses on demand (2.2.2). Readers who
 *   prefer reduced motion get the alternate state, static (2.3.3).
 * - The canvas is pointer-only; callers render the impacts as a table, which
 *   is the accessible equivalent, and pass a text summary for the canvas.
 *   Selecting a wedge moves to that dimension's row (`#{anchorPrefix}{slug}`).
 */

export type ImpactHighlight = 'improves' | 'worsens' | 'mixed' | 'risk_low' | 'risk_moderate' | 'risk_high';

export const HIGHLIGHT_COLOURS: Record<ImpactHighlight, string> = {
  improves: '#2e7d32',
  worsens: '#c62828',
  mixed: '#f9a825',
  risk_low: '#f9a825',
  risk_moderate: '#ef6c00',
  risk_high: '#c62828',
};

export interface ImpactDimension {
  slug: string;
  ring: Ring;
  name: string;
  /** viz_level today; null draws the gray "no data" wedge. */
  current: number | null;
  /** viz_level in the alternate state; null keeps the current size. */
  alternate: number | null;
  highlight: ImpactHighlight | null;
}

export interface ImpactDoughnutLabels {
  /** Name of the first state ("Now"). */
  now: string;
  /** Name of the alternate state ("With this policy", "Threatened by heat"). */
  alternate: string;
  /**
   * The motion button's text while stopped and while moving ("Play
   * animation" / "Pause animation"). The button reports its state by this
   * text alone — it is not a toggle with aria-pressed, because a toggle
   * whose label also changes reads as "Pause, pressed" while it is playing.
   */
  play: string;
  pause: string;
  /** Group label for the controls ("Doughnut view"). */
  controls: string;
  /**
   * Optional visible caption naming the state on screen, with `{state}`
   * replaced by `now` or `alternate` ("Showing: {state}"). Without it,
   * which frame is showing while the chart flashes is told only by the
   * colours. It is not a live region: while playing it changes every
   * 1.2 s, and the controls' own live region already announces the state
   * a reader chooses.
   */
  showing?: string;
}

const CYCLE_MS = 1200;

function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ImpactDoughnut({
  dimensions,
  labels,
  ariaLabel,
  size = 560,
  anchorPrefix = 'impact-',
}: {
  dimensions: ImpactDimension[];
  labels: ImpactDoughnutLabels;
  ariaLabel: string;
  size?: number;
  anchorPrefix?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<DoughnutRenderer | null>(null);
  const prefersReduced = useSyncExternalStore(subscribeReducedMotion, reducedMotion, () => false);
  const [playing, setPlaying] = useState<boolean | null>(null);
  const [state, setState] = useState<'now' | 'alternate'>('alternate');
  const isPlaying = playing ?? !prefersReduced;

  const ordered = useMemo(
    () => ({
      social: dimensions.filter((d) => d.ring === 'social'),
      ecological: dimensions.filter((d) => d.ring === 'ecological'),
    }),
    [dimensions],
  );
  const byName = useMemo(() => new Map(dimensions.map((d) => [`${d.ring}:${d.name}`, d])), [dimensions]);

  const draw = useCallback(
    (which: 'now' | 'alternate') => {
      const r = rendererRef.current;
      if (!r) return;
      r.setLevels(
        dimensions.map((d) => {
          const alt = which === 'alternate';
          const level = alt && d.alternate !== null ? d.alternate : d.current;
          return {
            type: d.ring === 'social' ? ('inner' as const) : ('outer' as const),
            name: d.name,
            level: level ?? 'NaN',
            colour: alt && d.highlight ? HIGHLIGHT_COLOURS[d.highlight] : null,
          };
        }),
      );
    },
    [dimensions],
  );

  // One renderer per dimension set; frames only update levels.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new DoughnutRenderer({
      canvas,
      size,
      donutScale: 1.0,
      textSize: Math.round((size / 640) * 13),
      onSelect: (hit: RendererHit | null) => {
        if (!hit) return;
        const ring: Ring = hit.dim_type === 'inner' ? 'social' : 'ecological';
        const dim = byName.get(`${ring}:${hit.dim_info.name}`);
        if (dim) window.location.hash = `${anchorPrefix}${dim.slug}`;
      },
    });
    renderer.setColours(2, 1, '#883251', '#E096C6');
    for (const d of ordered.social) renderer.addDimension('inner', d.name, d.current ?? 'NaN');
    for (const d of ordered.ecological) renderer.addDimension('outer', d.name, d.current ?? 'NaN');
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [ordered, size, byName, anchorPrefix]);

  // The flash: alternate states on a slow cycle while playing.
  useEffect(() => {
    draw(state);
  }, [draw, state]);
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => setState((s) => (s === 'now' ? 'alternate' : 'now')), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [isPlaying]);

  const button = (pressed: boolean) =>
    `rounded px-2.5 py-1 text-xs ${pressed ? 'bg-black text-white' : 'border border-black/20 hover:bg-black/5'}`;

  return (
    <div className="w-full" style={{ maxWidth: size }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
      <div role="group" aria-label={labels.controls} className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <button type="button" className={button(false)} onClick={() => setPlaying(!isPlaying)}>
          {isPlaying ? labels.pause : labels.play}
        </button>
        <span aria-hidden className="mx-1 text-black/20">
          |
        </span>
        {(['now', 'alternate'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={button(!isPlaying && state === s)}
            aria-pressed={!isPlaying && state === s}
            onClick={() => {
              setPlaying(false);
              setState(s);
            }}
          >
            {s === 'now' ? labels.now : labels.alternate}
          </button>
        ))}
      </div>
      {labels.showing ? (
        <p className="mt-2 text-center text-xs text-[color:var(--color-muted)]">
          {labels.showing.replace('{state}', state === 'now' ? labels.now : labels.alternate)}
        </p>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {isPlaying ? '' : state === 'now' ? labels.now : labels.alternate}
      </p>
    </div>
  );
}
