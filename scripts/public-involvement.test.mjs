import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { validatePublicInvolvement } from './public-involvement.mjs';
const data = JSON.parse(readFileSync('site/data/involvement.json'));
const portraits = JSON.parse(readFileSync('site/data/portraits.json')).portraits;
test('public opportunities have primary evidence and exact portrait dimensions', () => {
  const listings = validatePublicInvolvement(data, portraits);
  assert.ok(listings.some(x => x.portrait_slug === 'carmel'));
  assert.ok(listings.some(x => x.portrait_slug === 'monterey-county'));
  const dir = 'research/community-opportunities-2026-10-29/';
  const sources = JSON.parse(readFileSync(dir + 'sources.json'));
  for (const source of sources) {
    assert.match(source.path, /^evidence\/[a-z-]+\.html$/);
    const bytes = readFileSync(dir + source.path);
    assert.equal(bytes.length, source.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
  }
  for (const item of listings) {
    assert.ok(sources.some(s => s.url === item.source_url && s.retrieved_at === item.checked_at));
  }
});
test('directory rejects private fields, unsafe URLs, missing scope and stale framework aliases', () => {
  for (const change of [
    x => { x.contact_email = 'private@example.com'; },
    x => { x.actual_billed_usd = 1; },
    x => { x.url = 'javascript:alert(1)'; },
    x => { x.url = 'https://user:password@example.com/'; },
    x => { x.dimension_slugs = []; },
    x => { x.dimension_slugs = ['ozone-depletion']; },
    x => { x.portrait_slug = 'unknown-place'; },
    x => { x.checked_at = '2026-02-30'; },
  ]) {
    const copy = structuredClone(data); change(copy.listings[0]);
    assert.throws(() => validatePublicInvolvement(copy, portraits));
  }
  const duplicate = structuredClone(data); duplicate.listings.push(duplicate.listings[0]);
  assert.throws(() => validatePublicInvolvement(duplicate, portraits));
});
