import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { reviewedOverlayAssets, reviewedOverlayRelease } from './research-overlays.mjs';
const release = reviewedOverlayRelease();
const manifest = JSON.parse(await readFile('site/data/evidence-manifest.json', 'utf8'));
for (const [destination, { source, sha256, bytes }] of reviewedOverlayAssets()) {
  await mkdir(path.dirname(path.join('site', destination)), { recursive: true });
  await copyFile(source, path.join('site', destination));
  manifest[destination] = { sha256, bytes };
}
await writeFile('site/data/portraits.json', JSON.stringify(release, null, 2) + '\n');
await writeFile('site/data/evidence-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Applied ${release.research_overlay.applied.length} reviewed amendments; human approval remains false.`);
