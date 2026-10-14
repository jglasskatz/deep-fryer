'use client';

import { useState } from 'react';
import type { Confidence, DimensionData, GeographicScale, Indicator } from '@deep-fryer/core';
import { saveDimensionEdit } from '@/lib/actions';
import { unwrap } from '@/lib/action-result';
import { useAction } from '@/lib/use-action';

const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];
const SCALES: GeographicScale[] = ['city', 'county', 'regional', 'state', 'national', 'global'];

const field =
  'w-full rounded border border-black/20 bg-white px-2 py-1 text-sm';

/** Form input → indicator value: empty is null, numeric strings are numbers. */
const parseValueInput = (raw: string): number | string | null =>
  raw === '' ? null : Number.isFinite(Number(raw)) && raw.trim() !== '' ? Number(raw) : raw;

export function DimensionEditor({
  tenantSlug,
  dimensionId,
  initial,
}: {
  tenantSlug: string;
  dimensionId: string;
  initial: DimensionData;
}) {
  const [data, setData] = useState<DimensionData>(initial);
  const [changeNote, setChangeNote] = useState('');
  const { run, pending, error } = useAction();

  const setIndicator = (idx: number, patch: Partial<Indicator>) => {
    setData((d) => ({
      ...d,
      indicators: d.indicators.map((ind, i) => (i === idx ? { ...ind, ...patch } : ind)),
    }));
  };

  const save = () =>
    run(async () => {
      unwrap(await saveDimensionEdit({ tenantSlug, dimensionId, data, changeNote }));
      setChangeNote('');
    });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm">
          <span className="font-medium">Name</span>
          <input
            className={field}
            value={data.name}
            onChange={(e) => setData({ ...data, name: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Icon</span>
          <input
            className={field}
            value={data.icon}
            onChange={(e) => setData({ ...data, icon: e.target.value })}
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="font-medium">Description</span>
        <textarea
          className={field}
          rows={2}
          value={data.description}
          onChange={(e) => setData({ ...data, description: e.target.value })}
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium">Context (plain-language, shown on the public drilldown)</span>
        <textarea
          className={field}
          rows={4}
          value={data.context}
          onChange={(e) => setData({ ...data, context: e.target.value })}
        />
      </label>

      <section>
        <h3 className="text-sm font-semibold">Indicators</h3>
        <p className="text-xs text-[color:var(--color-muted)]">
          Changing a value requires a supporting source URL — human edits meet the same
          provenance bar as research.
        </p>
        <div className="mt-3 space-y-4">
          {data.indicators.map((ind, i) => (
            <div key={i} className="rounded border border-black/15 p-3">
              <div className="grid grid-cols-3 gap-3">
                <label className="col-span-2 block text-xs">
                  <span className="font-medium">Indicator</span>
                  <input
                    className={field}
                    value={ind.name}
                    onChange={(e) => setIndicator(i, { name: e.target.value })}
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium">Unit</span>
                  <input
                    className={field}
                    value={ind.unit}
                    onChange={(e) => setIndicator(i, { unit: e.target.value })}
                  />
                </label>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-3">
                <label className="block text-xs">
                  <span className="font-medium">Value</span>
                  <input
                    className={field}
                    value={ind.value ?? ''}
                    onChange={(e) => setIndicator(i, { value: parseValueInput(e.target.value) })}
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium">Year</span>
                  <input
                    className={field}
                    type="number"
                    value={ind.year ?? ''}
                    onChange={(e) =>
                      setIndicator(i, { year: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium">Target</span>
                  <input
                    className={field}
                    value={ind.target ?? ''}
                    onChange={(e) => setIndicator(i, { target: parseValueInput(e.target.value) })}
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium">Level %</span>
                  <input
                    className={`${field} bg-black/5`}
                    value={ind.level_pct ?? ''}
                    readOnly
                    title={ind.scoring?.worked_math ?? 'Computed by the thresholds engine on save'}
                  />
                </label>
              </div>
              {ind.scoring ? (
                <p className="mt-1 font-mono text-[11px] text-[color:var(--color-muted)]">
                  {ind.scoring.worked_math}
                </p>
              ) : null}
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="block text-xs">
                  <span className="font-medium">Source</span>
                  <input
                    className={field}
                    value={ind.source}
                    onChange={(e) => setIndicator(i, { source: e.target.value })}
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium">Source URL</span>
                  <input
                    className={field}
                    value={ind.source_url}
                    onChange={(e) => setIndicator(i, { source_url: e.target.value })}
                  />
                </label>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <label className="block text-xs">
                  <span className="font-medium">Supporting source (for this edit)</span>
                  <input
                    className={field}
                    placeholder="https://…"
                    value={ind.supporting_source_url ?? ''}
                    onChange={(e) => setIndicator(i, { supporting_source_url: e.target.value })}
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-medium">Confidence</span>
                  <select
                    className={field}
                    value={ind.confidence}
                    onChange={(e) => setIndicator(i, { confidence: e.target.value as Confidence })}
                  >
                    {CONFIDENCES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="font-medium">Geographic scale</span>
                  <select
                    className={field}
                    value={ind.geographic_scale}
                    onChange={(e) =>
                      setIndicator(i, { geographic_scale: e.target.value as GeographicScale })
                    }
                  >
                    {SCALES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <label className="block text-sm">
        <span className="font-medium">Actions (one per line)</span>
        <textarea
          className={field}
          rows={4}
          value={data.actions.join('\n')}
          onChange={(e) =>
            setData({ ...data, actions: e.target.value.split('\n').filter((l) => l.trim()) })
          }
        />
      </label>

      <div className="rounded border border-black/15 bg-black/[0.03] p-3">
        <label className="block text-sm">
          <span className="font-medium">Change note (required — the rationale for this edit)</span>
          <textarea
            className={field}
            rows={2}
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
          />
        </label>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        <button
          className="mt-3 rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={save}
          disabled={pending || !changeNote.trim()}
        >
          {pending ? 'Saving…' : 'Save as new draft version'}
        </button>
      </div>
    </div>
  );
}
