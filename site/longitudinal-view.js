/** Pure presentation of precomputed, validated longitudinal series. No scoring or interpolation. */
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const h = escape;
export const number = value => value == null ? 'Not available' : new Intl.NumberFormat('en', {maximumFractionDigits:2}).format(value);
export function period(observation, frequency) {
  if (!observation) return 'No observation';
  const year = observation.period_start.slice(0,4);
  return frequency === 'annual' ? year : frequency === 'semester' ? `${year} · ${observation.period_start.slice(5,7)==='01' ? 'H1 (Jan–Jun)' : 'H2 (Jul–Dec)'}` : observation.period_start.slice(0,7);
}
export function sourceLinks(data, id) {
  const source = data.sources.find(s => s.id === id);
  return source ? `<a href="${h(source.url)}" rel="noopener noreferrer">${h(source.publisher)} ↗</a> · <a href="${h(source.path)}">Archived source</a>` : 'No source available';
}
export function observationNotes(data, observation, indicator) {
  if(!observation || observation.value===null)return '';
  const range=observation.uncertainty || (observation.confidence_interval ? {lower:observation.confidence_interval[0],upper:observation.confidence_interval[1],confidence_level:observation.confidence_level} : null);
  const uncertainty=range ? `<p class="reported-interval"><strong>${range.confidence_level ? `${number(range.confidence_level*100)}% confidence interval` : 'Source-reported uncertainty range'}:</strong> ${number(range.lower)}–${number(range.upper)} ${h(indicator.unit)}.${range.method?` ${h(range.method)}`:''}</p>${observation.confidence_source_id ? `<p class="interval-source">${sourceLinks(data,observation.confidence_source_id)} · ${h(observation.confidence_locator)}</p>`:''}` : '';
  const comparisons=(observation.statistical_comparisons||[]).map(comparison=>`<p class="producer-comparison"><strong>Producer’s comparison:</strong> ${h(comparison.producer_statement)} This refers to ${h(period(observation,indicator.frequency))} versus ${h(period({period_start:comparison.reference_period_start},indicator.frequency))}, not every selectable baseline.<br>${sourceLinks(data,comparison.source_id)} · ${h(comparison.source_locator)}</p>`).join('');
  return `${observation.provisional?'<p class="provisional"><strong>Provisional estimate.</strong> The source may revise this value.</p>':''}${uncertainty}${comparisons}`;
}
const polar = (r,a) => [160+r*Math.cos(a),160+r*Math.sin(a)];
function wedge(inner,outer,start,end) {
  const a=polar(outer,start),b=polar(outer,end),c=polar(inner,end),d=polar(inner,start);
  return `M${a} A${outer},${outer} 0 0 1 ${b} L${c} A${inner},${inner} 0 0 0 ${d} Z`;
}
export function socialPortrait(data, year) {
  const entries = data.social[year];
  const paths = entries.map((entry,index) => {
    const start=-Math.PI/2+index*Math.PI/2+.035,end=start+Math.PI/2-.07;
    const known=entry.assessment.status==='assessed';
    const gap=known ? entry.assessment.shortfall_pct/100 : 1;
    const text=known ? `${number(entry.assessment.shortfall_pct)}% benchmark-relative gap` : entry.assessment.reason;
    return `<g><title>${h(entry.indicator.label)}: ${h(text)}</title><path d="${wedge(96,112,start,end)}" fill="#dce9dc"/>${gap>0 ? `<path d="${wedge(96-gap*48,96,start,end)}" fill="${known ? '#b94e47' : 'url(#missing)'}"/>` : ''}<text x="${polar(130,(start+end)/2)[0]}" y="${polar(130,(start+end)/2)[1]}" text-anchor="middle" dominant-baseline="middle" font-size="18">${index+1}</text></g>`;
  }).join('');
  return `<div class="social-figure"><svg viewBox="0 0 320 320" role="img" aria-label="Partial social portrait for ${h(year)}. Four benchmark sectors; see values and coverage alongside."><defs><pattern id="missing" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#eeeae3"/><line y2="7" stroke="#8b8790" stroke-width="2"/></pattern></defs>${paths}<text x="160" y="151" text-anchor="middle" font-size="13">PARTIAL SOCIAL</text><text x="160" y="177" text-anchor="middle" font-size="23">${h(year)}</text></svg><p class="research-chart-key"><span class="key target">Fixed benchmark</span><span class="key gap">Benchmark-relative gap</span><span class="key unknown">Missing for this period</span></p></div><ol class="social-values">${entries.map(entry=>{
    const {indicator,assessment}=entry; const known=assessment.status==='assessed';
    return `<li><h3>${h(indicator.label)}</h3><p class="measure">${known ? `${number(assessment.value)} <span>${h(indicator.unit)}</span>` : 'Not available'}</p><p>${h(entry.periodLabel)} · ${h(indicator.geography.name)}</p><p class="coverage">${h(indicator.geography.coverage)}</p><p>Fixed benchmark: ${number(indicator.target)} ${h(indicator.unit)}. ${known ? assessment.shortfall_pct>0 ? `Gap: ${number(assessment.shortfall_pct)}%.` : 'Benchmark met.' : h(assessment.reason)}</p>${known ? `<p class="source-line">${sourceLinks(data,assessment.observation.source_id)}</p>` : ''}<button type="button" class="text-button" data-series="${h(indicator.id)}">Explore this time series →</button></li>`;
  }).join('')}</ol>`;
}
export function trendChart(data, id) {
  const series=data.series[id], indicator=series.indicator;
  const values=series.observations.filter(o=>o.value!==null && o.epistemic_type!=='projection').map(o=>o.value);
  for(const o of series.observations){if(o.value!==null && o.epistemic_type!=='projection'){if(o.confidence_interval)values.push(...o.confidence_interval);else if(o.uncertainty)values.push(o.uncertainty.lower,o.uncertainty.upper);}}
  if(indicator.target!==null) values.push(indicator.target);
  if(!values.length) return '<p>No source-supported observations are available for this series.</p>';
  const lo=Math.min(0,...values),hi=Math.max(...values),span=hi-lo||1;
  const domain=[lo,hi+span*.12], x0=Date.parse(data.start),x1=Date.parse(data.end);
  const x=date=>64+((Date.parse(date)-x0)/(x1-x0))*656,y=value=>260-(value-domain[0])/(domain[1]-domain[0])*222;
  const ticks=Array.from({length:5},(_,i)=>domain[0]+(domain[1]-domain[0])*i/4);
  const events=data.events.filter(e=>e.category==='inauguration' && ['2015','2023'].includes(e.date.slice(0,4)));
  return `<svg viewBox="0 0 760 310" role="img" aria-label="${h(indicator.label)} in ${h(indicator.unit)}, observed history. Lines stop at missing periods and comparability breaks."><g class="chart-grid">${ticks.map(t=>`<line x1="64" x2="720" y1="${y(t)}" y2="${y(t)}"/><text x="54" y="${y(t)+4}" text-anchor="end">${number(t)}</text>`).join('')}</g>${[2013,2015,2017,2019,2021,2023,2025,2026].map(year=>`<text x="${x(`${year}-01-01`)}" y="286" text-anchor="middle" class="axis-label">${year}</text>`).join('')}${events.map(e=>`<g class="event-marker"><line x1="${x(e.date)}" x2="${x(e.date)}" y1="25" y2="260"/><text x="${x(e.date)+5}" y="${e.date.startsWith('2015')?18:32}">${e.date.startsWith('2015')?'Macri':'Milei'} takes office</text></g>`).join('')}${indicator.target===null ? '' : `<line class="benchmark-line" x1="64" x2="720" y1="${y(indicator.target)}" y2="${y(indicator.target)}"/><text class="benchmark-label" x="715" y="${y(indicator.target)-6}" text-anchor="end">Benchmark ${number(indicator.target)}</text>`}${series.segments.flat().map(o=>{const interval=o.confidence_interval || (o.uncertainty?[o.uncertainty.lower,o.uncertainty.upper]:null);if(!interval)return '';const cx=x(o.period_end);return `<g class="confidence-whisker"><line x1="${cx}" x2="${cx}" y1="${y(interval[0])}" y2="${y(interval[1])}"/><line x1="${cx-4}" x2="${cx+4}" y1="${y(interval[0])}" y2="${y(interval[0])}"/><line x1="${cx-4}" x2="${cx+4}" y1="${y(interval[1])}" y2="${y(interval[1])}"/></g>`;}).join('')}${series.segments.map(segment=>`<polyline class="observed-line" points="${segment.map(o=>`${x(o.period_end)},${y(o.value)}`).join(' ')}"/>${segment.map(o=>`<circle class="observed-point" cx="${x(o.period_end)}" cy="${y(o.value)}" r="3.5"><title>${h(period(o,indicator.frequency))}: ${number(o.value)} ${h(indicator.unit)}</title></circle>`).join('')}`).join('')}</svg>`;
}
export function trendView(data,id) {
  const series=data.series[id],i=series.indicator,latest=series.observations.filter(o=>o.value!==null && o.epistemic_type!=='projection').at(-1);
  const missing=series.observations.filter(o=>o.value===null).length;
  return `<div class="trend-heading"><div><h3>${h(i.label)}</h3><p>${h(i.unit)} · ${h(i.frequency)} · ${h(i.geography.name)}</p></div><p class="latest">Latest available<br><strong>${latest ? `${number(latest.value)} ${h(i.unit)}` : 'No observation'}</strong><br>${latest?h(period(latest,i.frequency)):''}</p></div><p class="coverage">${h(i.geography.coverage)}</p><div class="latest-notes">${observationNotes(data,latest,i)}</div><p class="mobile-chart-hint">Scroll the chart horizontally to read the full timeline. Exact values are listed below.</p><div class="trend-chart" tabindex="0" role="region" aria-label="Scrollable time series chart">${trendChart(data,id)}</div><p class="chart-note">Fixed scale across the full series. Points are source-supported observations or retrospective estimates; lines stop at gaps and comparability breaks. Inauguration markers show chronology, not policy effects. ${series.observations.some(o=>o.confidence_interval||o.uncertainty)?'Whiskers show source-reported uncertainty intervals where supplied; no intervals are inferred for other periods.':''}</p><p>${missing} missing periods in this series. ${i.target===null ? 'No threshold score is assigned to this series.' : `Dashed line: fixed analytical benchmark, ${number(i.target)} ${h(i.unit)}.`}</p><details><summary>Definition, comparability and benchmark method</summary><p>${h(Array.isArray(i.comparability_notes)?i.comparability_notes.join(' '):i.comparability_notes)}</p>${i.target_rationale?`<p>${h(i.target_rationale)}</p><p>${sourceLinks(data,i.target_source_id)}</p>`:''}</details><details class="observation-detail"><summary>All ${series.observations.length} periods, missing data and sources</summary><ol class="observation-list">${series.observations.map(o=>`<li><div><strong>${h(period(o,i.frequency))}</strong><br><span class="period-range">${h(o.period_start)} to ${h(o.period_end)}</span></div><div><strong>${o.value===null?'Not available':`${number(o.value)} ${h(i.unit)}`}</strong><p>${o.value===null?h(o.missing_reason):h(o.epistemic_type.replaceAll('-',' '))}</p>${observationNotes(data,o,i)}${o.break_flags.length?`<p class="break-warning">${h(o.break_flags.join(' · ').replaceAll('_',' '))}</p>`:''}</div><div>${sourceLinks(data,o.source_id)}<p>Released: ${h(o.release_date||'not specified by source')}<br>Retrieved: ${h(o.retrieved_at.slice(0,10))}</p><details><summary>Source locator</summary><p>${h(o.source_locator)}</p></details></div></li>`).join('')}</ol></details>`;
}
export function comparisonView(data,id) {
  const series=data.series[id],baselines=data.comparisons[id],latest=series.observations.filter(o=>o.value!==null && o.epistemic_type!=='projection').at(-1);
  return `<section class="comparison"><h3>Compare two recorded periods</h3><p>This is a descriptive endpoint change, not a policy-effect estimate. Missing intervening observations stay missing; known comparability breaks prevent a comparison.</p><div class="comparison-controls"><label>From<select id="comparison-from">${baselines.map((b,index)=>`<option value="${index}"${index===1?' selected':''}>${h(b.label)}</option>`).join('')}</select></label><label>To<select id="comparison-to">${series.observations.map(o=>`<option value="${o.period_start}"${o.period_start===latest?.period_start?' selected':''}>${h(period(o,series.indicator.frequency))}${o.value===null?' · missing':''}</option>`).join('')}</select></label></div><div id="comparison-result" role="status"></div></section>`;
}
export function comparisonResult(data,id,baselineIndex,to) {
  const baseline=data.comparisons[id][baselineIndex],result=baseline?.changes[to],series=data.series[id];
  if(!result)return 'Choose two recorded periods.';
  const endpoints=[baseline.start,to].map(start=>series.observations.find(o=>o.period_start===start)).filter(Boolean);
  const endpointNotes=endpoints.some(o=>o.provisional||o.confidence_interval||o.uncertainty||o.statistical_comparisons?.length) ? `<div class="comparison-endpoints">${endpoints.map(o=>`<section><h4>${h(period(o,series.indicator.frequency))} · ${number(o.value)} ${h(series.indicator.unit)}</h4><p>${h(series.indicator.geography.coverage)}</p>${observationNotes(data,o,series.indicator)}</section>`).join('')}</div><p class="comparison-caution">Point differences alone do not establish statistical significance. A producer’s significance statement applies only to the periods it names; no significance is inferred from confidence-interval overlap.</p>` : '';
  const change=result.comparable ? `<strong>${result.delta>0?'+':''}${number(result.delta)} ${h(result.unit)}</strong> between these endpoints. ${result.caveats?.length ? h(result.caveats.join(' ')) : 'This descriptive change does not establish causation.'}` : `No comparable change: ${h(result.reason)}`;
  return `<p>${change}</p>${endpointNotes}`;
}
