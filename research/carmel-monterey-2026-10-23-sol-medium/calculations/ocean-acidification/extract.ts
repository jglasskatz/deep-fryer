/** Run from repository root: node --import tsx research/carmel-monterey-2026-10-23-sol-medium/calculations/ocean-acidification/extract.ts */
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {computeScoring,resolveThreshold} from '../../../../packages/core/src/scoring.ts';
const dir=fileURLToPath(new URL('.',import.meta.url));
const html=readFileSync(dir+'raw/california-current.html','utf8');
const settings=JSON.parse(html.match(/<script type="application\/json" data-drupal-selector="drupal-settings-json">([\s\S]*?)<\/script>/)![1]);
const chart=JSON.parse(settings.highcharts['392-0-easychart'].config);
if(chart.title.text!=='California Current Omega Aragonite'||chart.xAxis[0].title.text!=='Year')throw Error('Unexpected chart');
type AnnualPoint = { x: number; y: number; name?: string };
const points: AnnualPoint[] = chart.series[0].data;
// Explicit numeric x is the year axis. NOAA's optional name fields are erroneous sequential-month labels.
if(!Array.isArray(points)||points.length!==27||points.some((p,index)=>p?.x!==1998+index||!Number.isFinite(p.y)))throw Error('Unexpected annual coverage');
writeFileSync(dir+'annual-series.csv','year,omega_aragonite,source_name_field\n'+points.map((p)=>`${p.x},${p.y},${p.name}`).join('\n')+'\n');
const value=points.find((p)=>p.x===2024)!.y;
const result={source_url:'https://ecowatch.noaa.gov/node/392',context_url:'https://ecowatch.noaa.gov/regions/california-current',year:2024,value,unit:'Ω aragonite',method:'Official NOAA chart annual regional value, parsed directly from numeric x/y fields; no new spatial or temporal averaging.',...computeScoring(value,'ocean-acidification.aragonite-saturation',resolveThreshold('ocean-acidification.aragonite-saturation')!)};
writeFileSync(dir+'result.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
