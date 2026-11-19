import {tmpdir} from 'node:os';
/** Public presentation checks: the scientific snapshot is read-only. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from './chromium-path.mjs';
const root=path.resolve('dist/pages');
const server=createServer(async(req,res)=>{try{let file=path.resolve(root,`.${decodeURIComponent(new URL(req.url,'http://localhost').pathname)}`);if(file!==root&&!file.startsWith(`${root}${path.sep}`)){res.writeHead(403).end();return;}if((await stat(file)).isDirectory())file=path.join(file,'index.html');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const out=process.env.CI?path.resolve('test-results/public-design'):path.join(tmpdir(),'deep-fryer-ui-evidence');await mkdir(out,{recursive:true});
let browser;
try{
 browser=await chromium.launch({executablePath:installedChromium(chromium.executablePath())});
 const desktop=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];desktop.on('pageerror',error=>errors.push(error.message));
 await desktop.goto(`${origin}/santa-cruz/`,{waitUntil:'networkidle'});
 assert.equal(await desktop.locator('.portrait-heading .notice').count(),1);
 assert.equal(await desktop.locator('.portrait-heading .notice').evaluate(el=>el.open),false);
 assert.ok((await desktop.locator('.portrait-heading .notice').innerText()).includes('await publication review'));
 assert.match(await desktop.locator('.evidence-counts').innerText(), /21 available values · 1 data gaps/);
 await desktop.locator('.dimension-links a[href="#dim-nitrogen-phosphorus-loading"]').click();
 assert.equal(await desktop.locator('#detail-panel .dimension-score').innerText(), 'Data needed');
 assert.match(await desktop.locator('#detail-panel .evidence-caution').innerText(), /No acceptable value/);
 await desktop.locator('.panel-close').click();
 await desktop.locator('.dimension-links a[href="#dim-social-equity"]').click();
 assert.equal(await desktop.locator('#detail-panel .value').innerText(), '0.4936 Gini 0–1');
 await desktop.locator('.panel-close').click();
 await desktop.locator('.dimension-links a[href="#dim-housing"]').click();
 const housingContext = await desktop.locator('#detail-panel .panel-dimension > p').last().innerText();
 assert.match(housingContext, /1,850 was the 2024 COUNTY total, not Santa Cruz city/);
 assert.match(housingContext, /1,024.*1,023/);
 assert.doesNotMatch(housingContext, /1,850 unhoused.*city-wide|highest per-capita/i);
 await desktop.locator('.panel-close').click();
 // Exercise the actual hover call site as well as the static card and panel.
 await desktop.locator('canvas').scrollIntoViewIfNeeded();
 const box = await desktop.locator('canvas').boundingBox();
 const equityAngle = await desktop.evaluate(() => {
  const p = JSON.parse(document.getElementById('portrait-data').textContent).portraits.find(p => p.slug === 'santa-cruz');
  const social = p.dimensions.filter(d => d.ring === 'social');
  return 2 * Math.PI * (social.findIndex(d => d.slug === 'social-equity') + .5) / social.length;
 });
 await desktop.mouse.move(box.x + box.width * (.5 + .24 * Math.cos(equityAngle)), box.y + box.height * (.5 + .24 * Math.sin(equityAngle)));
 assert.match(await desktop.locator('#chart-tooltip').innerText(), /0\.4936 Gini 0–1/);
 await desktop.keyboard.press('Escape');
 await desktop.screenshot({path:path.join(out,'portrait-desktop.png')});
 await desktop.getByRole('link',{name:'Extreme Heat',exact:true}).click();
 assert.equal(await desktop.locator('#detail-panel .dimension-score').innerText(),'Unscored observation');
 assert.ok((await desktop.locator('#detail-panel .meta').innerText()).includes('proxy'));
 assert.ok(await desktop.locator('#detail-panel .sources a').first().isVisible());
 assert.ok(await desktop.locator('#detail-panel .evidence-caution').isVisible());
 assert.equal(await desktop.locator('#detail-panel .evidence-details').first().evaluate(el=>el.open),false);
 await desktop.locator('canvas').scrollIntoViewIfNeeded();await desktop.screenshot({path:path.join(out,'portrait-unscored-panel.png')});
 for (const [slug, expected] of [['bronx', '0.0009642343384170714 lb per resident per year'], ['manhattan', '7.199E-7 lbs per resident per year']]) {
  await desktop.goto(`${origin}/${slug}/`, {waitUntil:'networkidle'});
  assert.match(await desktop.locator('.dimension-links a[href="#dim-chemical-pollution"]').innerText(), new RegExp(expected.replaceAll('.', '\\.')));
  await desktop.locator('.dimension-links a[href="#dim-chemical-pollution"]').click();
  assert.equal(await desktop.locator('#detail-panel .value').first().innerText(), expected);
 }
 for(const width of [390,320]){
  const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/santa-cruz/`,{waitUntil:'networkidle'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No document overflow at ${width}`);
  const chartTop=await page.locator('canvas').evaluate(el=>el.getBoundingClientRect().top);
  assert.ok(chartTop<650,`Chart starts on the first screen at ${width}px: ${chartTop}`);
  assert.ok((await page.locator('#chart-hover').innerText()).startsWith('Tap'),'Touch instructions never require hover');
  assert.ok(await page.locator('.dimension-links a').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().height>=44)));
  assert.ok(await page.locator('.dimension-links a[data-evidence-state="unscored"]').count()>0);

  await page.screenshot({path:path.join(out,`portrait-mobile-${width}.png`)});
  await page.getByRole('link',{name:'Extreme Heat',exact:true}).click();
  assert.ok(await page.locator('#detail-panel').evaluate(el=>el.matches(':modal')));
  assert.ok(!(await page.locator('#chart-hover').innerText()).includes('Hover'));
  await page.screenshot({path:path.join(out,`portrait-evidence-mobile-${width}.png`)});
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['one collapsed preview notice','chart visible in first phone screen','touch-aware instructions','unscored vs missing controls','essential evidence visible before detail expansion','mobile dialog','source precision in cards, panels and hover','missing-data text counted as a gap','housing context matches reviewed corrections']}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
