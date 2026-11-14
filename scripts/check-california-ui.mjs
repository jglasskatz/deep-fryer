/** Offline regression of the built artifact. Never installs a browser or fetches sources. */
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from './chromium-path.mjs';
const root = path.resolve('dist/pages');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/deep-fryer/')) { res.writeHead(404).end(); return; }
    let file = path.resolve(root, pathname.slice('/deep-fryer/'.length));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/deep-fryer/california/`;
const screenshots = path.resolve('test-results/california');
let browser;
try {
  browser = await chromium.launch({ executablePath: installedChromium(chromium.executablePath()) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(response.url()); });
  await page.goto(`${origin}/deep-fryer/`, { waitUntil: 'networkidle' });
  await page.locator('.card[href="california/"]').click();
  assert.equal(await page.locator('h1').innerText(), 'State of California');
  assert.equal(await page.locator('.dimension').count(), 21);
  assert.equal(await page.locator('.dimension .indicator').count(), 42);
  assert.match(await page.locator('.notice').innerText(), /not newly verified or approved/);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, 'california-desktop.png'), fullPage: true });
  const panel = page.locator('#detail-panel');
  const indicator = name => panel.locator('.indicator').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const open = async name => { await page.getByRole('link', { name, exact: true }).click(); assert.equal(await panel.isVisible(), true); };
  const close = async () => { await page.getByRole('button', { name: 'Close dimension details' }).click(); assert.equal(await panel.isVisible(), false); };
  await open('Climate Change');
  assert.equal(await panel.locator('.indicator').count(), 2);
  const ghg = indicator('Greenhouse Gas Footprint');
  assert.equal(await ghg.locator('.value').innerText(), '1890%');
  assert.match(await ghg.locator('.source-worksheet').innerText(), /19.6 Tonnes CO2 eq/);
  assert.doesNotMatch(await ghg.innerText(), /1890% Tonnes/);
  assert.equal(await ghg.locator('.target').count(), 0);
  assert.equal(new URL(page.url()).searchParams.get('dim'), 'climate-change');
  await open('Climate Change');
  await page.screenshot({ path: path.join(screenshots, 'california-climate-desktop.png') });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await panel.isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await panel.isVisible(), false);
  assert.equal(new URL(page.url()).searchParams.has('dim'), false);
  await open('Ozone Depletion');
  assert.match(await panel.innerText(), /score unknown/);
  const ods = indicator('Ozone-Depleting Substances');
  assert.equal(await ods.locator('.value').innerText(), 'Yes');
  assert.equal(await ods.locator('.imported-percentage').innerText(), 'Source category average (not indicator overshoot): 0%');
  const ozone = indicator('Ozone Layer');
  assert.equal(await ozone.locator('.value').innerText(), '284 Dobson Units');
  assert.equal(await ozone.locator('.imported-percentage').count(), 0);
  assert.match(await ozone.innerText(), /Global observation/);
  await close();
  await open('Biodiversity Loss');
  const protectedArea = indicator('Protected Area');
  assert.equal(await protectedArea.locator('.value').innerText(), '25.2% / 16.2%');
  assert.equal(await protectedArea.locator('.imported-percentage').innerText(), 'Source category average (not indicator overshoot): 503%');
  assert.match(await protectedArea.locator('.meta').first().innerText(), /^Source value/);
  assert.equal(await indicator('At-Risk Species').locator('.imported-percentage').count(), 0);
  await close();
  await open('Income & Work');
  assert.match(await indicator('Poverty').locator('.source-worksheet').innerText(), /2021-2023 \/ 2024/);
  await close();
  await open('Education');
  assert.match(await indicator('Literacy Rate').locator('.source-worksheet').innerText(), /2017 \/ 2018\?/);
  await close();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(url, { waitUntil: 'networkidle' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
    if (width === 390) await page.screenshot({ path: path.join(screenshots, 'california-mobile.png'), fullPage: true });
    await page.getByRole('link', { name: 'Food', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await panel.evaluate(el => el.matches(':modal')), true);
    assert.equal(await panel.locator('.indicator').count(), 2);
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), 'No panel overflow');
    if (width === 390) await page.screenshot({ path: path.join(screenshots, 'california-food-mobile.png') });
    await close();
  }
  for (const file of ['doughnut.json', 'raw_social.csv', 'raw_ecological.csv', 'manifest.json']) assert.equal((await page.request.get(`${origin}/deep-fryer/imports/california/${file}`)).status(), 200);
  const noJsContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  await noJsContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const noJs = await noJsContext.newPage();
  await noJs.goto(url, { waitUntil: 'networkidle' });
  assert.equal(await noJs.locator('.dimension .indicator').count(), 42);
  assert.equal(await noJs.locator('#dim-food').isVisible(), true);
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  console.log('California UI passed: desktop/mobile, native units, exact fallback scores, unknown/zero, full periods, keyboard/repeat/reload/Close/Escape, source downloads and no-JS.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
