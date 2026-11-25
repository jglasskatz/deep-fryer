'use client';

import { useState } from 'react';
import {
  CLOUD_CARBON_REGIONS,
  DEFAULT_CARBON_ROUTING,
  assessRunCarbon,
  dimensionResearchSessions,
  estimateRunCost,
  formatCostRange,
  type CarbonRoutingMode,
  type ResearchStrategy,
} from '@deep-fryer/core';
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
  initialCarbonMode = DEFAULT_CARBON_ROUTING.mode,
  initialRegionId = DEFAULT_CARBON_ROUTING.regionId,
}: {
  tenantSlug: string;
  dimensions: RunnableDimension[];
  initialCarbonMode?: CarbonRoutingMode;
  initialRegionId?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(dimensions.map((d) => d.id)));
  const { run, pending, error } = useAction();
  const [strategy, setStrategy] = useState<ResearchStrategy>('standard');
  const [carbonMode, setCarbonMode] = useState<CarbonRoutingMode>(initialCarbonMode);
  const [regionId, setRegionId] = useState<string>(initialRegionId);
  const sessions = 1 + dimensions.filter(d => selected.has(d.id)).reduce((count, d) => count + dimensionResearchSessions(d.indicatorCount ?? 0), 0);
  const carbon = assessRunCarbon({
    mode: carbonMode,
    regionId,
    sessions,
    strategy,
  });

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
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className="flex cursor-pointer items-start gap-3 rounded border border-black/15 p-3 text-sm">
            <input className="mt-1" type="radio" name="research-strategy" value="standard" checked={strategy === 'standard'} onChange={() => setStrategy('standard')} />
            <span><strong className="block">Standard</strong><span className="block text-xs text-[color:var(--color-muted)]">Sonnet research with independent Opus verification. Estimated API usage: {formatCostRange(estimateRunCost(sessions, 'standard'))} for this selection.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded border border-black/15 p-3 text-sm">
            <input className="mt-1" type="radio" name="research-strategy" value="hybrid" checked={strategy === 'hybrid'} onChange={() => setStrategy('hybrid')} />
            <span><strong className="block">Hybrid</strong><span className="block text-xs text-[color:var(--color-muted)]">Sonnet first, selectively escalating only gaps and failed verifications to Opus with Sonnet scouts. Estimated API usage: {formatCostRange(estimateRunCost(sessions, 'hybrid'))} for this selection.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded border border-black/15 p-3 text-sm">
            <input className="mt-1" type="radio" name="research-strategy" value="deep" checked={strategy === 'deep'} onChange={() => setStrategy('deep')} />
            <span><strong className="block">Deep</strong><span className="block text-xs text-[color:var(--color-muted)]">Opus leads the research with Sonnet scouts. Estimated API usage: {formatCostRange(estimateRunCost(sessions, 'deep'))}; independent Opus verification stays the same.</span></span>
          </label>
        </div>
        <p className="mt-2 text-xs text-[color:var(--color-muted)]">Estimates describe API usage, not a charge or spending cap. Actual usage and estimated cost appear on the run.</p>
        <p className="mt-1 text-xs text-[color:var(--color-muted)]">The run page names the strategy and version the run used, with its models and limits, and they stay the same even if the defaults change later.</p>
      </fieldset>
      <fieldset className="mt-4 rounded border border-black/10 p-3" disabled={pending}>
        <legend className="px-1 text-sm font-medium">Carbon &amp; provider routing</legend>
        <div className="mt-1 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="font-medium">Execution policy</span>
            <select
              className="mt-1 block w-full rounded border border-field-border bg-[color:var(--color-bg)] px-2.5 py-2 text-xs"
              name="carbon-routing-mode"
              value={carbonMode}
              onChange={(e) => setCarbonMode(e.target.value as CarbonRoutingMode)}
            >
              <option value="carbon_free_first">Carbon-free first · Google low-CO₂ region (default)</option>
              <option value="vertex_batch_low_carbon">Vertex AI Batch · low-carbon &amp; ~50% lower token cost</option>
              <option value="schedule_low_carbon">Schedule for low-carbon / peak-solar window</option>
              <option value="run_now">Run now (any selected provider / region)</option>
            </select>
          </label>
          <label className="block text-xs">
            <span className="font-medium">Region / provider profile</span>
            <select
              className="mt-1 block w-full rounded border border-field-border bg-[color:var(--color-bg)] px-2.5 py-2 text-xs"
              name="carbon-region-id"
              value={carbon.effectiveRegion.id}
              onChange={(e) => setRegionId(e.target.value)}
            >
              {CLOUD_CARBON_REGIONS.filter((r) =>
                carbonMode === 'carbon_free_first' || carbonMode === 'vertex_batch_low_carbon'
                  ? r.provider === 'google'
                  : true,
              ).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-[color:var(--color-muted)]">
          Routing target: <strong>{carbon.effectiveRegion.id}</strong> (~{carbon.classification.gco2PerKwh} gCO₂eq/kWh
          {carbon.effectiveRegion.cfePct !== null ? ` · ~${carbon.effectiveRegion.cfePct}% CFE` : ''}
          {carbon.useVertexBatch ? ' · Vertex AI Batch' : ''}) · Est. operational footprint: ~{carbon.estimatedGramsCo2} gCO₂eq.
        </p>
        {carbon.classification.shouldWarn ? (
          <div
            role="alert"
            className={
              carbon.classification.band === 'high'
                ? 'mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900'
                : 'mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900'
            }
          >
            <strong className="block">{carbon.classification.warningHeadline}</strong>
            <span>{carbon.classification.warningRecommendation}</span>
          </div>
        ) : null}
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
