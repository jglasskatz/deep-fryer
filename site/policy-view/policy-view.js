(() => {
  'use strict';
  const data = window.POLICY_DATA;
  if (!data || !Array.isArray(data.policies)) {
    document.getElementById('results').textContent = 'Evidence data could not be loaded. Please open policy-data.json directly.';
    return;
  }
  const state = { city: 'all', slice: 'all', evidence: 'all' };
  const el = (id) => document.getElementById(id);
  const safe = (str) => String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dimension = (id) => data.dimensions.find(d => d.id === id);
  const cityName = (id) => id === 'nyc' ? 'New York City' : id === 'santa-cruz' ? 'Santa Cruz' : 'Both places';
  const cityPolicies = () => data.policies.filter(p => state.city === 'all' || p.city === state.city);
  const selectedPolicies = () => cityPolicies().filter(p => (state.slice === 'all' || p.slices.includes(state.slice)) && (state.evidence === 'all' || (state.evidence === 'causal' ? p.hasCausalEstimate : !p.hasCausalEstimate)));
  const polar = (r, a) => [220 + r * Math.sin(a), 220 - r * Math.cos(a)];
  const arc = (inner, outer, start, end) => { const a=polar(outer,start),b=polar(outer,end),c=polar(inner,end),d=polar(inner,start); return `M ${a} A ${outer} ${outer} 0 0 1 ${b} L ${c} A ${inner} ${inner} 0 0 0 ${d} Z`; };
  function renderRing() {
    const relevant = cityPolicies();
    let svg = '<svg viewBox="0 0 440 440" role="group" aria-label="Doughnut dimension navigation. Equal segments show policy relevance, not impact. Select a segment to filter."><title>Policy-to-Doughnut mapping</title><desc>Inner ring: twelve social dimensions. Outer ring: nine ecological dimensions. Darker segments have reviewed policy mappings. Counts and colors are not outcome scores.</desc>';
    for (const ring of ['ecological','social']) {
      const dims = data.dimensions.filter(d => d.ring === ring);
      const radii = ring === 'ecological' ? [161,211] : [102,153];
      dims.forEach((d,i) => {
        const step=2*Math.PI/dims.length, start=i*step+.012, end=(i+1)*step-.012;
        const count=relevant.filter(p=>p.slices.includes(d.id)).length;
        const fill=count ? (ring==='ecological'?'#b9d0ab':'#deb7c5') : '#e0e3d8';
        const point=polar((radii[0]+radii[1])/2,(start+end)/2);
        svg += `<path class="ring-segment${state.slice===d.id?' selected':''}" d="${arc(radii[0],radii[1],start,end)}" fill="${fill}" data-slice="${safe(d.id)}" role="button" tabindex="0" aria-pressed="${state.slice===d.id}" aria-label="${safe(d.name)}: ${count} reviewed ${count===1?'policy':'policies'} in ${safe(cityName(state.city))}. Filter by this dimension."><title>${safe(d.name)} · ${count} reviewed ${count===1?'policy':'policies'}</title></path><text class="ring-code" text-anchor="middle" x="${point[0]}" y="${point[1]+3}">${safe(d.code)}</text>`;
      });
    }
    const n=selectedPolicies().length;
    svg += `<text class="center-title" text-anchor="middle" x="220" y="210">${n}</text><text class="center-sub" text-anchor="middle" x="220" y="233">${n===1?'POLICY CASE':'POLICY CASES'}</text><line x1="185" y1="249" x2="255" y2="249" stroke="#c4ccbc"/><text class="center-foot" text-anchor="middle" x="220" y="269">Not an impact score</text></svg>`;
    el('doughnut').innerHTML=svg;
    el('doughnut').querySelectorAll('[data-slice]').forEach(node => {
      node.addEventListener('click',()=>setSlice(node.dataset.slice));
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSlice(node.dataset.slice);}});
    });
  }
  const paragraphs = (items) => (items || []).map(x=>`<p>${safe(x)}</p>`).join('');
  function renderCard(p) {
    const metric=p.headline;
    const tags=p.slices.map(id=>{const d=dimension(id);return `<button type="button" class="slice-tag ${d.ring}" data-slice="${safe(id)}">${safe(d.name)}</button>`;}).join('');
    const sources=p.sources.map((s,i)=>`<li><a href="${safe(s.url)}" target="_blank" rel="noopener noreferrer">${i+1}. ${safe(s.title)} ↗</a><small>${safe(s.publisher || '')}${s.date?' · '+safe(s.date):''}</small></li>`).join('');
    return `<article class="policy-card" id="policy-${safe(p.id)}"><div class="card-main"><div class="card-top"><span class="city-label">${safe(cityName(p.city).toUpperCase())} / ${safe(p.year)}</span><span class="evidence-badge ${safe(p.tierClass)}">${safe(p.tierLabel)}</span></div><h3>${safe(p.title)}</h3><p class="policy-sub">${safe(p.jurisdiction)}</p><div class="slice-tags" aria-label="Mapped Doughnut dimensions">${tags}</div><div class="headline-block"><div><div class="metric-value">${safe(metric.value)}</div><div class="metric-unit">${safe(metric.unit)}</div></div><div><span class="claim-kind">${safe(metric.kind)}</span><p class="metric-text">${safe(metric.text)}</p><span class="metric-context">${safe(metric.context)}</span></div></div><p class="caution"><b aria-hidden="true">↳</b><span>${safe(p.caution)}</span></p></div><details><summary>Read evidence, limits & sources</summary><div class="evidence-body"><h4>The intervention</h4><p>${safe(p.mechanism)}</p><h4>What was observed</h4>${paragraphs(p.observed)}<h4>Causal interpretation</h4>${paragraphs(p.causal)}<h4>Costs, distribution & tradeoffs</h4>${paragraphs(p.tradeoffs)}<h4>Limits of the Doughnut mapping</h4>${paragraphs(p.limits)}<h4>Primary sources & research</h4><ul class="source-list">${sources}</ul><p class="source-note">Evidence tier: ${safe(p.tierLabel)}. This describes study design, not a source-quality score. Source details and full claims are preserved in the downloadable JSON.</p></div></details></article>`;
  }
  function render() {
    const list=selectedPolicies(), d=dimension(state.slice);
    el('results-context').textContent=`${cityName(state.city).toUpperCase()} / ${d?d.name.toUpperCase():'ALL DIMENSIONS'}`;
    el('results-title').textContent=d?d.name:'Policy evidence';
    el('results-count').textContent=list.length;
    el('results').innerHTML=list.length?list.map(renderCard).join(''):`<div class="empty-state"><p class="eyebrow">AN OPEN RESEARCH QUESTION</p><h3>No reviewed cases in this view.</h3><p>This study does not establish that no relevant policies or effects exist. Try another evidence lens, dimension, or place.</p><button type="button" class="reset" id="reset-empty">Reset all filters ↺</button></div>`;
    el('slice-filter').value=state.slice;
    el('slice-description').textContent=d?`${d.name}: ${d.description} Mapping is relevance, not a quantified threshold effect.`:'Select any ring segment or choose a dimension above. A policy may connect to more than one slice.';
    document.querySelectorAll('[data-city]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.city===state.city)));
    el('results').querySelectorAll('[data-slice]').forEach(b=>b.addEventListener('click',()=>setSlice(b.dataset.slice)));
    if(el('reset-empty'))el('reset-empty').addEventListener('click',()=>{state.city='all';state.slice='all';state.evidence='all';el('evidence-filter').value='all';render();});
    renderRing();
  }
  function setSlice(id){state.slice=id;render();}
  for(const ring of ['social','ecological']){
    const group=document.createElement('optgroup');group.label=ring==='social'?'Social foundation':'Ecological ceiling';
    data.dimensions.filter(d=>d.ring===ring).forEach(d=>{const o=document.createElement('option');o.value=d.id;o.textContent=d.name;group.appendChild(o);});
    el('slice-filter').appendChild(group);
  }
  document.querySelectorAll('[data-city]').forEach(b=>b.addEventListener('click',()=>{state.city=b.dataset.city;render();}));
  el('slice-filter').addEventListener('change',e=>setSlice(e.target.value));
  el('evidence-filter').addEventListener('change',e=>{state.evidence=e.target.value;render();});
  el('reset-slice').addEventListener('click',()=>setSlice('all'));
  el('total-policies').textContent=data.policies.length;
  render();
})();
