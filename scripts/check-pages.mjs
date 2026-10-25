/** Serve the real artifact below /deep-fryer/ and exercise its public routes. */
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from './chromium-path.mjs';
import { indicatorAssets } from './pages-contract.mjs';
const root = path.resolve('dist/pages');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/deep-fryer/')) { res.writeHead(404).end(); return; }
    let filename = path.resolve(root, pathname.slice('/deep-fryer/'.length));
    if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf' };
    res.setHeader('Content-Type', types[path.extname(filename)] ?? 'application/octet-stream');
    res.end(await readFile(filename));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}/deep-fryer/`;
let browser;
try {
  browser = await chromium.launch({ executablePath: installedChromium(chromium.executablePath()) });
  const page = await browser.newPage();
  const errors = [];
  const failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().startsWith(origin) && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto(origin, { waitUntil: 'networkidle' });
  const release = await (await page.request.get(`${origin}data/portraits.json`)).json();
  assert.equal(await page.locator('.card').count(), release.portraits.length);
  assert.equal(Object.hasOwn(release, 'cost_scenarios'), false, 'Public download excludes internal research accounting');
  assert.equal(await page.getByRole('heading', { name: 'Research costs', exact: true }).count(), 0);
  assert.equal(await page.locator('a[href*="api/docs/pricing"]').count(), 0);
  await mkdir('/private/tmp/deep-fryer-pages', { recursive: true }).catch(() => {});
  const screenshots = process.env.CI ? path.resolve('test-results/pages') : '/private/tmp/deep-fryer-pages';
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, 'collection.png'), fullPage: true });
  for (const portrait of release.portraits) {
    await page.goto(`${origin}${portrait.slug}/`, { waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), portrait.name);
    assert.equal(await page.locator('.indicator').count(), portrait.dimensions.reduce((n, d) => n + d.indicators.length, 0));
    assert.equal(await page.locator('.dimension').count(), portrait.dimensions.length);
    assert.equal(await page.getByRole('heading', { name: 'Possible actions', exact: true }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'Ways to get involved', exact: true }).count(), portrait.dimensions.filter(d => d.actions?.length).length);
    assert.ok(await page.locator('canvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0));
    if (portrait.slug === 'carmel') {
      assert.match((await page.locator('.notice').allTextContents()).join(' '), /does not approve the amendments/);
      assert.equal(await page.locator('.portrait-heading .research-preview').innerText(), 'Updated research preview');
      assert.ok(await page.getByText('Monterey County proxy — not Carmel city limits', { exact: false }).count() > 0);
      await page.screenshot({ path: path.join(screenshots, 'carmel-desktop.png') });
    }
    // Check every referenced local evidence file; source websites are external.
    for (const asset of new Set(portrait.dimensions.flatMap(d => d.indicators.flatMap(indicatorAssets)))) assert.equal((await page.request.get(`${origin}${asset}`)).status(), 200, asset);
  }
  await page.goto(`${origin}carmel/`, { waitUntil: 'networkidle' });
  const canvas = page.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  const carmel = release.portraits.find(p => p.slug === 'carmel');
  const social = carmel.dimensions.filter(d => d.ring === 'social');
  const angle = Math.PI / social.length;
  const segment = { x: bounds.x + bounds.width * (.5 + .24 * Math.cos(angle)), y: bounds.y + bounds.height * (.5 + .24 * Math.sin(angle)) };
  await page.mouse.move(segment.x, segment.y);
  assert.equal(await page.locator('#chart-tooltip').isVisible(), true);
  assert.ok((await page.locator('#chart-tooltip').innerText()).includes(social[0].name));
  for (const indicator of social[0].indicators) assert.ok((await page.locator('#chart-tooltip').innerText()).includes(String(indicator.value ?? 'Data needed')));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#chart-tooltip').isVisible(), false);
  const beforeClick = await page.evaluate(() => scrollY);
  await page.mouse.click(segment.x, segment.y);
  assert.equal(await page.locator('#detail-panel').isVisible(), true);
  assert.equal(await page.locator('#panel-heading').innerText(), social[0].name);
  assert.equal(await page.locator('#detail-panel .indicator').count(), social[0].indicators.length);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - beforeClick) < 2, 'Canvas selection must not scroll the page');
  await page.mouse.click(segment.x, segment.y);
  assert.equal(await page.locator('#detail-panel').isVisible(), true, 'Repeated click keeps the panel open');
  await page.screenshot({ path: path.join(screenshots, 'dimension-side-panel.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#detail-panel').isVisible(), false, 'Escape closes the desktop panel');
  await page.mouse.click(segment.x, segment.y);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.getElementById('detail-panel').matches(':modal'));
  await page.screenshot({ path: path.join(screenshots, 'dimension-mobile-panel.png') });
  await page.getByRole('button', { name: 'Close dimension details' }).click();
  assert.equal(await page.locator('#detail-panel').isVisible(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['', 'nyc/', 'santa-cruz/', 'carmel/', 'monterey-county/']) {
    await page.goto(origin + route, { waitUntil: 'networkidle' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Mobile overflow: ${route}`);
  }
  await page.screenshot({ path: path.join(screenshots, 'monterey-mobile.png') });
  for (const [hub, target] of [['carmel', 'monterey-county'], ['nyc', 'manhattan'], ['santa-cruz', 'watsonville']]) {
    await page.goto(`${origin}${hub}/`, { waitUntil: 'networkidle' });
    const portrait = release.portraits.find(p => p.slug === target);
    await page.locator(`.portrait-switcher a[data-portrait="${target}"]`).click();
    assert.equal(new URL(page.url()).pathname, `/deep-fryer/${hub}/`);
    assert.equal(new URL(page.url()).searchParams.get('area'), target);
    assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), portrait.name);
    assert.equal(await page.locator('.indicator').count(), portrait.dimensions.reduce((n, d) => n + d.indicators.length, 0));
    assert.equal(await page.locator('.portrait-switcher [aria-current="page"]').getAttribute('data-portrait'), target);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), portrait.name, 'Selection survives reload');
    await page.goBack({ waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), release.portraits.find(p => p.slug === hub).name);
    await page.goForward({ waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), portrait.name, 'Forward restores selection');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Selector overflow: ${hub}`);
  }
  await page.goto(`${origin}carmel/?area=monterey-county`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(screenshots, 'regional-selector-mobile.png') });
  await page.getByRole('link', { name: 'Health', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('dim'), 'health');
  assert.equal(await page.locator('#detail-panel').isVisible(), true);
  assert.equal(await page.locator('#panel-heading').innerText(), 'Health');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), 'Monterey County');
  assert.equal(await page.locator('#detail-panel').isVisible(), true, 'Selected evidence panel survives reload');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#detail-panel').isVisible(), false);
  await page.goto(`${origin}carmel/?area=monterey-county&dim=extreme-heat`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#panel-heading').innerText(), 'Extreme Heat');
  assert.match(await page.locator('#detail-panel').innerText(), /Observed · no scoring target/);
  assert.match(await page.locator('#detail-panel').innerText(), /Unscored:/);
  assert.equal(await page.locator('#detail-panel').getByText('Scoring calculation', { exact: true }).count(), 0);
  assert.equal(await page.locator('a[href="#dim-ozone-depletion"]').count(), 0);
  await page.screenshot({ path: path.join(screenshots, 'extreme-heat-observation.png') });
  await page.goto(`${origin}carmel/?area=monterey-county#dim-health`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => { const top = document.getElementById('dim-health').getBoundingClientRect().top; return top >= 0 && top < 100; }, null, { timeout: 10000 }).catch(async error => {
    console.error(await page.evaluate(() => ({ url: location.href, scrollY, healthTop: document.getElementById('dim-health').getBoundingClientRect().top, height: document.documentElement.scrollHeight })));
    throw error;
  });
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const fallback = await noScript.newPage();
  await fallback.goto(`${origin}santa-cruz/`);
  await fallback.getByRole('navigation', { name: 'Santa Cruz portraits' }).getByRole('link', { name: 'City of Watsonville' }).click();
  assert.equal(await fallback.getByRole('heading', { level: 1 }).innerText(), 'City of Watsonville');
  await noScript.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ passed: true, portraits: release.portraits.length, checks: ['all public routes', 'all indicators', 'evidence links', 'draft and proxy labels', 'mobile overflow', 'regional selection and history', 'deep links and reload', 'no-JavaScript navigation', 'no browser errors'] }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
