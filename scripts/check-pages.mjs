/** Serve the real artifact below /deep-fryer/ and exercise its public routes. */
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
  await mkdir('/private/tmp/deep-fryer-pages', { recursive: true }).catch(() => {});
  const screenshots = process.env.CI ? path.resolve('test-results/pages') : '/private/tmp/deep-fryer-pages';
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, 'collection.png'), fullPage: true });
  for (const portrait of release.portraits) {
    await page.goto(`${origin}${portrait.slug}/`, { waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), portrait.name);
    assert.equal(await page.locator('.indicator').count(), portrait.dimensions.reduce((n, d) => n + d.indicators.length, 0));
    assert.equal(await page.locator('.dimension').count(), portrait.dimensions.length);
    assert.ok(await page.locator('canvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0));
    if (portrait.slug === 'carmel') {
      assert.match(await page.locator('.notice').innerText(), /not an approved portrait/);
      assert.ok(await page.getByText('Monterey County proxy — not Carmel city limits', { exact: false }).count() > 0);
      await page.screenshot({ path: path.join(screenshots, 'carmel-desktop.png') });
    }
    // Check every referenced local evidence file; source websites are external.
    for (const asset of new Set(portrait.dimensions.flatMap(d => d.indicators.flatMap(i => [i.evidence_path, i.pdf_path].filter(Boolean))))) assert.equal((await page.request.get(`${origin}${asset}`)).status(), 200, asset);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['', 'nyc/', 'santa-cruz/', 'carmel/', 'monterey-county/']) {
    await page.goto(origin + route, { waitUntil: 'networkidle' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Mobile overflow: ${route}`);
  }
  await page.screenshot({ path: path.join(screenshots, 'monterey-mobile.png') });
  await page.getByRole('link', { name: 'Health', exact: true }).click();
  assert.match(page.url(), /#dim-health$/);
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ passed: true, portraits: release.portraits.length, checks: ['all public routes', 'all indicators', 'evidence links', 'draft and proxy labels', 'mobile overflow', 'dimension navigation', 'no browser errors'] }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
