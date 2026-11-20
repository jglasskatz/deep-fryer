import { fmtPlural, type PluralForms } from '@/lib/i18n/format';
import { STATUS_DOT, STATUS_GROUPS, statusCounts, type StatusGroup } from './status';

/** The chips' words, from the page's catalog (`portrait.chips`). */
export interface SummaryChipLabels {
  /** The list's accessible name. */
  label: string;
  thriving: PluralForms;
  attention: PluralForms;
  critical: PluralForms;
  unknown: PluralForms;
}

/**
 * The line of chips above the doughnut ("9 thriving, 6 need attention"),
 * after the Santa Cruz site's summary strip: one chip per reading, counted
 * from the same dimensions the canvas draws, so the counts are the wedges'.
 * The three readings with data are always shown (a "0 critical" chip is
 * news too); the no-data chip only when some dimension has none.
 *
 * Each chip's dot is the status dot of the list below (status.ts), so a
 * colour means the same thing everywhere on the page; the count and the
 * word carry the meaning, the dot is decoration (WCAG 1.4.1).
 */
export function SummaryChips({
  dims,
  labels,
  locale,
  className,
}: {
  dims: readonly { viz_level: number | null }[];
  labels: SummaryChipLabels;
  /** The reader's language, for its plural rules. */
  locale: string;
  className?: string;
}) {
  const counts = statusCounts(dims);
  const shown = STATUS_GROUPS.filter((group: StatusGroup) => group !== 'unknown' || counts.unknown > 0);
  return (
    <ul aria-label={labels.label} className={`flex flex-wrap justify-center gap-2 text-sm ${className ?? ''}`}>
      {shown.map((group) => (
        <li
          key={group}
          data-status={group}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/15 px-3 py-1"
        >
          <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[group]}`} />
          <span>{fmtPlural(locale, labels[group], counts[group])}</span>
        </li>
      ))}
    </ul>
  );
}
