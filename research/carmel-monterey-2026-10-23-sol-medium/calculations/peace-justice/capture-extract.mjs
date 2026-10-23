import { chromium } from '../../../../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from '../../../../scripts/chromium-path.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const base=path.dirname(new URL(import.meta.url).pathname);
const html=await readFile(path.join(base,'source-extract.html'));
const browser=await chromium.launch({executablePath:installedChromium(chromium.executablePath())});
try {
 const page=await browser.newPage({viewport:{width:1400,height:1800}});
 await page.goto('file://'+path.join(base,'source-extract.html'));
 for (const tenant of ['carmel','monterey-county']) {
  const dest=path.resolve(base,'../../../../apps/web/public/evidence',tenant,'evidence');
  const stem='peace-justice-2025-doj-extract';
  await writeFile(path.join(dest,stem+'.html'),html);
  await page.screenshot({path:path.join(dest,stem+'.png'),fullPage:true});
  const record={url:'https://data-openjustice.doj.ca.gov/sites/default/files/dataset/2026-07/Crimes_and_Clearances_with_Arson-1985-2025.csv',snapshot_path:'evidence/'+stem+'.png',captured_at:new Date().toISOString(),sha256:createHash('sha256').update(html).digest('hex'),hashed_content:'researcher_faithful_csv_extract',derivation:'research/carmel-monterey-2026-10-23-sol-medium/calculations/peace-justice/derive.py'};
  await writeFile(path.join(dest,stem+'.source.json'),JSON.stringify(record,null,2));
  console.log(tenant,JSON.stringify(record));
 }
}finally {await browser.close();}
