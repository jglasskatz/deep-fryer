/** Archive a source for a session-agent run using the same tenant evidence layout. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from './chromium-path.mjs';

const [tenant, url, pageArg] = process.argv.slice(2);
if (!tenant || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenant) || !url || !/^https?:\/\//.test(url)) {
  throw new Error('Usage: pnpm exec tsx scripts/capture-evidence.ts <tenant> <source-url> [pdf-page=1]');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'apps/web/public/evidence', tenant);
const captured_at = new Date().toISOString();
const hash = createHash('sha256').update(`${url}|${captured_at}`).digest('hex').slice(0, 16);
const stem = `evidence/${hash}`;
await mkdir(path.join(base, 'evidence'), { recursive: true });
// curl honors the workstation's configured HTTPS proxy; node fetch does not
// on every supported Node version. Pass arguments directly, never through a shell.
let bytes: Buffer | undefined;
try {
  bytes = execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '45', url], { maxBuffer: 80 * 1024 * 1024 });
} catch (error) {
  if (pageArg === '--download' || new URL(url).pathname.toLowerCase().endsWith('.pdf')) throw error;
  // Some sites reject curl but allow the installed browser. Capture the actual
  // browser response below; never treat the failed response as source evidence.
}
// Data downloads retain the original bytes. They are not screenshot exhibits;
// a researcher must supply and review a faithful table extract separately.
if (pageArg === '--download') {
  if (!bytes) throw new Error('Source download failed');
  const pathname = new URL(url).pathname.toLowerCase();
  const extension = pathname.endsWith('.xlsx') ? 'xlsx' : pathname.endsWith('.csv') ? 'csv' : 'bin';
  const original_path = `${stem}.${extension}`;
  await writeFile(path.join(base, original_path), bytes);
  const record = { url, original_path, captured_at, sha256: createHash('sha256').update(bytes).digest('hex'), screenshot_available: false };
  await writeFile(path.join(base, `${stem}.source.json`), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
  process.exit(0);
}
const isPdf = bytes?.subarray(0, 4).toString() === '%PDF';
let pdf_path: string | undefined;
let snapshot_path: string;
if (isPdf) {
  pdf_path = `${stem}.pdf`;
  await writeFile(path.join(base, pdf_path), bytes!);
  const page = String(Math.max(1, Number(pageArg ?? 1)));
  execFileSync('pdftoppm', ['-f', page, '-l', page, '-scale-to', '1800', '-singlefile', '-png', path.join(base, pdf_path), path.join(base, stem)], { timeout: 60_000 });
  execFileSync('pdftotext', ['-layout', path.join(base, pdf_path), path.join(base, `${stem}.txt`)], { timeout: 60_000 });
  snapshot_path = `${stem}.png`;
} else {
  const browser = await chromium.launch({ executablePath: installedChromium(chromium.executablePath()) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    const navigation = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (navigation && !navigation.ok()) throw new Error(`Browser returned HTTP ${navigation.status()}`);
    await page.waitForTimeout(1500);
    const html = await page.content();
    await writeFile(path.join(base, `${stem}.html`), html);
    bytes = Buffer.from(html);
    await writeFile(path.join(base, `${stem}.txt`), await page.locator('body').innerText());
    snapshot_path = `${stem}.png`;
    await page.screenshot({ path: path.join(base, snapshot_path), fullPage: true, timeout: 45_000 });
  } finally { await browser.close(); }
}
const evidence = { snapshot_path, ...(pdf_path ? { pdf_path } : {}), captured_at };
await writeFile(path.join(base, `${stem}.source.json`), JSON.stringify({ url, ...evidence, sha256: createHash('sha256').update(bytes!).digest('hex'), hashed_content: isPdf ? 'pdf' : 'rendered_html' }, null, 2));
// Check that the exhibit really exists before returning its path.
await readFile(path.join(base, snapshot_path));
console.log(JSON.stringify(evidence));
