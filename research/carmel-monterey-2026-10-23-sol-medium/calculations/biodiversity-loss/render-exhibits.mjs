import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../../../apps/worker/node_modules/playwright-core/index.mjs';
import {installedChromium} from '../../../../scripts/chromium-path.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const browser=await chromium.launch({executablePath:installedChromium(chromium.executablePath())});
try {
 for (const tenant of ['carmel','monterey-county']) for (const stem of ['biodiversity-loss-derived-2024','biodiversity-loss-guide-extract']) {
  const base=path.join(root,'apps/web/public/evidence',tenant,'evidence',stem);
  const page=await browser.newPage({viewport:{width:1280,height:1600}});
  await page.goto('file://'+base+'.html');await page.screenshot({path:base+'.png',fullPage:true});await page.close();
 }
} finally {await browser.close();}
