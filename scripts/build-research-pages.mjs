import {readFile,writeFile,mkdir,copyFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
import {escape as h,period,sourceLinks,socialPortrait,trendView,number} from '../site/longitudinal-view.js';

/** Validate and publish a source-backed research bundle without rewriting it. */
export async function buildResearchPages(output) {
  const input=path.resolve('research/argentina-2026-10-29'),destination=path.join(output,'research/argentina');
  const core=await tsImport('../packages/core/src/longitudinal.ts',import.meta.url);
  const data=core.longitudinalDatasetSchema.parse(JSON.parse(await readFile(path.join(input,'data/portrait-series.json'),'utf8')));
  const modeled=JSON.parse(await readFile(path.join(input,'data/modeled-reference.json'),'utf8'));
  const root=await realpath(input);
  for(const source of data.sources){
    const file=await realpath(path.resolve(input,source.path));
    if(!file.startsWith(root+path.sep))throw new Error('Research source escapes bundle');
    if(createHash('sha256').update(await readFile(file)).digest('hex')!==source.sha256)throw new Error(`Research source checksum mismatch: ${source.id}`);
  }
  const years=Array.from({length:14},(_,i)=>2013+i),socialIds=data.scope.featured_social;
  const payload={...data,start:'2013-01-01',end:'2026-12-31',series:{},social:{},comparisons:{}};
  for(const indicator of data.indicators){
    payload.series[indicator.id]=core.longitudinalSeries(data,indicator.id);
    const suffix=indicator.frequency==='semester'?'-07-01':'-01-01';
    const starts=[`2013${suffix}`,indicator.frequency==='monthly'?'2023-12-01':`2023${suffix}`,...(indicator.frequency==='semester'?['2025-01-01','2025-07-01']:[])];
    payload.comparisons[indicator.id]=starts.map(start=>({start,label:period({period_start:start},indicator.frequency),changes:Object.fromEntries(payload.series[indicator.id].observations.map(o=>[o.period_start,core.longitudinalChange(data,indicator.id,start,o.period_start)]))}));
  }
  for(const year of years)payload.social[year]=socialIds.map(id=>{
    const indicator=data.indicators.find(i=>i.id===id),start=`${year}-${indicator.frequency==='semester'?'07':'01'}-01`;
    return {indicator,assessment:core.socialThresholdAtPeriod(data,id,start),periodLabel:period({period_start:start},indicator.frequency)};
  });
  await mkdir(destination,{recursive:true});
  for(const source of data.sources){const target=path.join(destination,source.path);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(input,source.path),target);}
  await mkdir(path.join(destination,'data'),{recursive:true});
  for(const file of ['portrait-series.json','modeled-reference.json'])await copyFile(path.join(input,'data',file),path.join(destination,'data',file));
  for(const name of ['longitudinal.js','longitudinal-view.js','longitudinal.css'])await copyFile(path.join('site',name),path.join(output,'assets',name));
  const papers=[];
  for(const [file,label] of [['argentina-working-paper.html','Read the working paper'],['methods-paper.html','Read the methods paper']]){
    try{
      await stat(path.join(input,file));
      const paper=await readFile(path.join(input,file),'utf8');
      await copyFile(path.join(input,file),path.join(destination,file));
      for(const match of paper.matchAll(/(?:href|src)=["']([^"']+)["']/g)){
        const href=match[1].replaceAll('&amp;','&');
        if(/^(?:https?:|mailto:|#)/.test(href))continue;
        if(/^[a-z]+:/i.test(href)||href.startsWith('/'))throw new Error('Unsupported research paper asset URL');
        const relative=href.split(/[?#]/)[0];
        if(!relative || relative==='.' || relative==='./')continue;
        const local=await realpath(path.resolve(input,relative));
        if(!local.startsWith(root+path.sep))throw new Error('Paper asset escapes research bundle');
        const target=path.resolve(destination,relative);
        if(!target.startsWith(destination+path.sep))throw new Error('Paper asset escapes output');
        await mkdir(path.dirname(target),{recursive:true});await copyFile(local,target);
      }
      papers.push(`<a href="${file}">${label} →</a>`);
    }catch(error){if(error.code!=='ENOENT')throw error;else throw new Error(`Required paper or linked artifact missing: ${file}`,{cause:error});}
  }
  for(const [file,label] of [['argentina-working-paper.pdf','Working paper PDF'],['methods-paper.pdf','Methods paper PDF']]){
    const relative=`papers/${file}`;
    try{
      const local=await realpath(path.join(input,relative));
      if(!local.startsWith(root+path.sep))throw new Error('Research PDF escapes bundle');
      await mkdir(path.join(destination,'papers'),{recursive:true});
      await copyFile(local,path.join(destination,relative));
      papers.push(`<a href="${relative}">${label}</a>`);
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const coverage=data.scope.featured_ecological.map(id=>{
    const series=payload.series[id],known=series.observations.filter(o=>o.value!==null && o.epistemic_type!=='projection'),latest=known.at(-1),post=known.filter(o=>o.period_start>='2024-01-01').length;
    return `<li><h3>${h(series.indicator.label)}</h3><p>${latest?`${number(latest.value)} ${h(series.indicator.unit)} · ${h(period(latest,series.indicator.frequency))}`:'No usable observation'}</p><p>${post} observations covering periods wholly after 2023.</p><p><a href="#trends" data-coverage-series="${h(id)}">Explore series →</a></p></li>`;
  }).join('');
  const selected='co2_territorial_per_capita';
  const body=`<section class="research-hero"><p class="eyebrow">ARGENTINA · LONGITUDINAL RESEARCH</p><h1>A portrait through time.</h1><p class="lead">Follow social outcomes and ecological pressures from 2013 to the latest available observations. See what changed, where evidence ends, and what a timeline alone cannot explain.</p><p>Evidence available as of ${h(data.as_of.slice(0,10))}. Observation years and release dates are kept separate.</p><nav class="research-links" aria-label="Research resources">${papers.join('')}<a href="data/portrait-series.json">Download observations</a><a href="#sources">Sources and method</a></nav></section>
  <p class="scope-note"><strong>Descriptive evidence, not an estimate of policy effects.</strong> December 2023 marks Milei’s inauguration; 2015 and other events remain visible as context. A before-and-after change does not establish who or what caused it.</p>
  <section class="research-section" aria-labelledby="partial-heading"><h2 id="partial-heading">Four social benchmarks. A partial view.</h2><p>Only four social benchmarks are scored. Three series are national; equality describes an <strong>urban, second-half-year survey</strong>. Poverty and other outcomes are tracked below. No ecological score or overall safe-and-just rating is implied.</p><div class="year-control"><label for="portrait-year">Reference year</label><select id="portrait-year">${years.map(year=>`<option${year===2023?' selected':''}>${year}</option>`).join('')}</select><span>Annual observations + H2 equality; no carry-forward.</span></div><p id="year-status" class="sr-only" role="status"></p><div id="social-portrait" class="social-layout">${socialPortrait(payload,2023)}</div><details><summary>How this partial Doughnut is calculated</summary><p>Benchmarks stay fixed: life expectancy 74 years; electricity access 95%; employment 94% (100 minus unemployment); equality 70 points (100 minus Gini). These are Fanning et al.’s published analytical thresholds, not Argentine statutory targets.</p><p>In this adaptation, the benchmark-relative gap is max(0, 1 − value ÷ benchmark). The red sector extends inward in proportion to that gap. The pale green band marks the fixed benchmark. This differs from the original paper’s normalization against historical global minima; original published ratios are not spliced into this series. Missing periods are hatched, never zero. There is no average or total score.</p><p>${sourceLinks(payload,'fanning2021-paper')}</p></details></section>
  <section class="research-section" id="trends" aria-labelledby="trends-heading"><h2 id="trends-heading">Follow the evidence in its own units.</h2><fieldset class="evidence-modes"><legend>Evidence view</legend><label><input type="radio" name="evidence-mode" value="observed" checked> Observed trends</label><label><input type="radio" name="evidence-mode" value="modeled"> Modeled references</label></fieldset><div id="observed-evidence"><p>Published observations and retrospective statistical estimates share this view. Projected inputs are excluded. Ecological series remain in their native units: no national planetary quota or ecological Doughnut score is invented.</p><div class="series-control"><label for="series-select">Indicator</label><select id="series-select">${['social','ecological','context'].map(group=>`<optgroup label="${group[0].toUpperCase()+group.slice(1)}">${data.indicators.filter(i=>i.dimension===group).map(i=>`<option value="${h(i.id)}"${i.id===selected?' selected':''}>${h(i.label)} · ${h(i.unit)}</option>`).join('')}</optgroup>`).join('')}</select></div><div id="trend-view">${trendView(payload,selected)}</div><div id="period-comparison"></div><details><summary>Ecological coverage at a glance</summary><p>“After 2023” counts periods fully within 2024 onward, not policy attribution. Reporting delays and projected inputs limit what can be said about recent years.</p><ul class="coverage-grid">${coverage}</ul></details></div>
  <div id="modeled-evidence" hidden><h3>Projected source inputs, kept separate</h3><p>No policy-effect estimate or forecast scenario has been supplied for this portrait. These UNEP material-accounting reference values contain projected components from 2020 onward. They are excluded from observed trends and the partial Doughnut.</p><p>The source methodology limits statistical correlations to the empirical portion ending in 2019. Do not interpret these values as measured post-policy outcomes.</p><p><a href="data/modeled-reference.json">Download the separate modeled reference data</a></p><ul class="modeled-records">${modeled.records.map(r=>`<li><strong>${h(data.indicators.find(i=>i.id===r.indicator_id)?.label||r.indicator_id)} · ${h(r.year)}</strong><p>${number(r.value)} ${h(data.indicators.find(i=>i.id===r.indicator_id)?.unit||'')} · ${h(r.epistemic_type)}</p><p>${h(r.use_restriction)}</p><p>${sourceLinks(payload,r.source_id)} · ${sourceLinks(payload,r.method_source_id)}</p><p>${h(r.source_locator)}; ${h(r.method_locator)}</p></li>`).join('')}</ul></div></section>
  <section class="research-section"><h2>Political and economic chronology</h2><p>Events provide context, not a treatment-effect estimate. Different events have different dates and geographic reach.</p><details><summary>Show ${data.events.length} sourced events</summary><ol class="chronology">${data.events.map(e=>`<li><strong>${h(e.date)}${e.date_end?` to ${h(e.date_end)}`:''} · ${h(e.label)}</strong><br>${h(e.category)}${e.date_precision?` · ${h(e.date_precision)}`:''}<br>${sourceLinks(payload,e.source_id)}<br>${h(e.source_locator)}</li>`).join('')}</ol></details></section>
  <section class="research-section" id="sources"><h2>Method and source record</h2><p>Periods, geography and source definitions stay attached to every observation. Missing values and comparability breaks are retained; no interpolation, extrapolation, annualization of semester data or substitution of a later release year is performed.</p><nav class="research-links">${papers.join('')}<a href="data/portrait-series.json">Data and source checksums</a></nav><details><summary>Browse ${data.sources.length} archived primary sources</summary><ol>${data.sources.map(s=>`<li><p><strong>${h(s.title)}</strong><br>${sourceLinks(payload,s.id)}<br>Released: ${h(s.release_date||'not specified')} · Retrieved: ${h(s.retrieved_at.slice(0,10))}</p></li>`).join('')}</ol></details></section>`;
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Argentina through time · deep-fryer</title><meta name="description" content="Argentina’s partial social Doughnut and native-unit ecological trends, with explicit gaps, source archives and methodological limits."><link rel="stylesheet" href="../../assets/site.css"><link rel="stylesheet" href="../../assets/longitudinal.css"></head><body><a class="skip" href="#main">Skip to content</a><header><a class="brand" href="../../">◉ deep-fryer</a><nav><a href="../../#portraits">Portraits</a><a href="#sources">Method</a></nav></header><main id="main" class="research-page">${body}<noscript><p>Interactive selectors require JavaScript. The 2023 partial portrait and territorial CO₂ observations are shown above; the complete data download contains all periods and indicators.</p></noscript></main><footer class="research-footer">A partial research portrait · <a href="../../">Back to the portrait collection</a></footer><script type="application/json" id="longitudinal-data">${JSON.stringify(payload).replaceAll('<','\\u003c')}</script><script type="module" src="../../assets/longitudinal.js"></script></body></html>`;
  await writeFile(path.join(destination,'index.html'),html);
  return {sources:data.sources.length,indicators:data.indicators.length,papers:papers.length};
}
