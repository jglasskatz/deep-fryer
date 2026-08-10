'use client';

import { useMemo, useState } from 'react';
import { reviewReasons } from '@deep-fryer/contract';
import type { CurrentDisposition, DispositionState, ReviewAnnotation } from '@deep-fryer/core';
import type { Finding, ReviewNote } from '@deep-fryer/db';
import { addReviewNote, dispositionFinding } from '@/lib/verify-actions';
import { useAction } from '@/lib/use-action';

/** Serializable projection of lib/verify-data's VerifyFinding for the client. */
export interface TriageFinding {
  finding: Finding;
  dimensionSlug: string;
  dimensionName: string;
  flagged: boolean;
  inSample: boolean;
  disposition: CurrentDisposition | null;
  notes: ReviewNote[];
}

export interface TriageDimensionContext {
  slug: string;
  name: string;
  prompt: string | null;
  maxAgeYears: number;
  acceptedScales: string[];
}

type Filter =
  | 'all'
  | 'open'
  | 'flagged'
  | 'unsupported'
  | 'uncertain'
  | 'tier4'
  | 'gaps'
  | 'sample';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'open', label: 'open flags' },
  { key: 'flagged', label: 'flagged' },
  { key: 'unsupported', label: 'unsupported' },
  { key: 'uncertain', label: 'uncertain' },
  { key: 'tier4', label: 'tier ≥ 4' },
  { key: 'gaps', label: 'gaps' },
  { key: 'sample', label: 'spot-check' },
];

function matches(f: TriageFinding, filter: Filter): boolean {
  const v = f.finding.verification;
  switch (filter) {
    case 'all':
      return true;
    case 'open':
      return f.flagged && !f.disposition;
    case 'flagged':
      return f.flagged;
    case 'unsupported':
      return v?.content_supported === 'fail';
    case 'uncertain':
      return v?.content_supported === 'uncertain';
    case 'tier4':
      return f.finding.payload.kind === 'indicator' && f.finding.payload.source_tier >= 4;
    case 'gaps':
      return f.finding.payload.kind === 'gap';
    case 'sample':
      return f.inSample;
  }
}

function Chip({ ok, label, title }: { ok: boolean; label: string; title?: string }) {
  return (
    <span
      title={title}
      className={`rounded px-1.5 py-0.5 text-[11px] ${
        ok ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'
      }`}
    >
      {label}
    </span>
  );
}

function DispositionChip({ d }: { d: CurrentDisposition | null }) {
  if (!d) return <span className="rounded bg-black/10 px-1.5 py-0.5 text-[11px]">open</span>;
  const tone =
    d.state === 'verified'
      ? 'bg-green-100 text-green-900'
      : d.state === 'rejected'
        ? 'bg-red-100 text-red-900'
        : 'bg-amber-100 text-amber-900';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] ${tone}`} title={`by ${d.reviewerLabel}`}>
      {d.state.replace('_', ' ')}
    </span>
  );
}

/**
 * Every finding of the run, filterable by verification state, expanding into
 * the full expert view: claim beside evidence, worked math, producing prompt,
 * config bars, disposition controls, and the reviewer note thread.
 */
export function TriageTable({
  tenantSlug,
  runId,
  findings,
  contexts,
  evidenceBase,
  sourceIds = {},
}: {
  tenantSlug: string;
  runId: string;
  findings: TriageFinding[];
  contexts: Record<string, TriageDimensionContext>;
  evidenceBase: string;
  /** evidence.snapshot_path → source-library id for archived-text links. */
  sourceIds?: Record<string, string>;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const m = new Map<Filter, number>();
    for (const { key } of FILTERS) m.set(key, findings.filter((f) => matches(f, key)).length);
    return m;
  }, [findings]);

  const visible = findings.filter((f) => matches(f, filter));

  return (
    <section>
      <div className="flex flex-wrap gap-2 text-xs">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded border px-2 py-1 ${
              filter === key ? 'bg-black text-white' : 'hover:bg-black/5'
            } ${(counts.get(key) ?? 0) === 0 ? 'opacity-40' : ''}`}
          >
            {label} · {counts.get(key) ?? 0}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {visible.map((f) => (
          <TriageRow
            key={f.finding.id}
            item={f}
            context={contexts[f.dimensionSlug]}
            tenantSlug={tenantSlug}
            runId={runId}
            evidenceBase={evidenceBase}
            sourceIds={sourceIds}
            open={openId === f.finding.id}
            onToggle={() => setOpenId(openId === f.finding.id ? null : f.finding.id)}
          />
        ))}
        {visible.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">Nothing matches this filter.</p>
        ) : null}
      </div>
    </section>
  );
}

function TriageRow({
  item,
  context,
  tenantSlug,
  runId,
  evidenceBase,
  sourceIds,
  open,
  onToggle,
}: {
  item: TriageFinding;
  context: TriageDimensionContext | undefined;
  tenantSlug: string;
  runId: string;
  evidenceBase: string;
  sourceIds: Record<string, string>;
  open: boolean;
  onToggle: () => void;
}) {
  const { finding } = item;
  const p = finding.payload;
  const v = finding.verification;
  return (
    <div
      id={`finding-${finding.id}`}
      className={`rounded border ${item.flagged && !item.disposition ? 'border-red-300' : 'border-black/15'}`}
    >
      <button className="flex w-full flex-wrap items-center gap-2 p-2 text-left" onClick={onToggle}>
        <span className="min-w-40 text-xs text-[color:var(--color-muted)]">
          {item.dimensionName}
        </span>
        <span className="flex-1 text-sm font-medium">
          {p.kind === 'indicator' ? p.name : `Data gap — ${p.indicator_slug}`}
        </span>
        {p.kind === 'indicator' ? (
          <span className="text-xs">
            {p.value} {p.unit} ({p.year})
          </span>
        ) : null}
        <span className="flex flex-wrap gap-1">
          {p.kind === 'indicator' ? (
            <span className="rounded bg-black/10 px-1.5 py-0.5 text-[11px]">tier {p.source_tier}</span>
          ) : (
            <span className="rounded bg-black/10 px-1.5 py-0.5 text-[11px]">gap</span>
          )}
          {v && p.kind === 'indicator' ? (
            <>
              <Chip ok={v.url_ok} label="url" />
              <Chip ok={v.schema_ok} label="schema" />
              <Chip ok={v.recency_ok} label="recency" />
              <Chip ok={v.scale_ok} label="scale" />
              <Chip
                ok={v.content_supported === 'pass'}
                label={`source ${v.content_supported}`}
                title={v.verifier_note}
              />
              {v.quote_ok !== undefined ? (
                <Chip
                  ok={v.quote_ok}
                  label="quote"
                  title="Does evidence.quote appear in the archived source text?"
                />
              ) : null}
            </>
          ) : v && p.kind === 'gap' ? (
            <span className="rounded bg-black/10 px-1.5 py-0.5 text-[11px]" title={v.verifier_note}>
              n/a — nothing to fetch
            </span>
          ) : (
            <Chip ok={false} label="no verification" />
          )}
          {item.inSample ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900">
              spot-check
            </span>
          ) : null}
          <DispositionChip d={item.disposition} />
        </span>
      </button>
      {open ? (
        <FindingDetail
          item={item}
          context={context}
          tenantSlug={tenantSlug}
          runId={runId}
          evidenceBase={evidenceBase}
          sourceIds={sourceIds}
        />
      ) : null}
    </div>
  );
}

function FindingDetail({
  item,
  context,
  tenantSlug,
  runId,
  evidenceBase,
  sourceIds,
}: {
  item: TriageFinding;
  context: TriageDimensionContext | undefined;
  tenantSlug: string;
  runId: string;
  evidenceBase: string;
  sourceIds: Record<string, string>;
}) {
  const { finding } = item;
  const p = finding.payload;
  const v = finding.verification;
  return (
    <div className="border-t border-black/10 p-3 text-sm">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          {p.kind === 'indicator' ? (
            <>
              <p className="text-lg font-semibold">
                {p.value} <span className="text-xs font-normal">{p.unit}</span>
                <span className="ml-2 text-xs font-normal text-[color:var(--color-muted)]">
                  ({p.year}) · target {p.target} · level {p.level_pct}%
                </span>
              </p>
              {/* Schema-failed payloads are stored verbatim — render what exists. */}
              {p.scoring ? (
                <p className="mt-1 font-mono text-[11px] text-[color:var(--color-muted)]">
                  {p.scoring.worked_math}
                </p>
              ) : null}
              <p className="mt-1 text-xs">
                <a className="underline" href={p.source_url} target="_blank" rel="noreferrer">
                  {p.source}
                </a>{' '}
                · tier {p.source_tier} · {p.geographic_scale} · {p.confidence} confidence
              </p>
              {p.evidence?.quote ? (
                <blockquote
                  className={`mt-2 border-l-2 pl-2 text-xs italic ${
                    v?.quote_ok === false ? 'border-red-400 text-red-900' : 'border-black/20'
                  }`}
                >
                  “{p.evidence.quote}”
                  {v?.quote_ok === false ? ' — NOT found in the archived text' : ''}
                  {sourceIds[p.evidence.snapshot_path] ? (
                    <>
                      {' '}
                      <a
                        className="not-italic underline"
                        href={`/${tenantSlug}/sources/${sourceIds[p.evidence.snapshot_path]}?q=${encodeURIComponent(p.evidence.quote)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        open archived text
                      </a>
                    </>
                  ) : null}
                </blockquote>
              ) : null}
              {v?.verifier_note ? (
                <p
                  className={`mt-2 rounded p-2 text-xs ${
                    v.content_supported === 'pass'
                      ? 'bg-black/5'
                      : 'bg-red-50 text-red-900'
                  }`}
                >
                  Verifier: {v.verifier_note}
                </p>
              ) : null}
              {p.notes ? (
                <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                  Session notes: {p.notes}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="font-medium">{p.reason}</p>
              <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                Scales tried: {(p.scales_tried ?? []).join(', ')}
                {p.tiers_tried?.length ? ` · tiers ${p.tiers_tried.join(', ')}` : ''}
                {p.nearest_data ? ` · nearest: ${p.nearest_data}` : ''}
              </p>
            </>
          )}

          {context ? (
            <p className="mt-2 text-[11px] text-[color:var(--color-muted)]">
              Judged against: max age {context.maxAgeYears}y · scales{' '}
              {context.acceptedScales.join(' → ')}
            </p>
          ) : null}

          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-[color:var(--color-muted)]">
              Raw payload &amp; verification
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-black/5 p-2 text-[10px]">
              {JSON.stringify({ payload: p, verification: v }, null, 2)}
            </pre>
          </details>
          {context?.prompt ? (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-[color:var(--color-muted)]">
                Producing prompt
              </summary>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/5 p-2 text-[10px]">
                {context.prompt}
              </pre>
            </details>
          ) : null}
        </div>

        <div>
          {p.kind === 'indicator' && p.evidence ? (
            <>
              <a
                href={`${evidenceBase}/${p.evidence.snapshot_path}`}
                target="_blank"
                rel="noreferrer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${evidenceBase}/${p.evidence.snapshot_path}`}
                  alt={`Evidence snapshot for ${p.name}`}
                  className="max-h-96 w-full rounded border border-black/15 object-contain object-top"
                />
              </a>
              <p className="mt-0.5 text-[11px] text-[color:var(--color-muted)]">
                archived exhibit · captured {p.evidence.captured_at.slice(0, 10)}
                {p.evidence.pdf_path ? (
                  <>
                    {' · '}
                    <a
                      className="underline"
                      href={`${evidenceBase}/${p.evidence.pdf_path}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      source PDF
                    </a>
                  </>
                ) : null}
              </p>
            </>
          ) : p.kind === 'indicator' ? (
            <p className="rounded border border-dashed border-red-300 p-3 text-xs text-red-900">
              No evidence snapshot was archived for this claim (evidence-archived-at-access).
            </p>
          ) : null}
        </div>
      </div>

      <DispositionForm item={item} tenantSlug={tenantSlug} runId={runId} />
      <NoteThread item={item} tenantSlug={tenantSlug} runId={runId} />
    </div>
  );
}

function DispositionForm({
  item,
  tenantSlug,
  runId,
}: {
  item: TriageFinding;
  tenantSlug: string;
  runId: string;
}) {
  const { run: act, pending, error } = useAction();
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [value, setValue] = useState('');
  const [year, setYear] = useState('');
  const [tags, setTags] = useState('');

  const submit = (state: DispositionState) => {
    const annotation: ReviewAnnotation = {};
    if (reasonCode) annotation.reason_code = reasonCode as ReviewAnnotation['reason_code'];
    if (sourceUrl.trim()) annotation.suggested_source_url = sourceUrl.trim();
    if (value.trim()) {
      const n = Number(value);
      annotation.suggested_value = Number.isFinite(n) && value.trim() !== '' ? n : value.trim();
    }
    if (year.trim()) annotation.suggested_year = Number(year);
    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tagList.length) annotation.tags = tagList;
    act(() =>
      dispositionFinding({
        tenantSlug,
        runId,
        findingId: item.finding.id,
        state,
        note: note.trim() || undefined,
        annotation: Object.keys(annotation).length ? annotation : undefined,
      }),
    );
  };

  return (
    <div className="mt-3 rounded border border-black/10 bg-black/[0.02] p-2">
      <p className="text-xs font-medium">
        Disposition
        {item.disposition ? (
          <span className="ml-2 font-normal text-[color:var(--color-muted)]">
            currently {item.disposition.state.replace('_', ' ')} by {item.disposition.reviewerLabel}{' '}
            — a new disposition appends; history is kept
          </span>
        ) : null}
      </p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <select
          className="rounded border border-black/20 px-2 py-1 text-xs"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
        >
          <option value="">reason code (machine-readable)…</option>
          {reviewReasons.reasons.map((r) => (
            <option key={r.code} value={r.code} title={r.description}>
              {r.label}
            </option>
          ))}
        </select>
        <input
          className="rounded border border-black/20 px-2 py-1 text-xs"
          placeholder="tags, comma-separated (optional)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <input
          className="rounded border border-black/20 px-2 py-1 text-xs"
          placeholder="suggested source URL (optional)"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
        />
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-black/20 px-2 py-1 text-xs"
            placeholder="suggested value (optional)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <input
            className="w-24 rounded border border-black/20 px-2 py-1 text-xs"
            placeholder="year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
      </div>
      <textarea
        className="mt-2 w-full rounded border border-black/20 px-2 py-1 text-xs"
        rows={2}
        placeholder="Free-form note — impressions, follow-ups, reasoning. Required (or a reason code) when rejecting."
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className="rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={pending}
          onClick={() => submit('verified')}
        >
          Verify
        </button>
        <button
          className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={pending || (!note.trim() && !reasonCode)}
          title="Requires a reason code or a note"
          onClick={() => submit('rejected')}
        >
          Reject (exclude from publication)
        </button>
        <button
          className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={pending}
          onClick={() => submit('needs_rework')}
        >
          Needs rework
        </button>
      </div>
    </div>
  );
}

function NoteThread({
  item,
  tenantSlug,
  runId,
}: {
  item: TriageFinding;
  tenantSlug: string;
  runId: string;
}) {
  const { run: act, pending, error } = useAction();
  const [note, setNote] = useState('');
  return (
    <div className="mt-3">
      {item.notes.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {item.notes.map((n) => (
            <li key={n.id} className="rounded border border-black/10 p-2">
              <p className="text-[11px] text-[color:var(--color-muted)]">
                {n.reviewerLabel} · {new Date(n.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                {n.disposition ? (
                  <span className="ml-1 font-medium">→ {n.disposition.replace('_', ' ')}</span>
                ) : null}
              </p>
              {n.annotation ? (
                <p className="mt-0.5 font-mono text-[10px] text-[color:var(--color-muted)]">
                  {JSON.stringify(n.annotation)}
                </p>
              ) : null}
              {n.note ? <p className="mt-0.5">{n.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex gap-2">
        <input
          className="flex-1 rounded border border-black/20 px-2 py-1 text-xs"
          placeholder="Jot a thought for other reviewers — no disposition attached"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          className="rounded border px-3 py-1 text-xs hover:bg-black/5 disabled:opacity-50"
          disabled={pending || !note.trim()}
          onClick={() =>
            act(async () => {
              await addReviewNote({ tenantSlug, runId, findingId: item.finding.id, note });
              setNote('');
            })
          }
        >
          Add note
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
