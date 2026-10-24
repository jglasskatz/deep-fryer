/** Synthetic clone fixture only. Creates drafts and unapplied plans, never runs research. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from './chromium-path.mjs';
const url = process.env.UI_REVIEW_FIXTURE_URL;
assert.ok(url && process.env.UI_TEST_ISOLATED === '1' && ['localhost','127.0.0.1'].includes(new URL(url).hostname), 'Requires an explicit isolated local fixture');
const out = '/private/tmp/deep-fryer-high-effort-visuals';
await mkdir(out,{recursive:true});
const browser = await chromium.launch({executablePath:installedChromium(chromium.executablePath())});
try {
 const page = await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(url,{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'Review queue',exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'review-workflow-desktop.png'),fullPage:true});
 for (const width of [390,320]) {
  await page.setViewportSize({width,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Review overflow at ${width}`);
  const card=page.locator('[id^="review-"]').first();
  await card.locator('summary').filter({hasText:'Preview audit recommendations'}).click();
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,`review-workflow-mobile-${width}.png`)});
  await card.locator('summary').filter({hasText:'Preview audit recommendations'}).click();
 }
 const narrative=page.getByRole('checkbox',{name:'Include the proposed context and actions when approving this card'});
 assert.equal(await narrative.isChecked(),false,'Narrative inclusion is opt-in');
 assert.equal(await narrative.isEnabled(),true,'Verified fixture narrative can be explicitly included');
 await narrative.scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(out,'review-narrative-mobile.png')});
 if (process.env.UI_TEST_APPLY === '1') {
  await page.setViewportSize({width:1440,height:1000});
  const cards=page.locator('[id^="review-"]');
  const food=cards.filter({has:page.getByRole('heading',{name:/^Food/})});
  await food.getByText('Preview audit recommendations (1 findings)',{exact:true}).click();
  await food.getByRole('button',{name:'Apply these recommendations'}).click();
  await food.getByRole('status').filter({hasText:'Draft version'}).waitFor();
  const health=cards.filter({has:page.getByRole('heading',{name:/^Health/})});
  await health.getByText('Preview audit recommendations (1 findings)',{exact:true}).click();
  await health.getByRole('button',{name:'Apply these recommendations'}).click();
  const plan=health.getByRole('link',{name:'Inspect the new research plan'});
  await plan.waitFor();
  const planUrl=new URL(await plan.getAttribute('href'),url).href;
  const proposed=cards.filter({has:narrative});
  await proposed.locator('summary').filter({hasText:'Proposed context and actions'}).click();
  await narrative.check();
  await proposed.getByRole('button',{name:'Approve as draft',exact:true}).click();
  await proposed.getByText(/approved → v/).waitFor();
  const publish=page.getByRole('region',{name:'Publish reviewed drafts'});
  await publish.locator('summary').click();
  assert.equal(await publish.getByRole('checkbox',{checked:true}).count(),0,'Exact draft list starts unselected');
  await publish.getByRole('checkbox',{name:/Food/}).check();
  await publish.getByRole('checkbox',{name:/Income/}).check();
  assert.ok(await publish.getByText(/Will publish:.*Food/).isVisible());
  await publish.scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'review-exact-publication.png')});
  await publish.getByRole('button',{name:'Publish selected versions (2)'}).click();
  await publish.getByRole('status').filter({hasText:'2 draft versions published.'}).waitFor();
  await page.getByRole('button',{name:'Apply machine-approved findings (1 finding)',exact:true}).click();
  const sample=page.getByRole('group',{name:'Approve 1 finding in 1 dimension as drafts?'});
  const approve=sample.getByRole('button',{name:'Approve 1 finding',exact:true});
  assert.ok(await approve.isDisabled(),'Bulk approval requires the explicit sample check');
  await sample.getByRole('checkbox').check();
  await approve.click();
  const success=page.getByRole('status').filter({hasText:'Approved 1 finding into 1 draft version.'});
  await success.waitFor();
  assert.ok((await success.innerText()).includes('Nothing is published yet.'));
  assert.ok(await success.evaluate(el=>el===document.activeElement),'Success stays mounted and receives focus after the pending count reaches zero');
  await page.goto(planUrl,{waitUntil:'networkidle'});
  assert.ok((await page.locator('main').innerText()).includes('Apply'), 'Re-research produces an unapplied plan');
  await page.screenshot({path:path.join(out,'review-unapplied-plan.png')});
  console.log(JSON.stringify({passed:true,planUrl,checks:['audit edit creates draft','re-research creates unapplied plan','narrative included only with opt-in','exact selected versions published']}));
 }
 console.log('Read-only review layout and opt-in checks passed');
} finally {await browser.close();}
