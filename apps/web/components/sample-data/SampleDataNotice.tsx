import { fmt } from '@/lib/i18n/format';
import type { Messages } from '@/lib/i18n/messages';

/**
 * "Sample data — not research": the notice on every public view of a
 * portrait seeded with synthetic values (core SAMPLE_DATA_CONFIG_KEY, set by
 * scripts/seed-demo-data.ts; read by lib/sample-data.ts). Placed under the
 * page's heading, before any number, in the amber of the site's other
 * notices, so neither a reader nor a screenshot can take the figures for a
 * city's measurements.
 *
 * `org` switches to the organization pages' wording (compare, insights,
 * progress: "some or all of the figures"), where one seeded portrait among
 * several labels the page. role="note": it is advice about the content
 * around it, read in place, not an alert that interrupts.
 */
export function SampleDataNotice({
  labels,
  name,
  org = false,
  compact = false,
  className = '',
}: {
  labels: Messages['sampleData'];
  /** The portrait's name, or the organization's when `org`. */
  name: string;
  org?: boolean;
  /** The embed's one-line form: it sits above the doughnut inside a city's page. */
  compact?: boolean;
  className?: string;
}) {
  const body = org ? fmt(labels.bodyOrg, { org: name }) : fmt(labels.body, { name });
  return (
    <div
      role="note"
      className={`rounded border border-amber-300 bg-amber-50 text-amber-900 ${compact ? 'px-2 py-1 text-xs' : 'p-3 text-sm'} ${className}`}
    >
      <strong className="font-semibold">{labels.title}</strong>
      {compact ? ' — ' : <br />}
      {body}
    </div>
  );
}
