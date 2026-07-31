'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { planResearchAction } from '@/lib/research-actions';

export interface RunnableDimension {
  id: string;
  name: string;
  ring: string;
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const plan = () => {
    setError(null);
    startTransition(async () => {
      try {
        const { runId } = await planResearchAction({
          tenantSlug,
          dimensionIds: [...selected],
        });
        router.push(`/${tenantSlug}/admin/research/${runId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="rounded border border-black/15 p-4">
      <h2 className="text-base font-semibold">New research run</h2>
      <p className="mt-1 text-xs text-[color:var(--color-muted)]">
        Planning renders every session prompt without spending tokens; you inspect the plan
        before applying. Session count: {selected.size + 1} (region context + {selected.size}{' '}
        dimensions).
      </p>
      <div className="mt-3 grid grid-cols-3 gap-1 text-sm">
        {dimensions.map((d) => (
          <label key={d.id} className="flex items-center gap-2">
            <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
            {d.name}
            <span className="text-xs text-[color:var(--color-muted)]">({d.ring})</span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2 text-xs">
        <button className="underline" onClick={() => setSelected(new Set(dimensions.map((d) => d.id)))}>
          all
        </button>
        <button className="underline" onClick={() => setSelected(new Set())}>
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
