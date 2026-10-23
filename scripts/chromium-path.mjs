import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Reuse an existing browser for local tooling; never install one implicitly. */
export function installedChromium(expected) {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (existsSync(expected)) return expected;
  const cache = process.platform === 'darwin' ? path.join(homedir(), 'Library/Caches/ms-playwright') : path.join(homedir(), '.cache/ms-playwright');
  if (existsSync(cache)) {
    const revisions = readdirSync(cache).filter((entry) => /^chromium_headless_shell-\d+$/.test(entry)).sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));
    for (const revision of revisions) {
      for (const relative of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell', 'chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
        const file = path.join(cache, revision, relative);
        if (existsSync(file)) return file;
      }
    }
  }
  throw new Error('No installed Chromium found. Set CHROMIUM_PATH to an existing browser executable.');
}
