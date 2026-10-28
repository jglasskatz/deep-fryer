import { socialPortrait, trendView, comparisonView, comparisonResult } from './longitudinal-view.js';
const data=JSON.parse(document.querySelector('#longitudinal-data').textContent);
const year=document.querySelector('#portrait-year'),social=document.querySelector('#social-portrait'),select=document.querySelector('#series-select'),trend=document.querySelector('#trend-view');
year.addEventListener('change',()=>{social.innerHTML=socialPortrait(data,year.value);document.querySelector('#year-status').textContent=`Showing exact ${year.value} observations; missing periods remain empty.`;});
select.addEventListener('change',()=>showSeries(select.value));
social.addEventListener('click',event=>{const button=event.target.closest('[data-series]');if(!button)return;select.value=button.dataset.series;showSeries(select.value);select.focus();select.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
const modes=[...document.querySelectorAll('[name=evidence-mode]')];
for(const mode of modes)mode.addEventListener('change',()=>{const modeled=mode.value==='modeled';document.querySelector('#observed-evidence').hidden=modeled;document.querySelector('#modeled-evidence').hidden=!modeled;});

const comparison=document.querySelector('#period-comparison');
function updateComparison(){comparison.querySelector('#comparison-result').innerHTML=comparisonResult(data,select.value,comparison.querySelector('#comparison-from').value,comparison.querySelector('#comparison-to').value);}
function showSeries(id){document.querySelector('#observed-evidence').hidden=false;document.querySelector('#modeled-evidence').hidden=true;document.querySelector('[name=evidence-mode][value=observed]').checked=true;select.value=id;trend.innerHTML=trendView(data,id);comparison.innerHTML=comparisonView(data,id);updateComparison();}
comparison.addEventListener('change',updateComparison);
comparison.innerHTML=comparisonView(data,select.value);updateComparison();
for(const link of document.querySelectorAll('[data-coverage-series]'))link.addEventListener('click',event=>{event.preventDefault();showSeries(link.dataset.coverageSeries);select.focus();select.scrollIntoView({block:'start'});});
