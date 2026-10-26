const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const dir=require('node:path').resolve(__dirname, '../../../site/policy-view');
class Element {
 constructor(id=''){this.id=id;this.innerHTML='';this.textContent='';this.value='';this.dataset={};this.events={};this.children=[];this.attrs={};}
 addEventListener(type,fn){this.events[type]=fn;}
 setAttribute(k,v){this.attrs[k]=v;}
 appendChild(el){this.children.push(el);}
 querySelectorAll(sel){return [...this.innerHTML.matchAll(/data-slice="([^"]+)"/g)].map(m=>{const e=new Element();e.dataset.slice=m[1];return e;});}
 fire(type,target=this){this.events[type]({target,preventDefault(){}});}
}
const ids=['results','doughnut','results-context','results-title','results-count','slice-filter','slice-description','evidence-filter','reset-slice','total-policies'];
const els=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
const buttons=['all','nyc','santa-cruz'].map(id=>{const e=new Element();e.dataset.city=id;return e;});
const document={getElementById:id=>els[id]??null,querySelectorAll:s=>s==='[data-city]'?buttons:[],createElement:()=>new Element()};
const context={window:{},document};vm.createContext(context);
vm.runInContext(fs.readFileSync(dir+'/policy-data.js','utf8'),context);
vm.runInContext(fs.readFileSync(dir+'/policy-view.js','utf8'),context);
const count=()=>Number(els['results-count'].textContent);
const cards=()=>[...els.results.innerHTML.matchAll(/class="policy-card"/g)].length;
assert.equal(count(),10);assert.equal(cards(),10);
assert.equal((els.doughnut.innerHTML.match(/class="ring-segment/g)||[]).length,21);
assert.equal(els['slice-filter'].children.reduce((n,e)=>n+e.children.length,0),21);
buttons[1].fire('click');assert.equal(count(),5);assert.equal(cards(),5);assert.equal(buttons[1].attrs['aria-pressed'],'true');
buttons[2].fire('click');assert.equal(count(),5);assert.equal(cards(),5);
els['evidence-filter'].value='causal';els['evidence-filter'].fire('change');assert.equal(count(),0);assert.match(els.results.innerHTML,/No reviewed cases/);
buttons[0].fire('click');assert.equal(count(),4);
els['evidence-filter'].value='all';els['evidence-filter'].fire('change');
for(const d of context.window.POLICY_DATA.dimensions){els['slice-filter'].value=d.id;els['slice-filter'].fire('change');assert.equal(count(),context.window.POLICY_DATA.policies.filter(p=>p.slices.includes(d.id)).length);}
els['reset-slice'].fire('click');assert.equal(count(),10);
const report='PASS: dependency-free JavaScript state test. Initial10 cases;21 ring segments/options;NYC5;SC5;quasi-experimental4;SC causal lens empty state;all21 dimension filters match data;reset restores10. This is a DOM-stub logic test, not a browser layout/accessibility verification.\n';
fs.writeFileSync('/workspace/shared/policy_study/qa/ui-state-test-result.txt',report);process.stdout.write(report);
