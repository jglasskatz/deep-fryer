import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const root = 'site/policy-view/';
const read = name => readFileSync(root + name, 'utf8');
const data = JSON.parse(read('policy-data.json'));
const html = read('index.html');
const snapshot = JSON.parse(readFileSync('site/data/portraits.json', 'utf8'));

test('policy data is separate from unchanged portrait and prospective projections', () => {
  assert.equal(createHash('sha256').update(readFileSync('site/data/portraits.json')).digest('hex'),
    'd73bd707ac4047b4c6b2a503bf7669b8c44b7aa64deaf5ece6582b64d76d1603');
  assert.doesNotMatch(JSON.stringify(data), /"projected_value"\s*:/);
  assert.match(html, /Research draft.*not publication-approved/);
  assert.match(html, /source archives are incomplete/);
  assert.match(html, /not (?:an? )?(?:impact|outcome|performance) score|not.*scores|not.*score/i);
});

test('every policy uses unique identities and existing local portrait slices', () => {
  assert.equal(data.policies.length, 10);
  assert.equal(new Set(data.policies.map(p => p.id)).size, data.policies.length);
  const dims = new Set(data.dimensions.map(d => d.id));
  for (const p of data.policies) {
    assert.match(p.id, /^[a-z0-9-]+$/);
    assert.ok(['nyc', 'santa-cruz'].includes(p.city));
    const local = snapshot.portraits.find(x => x.slug === p.city);
    for (const slice of p.slices) {
      assert.ok(dims.has(slice), `${p.id}: dimension ${slice} exists in view`);
      assert.ok(local.dimensions.some(d => d.slug === slice), `${p.id}: ${slice} maps to portrait identity`);
    }
    assert.ok(p.jurisdiction && p.caution && p.headline.kind && p.headline.context);
    assert.equal(typeof p.hasCausalEstimate, 'boolean');
    assert.ok(p.sources.length > 0);
    for (const source of p.sources) assert.ok(['https:', 'http:'].includes(new URL(source.url).protocol));
  }
});

test('browser data exactly matches portable JSON', () => {
  const context = { window: {} };
  vm.runInNewContext(read('policy-data.js'), context, { timeout: 1000 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.POLICY_DATA)), data);
});

test('relative linked assets exist and render scripts parse', () => {
  for (const [, target] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(?:https?:|#)/.test(target)) continue;
    assert.ok(!target.startsWith('/'), `Nested-hosting-safe path: ${target}`);
    assert.ok(!target.includes('..'), `Asset stays inside atlas: ${target}`);
    assert.ok(existsSync(root + target), `Asset exists: ${target}`);
  }
  new vm.Script(read('policy-view.js'));
  assert.match(read('policy-view.css'), /prefers-reduced-motion/);
  assert.match(html, /aria-|<label/);
});

