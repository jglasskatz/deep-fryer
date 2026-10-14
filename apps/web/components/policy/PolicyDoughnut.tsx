'use client';

import {
  HIGHLIGHT_COLOURS,
  ImpactDoughnut,
  type ImpactDimension,
  type ImpactDoughnutLabels,
} from '@/components/doughnut/ImpactDoughnut';
import type { ImpactDirection } from '@deep-fryer/core';

// Staff pages are English (SPEC-v4 §7: the admin plane is not translated).
// The motion button names its action ("Pause animation") and nothing else
// reports its state; `showing` puts the frame on screen into words.
const LABELS: ImpactDoughnutLabels = {
  now: 'Today',
  alternate: 'With this policy',
  play: 'Play animation',
  pause: 'Pause animation',
  controls: 'Doughnut view',
  showing: 'Showing: {state}',
};

type Shown = Exclude<ImpactDirection, 'none'>;

const DIRECTION_TEXT: Record<Shown, { label: string; detail: string }> = {
  improves: { label: 'Improves', detail: 'moves toward the safe and just space' },
  worsens: { label: 'Worsens', detail: 'moves away from it' },
  mixed: { label: 'Mixed', detail: 'its impacts point both ways' },
};

/**
 * The analysis doughnut, its caption, and its colour key. A client
 * component because the highlight colours live in ImpactDoughnut's (client)
 * module, and a server component cannot read a client module's values.
 *
 * Direction is never carried by colour alone: the key names every colour in
 * words, and the caption (`summary`, lib/policy.ts impactsSummary) says in
 * words which wedges improve, worsen, or are mixed — right under the chart,
 * for sighted readers who cannot tell the green from the red as much as for
 * screen readers. The figure takes its accessible name from that caption;
 * the canvas inside keeps a short name of its own (`ariaLabel`).
 */
export function PolicyDoughnut({
  dimensions,
  ariaLabel,
  summary,
}: {
  dimensions: ImpactDimension[];
  ariaLabel: string;
  summary: string;
}) {
  return (
    <figure className="flex flex-col items-center gap-4">
      <ImpactDoughnut dimensions={dimensions} labels={LABELS} ariaLabel={ariaLabel} size={520} />
      <figcaption className="w-full max-w-xl text-center text-sm">{summary}</figcaption>
      <div className="w-full max-w-xl text-sm">
        <h3 className="sr-only">Colour key</h3>
        <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1">
          {(Object.keys(DIRECTION_TEXT) as Shown[]).map((d) => (
            <li key={d} className="flex items-center gap-1.5">
              <Swatch direction={d} />
              <span>
                <strong className="font-semibold">{DIRECTION_TEXT[d].label}</strong> — {DIRECTION_TEXT[d].detail}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-center text-xs text-[color:var(--color-muted)]">
          In “With this policy”, every impacted dimension’s name (and its wedge, where it has one)
          takes its direction’s colour. A wedge changes size only where the analysis quantified one
          of its published indicators; the rest are direction only. Gray wedges have no published
          data.
        </p>
      </div>
    </figure>
  );
}

/** A small colour sample that matches the doughnut's highlight; decorative next to its text. */
export function Swatch({ direction }: { direction: Shown }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 shrink-0 rounded-sm"
      style={{ background: HIGHLIGHT_COLOURS[direction] }}
    />
  );
}

/** Direction as text, with the matching swatch; "none" reads as no expected effect. */
export function DirectionLabel({ direction }: { direction: ImpactDirection }) {
  if (direction === 'none') return <span>No expected effect</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Swatch direction={direction} />
      {DIRECTION_TEXT[direction].label}
    </span>
  );
}
