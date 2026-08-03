'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Ring } from '@deep-fryer/core';
import { DoughnutRenderer, type RendererHit } from './doughnut-renderer';

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
}

function statusLabel(level: number | null): string {
  if (level === null || Number.isNaN(level)) return 'Unknown';
  if (level <= -100) return 'No problem';
  if (level <= -50) return 'Under control';
  if (level <= 0) return 'On track';
  if (level <= 50) return 'Needs attention';
  if (level <= 100) return 'Critical';
  return 'Severe';
}

/**
 * React wrapper around the vendored canvas renderer from doughnut-santa-cruz
 * (the canonical visual, SPEC.md §4). Social dimensions draw on the inner
 * ring, ecological on the outer; viz_level uses the -100..150 scale.
 */
export function Doughnut({ social, ecological, size = 640, onSelect }: DoughnutProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
        onSelect?.(resolve(hit));
      },
    });

    // The live SC site's color mode (app.js): the red 'global' gradient for
    // shortfall/overshoot wedges. Part of the canonical visual.
    renderer.setColours(2, 1, '#883251', '#E096C6');

    for (const d of social) {
      renderer.addDimension('inner', d.name, d.viz_level ?? 'NaN');
    }
    for (const d of ecological) {
      renderer.addDimension('outer', d.name, d.viz_level ?? 'NaN');
    }

    return () => {
      renderer.destroy();
    };
  }, [social, ecological, size, byName, onSelect]);

  return (
    <div
      style={{ position: 'relative', width: '100%', maxWidth: size }}
      onMouseLeave={() => setTooltip(null)}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
      {tooltip ? (
        <div
          style={{
            position: 'absolute',
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
                marginLeft: 4,
              }}
            >
              {statusLabel(tooltip.dim.viz_level)}
            </span>
          </div>
          {tooltip.dim.indicator ? (
            <div style={{ fontSize: 12, opacity: 0.9 }}>{tooltip.dim.indicator}</div>
          ) : null}
          <div style={{ fontSize: 14, fontWeight: 'bold', margin: '4px 0' }}>
            {tooltip.dim.value ?? 'Data needed'}
          </div>
          {tooltip.dim.year ? (
            <div style={{ fontSize: 11, opacity: 0.7 }}>Year: {tooltip.dim.year}</div>
          ) : null}
          {tooltip.dim.source ? (
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
              Source: {tooltip.dim.source}
            </div>
          ) : null}
          <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>Click for details</div>
        </div>
      ) : null}
    </div>
  );
}
