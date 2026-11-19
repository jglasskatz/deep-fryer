/** Offline regression of the built San Francisco route. Never installs a browser or fetches sources. */
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from './chromium-path.mjs';
import { sanFranciscoSource, dimensionSlug } from './san-francisco-import.mjs';
const root = path.resolve('dist/pages');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/deep-fryer/')) { res.writeHead(404).end(); return; }
    let file = path.resolve(root, pathname.slice('/deep-fryer/'.length));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/deep-fryer/san-francisco/`;
const screenshots = process.env.CI ? path.resolve('test-results/san-francisco') : '/private/tmp/deep-fryer-pages/san-francisco';
// Expected states come from the fork's own levels, read as data from the pinned file.
const { jurisdictions } = sanFranciscoSource();
const forkRows = ['social', 'ecological'].flatMap(ring => jurisdictions.city_san_francisco[ring]);
const expectedState = Object.fromEntries(forkRows.map(row => [dimensionSlug(row.name), row.level <= 0 ? 'within' : 'outside']));
const expectedWithin = Object.values(expectedState).filter(state => state === 'within').length;
const expectedOutside = Object.values(expectedState).filter(state => state === 'outside').length;
assert.equal(expectedWithin + expectedOutside, 21);
let browser;
try {
  await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ executablePath: installedChromium(chromium.executablePath()) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  // The portrait must stand on its own files; an outside request is a failure, not a dependency.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });

  await page.goto(`${origin}/deep-fryer/`, { waitUntil: 'networkidle' });
  const card = page.locator('a.card[href="san-francisco/"]');
  assert.equal(await card.count(), 1);
  assert.match(await card.innerText(), /Existing source portrait[\s\S]*City of San Francisco/);
  assert.equal(await page.getByText('SoMa', { exact: false }).count(), 0, 'The copied SoMa portrait is not published');

  await page.goto(url, { waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), 'City of San Francisco');
  const notice = page.locator('#selected-portrait .notice');
  assert.equal(await notice.getAttribute('open'), '', 'The import notice starts open');
  const noticeText = await notice.innerText();
  assert.match(noticeText, /Community data · not checked or approved here/);
  assert.match(noticeText, /community member in a fork of the Santa Cruz doughnut project/);
  assert.match(noticeText, /figures, targets and scores are the fork author’s/);
  assert.match(noticeText, /have not been researched, checked against their sources or approved here/);
  assert.match(noticeText, /Source links lead to publishers’ websites, and no archived evidence is available/);
  assert.match(noticeText, /SoMa portrait is not included, because its rows are still those of the Watsonville portrait/);
  // Known issues are recorded for the fork's author, not shown to readers.
  assert.doesNotMatch(await page.locator('main').innerText(), /placeholder|withheld|not shown/i);
  for (const [label, href] of [['Original data file', '../imports/san-francisco/data.js'], ['Import record', '../imports/san-francisco/manifest.json']]) {
    assert.equal(await notice.getByRole('link', { name: label, exact: true }).getAttribute('href'), href);
    assert.equal((await page.request.get(new URL(href, url).href)).status(), 200);
  }
  assert.match(await notice.getByRole('link', { name: 'Pinned commit ↗' }).getAttribute('href'), /^https:\/\/github\.com\/BioKyle\/doughnut-san-francisco-v1\/tree\/5cce9f1cc476052b88c316d847926e0ad34b4b00$/);

  const links = page.locator('#selected-portrait .dimension-links a');
  assert.equal(await links.count(), 21);
  // Every dimension keeps the fork's score: none is unscored, and the counts follow the fork's levels.
  for (const [slug, state] of Object.entries(expectedState)) {
    assert.equal(await page.locator(`#selected-portrait .dimension-links a[href="#dim-${slug}"]`).getAttribute('data-evidence-state'), state, slug);
  }
  assert.equal(await page.locator('#selected-portrait .dimension-links a[data-evidence-state="within"]').count(), expectedWithin);
  assert.equal(await page.locator('#selected-portrait .dimension-links a[data-evidence-state="outside"]').count(), expectedOutside);
  assert.equal(await page.locator('#selected-portrait .dimension-links a[data-evidence-state="unscored"], #selected-portrait .dimension-links a[data-evidence-state="unknown"]').count(), 0);
  assert.match(await page.locator('#dim-peace-justice .indicator').innerText(), /Projected Synthesis/);
  // A closed <details> exposes only its summary to innerText.
  assert.match(await page.locator('#selected-portrait .chart-explanation').textContent(), /Wedges show the scores the source project assigned\./);
  assert.ok(await page.locator('canvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0));

  await page.getByRole('link', { name: 'housing', exact: true }).click();
  assert.match(await page.locator('#panel-heading').innerText(), /housing/i);
  assert.match(await page.locator('#detail-panel').innerText(), /61\.6%[\s\S]*ACS\/Housing Needs Assessment/);
  assert.match(page.url(), /dim=housing/);
  await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: false });
  await page.keyboard.press('Escape');

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await phone.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const mobile = await phone.newPage();
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(url, { waitUntil: 'networkidle' });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No horizontal overflow at 390px');
  await mobile.screenshot({ path: path.join(screenshots, 'mobile.png'), fullPage: true });

  const plain = await browser.newContext({ javaScriptEnabled: false });
  const nojs = await plain.newPage();
  await nojs.goto(url);
  assert.equal(await nojs.locator('.dimension').count(), 21, 'Every dimension is readable without JavaScript');

  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(`San Francisco UI passed: collection card, open import notice, source downloads, ${expectedWithin} within and ${expectedOutside} outside as the fork scores them, nothing withheld, SoMa absent, panel and deep link, 390px, no-JS.`);
} finally {
  await browser?.close();
  server.close();
}
