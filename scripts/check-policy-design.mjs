import {tmpdir} from 'node:os';
/** Read-only visual check against an explicitly supplied synthetic local policy analysis. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import{chromium}from'../apps/worker/node_modules/playwright-core/index.mjs';
import{installedChromium}from'./chromium-path.mjs';
const url=process.env.POLICY_UI_FIXTURE_URL;
if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw new Error('Set POLICY_UI_FIXTURE_URL to a synthetic localhost analysis; this check never creates an analysis.');
const out=process.env.CI?path.resolve('test-results/policy-design'):path.join(tmpdir(),'deep-fryer-ui-evidence');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:installedChromium(chromium.executablePath())});
try{const errors=[];for(const width of[1440,390,320]){
 const p=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});p.on('pageerror',e=>errors.push(e.message));await p.goto(url,{waitUntil:'networkidle'});
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const baseline=p.getByRole('button',{name:'Analysis baseline',exact:true}),scenario=p.getByRole('button',{name:'Modeled scenario',exact:true});
 assert.equal(await baseline.getAttribute('aria-pressed'),'true');assert.ok(await p.getByRole('button',{name:'Play animation',exact:true}).isVisible());
 await p.waitForTimeout(1400);assert.equal(await baseline.getAttribute('aria-pressed'),'true','Baseline remains static without requested playback');
 await scenario.click();assert.equal(await scenario.getAttribute('aria-pressed'),'true');await baseline.click();
 assert.ok((await p.locator('main').innerText()).includes('2027'));assert.ok((await p.locator('main').innerText()).includes('Supplied range'));
 await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await p.screenshot({path:path.join(out,`policy-${width}.png`),fullPage:true});await p.close();
 }assert.deepEqual(errors,[]);console.log('Policy desktop/mobile, reduced-motion static baseline, manual scenario controls and dated uncertainty evidence passed.');
}finally{await browser.close();}
