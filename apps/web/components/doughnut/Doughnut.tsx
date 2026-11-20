'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
  /**
   * Shortcut keys (the portrait's front page only): the canvas joins the tab
   * order and acts on the keys of doughnutShortcut while it has focus.
   * Left out, the canvas is a picture outside the tab order, as before.
   */
  shortcuts?: DoughnutShortcuts;
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
 * The canvas backing store's density: the screen's device pixel ratio,
 * capped at 3 (a 720 px doughnut is then at most 2160 px square, well within
 * mobile canvas limits) and never below 1.
 */
export function doughnutPixelRatio(devicePixelRatio: number | undefined): number {
  if (!devicePixelRatio || !Number.isFinite(devicePixelRatio)) return 1;
  return Math.min(3, Math.max(1, devicePixelRatio));
}

/** Whether a keydown should hide the hover tooltip: an Escape no other widget used. */
export function dismissesTooltip(event: { key: string; defaultPrevented: boolean; isComposing?: boolean }): boolean {
  return event.key === 'Escape' && !event.defaultPrevented && !event.isComposing;
}

/** What a shortcut key on the focused doughnut asks for. */
export type DoughnutShortcut = { kind: 'theme' } | { kind: 'portrait'; index: number };

/** The most portraits number keys reach: 1 to 9. */
export const MAX_PORTRAIT_KEYS = 9;

/** The slice of a keydown that doughnutShortcut reads (a structural type, so tests can pass a plain object). */
export interface ShortcutKeyEvent {
  key: string;
  /** The physical key ("KeyD", "Digit2"), read when the layout types something else there. */
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented: boolean;
  /** Where the key was pressed, and the element listening: they must be the same. */
  target: unknown;
  currentTarget: unknown;
}

/**
 * The single-character shortcuts of the Santa Cruz site: "d" switches light
 * and dark, a number opens that portrait of the family. They act only on a
 * key pressed while the doughnut itself has focus (WCAG 2.1.4), so typing a
 * "d" or a "2" anywhere else on the page, in a search box or a comment,
 * does nothing. A key held down acts once (no flashing between themes), and
 * a key with Ctrl, Alt or Cmd is left to the browser. Shift is allowed, so
 * Caps Lock does not turn the theme key off.
 *
 * The keys are named by what they type on a Latin layout ("Press D"). A
 * reader whose layout types another script there (Cyrillic, Arabic,
 * Hangul) or other digits (Arabic-Indic, Bengali), or puts symbols on the
 * number row (French), presses the same physical keys, so the physical key
 * decides whenever the typed character is not a Latin letter or digit. A
 * Latin letter is always taken as typed: on a Dvorak layout the key that
 * types "d" is the theme key, not the one where D sits on QWERTY.
 */
export function doughnutShortcut(event: ShortcutKeyEvent, portraitCount: number): DoughnutShortcut | null {
  if (event.target !== event.currentTarget || isTextEntry(event.target)) return null;
  if (event.defaultPrevented || event.isComposing || event.repeat) return null;
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const typed = [...event.key].length === 1 ? event.key : null;
  if (!typed) return null; // Named keys (Enter, Tab, arrows) and dead keys.
  const latin = /^[A-Za-z0-9]$/.test(typed);
  const physical = latin ? undefined : event.code;
  if (typed === 'd' || typed === 'D' || physical === 'KeyD') return { kind: 'theme' };
  const digit = /^[1-9]$/.test(typed) ? typed : /^Digit([1-9])$/.exec(physical ?? '')?.[1];
  if (digit) {
    const index = Number(digit) - 1;
    return index < Math.min(portraitCount, MAX_PORTRAIT_KEYS) ? { kind: 'portrait', index } : null;
  }
  return null;
}

/** A field that takes typed text: a key pressed there is always the reader's typing. */
function isTextEntry(target: unknown): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el !== 'object') return false;
  if (el.isContentEditable === true) return true;
  return typeof el.tagName === 'string' && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName.toUpperCase());
}

/**
 * The `aria-keyshortcuts` value for the doughnut's keys: "D", then each
 * portrait's number up to the ninth, leaving out the current portrait's
 * (its key does nothing).
 */
export function doughnutKeyShortcuts(portraitCount: number, currentIndex?: number): string {
  const numbers = Array.from({ length: Math.min(portraitCount, MAX_PORTRAIT_KEYS) }, (_, i) => i)
    .filter((i) => i !== currentIndex)
    .map((i) => String(i + 1));
  return ['D', ...numbers].join(' ');
}

/** What the page gives the doughnut to turn its shortcut keys on. */
export interface DoughnutShortcuts {
  /** How many portraits the number keys reach (0 when the portrait stands alone). */
  portraitCount: number;
  /** The current portrait's place among them, whose own key does nothing. */
  currentIndex?: number;
  /** The keys in words, read as the doughnut's description. */
  description: string;
  /** Acts on a shortcut; returns what to announce, if anything. */
  onShortcut: (shortcut: DoughnutShortcut) => string | void;
}

/** How long a shortcut's announcement stays in the live region (as the theme toggle's). */
const ANNOUNCEMENT_MS = 5000;

/**
 * React wrapper around the vendored canvas renderer from doughnut-santa-cruz
 * (the canonical visual, SPEC.md §4). Social dimensions draw on the inner
 * ring, ecological on the outer; viz_level uses the -100..150 scale.
 */
export function Doughnut({
  social,
  ecological,
  size = 640,
  onSelect,
  ariaLabel,
  labels,
  selectedSlug,
  shortcuts,
}: DoughnutProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shortcutsId = useId();
  /** What the last shortcut did ("Theme: Dark"), politely announced, then cleared. */
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(''), ANNOUNCEMENT_MS);
    return () => clearTimeout(timer);
  }, [announcement]);

  // A React handler on the canvas itself, never a document listener: a key
  // reaches it only while the canvas has focus (doughnutShortcut also checks).
  const onKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (!shortcuts) return;
    const shortcut = doughnutShortcut(event, shortcuts.portraitCount);
    if (!shortcut) return;
    event.preventDefault();
    const said = shortcuts.onShortcut(shortcut);
    if (said) setAnnouncement(said);
  };
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
      // A backing store at the screen's density, so the canvas-drawn labels
      // are not a 720 px bitmap stretched over a phone's 1000+ device pixels.
      pixelRatio: doughnutPixelRatio(window.devicePixelRatio),
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

  // Escape hides the hover tooltip without moving the pointer (WCAG 1.4.13:
  // it covers part of the chart). It stays hidden until the pointer reaches
  // another wedge: the renderer reports hover only when the wedge under it
  // changes. preventDefault marks the Escape as spent, so DeepFryLayer does
  // not also un-fry the page with it.
  const tooltipShown = tooltip !== null;
  useEffect(() => {
    if (!tooltipShown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (dismissesTooltip(event)) {
        event.preventDefault();
        setTooltip(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [tooltipShown]);

  return (
    <div
      style={{ position: 'relative', width: '100%', maxWidth: size }}
      onMouseLeave={() => setTooltip(null)}
    >
      {/* width/height give the server-rendered canvas its square shape before the
          renderer runs (it then sets the backing store, at the same 1:1 ratio). Without
          them the canvas lays out at the default 300×150 until hydration, and the panel
          and list below it jump by half its width. */}
      {/* With shortcuts the canvas is focusable (a click focuses it too), names
          its keys for assistive technology, and shows the browser's own focus
          ring. */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel ?? labels.chartLabel}
        tabIndex={shortcuts ? 0 : undefined}
        aria-keyshortcuts={shortcuts ? doughnutKeyShortcuts(shortcuts.portraitCount, shortcuts.currentIndex) : undefined}
        aria-describedby={shortcuts ? shortcutsId : undefined}
        onKeyDown={shortcuts ? onKeyDown : undefined}
        width={size}
        height={size}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
      {shortcuts ? (
        <>
          <span id={shortcutsId} hidden>
            {shortcuts.description}
          </span>
          <span role="status" className="sr-only">
            {announcement}
          </span>
        </>
      ) : null}
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
          <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>{labels.clickForDetails}</div>
        </div>
      ) : null}
    </div>
  );
}
