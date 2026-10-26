/** Offline browser smoke for the built policy atlas, not private hosting or live AI. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from './chromium-path.mjs';
const root=path.resolve('dist/pages');
const server=createServer(async(req,res)=>{
 try {const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(!pathname.startsWith('/deep-fryer/')){res.writeHead(404).end();return;}
 let file=path.resolve(root,pathname.slice('/deep-fryer/'.length));if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 if((await stat(file)).isDirectory())file=path.join(file,'index.html');
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]??'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404).end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`,url=`${origin}/deep-fryer/policies/`;
const screenshots=path.resolve('test-results/policy-evaluator');await mkdir(screenshots,{recursive:true});
let browser;
try{
 browser=await chromium.launch({executablePath:installedChromium(chromium.executablePath())});
 const context=await browser.newContext({viewport:{width:1360,height:1000},acceptDownloads:true});
 const external=[];await context.route('**/*',route=>{const target=route.request().url();if(target.startsWith(origin+'/')||target.startsWith('blob:')||target.startsWith('data:'))return route.continue();external.push(target);return route.abort();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'networkidle'});
 assert.equal(await page.locator('#policy-lookup option').count(),10);
 assert.equal(await page.locator('#impact-doughnut .impact-wedge').count(),21);
 assert.match(await page.locator('#evaluation-title').innerText(),/school meals/i);
 assert.match(await page.locator('.evaluation-map').innerText(),/Social foundation.*progress points outward/s);
 assert.match(await page.locator('.evaluation-map').innerText(),/Ecological ceiling.*progress points inward/s);
 const graphs=JSON.parse(await readFile(path.join(root,'policies/impact-graph.json'),'utf8')).graphs;
 for(const graph of graphs){await page.locator('#policy-lookup').selectOption(graph.policyId);assert.equal(await page.locator('#evaluation-title').innerText(),graph.title);assert.equal(await page.locator('#impact-details .impact-edge').count(),graph.edges.length);}
 await page.locator('#lookup-query').fill('zz-no-curated-match-zz');assert.equal(await page.locator('#evaluation-output').isVisible(),false);assert.match(await page.locator('#lookup-count').innerText(),/No curated match/);
 await page.locator('#lookup-query').fill('school meals');assert.equal(await page.locator('#evaluation-output').isVisible(),true);
 const lines=await page.locator('#impact-doughnut line[marker-end]').evaluateAll(nodes=>nodes.map(n=>{const x1=+n.getAttribute('x1')-250,y1=+n.getAttribute('y1')-250,x2=+n.getAttribute('x2')-250,y2=+n.getAttribute('y2')-250;return {from:Math.hypot(x1,y1),to:Math.hypot(x2,y2)};}));
 assert.ok(lines.length>=2&&lines.every(l=>l.to>l.from),'School-meal social improvement arrows point outward');
 await page.locator('#lookup-query').fill('water rationing');
 const eco=await page.locator('#impact-doughnut line[marker-end]').evaluateAll(nodes=>nodes.map(n=>({from:Math.hypot(+n.getAttribute('x1')-250,+n.getAttribute('y1')-250),to:Math.hypot(+n.getAttribute('x2')-250,+n.getAttribute('y2')-250)})));
 assert.ok(eco.some(l=>l.from>170&&l.to<l.from),'Water ecological improvement arrow points inward');
 await page.locator('#evaluator').screenshot({path:path.join(screenshots,'retrospective-desktop.png')});
 await page.getByRole('button',{name:'Explore a proposed policy'}).focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('#scenario-form').isVisible(),true);assert.equal(await page.locator('#evaluation-output').isVisible(),false);
 await page.locator('#scenario-policy').fill('School meals pilot');await page.locator('#scenario-analog').selectOption('nyc-universal-school-meals');await page.locator('#scenario-text').fill('A proposed expansion; test inputs only.');await page.locator('#scenario-geography').fill('Test town');await page.locator('#scenario-group').fill('Students');await page.locator('#scenario-horizon').fill('2028–2030');await page.locator('#scenario-comparator').fill('No expansion');await page.locator('#scenario-assumption').fill('Assume comparable uptake; test transportability.');
 await page.getByRole('button',{name:'Build conditional impact map'}).click();
 assert.match(await page.locator('#evaluation-kind').innerText(),/NOT A FORECAST/);assert.equal(await page.locator('#impact-details .native-value').count(),0);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export this evaluation'}).click();const download=await downloadPromise;
 const exported=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(exported.geography,'Test town');assert.equal(exported.edges.every(e=>e.evidence==='inferred'&&e.magnitude===null),true);assert.equal(exported.edges.find(e=>e.slice==='health').direction,'unknown');
 await page.getByRole('button',{name:'Look up a past policy'}).click();await page.getByRole('button',{name:'Explore a proposed policy'}).click();assert.equal(await page.locator('#evaluation-output').isVisible(),false,'Switching modes clears stale claims');
 for(const width of [390,768]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Scenario mobile overflow at ${width}`);await page.getByRole('button',{name:'Look up a past policy'}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Lookup mobile overflow at ${width}`);await page.locator('#evaluator').screenshot({path:path.join(screenshots,`lookup-${width}.png`)});await page.getByRole('button',{name:'Explore a proposed policy'}).click();}
 assert.deepEqual(errors,[]);assert.deepEqual(external,[],'Smoke test must not contact external sites or model APIs');
 console.log('PASS: policy evaluator browser smoke — 10 cases, 21 slices, opposite radial arrows, keyboard mode switch, no-match recovery, conditional scenario/export, repeated modes, mobile overflow, offline network boundary.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
