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
 await desktop.screenshot({path:path.join(out,'portrait-desktop.png')});
 await desktop.getByRole('link',{name:'Extreme Heat',exact:true}).click();
 assert.equal(await desktop.locator('#detail-panel .dimension-score').innerText(),'Unscored observation');
 assert.ok((await desktop.locator('#detail-panel .meta').innerText()).includes('proxy'));
 assert.ok(await desktop.locator('#detail-panel .sources a').first().isVisible());
 assert.ok(await desktop.locator('#detail-panel .evidence-caution').isVisible());
 assert.equal(await desktop.locator('#detail-panel .evidence-details').first().evaluate(el=>el.open),false);
 await desktop.locator('canvas').scrollIntoViewIfNeeded();await desktop.screenshot({path:path.join(out,'portrait-unscored-panel.png')});
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
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['one collapsed preview notice','chart visible in first phone screen','touch-aware instructions','unscored vs missing controls','essential evidence visible before detail expansion','mobile dialog']}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
