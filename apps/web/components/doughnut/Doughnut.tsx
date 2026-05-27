'use client';

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Ring } from '@deep-fryer/core';

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
  margin?: number;
  onSelect?: (dim: (DoughnutDimension & { ring: Ring }) | null) => void;
  onHover?: (dim: DoughnutDimension | null, ring: Ring | null) => void;
  className?: string;
}

const SOCIAL_COLORS = {
  severe: '#883251',
  bad: '#c0566b',
  caution: '#e096c6',
  ok: '#a8d65c',
  good: '#4a8c1c',
  unknown: '#ccc',
} as const;

const ECO_COLORS = {
  severe: '#8b0000',
  bad: '#d63c36',
  caution: '#f0c929',
  ok: '#a8d65c',
  good: '#2d7d2d',
  unknown: '#ccc',
} as const;

function colorFor(level: number | null, ring: Ring): string {
  const colors = ring === 'social' ? SOCIAL_COLORS : ECO_COLORS;
  if (level === null || Number.isNaN(level)) return colors.unknown;
  if (level <= -50) return colors.good;
  if (level <= 0) return colors.ok;
  if (level <= 50) return colors.caution;
  if (level <= 100) return colors.bad;
  return colors.severe;
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

export function Doughnut({
  social,
  ecological,
  size = 640,
  margin = 40,
  onSelect,
  onHover,
  className,
}: DoughnutProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const svg = d3
      .select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${size} ${size}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('width', '100%')
      .style('max-width', `${size}px`)
      .style('height', 'auto');

    const center = size / 2;
    const r = center - margin;
    const radii = {
      innerHole: r * 0.18,
      socialInner: r * 0.18,
      socialOuter: r * 0.52,
      doughnutInner: r * 0.52,
      doughnutOuter: r * 0.65,
      ecoInner: r * 0.65,
      ecoOuter: r * 0.95,
      labelSocial: r * 0.36,
      labelEco: r * 0.81,
    };

    const g = svg.append('g').attr('transform', `translate(${center},${center})`);
    const layerBg = g.append('g');
    const layerEco = g.append('g');
    const layerDoughnut = g.append('g');
    const layerSocial = g.append('g');
    const layerLabels = g.append('g');
    const layerCenter = g.append('g');

    [radii.socialInner, radii.socialOuter, radii.ecoInner, radii.ecoOuter].forEach((rr) => {
      layerBg
        .append('circle')
        .attr('r', rr)
        .attr('fill', 'none')
        .attr('stroke', '#e0e0e0')
        .attr('stroke-width', 0.5)
        .attr('stroke-dasharray', '4,4');
    });

    const doughnutArc = d3
      .arc<unknown, unknown>()
      .innerRadius(radii.doughnutInner)
      .outerRadius(radii.doughnutOuter)
      .startAngle(0)
      .endAngle(Math.PI * 2);

    layerDoughnut
      .append('path')
      .attr('d', doughnutArc({}) ?? '')
      .attr('fill', '#8cd755')
      .attr('stroke', '#477020')
      .attr('stroke-width', 2)
      .attr('opacity', 0.7);

    [radii.doughnutInner, radii.doughnutOuter].forEach((rr) => {
      layerDoughnut
        .append('circle')
        .attr('r', rr)
        .attr('fill', 'none')
        .attr('stroke', '#477020')
        .attr('stroke-width', 2);
    });

    const tooltip = d3
      .select(container)
      .append('div')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('opacity', '0')
      .style('background', 'rgba(0,0,0,0.85)')
      .style('color', 'white')
      .style('padding', '10px 14px')
      .style('border-radius', '8px')
      .style('font-size', '13px')
      .style('line-height', '1.4')
      .style('max-width', '280px')
      .style('z-index', '100')
      .style('box-shadow', '0 4px 12px rgba(0,0,0,0.3)')
      .style('transition', 'opacity 0.15s');
    tooltipRef.current = tooltip.node() as HTMLDivElement;

    function showTooltip(event: MouseEvent, dim: DoughnutDimension, ring: Ring) {
      const level = dim.viz_level;
      const status = statusLabel(level);
      const color = colorFor(level, ring);
      let html = `<div style="margin-bottom:4px"><strong>${dim.name}</strong>`;
      html += ` <span style="background:${color};padding:2px 6px;border-radius:10px;font-size:11px;color:white;margin-left:4px">${status}</span></div>`;
      if (dim.indicator) html += `<div style="font-size:12px;opacity:0.9">${dim.indicator}</div>`;
      html += `<div style="font-size:14px;font-weight:bold;margin:4px 0">${dim.value ?? 'Data needed'}</div>`;
      if (dim.year) html += `<div style="font-size:11px;opacity:0.7">Year: ${dim.year}</div>`;
      if (dim.source) html += `<div style="font-size:11px;opacity:0.7;margin-top:2px">Source: ${dim.source}</div>`;
      html += `<div style="font-size:10px;opacity:0.5;margin-top:4px">Click for details</div>`;
      tooltip.html(html).style('opacity', '1');
      moveTooltip(event);
    }

    function moveTooltip(event: MouseEvent) {
      const rect = container!.getBoundingClientRect();
      let x = event.clientX - rect.left + 15;
      let y = event.clientY - rect.top - 10;
      const tw = 280;
      if (x + tw > rect.width) x = event.clientX - rect.left - tw - 10;
      if (y < 0) y = 10;
      tooltip.style('left', `${x}px`).style('top', `${y}px`);
    }

    function hideTooltip() {
      tooltip.style('opacity', '0');
    }

    function drawSegments(
      layer: d3.Selection<SVGGElement, unknown, null, undefined>,
      dims: DoughnutDimension[],
      ring: Ring,
      innerR: number,
      outerR: number,
    ) {
      if (!dims.length) return;
      const arcAngle = (Math.PI * 2) / dims.length;
      const padAngle = 0.02;

      dims.forEach((dim, i) => {
        const startAngle = i * arcAngle - Math.PI / 2;
        const endAngle = startAngle + arcAngle;
        const level = dim.viz_level;
        const color = colorFor(level, ring);

        let segInner: number;
        let segOuter: number;
        if (level === null || Number.isNaN(level)) {
          segInner = innerR;
          segOuter = outerR;
        } else if (ring === 'social') {
          if (level >= 0) {
            const fraction = Math.min(1, level / 150);
            segInner = outerR - (outerR - innerR) * fraction;
            segOuter = outerR;
          } else {
            segInner = outerR - (outerR - innerR) * 0.15;
            segOuter = outerR;
          }
        } else {
          if (level >= 0) {
            const fraction = Math.min(1, level / 150);
            segInner = innerR;
            segOuter = innerR + (outerR - innerR) * fraction;
          } else {
            segInner = innerR;
            segOuter = innerR + (outerR - innerR) * 0.15;
          }
        }

        const arc = d3
          .arc<unknown, unknown>()
          .innerRadius(segInner)
          .outerRadius(segOuter)
          .startAngle(startAngle + padAngle)
          .endAngle(endAngle - padAngle)
          .cornerRadius(2);

        const hitArc = d3
          .arc<unknown, unknown>()
          .innerRadius(innerR)
          .outerRadius(outerR)
          .startAngle(startAngle + padAngle)
          .endAngle(endAngle - padAngle);

        const segG = layer.append('g').style('cursor', 'pointer');

        segG
          .append('path')
          .attr('d', hitArc({}) ?? '')
          .attr('fill', 'transparent');

        const key = `${ring}:${dim.slug}`;
        const isSelected = key === selectedKey;

        const path = segG
          .append('path')
          .attr('d', arc({}) ?? '')
          .attr('fill', color)
          .attr('stroke', isSelected ? '#0066cc' : 'white')
          .attr('stroke-width', isSelected ? 3 : 1)
          .attr('opacity', isSelected ? 1 : 0.85)
          .style('transition', 'opacity 0.15s, stroke-width 0.15s');

        segG
          .on('mouseenter', (event: MouseEvent) => {
            path.attr('opacity', 1).attr('stroke-width', 2).attr('stroke', isSelected ? '#0066cc' : '#333');
            showTooltip(event, dim, ring);
            onHover?.(dim, ring);
          })
          .on('mousemove', (event: MouseEvent) => moveTooltip(event))
          .on('mouseleave', () => {
            path
              .attr('opacity', isSelected ? 1 : 0.85)
              .attr('stroke-width', isSelected ? 3 : 1)
              .attr('stroke', isSelected ? '#0066cc' : 'white');
            hideTooltip();
            onHover?.(null, null);
          })
          .on('click', () => {
            setSelectedKey((prev) => {
              const next = prev === key ? null : key;
              onSelect?.(next ? { ...dim, ring } : null);
              return next;
            });
          });
      });
    }

    function drawLabels(dims: DoughnutDimension[], radius: number, color: string) {
      if (!dims.length) return;
      const arcAngle = (Math.PI * 2) / dims.length;

      dims.forEach((dim, i) => {
        const angle = i * arcAngle - Math.PI / 2 + arcAngle / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;

        const words = dim.name.split(' ');
        const lines = words.length <= 2
          ? [dim.name]
          : [
              words.slice(0, Math.ceil(words.length / 2)).join(' '),
              words.slice(Math.ceil(words.length / 2)).join(' '),
            ];

        const text = layerLabels
          .append('text')
          .attr('x', x)
          .attr('y', y)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', color)
          .attr('font-size', '11px')
          .attr('font-weight', '600')
          .style('text-shadow', `1px 1px 2px ${color === 'white' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)'}`)
          .style('pointer-events', 'none');

        lines.forEach((line, li) => {
          text
            .append('tspan')
            .attr('x', x)
            .attr('dy', li === 0 ? `-${(lines.length - 1) * 6}px` : '14px')
            .text(line);
        });
      });
    }

    drawSegments(layerEco, ecological, 'ecological', radii.ecoInner, radii.ecoOuter);
    drawSegments(layerSocial, social, 'social', radii.socialInner, radii.socialOuter);
    drawLabels(social, radii.labelSocial, 'white');
    drawLabels(ecological, radii.labelEco, '#333');

    layerCenter
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#2d5016')
      .attr('font-size', '16px')
      .attr('font-weight', '700')
      .attr('y', -10)
      .text('Doughnut');

    layerCenter
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#2d5016')
      .attr('font-size', '16px')
      .attr('font-weight', '700')
      .attr('y', 12)
      .text('Economics');

    return () => {
      container.innerHTML = '';
    };
  }, [social, ecological, size, margin, selectedKey, onSelect, onHover]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', width: '100%', maxWidth: size }}
    />
  );
}
