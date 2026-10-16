'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Ring } from '@deep-fryer/core';
import { DoughnutRenderer, type RendererHit } from './doughnut-renderer';
import { fmt } from '@/lib/i18n/format';
import type { DoughnutLabels } from '@/lib/i18n/doughnut';

export interface DoughnutDimension {
  ring: Ring;
  slug: string;
  name: string;
  viz_level: number | null;
  indicator?: string;
  value?: string;
  year?: number;
  source?: string;
}

export interface DoughnutProps {
  social: DoughnutDimension[];
  ecological: DoughnutDimension[];
  size?: number;
  onSelect?: (dim: DoughnutDimension | null) => void;
  /** Text alternative for the canvas (WCAG 1.1.1); the parent builds the summary. */
  ariaLabel?: string;
  /** The reader's language (lib/i18n/doughnut.ts). */
  labels: DoughnutLabels;
  /**
   * Controlled selection (the portrait's core view, SPEC-v7 §2): the slug of
   * the dimension to mark on the canvas, or null for none. When given, the
   * canvas shows exactly this selection — see SELECTED_COLOUR. Left out
   * (embeds, the family comparison), a click navigates away and the
   * renderer's own click outline is all there is.
   */
  selectedSlug?: string | null;
}

/**
 * The selected dimension's mark: the renderer's highlight (a level's colour),
 * which fills the wedge and draws the label on a pill of this colour, so the
 * mark shows even on a wedge with no size (a dimension inside the safe
 * space). The Santa Cruz view's selection blue (#0066cc); white label text on
 * it is 5.6:1. The status is always written out in the panel beside it.
 */
export const SELECTED_COLOUR = '#0066cc';

/** The doughnut's own status words for a viz_level (-100…150 scale). */
export function statusLabel(level: number | null, words: DoughnutLabels['level']): string {
  if (level === null || Number.isNaN(level)) return words.unknown;
  if (level <= -100) return words.noProblem;
  if (level <= -50) return words.underControl;
  if (level <= 0) return words.onTrack;
  if (level <= 50) return words.needsAttention;
  if (level <= 100) return words.critical;
  return words.severe;
}

/**
 * React wrapper around the vendored canvas renderer from doughnut-santa-cruz
 * (the canonical visual, SPEC.md §4). Social dimensions draw on the inner
 * ring, ecological on the outer; viz_level uses the -100..150 scale.
 */
export function Doughnut({ social, ecological, size = 640, onSelect, ariaLabel, labels, selectedSlug }: DoughnutProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlled = selectedSlug !== undefined;
  // Bumped on every canvas click while controlled, to rebuild the renderer.
  // The renderer keeps a click selection of its own (a blue outline that a
  // second click toggles off) and has no API to set or clear it; a fresh
  // renderer has none, so after any click the canvas shows the parent's
  // selection and nothing else — including a click on the wedge already
  // selected, which the parent keeps.
  const [epoch, setEpoch] = useState(0);
  const [tooltip, setTooltip] = useState<{
    dim: DoughnutDimension;
    x: number;
    y: number;
  } | null>(null);

  const byName = useMemo(() => {
    const m = new Map<string, DoughnutDimension>();
    for (const d of [...social, ...ecological]) m.set(`${d.ring}:${d.name}`, d);
    return m;
  }, [social, ecological]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resolve = (hit: RendererHit | null): DoughnutDimension | null => {
      if (!hit) return null;
      const ring: Ring = hit.dim_type === 'inner' ? 'social' : 'ecological';
      return byName.get(`${ring}:${hit.dim_info.name}`) ?? null;
    };

    const renderer = new DoughnutRenderer({
      canvas,
      size,
      donutScale: 1.0,
      textSize: Math.round((size / 640) * 13),
      onHover: (hit, event) => {
        const dim = resolve(hit);
        if (dim) {
          const rect = canvas.getBoundingClientRect();
          setTooltip({
            dim,
            x: event.clientX - rect.left + 14,
            y: event.clientY - rect.top - 8,
          });
        } else {
          setTooltip(null);
        }
      },
      onSelect: (hit) => {
        if (controlled) {
          setEpoch((n) => n + 1);
          // The panel now shows what the tooltip said; on a phone a tap
          // leaves the tooltip up (there is no mouseleave), over the canvas.
          setTooltip(null);
        }
        onSelect?.(resolve(hit));
      },
    });

    // The live SC site's color mode (app.js): the red 'global' gradient for
    // shortfall/overshoot wedges. Part of the canonical visual.
    renderer.setColours(2, 1, '#883251', '#E096C6');

    // Every level in one redraw (addDimension redraws per call), inner ring
    // then outer in display order, as before; the selected one highlighted.
    renderer.setLevels([
      ...social.map((d) => ({
        type: 'inner' as const,
        name: d.name,
        level: d.viz_level ?? 'NaN',
        colour: d.slug === selectedSlug ? SELECTED_COLOUR : null,
      })),
      ...ecological.map((d) => ({
        type: 'outer' as const,
        name: d.name,
        level: d.viz_level ?? 'NaN',
        colour: d.slug === selectedSlug ? SELECTED_COLOUR : null,
      })),
    ]);

    return () => {
      renderer.destroy();
    };
  }, [social, ecological, size, byName, onSelect, controlled, selectedSlug, epoch]);

  return (
    <div
      style={{ position: 'relative', width: '100%', maxWidth: size }}
      onMouseLeave={() => setTooltip(null)}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel ?? labels.chartLabel}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
      {tooltip ? (
        <div
          style={{
            position: 'absolute',
            // Pointer coordinates are physical; the tooltip stays left-anchored in RTL too.
            left: tooltip.x,
            top: tooltip.y,
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.85)',
            color: 'white',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.4,
            maxWidth: 280,
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          <div style={{ marginBottom: 4 }}>
            <strong>{tooltip.dim.name}</strong>{' '}
            <span
              style={{
                background: '#555',
                padding: '2px 6px',
                borderRadius: 10,
                fontSize: 11,
                marginInlineStart: 4,
              }}
            >
              {statusLabel(tooltip.dim.viz_level, labels.level)}
            </span>
          </div>
          {tooltip.dim.indicator ? (
            <div style={{ fontSize: 12, opacity: 0.9 }}>{tooltip.dim.indicator}</div>
          ) : null}
          <div style={{ fontSize: 14, fontWeight: 'bold', margin: '4px 0' }}>
            {tooltip.dim.value ?? labels.dataNeeded}
          </div>
          {tooltip.dim.year ? (
            <div style={{ fontSize: 11, opacity: 0.7 }}>{fmt(labels.year, { year: tooltip.dim.year })}</div>
          ) : null}
          {tooltip.dim.source ? (
            <div lang="en" style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
              {fmt(labels.source, { source: tooltip.dim.source })}
            </div>
          ) : null}
          <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>Click for details</div>
        </div>
      ) : null}
    </div>
  );
}
