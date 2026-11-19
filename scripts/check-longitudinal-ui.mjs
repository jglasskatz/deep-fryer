import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '../apps/worker/node_modules/playwright-core/index.mjs';
import {installedChromium} from './chromium-path.mjs';
import {isRenderable,publishedArchiveName} from '../site/published-name.js';
const root=path.resolve('dist/pages');
const server=createServer(async(req,res)=>{try{let file=path.resolve(root,`.${decodeURIComponent(new URL(req.url,'http://localhost').pathname)}`);if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403).end();return;}if((await stat(file)).isDirectory())file=path.join(file,'index.html');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.txt':'text/plain; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.pdf':'application/pdf'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const out=process.env.CI?path.resolve('test-results/longitudinal'):path.join(tmpdir(),'deep-fryer-ui-evidence');await mkdir(out,{recursive:true});
let browser;
try{
 browser=await chromium.launch({executablePath:installedChromium(chromium.executablePath())});const errors=[];
 for(const width of [1440,390,320]){
  const page=await browser.newPage({viewport:{width,height:1000},isMobile:width<500,hasTouch:width<500,reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/research/argentina/`,{waitUntil:'networkidle'});
  assert.equal(await page.locator('#portrait-year').inputValue(),'2023');
  assert.ok((await page.locator('#social-portrait').innerText()).includes('H2 (Jul–Dec)'));
  assert.equal(await page.locator('#social-portrait .social-values>li').count(),4);
  assert.ok(await page.evaluate(width=>document.documentElement.scrollWidth<=width,width),`no overflow at ${width}`);
  await page.screenshot({path:path.join(out,`argentina-${width}.png`),fullPage:true});
  await page.locator('#portrait-year').selectOption('2026');assert.equal(await page.locator('#social-portrait .measure').filter({hasText:'Not available'}).count(),4);
  await page.locator('#series-select').selectOption('equality');
  assert.ok((await page.locator('#comparison-result').innerText()).includes('intervening'));
  await page.locator('#series-select').selectOption('poverty');
  assert.ok((await page.locator('.latest-notes').innerText()).includes('90% confidence interval: 30.8–33.7 %'));
  assert.ok((await page.locator('.latest-notes').innerText()).includes('Provisional estimate'));
  assert.ok((await page.locator('.latest-notes').innerText()).includes('2026 · H1 (Jan–Jun) versus 2025 · H1 (Jan–Jun)'));
  await page.locator('#comparison-from').selectOption('2');await page.locator('#comparison-to').selectOption('2026-01-01');
  assert.ok((await page.locator('#comparison-result').innerText()).includes('+0.7 percentage points'));
  assert.ok((await page.locator('#comparison-result').innerText()).includes('no significant change'));
  assert.ok((await page.locator('#comparison-result').innerText()).includes('no significance is inferred from confidence-interval overlap'));
  await page.locator('#trend-view').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:path.join(out,`argentina-poverty-${width}.png`)});
  await page.locator('.comparison').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:path.join(out,`argentina-poverty-comparison-${width}.png`)});
  await page.locator('#series-select').selectOption('material_footprint');
  const points=await page.locator('#trend-view .observed-point').count();assert.equal(points,7,'Projected material inputs never enter observed plot');
  await page.locator('#trends').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`argentina-trend-${width}.png`)});
  await page.getByLabel('Modeled references',{exact:true}).check();assert.ok(await page.locator('#modeled-evidence').isVisible());assert.ok(!await page.locator('#observed-evidence').isVisible());
  assert.ok((await page.locator('#modeled-evidence').innerText()).includes('projected components'));
  await page.locator('#social-portrait [data-series]').first().click();assert.ok(await page.locator('#observed-evidence').isVisible());assert.equal(await page.locator('#series-select').inputValue(),'life_expectancy');
  await page.getByLabel('Modeled references',{exact:true}).check();
  await page.screenshot({path:path.join(out,`argentina-modeled-${width}.png`)});
  await page.close();
 }
 // Archived web pages and scripts are served as source text: same bytes, never a live page.
 const sources=JSON.parse(await readFile(path.join(root,'research/argentina/data/portrait-series.json'),'utf8')).sources;
 const archive=await browser.newPage();archive.on('pageerror',e=>errors.push(e.message));
 const requests=[];await archive.route('**/*',route=>{requests.push(route.request().url());return route.request().url().startsWith(origin)?route.continue():route.abort();});
 await archive.goto(`${origin}/research/argentina/`,{waitUntil:'networkidle'});
 const hrefs=await archive.locator('a[href^="raw/"]').evaluateAll(links=>links.map(a=>a.getAttribute('href')));
 assert.ok(hrefs.length>0);assert.deepEqual(hrefs.filter(isRenderable),[],'No archived-source link points at a renderable name');
 for(const source of sources.filter(s=>isRenderable(s.path))){
  assert.equal((await archive.request.get(`${origin}/research/argentina/${source.path}`)).status(),404,source.path);
  const response=await archive.request.get(`${origin}/research/argentina/${publishedArchiveName(source.path)}`);
  assert.equal(response.status(),200,source.path);assert.match(response.headers()['content-type'],/^text\/plain/);
  assert.equal(createHash('sha256').update(await response.body()).digest('hex'),source.sha256,source.id);
 }
 const followed=sources.find(s=>s.id==='indec-poverty-topic');
 await archive.locator('#sources details summary').click();
 const link=archive.locator('#sources li').filter({hasText:followed.title}).first().getByRole('link',{name:'Archived page source (text)',exact:true});
 assert.equal(await link.getAttribute('href'),`${followed.path}.txt`);
 assert.equal(await archive.locator('#sources li').filter({hasText:followed.title}).first().getByRole('link',{name:`${followed.publisher} ↗`}).getAttribute('href'),followed.url,'Live original stays linked');
 requests.length=0;
 const [navigation]=await Promise.all([archive.waitForNavigation({waitUntil:'networkidle'}),link.click()]);
 assert.match(navigation.headers()['content-type'],/^text\/plain/);
 assert.equal(archive.url(),`${origin}/research/argentina/${followed.path}.txt`);
 const shown=await archive.evaluate(()=>({type:document.contentType,elements:[...document.querySelectorAll('*')].map(e=>e.localName),text:document.body.innerText}));
 assert.equal(shown.type,'text/plain');
 assert.deepEqual(shown.elements.filter(name=>!['html','head','meta','body','pre','style'].includes(name)),[],'No element of the archived page was parsed');
 assert.ok(shown.text.includes('<script'),'The archived markup is shown as text');
 assert.deepEqual(requests.filter(url=>!url.startsWith(origin)),[],'No request left the local origin');
 assert.deepEqual(requests,[`${origin}/research/argentina/${followed.path}.txt`],'The text view loads nothing else');
 await archive.close();
 const nojs=await browser.newPage({javaScriptEnabled:false});await nojs.goto(`${origin}/research/argentina/`);assert.equal(await nojs.locator('.social-values>li').count(),4);assert.ok(await nojs.locator('.trend-chart svg').isVisible());await nojs.close();
 assert.deepEqual(errors,[]);console.log('Argentina desktop/mobile, exact missing years, gap disclosure, projected-input exclusion, separate modes, archived pages served as source text and no-JS evidence passed.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
