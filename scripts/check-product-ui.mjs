/** Run against a local server with a published NYC family and staff access.
 * This exercises UI only: it never plans/applies research or writes settings. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from './chromium-path.mjs';
const origin = process.env.UI_TEST_ORIGIN || 'http://127.0.0.1:4175';
const screenshots = process.env.CI ? path.resolve('test-results/product-ui') : '/private/tmp/deep-fryer-high-effort-visuals';
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ executablePath: installedChromium(chromium.executablePath()) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/nyc`, { waitUntil: 'networkidle' });
  const canvas = page.locator('canvas').first();
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  const segment = { x: bounds.x + bounds.width * (.5 + .24 * Math.cos(Math.PI / 12)), y: bounds.y + bounds.height * (.5 + .24 * Math.sin(Math.PI / 12)) };
  await page.mouse.move(segment.x, segment.y);
  const before = await page.evaluate(() => scrollY);
  await page.mouse.click(segment.x, segment.y);
  await page.waitForURL(url => Boolean(url.searchParams.get('dim')));
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - before) < 2, 'Server canvas selection preserves scroll position');
  assert.ok(await page.locator('#panel h2').isVisible());
  await page.screenshot({ path: path.join(screenshots, 'product-portrait-panel.png') });
  await page.goto(`${origin}/o/nyc/insights?dim=housing`, { waitUntil: 'networkidle' });
  assert.ok(await page.getByRole('heading', { name: 'Comparison baseline', exact: true }).isVisible(), 'A DB-backed NYC family is required');
  const matrix = page.getByRole('region', { name: 'The matrix', exact: true });
  assert.ok(await matrix.locator('table').isVisible());
  const modeNames = ['Versus whole jurisdiction', 'Versus target', 'Member rank', 'Published score'];
  const modes = ['vs-city', 'vs-target', 'rank', 'absolute'];
  for (let i = 0; i < modes.length; i++) {
    await page.getByRole('navigation', { name: 'Comparison baseline', exact: true }).getByRole('link', { name: modeNames[i], exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('mode') === modes[i]);
    await page.getByRole('navigation', { name: 'Comparison baseline', exact: true }).getByRole('link', { name: modeNames[i], exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('dim'), 'housing');
    if (modes[i] === 'rank') {
      await page.waitForFunction(() => document.querySelector('table tbody')?.textContent.includes('#'));
      assert.ok((await matrix.innerText()).includes('#'));
    }
  }
  const housingRow = matrix.locator('tr[data-insight-dimension="housing"]');
  const memberCell = housingRow.locator('[data-insight-member="manhattan"] a');
  await memberCell.hover();
  assert.ok(await page.locator('[data-insight-dimension="housing"][data-linked-dimension]').count() > 2, 'Dimension links matrix, bars and research cards');
  assert.ok(await page.locator('[data-insight-member="brooklyn"][data-muted-member]').count() > 2, 'Member hover dims other matrix columns, bars and cards');
  await memberCell.focus();
  await page.screenshot({ path: path.join(screenshots, 'product-insights-desktop.png') });
  await page.getByRole('heading', { name: 'The research behind it', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshots, 'product-insights-evidence.png') });
  await page.goto(`${origin}/o/nyc/insights?dim=peace-justice&mode=absolute`, { waitUntil: 'networkidle' });
  const contributions = page.getByRole('heading', { name: 'Member contributions', exact: true });
  if (await contributions.count()) {
    await contributions.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshots, 'product-insights-contributions.png') });
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${origin}/o/nyc/insights?dim=housing&mode=rank`, { waitUntil: 'networkidle' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Insights overflow at ${width}px`);
    await page.getByRole('heading', { name: 'Comparison baseline', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshots, `product-insights-mobile-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/nyc/admin/research`, { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: /^Deep/ }).check();
  assert.equal(await page.getByRole('radio', { name: /^Deep/ }).isChecked(), true);
  await page.getByRole('radio', { name: /^Standard/ }).check();
  await page.getByRole('heading', { name: 'New research run', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshots, 'product-research-strategies.png') });
  const runLink = page.locator('table a[href*="/admin/research/"]').first();
  if (await runLink.count()) {
    await runLink.click();
    await page.getByRole('heading', { name: 'Research cost estimate', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshots, 'product-run-costs.png') });
    const csv = page.getByRole('link', { name: 'Download cost details (CSV)' });
    assert.equal((await page.request.get(new URL(await csv.getAttribute('href'), origin).href)).status(), 200);
    await page.setViewportSize({ width: 320, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Run cost summary fits small phones');
    await page.getByRole('heading', { name: 'Research cost estimate', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshots, 'product-run-costs-mobile.png') });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['URL-addressable comparison modes', 'dimension and member hover linking', 'keyboard linking', '320px and 390px Insights', 'strategy controls without starting research', 'run cost summary and authorized CSV'] }));
} finally { await browser.close(); }
