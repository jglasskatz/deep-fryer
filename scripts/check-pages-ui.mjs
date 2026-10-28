/** Accessibility and interaction regressions for the built public portrait. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from './chromium-path.mjs';
const root = path.resolve('dist/pages');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const screenshots = process.env.CI ? path.resolve('test-results/pages-ui') : '/private/tmp/deep-fryer-high-effort-visuals';
await mkdir(screenshots, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ executablePath: installedChromium(chromium.executablePath()) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/carmel/`, { waitUntil: 'networkidle' });
  const links = page.locator('.dimension-links a');
  assert.equal(await links.count(), 21);
  assert.equal(await page.locator('.dimension-groups h3').allTextContents().then(headings => headings.join(', ')), 'Social foundation, Ecological ceiling');
  assert.ok(await links.evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height >= 44)), 'Every text control meets the 44px touch target');
  assert.equal(await page.locator('.status-legend li').count(), 5);
  assert.match(await page.locator('.status-legend').innerText(), /Slate: value available, no score/);
  assert.match(await page.locator('.status-legend').innerText(), /Grey: data needed/);
  const health = page.getByRole('link', { name: 'Health', exact: true });
  await health.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#panel-heading').innerText(), 'Health');
  assert.equal(await page.locator('.dimension-links a:visible').count(), 21);
  assert.equal(await health.getAttribute('aria-current'), 'true');
  assert.equal(await page.locator('#panel-heading').evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await health.evaluate(node => node === document.activeElement), true, 'Closing keyboard-opened panel returns focus to its dimension');
  await page.keyboard.press('Enter');
  const housing = page.getByRole('link', { name: 'Housing', exact: true });
  await housing.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#panel-heading').innerText(), 'Housing', 'Another dimension remains reachable while the panel is open');
  assert.equal(await health.getAttribute('aria-current'), null);
  await page.locator('canvas').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshots, 'after-desktop-panel.png') });
  await page.keyboard.press('Escape');
  await page.locator('.dimension-explorer').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshots, 'after-desktop-dimensions.png') });
  // Same-document history must restore the dimension, even if the area did not change.
  await page.evaluate(() => {
    history.pushState(null, '', '?dim=health');
    history.pushState(null, '', '?dim=housing');
  });
  await page.goBack();
  await page.waitForFunction(() => document.getElementById('panel-heading')?.textContent === 'Health');
  await page.goForward();
  await page.waitForFunction(() => document.getElementById('panel-heading')?.textContent === 'Housing');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${origin}/carmel/`, { waitUntil: 'networkidle' });
    await health.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#detail-panel').evaluate(node => node.matches(':modal')), true);
    assert.equal(await page.locator('#panel-heading').evaluate(node => node === document.activeElement), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(screenshots, `after-mobile-panel-${width}.png`) });
    await page.keyboard.press('Escape');
    assert.equal(await health.evaluate(node => node === document.activeElement), true);
    await page.locator('.dimension-explorer').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshots, `after-mobile-dimensions-${width}.png`) });
  }
  await page.goto(`${origin}/monterey-county/?dim=extreme-heat`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.panel-dimension .dimension-score').innerText(), 'Unscored observation');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['persistent grouped dimension controls', '44px targets', 'status words and legend', 'keyboard switching and focus return', 'same-area dimension history', '320px and 390px modal focus', 'unscored observations'] }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
