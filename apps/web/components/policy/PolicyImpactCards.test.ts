import React, {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import {IndicatorEstimate,PolicyImpactCards} from './PolicyImpactCards';
import {PolicyDoughnut} from './PolicyDoughnut';
import type {ImpactRow} from '@/lib/policy';
vi.stubGlobal('React', React);
const row:ImpactRow={impact:{dimension_slug:'housing',direction:'improves',magnitude:'small',confidence:'low',rationale:'An assumption to review.',sources:[]},unquantified:[],change:{indicator:'Rent burden',unit:'%',current_value:40,current_year:2023,projected_value:35,projected_year:2028}};
describe('policy estimate presentation',()=>{
 it('labels observed baseline date separately from modeled year without inventing an interval',()=>{
  const html=renderToStaticMarkup(createElement(IndicatorEstimate,{row}));
  expect(html).toContain('Analysis baseline · 2023');expect(html).toContain('Modeled estimate · 2028');expect(html).toContain('No uncertainty interval was supplied');expect(html).toContain('40%');expect(html).toContain('35%');
 });
 it('retains the supplied range and its interpretation',()=>{
  const html=renderToStaticMarkup(createElement(IndicatorEstimate,{row:{...row,change:{...row.change!,uncertainty:{lower:31,upper:39,method:'Sensitivity range, not a confidence interval.'}}}}));
  expect(html).toContain('31% to 39%');expect(html).toContain('Sensitivity range, not a confidence interval.');expect(html).not.toContain('No uncertainty interval');
 });
 it('starts the comparison static and names the baseline honestly',()=>{
  const html=renderToStaticMarkup(createElement(PolicyDoughnut,{dimensions:[],ariaLabel:'Policy test',summary:'Modeled comparison'}));
  expect(html).toContain('Play animation');expect(html).not.toContain('Pause animation');expect(html).toContain('Analysis baseline');expect(html).toContain('Modeled scenario');expect(html).not.toContain('Today');
 });
 it('shows arithmetic conflicts without discarding the quantified value',()=>{
  const html=renderToStaticMarkup(createElement(IndicatorEstimate,{row:{...row,warnings:['The stated direction conflicts with its threshold arithmetic.']}}));
  expect(html).toContain('Review note:');expect(html).toContain('stated direction conflicts');expect(html).toContain('35%');
 });
 it('discloses mixed horizons and leaves a common horizon unflagged',()=>{
  const group={slug:'housing',name:'Housing',direction:'improves' as const,currentViz:80,projectedViz:70,wedge:null,rows:[row,{...row,change:{...row.change!,projected_year:2050}}]};
  const html=renderToStaticMarkup(createElement(PolicyImpactCards,{groups:[group],onDoughnut:['housing']}));
  expect(html).toContain('Mixed projection years: 2028, 2050');expect(html).toContain('not a portrait of one future year');
  expect(renderToStaticMarkup(createElement(PolicyImpactCards,{groups:[{...group,rows:[row,row]}],onDoughnut:['housing']}))).not.toContain('Mixed projection years');
 });
});
