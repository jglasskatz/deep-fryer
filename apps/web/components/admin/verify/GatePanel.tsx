import type { GateReport, GateViolation } from '@deep-fryer/research';

const STAGES: { key: GateViolation['stage']; label: string; blurb: string }[] = [
  { key: 'deterministic', label: 'Deterministic', blurb: 'coverage · evidence archived · citations resolve' },
  { key: 'verifier', label: 'Verifier', blurb: 'unsupported/uncertain rates · tier mix' },
  { key: 'review', label: 'Human review', blurb: 'every flag dispositioned · sample spot-checked' },
  { key: 'confirmation', label: 'Confirmation', blurb: 'approval bound to content hash' },
];

function pct(x: number): string {
  return `${(x * 100).toFixed(x >= 0.1 ? 0 : 1)}%`;
}

function Tile({
  label,
  value,
  bar,
  bad,
}: {
  label: string;
  value: string;
  bar?: string;
  bad?: boolean;
}) {
  return (
    <div className={`rounded border p-2 ${bad ? 'border-red-300 bg-red-50' : 'border-black/15'}`}>
      <p className="text-[11px] text-[color:var(--color-muted)]">{label}</p>
      <p className={`text-lg font-semibold ${bad ? 'text-red-900' : ''}`}>{value}</p>
      {bar ? <p className="text-[11px] text-[color:var(--color-muted)]">{bar}</p> : null}
    </div>
  );
}

/**
 * The run's gate report, stage by stage — the same computeGateReport() the
 * research-verify CLI prints, so the numbers here always match the terminal.
 */
export function GatePanel({ report }: { report: GateReport }) {
  const r = report.rollups;
  return (
    <section className="rounded-lg border border-black/15 p-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Findings"
          value={String(r.total)}
          bar={`${r.indicators} indicators · ${r.gaps} gaps`}
        />
        <Tile
          label="Verifier verdicts"
          value={`${r.supported} pass`}
          bar={`${r.unsupported} fail · ${r.uncertain} uncertain`}
          bad={r.unsupported > 0}
        />
        <Tile
          label="Unsupported rate"
          value={pct(r.failRate)}
          bar="bar: 5% blocks the run"
          bad={r.failRate > 0.05}
        />
        <Tile
          label="Uncertain rate"
          value={pct(r.uncertainRate)}
          bar="bar: 25% warns"
          bad={r.uncertainRate > 0.25}
        />
        <Tile
          label="Tier 1–2 share"
          value={pct(r.tier12Share)}
          bar="bar: below 50% warns"
          bad={r.tier12Share < 0.5}
        />
        <Tile
          label="Evidence coverage"
          value={
            r.indicators > 0 ? pct((r.indicators - r.evidenceMissing) / r.indicators) : '—'
          }
          bar={r.evidenceMissing > 0 ? `${r.evidenceMissing} missing snapshots` : 'every claim archived'}
          bad={r.evidenceMissing > 0}
        />
        <Tile
          label="Schema failures"
          value={String(r.schemaFailed)}
          bar="finding.schema.json conformance"
          bad={r.schemaFailed > 0}
        />
        <Tile
          label="Flagged"
          value={String(r.flagged)}
          bar="need individual dispositions"
          bad={r.flagged > 0}
        />
      </div>

      <div className="mt-4 space-y-2">
        {STAGES.map((stage) => {
          const rows = report.violations.filter((v) => v.stage === stage.key);
          const criticals = rows.filter((v) => v.severity === 'critical');
          const icon = criticals.length > 0 ? '✗' : rows.length > 0 ? '⚠' : '✓';
          const tone =
            criticals.length > 0
              ? 'text-red-800'
              : rows.length > 0
                ? 'text-amber-700'
                : 'text-green-800';
          return (
            <div key={stage.key} className="rounded border border-black/10 p-2 text-sm">
              <p className={`font-medium ${tone}`}>
                {icon} {stage.label}
                <span className="ml-2 text-xs font-normal text-[color:var(--color-muted)]">
                  {stage.blurb}
                </span>
              </p>
              {rows.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {rows.map((v, i) => (
                    <li key={i} className={v.severity === 'critical' ? 'text-red-800' : 'text-amber-700'}>
                      {v.severity === 'critical' ? '✗' : '⚠'}{' '}
                      {v.findingId ? (
                        <a className="underline" href={`#finding-${v.findingId}`}>
                          {v.message}
                        </a>
                      ) : (
                        v.message
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
