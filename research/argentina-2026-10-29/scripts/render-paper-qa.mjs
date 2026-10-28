import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const qaOutput = process.env.ARGENTINA_QA_OUTPUT || '/private/tmp/deep-fryer-private-20261029/argentina-paper-qa';
await mkdir(qaOutput, { recursive: true });
const profile = await mkdtemp('/private/tmp/argentina-paper-cdp-');
const browser = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).split('\n')[0]; break; } catch { await delay(100); }
  }
  if (!port) throw new Error('Browser did not expose DevTools port');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', fail, { once: true }); });
  let next = 0; const pending = new Map();
  socket.addEventListener('message', event => { const response = JSON.parse(event.data); if (response.id && pending.has(response.id)) { const {ok, fail} = pending.get(response.id); pending.delete(response.id); response.error ? fail(new Error(JSON.stringify(response.error))) : ok(response.result); } });
  const cdp = (method, params = {}) => new Promise((ok, fail) => { const id = ++next; pending.set(id, {ok, fail}); socket.send(JSON.stringify({id, method, params})); });
  await cdp('Page.enable');
  const results = [];
  for (const paper of ['argentina-working-paper', 'methods-paper']) {
    for (const [suffix, width, height] of [['desktop', 1240, 1000], ['mobile', 390, 844]]) {
      await cdp('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: suffix === 'mobile'});
      await cdp('Page.navigate', {url: pathToFileURL(`${root}/${paper}.html`).href});
      await delay(300);
      await cdp('Runtime.evaluate', {expression: 'window.scrollTo(0,0)'});
      const metrics = await cdp('Runtime.evaluate', {expression: 'JSON.stringify({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,title:document.title,headings:document.querySelectorAll("h2").length})', returnByValue: true});
      const result = JSON.parse(metrics.result.value);
      if (result.viewport !== width || result.documentWidth > width) throw new Error(`Overflow at ${paper} ${suffix}: ${JSON.stringify(result)}`);
      const screenshot = await cdp('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
      await writeFile(`${qaOutput}/${paper}-${suffix}.png`, Buffer.from(screenshot.data, 'base64'));
      results.push({paper, suffix, ...result});
    }
  }
  await writeFile(`${root}/data/render-verification.json`, JSON.stringify({status: 'desktop-and-mobile-rendered-no-page-overflow', results}, null, 2) + '\n');
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  socket.close();
} finally { browser.kill(); }
