import { formatIndicatorValue } from '@deep-fryer/core';
import type { ImpactGroup, ImpactRow, WedgeOutcome } from '@/lib/policy';
import { safeHref } from '@/lib/safe-url';
import { DirectionLabel } from './PolicyDoughnut';

const unchanged: Record<Exclude<WedgeOutcome,'resized'>,string>={
 worse_indicator:'The wedge stays the same size because another indicator remains further from its target.',
 display_range:'Both scores lie beyond the visible chart range. Read the values below for the change.',
 too_small:'This change is smaller than one drawn step. The values below retain the estimate.',
 unmoved:'The projected indicator change does not change this dimension’s wedge.',
};

export function PolicyImpactCards({groups,onDoughnut}:{groups:ImpactGroup[];onDoughnut:string[]}){
 const years=[...new Set(groups.flatMap(group=>group.rows.flatMap(row=>row.change?.projected_year?[row.change.projected_year]:[])))].sort((a,b)=>a-b);
 return <div className="mt-4 space-y-5">{years.length>1?<p className="rounded border border-amber-600 p-3 text-sm"><strong>Mixed projection years: {years.join(', ')}.</strong> This chart combines separately dated estimates; it is not a portrait of one future year. Read each estimate’s horizon below.</p>:null}{groups.map(group=><section key={group.slug} id={`impact-${group.slug}`} aria-labelledby={`impact-title-${group.slug}`} className="scroll-mt-24 rounded-lg border border-black/15 p-4 sm:p-5 target:bg-black/5">
  <div className="flex flex-wrap items-start justify-between gap-3"><h3 id={`impact-title-${group.slug}`} className="text-lg font-semibold">{group.name}</h3><span className="text-sm"><DirectionLabel direction={group.direction}/></span></div>
  {!onDoughnut.includes(group.slug)?<p className="mt-2 text-sm text-[color:var(--color-muted)]">This dimension is not published on the portrait.</p>:null}
  {group.wedge && group.wedge!=='resized'?<p className="mt-2 text-sm text-[color:var(--color-muted)]">{unchanged[group.wedge]}</p>:null}
  <ul className="mt-3 space-y-5">{group.rows.map((row,index)=><li key={index} className="border-t border-black/10 pt-4">
   <dl className="flex flex-wrap gap-x-5 gap-y-2 text-xs"><div className="flex gap-1"><dt>Expected direction:</dt><dd><DirectionLabel direction={row.impact.direction}/></dd></div><div className="flex gap-1"><dt>Magnitude:</dt><dd>{row.impact.magnitude}</dd></div><div className="flex gap-1"><dt>Confidence:</dt><dd>{row.impact.confidence}</dd></div></dl>
   <IndicatorEstimate row={row}/>
   <p className="mt-3 whitespace-pre-line text-sm wrap-anywhere">{row.impact.rationale}</p>
   <div className="mt-3 text-sm"><h4 className="font-medium">Supporting sources</h4>{row.impact.sources.length?<ul className="mt-1 space-y-1">{row.impact.sources.map((source,i)=><li key={i}>{safeHref(source.url)?<a className="inline-block min-h-11 py-2 underline wrap-anywhere" href={safeHref(source.url)} target="_blank" rel="noreferrer">{source.title} ↗</a>:source.title}</li>)}</ul>:<p className="mt-1 text-[color:var(--color-muted)]">No source supplied. Treat this as an unsupported directional claim.</p>}</div>
  </li>)}</ul>
 </section>)}</div>;
}
export function IndicatorEstimate({row}:{row:ImpactRow}){
 const change=row.change;
 if(!change)return <div className="mt-3 rounded bg-black/[0.03] p-3 text-sm"><p className="font-medium">Direction only — no quantified scenario</p>{row.unquantified.length?<p className="mt-1 text-[color:var(--color-muted)]">{row.unquantified.join('; ')}.</p>:<p className="mt-1 text-[color:var(--color-muted)]">The analysis does not establish a numeric change to the portrait.</p>}</div>;
 return <div className="mt-3 rounded bg-black/[0.03] p-3"><h4 className="text-sm font-medium">{change.indicator}</h4><dl className="mt-3 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-[color:var(--color-muted)]">Analysis baseline{change.current_year ? ` · ${change.current_year}` : ' · year not recorded'}</dt><dd className="mt-1 text-lg font-semibold tabular-nums wrap-anywhere">{formatIndicatorValue(change.current_value,change.unit)}</dd></div><div><dt className="text-xs text-[color:var(--color-muted)]">Modeled estimate{change.projected_year?` · ${change.projected_year}`:''}</dt><dd className="mt-1 text-lg font-semibold tabular-nums wrap-anywhere">{formatIndicatorValue(change.projected_value,change.unit)}</dd></div></dl>
  {change.uncertainty?<div className="mt-3 text-sm"><p>Supplied range: {formatIndicatorValue(change.uncertainty.lower,change.unit)} to {formatIndicatorValue(change.uncertainty.upper,change.unit)}.</p><p className="mt-1 text-xs text-[color:var(--color-muted)]">Range method: {change.uncertainty.method}</p></div>:<p className="mt-3 text-xs text-[color:var(--color-muted)]">No uncertainty interval was supplied. The estimate is not a measured outcome.</p>}
  {row.warnings?.length?<p className="mt-3 border-l-2 border-amber-600 pl-3 text-sm"><strong>Review note:</strong> {row.warnings.join('; ')}.</p>:null}
 </div>;
}
