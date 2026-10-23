import { chromium } from '../../../../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from '../../../../scripts/chromium-path.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const source = path.join(here, 'source-extract.html');
const browser = await chromium.launch({ executablePath: installedChromium(chromium.executablePath()) });
try {
 const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, deviceScaleFactor: 1 });
 await page.goto('file://' + source);
 for (const tenant of ['carmel','monterey-county']) {
  const dest=path.join(root,'apps/web/public/evidence',tenant,'evidence');
  await mkdir(dest,{recursive:true});
  await page.screenshot({path:path.join(dest,'extreme-heat-derived.png'),fullPage:true});
  const bytes=await readFile(source);
  await writeFile(path.join(dest,'extreme-heat-derived.html'),bytes);
  await writeFile(path.join(dest,'extreme-heat-derived.source.json'),JSON.stringify({
   url:'https://eji.cdc.gov/Documents/Data/2024/2024_CSV/EJI_2024_California_CSV.zip',
   derived:true, reproduction_script:'research/carmel-monterey-2026-10-23-sol-medium/calculations/extreme-heat/derive.py',
   snapshot_path:'evidence/extreme-heat-derived.png',captured_at:new Date().toISOString(),
   sha256:createHash('sha256').update(bytes).digest('hex'),hashed_content:'researcher-derived HTML exhibit'
  },null,2));
 }
} finally { await browser.close(); }
