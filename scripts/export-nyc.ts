#!/usr/bin/env tsx
/**
 * One-command NYC demo publish (SPEC v3 §1.5): runs the static export into
 * the demo repo checkout, applies the NYC branding + presentation fixes the
 * raw template lacks, and optionally commits and pushes.
 *
 *   tsx scripts/export-nyc.ts --repo /path/to/doughnut-santa-cruz [--push]
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const repo = arg('repo');
if (!repo) {
  console.error('Usage: export-nyc --repo <doughnut-santa-cruz checkout> [--push]');
  process.exit(1);
}
const site = path.join(repo, 'docs');
const out = path.join(site, 'nyc');

execSync(`npx tsx ${path.join(import.meta.dirname, 'export-static.ts')} --site ${site} --out ${out}`, {
  stdio: 'inherit',
});

const htmlPath = path.join(out, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
html = html
  .replace(
    '<title>Santa Cruz Doughnut Economics</title>',
    '<title>New York City Doughnut — Social & Ecological Portrait</title>',
  )
  .replace('>Santa Cruz Doughnut Economics<', '>New York City Doughnut<')
  .replace(
    'A portrait of social and ecological wellbeing',
    'A portrait of social and ecological wellbeing — the city and its five boroughs',
  );
// Presentation fixes over the vendored template: evidence screenshots can be
// very tall full-page captures; clamp them so actions stay in reach.
if (!html.includes('/* nyc-overrides */')) {
  html = html.replace(
    '</head>',
    `<style>/* nyc-overrides */
img.source-screenshot { max-height: 420px; width: 100%; object-fit: cover; object-position: top; border-radius: 6px; }
</style></head>`,
  );
}
writeFileSync(htmlPath, html);
console.log('rebranded + presentation overrides applied');

if (process.argv.includes('--push')) {
  execSync(`git -C ${repo} add docs/nyc`, { stdio: 'inherit' });
  execSync(
    `git -C ${repo} commit -m "Regenerate NYC portraits from deep-fryer publish" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`,
    { stdio: 'inherit' },
  );
  execSync(`git -C ${repo} push origin main`, { stdio: 'inherit' });
}
