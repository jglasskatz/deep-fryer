/** Print the checked HTML and SVG figures using an already installed browser. */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '../../../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from '../../../scripts/chromium-path.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.env.PAPER_PDF_OUTPUT || 'output/pdf');
const publicBase='https://jglasskatz.github.io/deep-fryer/research/argentina/';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:installedChromium(chromium.executablePath())});
try {
  for(const name of ['argentina-working-paper','methods-paper']) {
    const page=await browser.newPage();
    await page.goto(pathToFileURL(path.join(root,`${name}.html`)).href,{waitUntil:'load'});
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));});
    // PDF links must remain portable after download; figures stay local while printing.
    await page.evaluate(base=>{for(const a of document.querySelectorAll('a[href]'))a.href=new URL(a.getAttribute('href'),base).href;},publicBase);
    await page.pdf({path:path.join(output,`${name}.pdf`),format:'A4',printBackground:true,
      margin:{top:'18mm',bottom:'19mm',left:'18mm',right:'18mm'},displayHeaderFooter:true,
      headerTemplate:'<div></div>',
      footerTemplate:'<div style="font:9px Arial;width:100%;margin:0 18mm;color:#52666b;display:flex;justify-content:space-between"><span>deep-fryer · Research working paper · 29 October 2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'});
    await page.close();
    console.log(path.join(output,`${name}.pdf`));
  }
}finally{await browser.close();}
