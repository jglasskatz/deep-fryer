import { chromium } from '../../apps/worker/node_modules/playwright-core/index.mjs';
import { installedChromium } from '../../scripts/chromium-path.mjs';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
const [mode,url,stem]=process.argv.slice(2);
if(!mode||!url||!stem||!['fetch','page','render'].includes(mode)||!/^[a-z0-9-]+$/.test(stem))throw Error('capture.mjs fetch|page|render URL stem');
const browser=await chromium.launch({executablePath:installedChromium(chromium.executablePath())});
const start=new Date().toISOString();let record={mode,url,stem,captured_at:start};
try{
 const context=await browser.newContext({ignoreHTTPSErrors:false});
 if(mode==='fetch'){
  const response=await context.request.get(url,{timeout:60000}); const bytes=await response.body();record.status=response.status();record.content_type=response.headers()['content-type'];
  if(!response.ok())throw Error('HTTP '+response.status()+' '+bytes.toString().slice(0,80));
  const ext=bytes.subarray(0,4).toString()==='%PDF'?'pdf':record.content_type?.includes('json')?'json':url.includes('.csv')?'csv':record.content_type?.includes('spreadsheet')?'xlsx':'bin';
  record.raw_path='raw/'+stem+'.'+ext;record.sha256=createHash('sha256').update(bytes).digest('hex');record.bytes=bytes.length;await writeFile(path.join(base,record.raw_path),bytes);
 }else{
  const page=await context.newPage({viewport:{width:1400,height:1800}});const response=await page.goto(mode==='render'?pathToFileURL(path.join(base,url)).href:url,{waitUntil:'domcontentloaded',timeout:60000});record.status=response?.status();if(response&&!response.ok())throw Error('HTTP '+response.status());
  await page.waitForTimeout(mode==='render'?100:1500);const bytes=Buffer.from(await page.content());record.raw_path='raw/'+stem+'.html';record.snapshot_path='evidence/'+stem+'.png';record.sha256=createHash('sha256').update(bytes).digest('hex');record.bytes=bytes.length;await writeFile(path.join(base,record.raw_path),bytes);await writeFile(path.join(base,'raw',stem+'.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(base,record.snapshot_path),fullPage:true});
 }
 record.success=true;
}catch(e){record.success=false;record.error=String(e);process.exitCode=1;}finally{await browser.close();await writeFile(path.join(base,'activity',stem+'.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));}
