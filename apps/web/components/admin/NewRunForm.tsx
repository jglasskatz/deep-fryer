'use client';

import { useState } from 'react';
import { dimensionResearchSessions, estimateRunCost, formatCostRange, type ResearchStrategy } from '@deep-fryer/core';
import { useRouter } from 'next/navigation';
import { planResearchAction } from '@/lib/research-actions';
import { useAction } from '@/lib/use-action';
import { unwrap } from '@/lib/action-result';

export interface RunnableDimension {
  id: string;
  name: string;
  ring: string;
  indicatorCount?: number;
}

export function NewRunForm({
  tenantSlug,
  dimensions,
}: {
  tenantSlug: string;
  dimensions: RunnableDimension[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(dimensions.map((d) => d.id)));
  const { run, pending, error } = useAction();
  const [strategy, setStrategy] = useState<ResearchStrategy>('standard');
  const sessions = 1 + dimensions.filter(d => selected.has(d.id)).reduce((count, d) => count + dimensionResearchSessions(d.indicatorCount ?? 0), 0);

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const plan = () =>
    run(async () => {
      const { runId } = unwrap(
        await planResearchAction({
          tenantSlug,
          strategy,
          dimensionIds: [...selected],
        }),
      );
      router.push(`/${tenantSlug}/admin/research/${runId}`);
    });

  return (
    <div className="rounded border border-black/15 p-4">
      <h2 className="text-base font-semibold">New research run</h2>
      <p className="mt-1 text-xs text-[color:var(--color-muted)]">
        Planning renders every session prompt without spending tokens; you inspect the plan
        before applying. Session count: {sessions} (region context + {selected.size} dimensions; dense dimensions are split into smaller sessions).
      </p>
      <fieldset className="mt-4" disabled={pending}>
        <legend className="text-sm font-medium">Research strategy</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded border border-black/15 p-3 text-sm">
            <input className="mt-1" type="radio" name="research-strategy" value="standard" checked={strategy === 'standard'} onChange={() => setStrategy('standard')} />
            <span><strong className="block">Standard</strong><span className="block text-xs text-[color:var(--color-muted)]">Sonnet research with independent Opus verification. Estimated API usage: {formatCostRange(estimateRunCost(sessions))} for this selection.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded border border-black/15 p-3 text-sm">
            <input className="mt-1" type="radio" name="research-strategy" value="deep" checked={strategy === 'deep'} onChange={() => setStrategy('deep')} />
            <span><strong className="block">Deep</strong><span className="block text-xs text-[color:var(--color-muted)]">Opus leads the research with Sonnet scouts. Uses more API budget; independent Opus verification stays the same.</span></span>
          </label>
        </div>
        <p className="mt-2 text-xs text-[color:var(--color-muted)]">Estimates describe API usage, not a charge or spending cap. Actual usage and estimated cost appear on the run.</p>
      </fieldset>
      <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2 md:grid-cols-3">
        {dimensions.map((d) => (
          <label key={d.id} className="flex min-h-11 items-center gap-2">
            <input className="shrink-0" type="checkbox" disabled={pending} checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
            <span className="min-w-0">{d.name} <span className="text-xs text-[color:var(--color-muted)]">({d.ring})</span></span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2 text-xs">
        <button className="underline" disabled={pending} onClick={() => setSelected(new Set(dimensions.map((d) => d.id)))}>
          all
        </button>
        <button className="underline" disabled={pending} onClick={() => setSelected(new Set())}>
          none
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <button
        className="mt-3 rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        disabled={pending || selected.size === 0}
        onClick={plan}
      >
        {pending ? 'Planning…' : 'Plan run'}
      </button>
    </div>
  );
}
