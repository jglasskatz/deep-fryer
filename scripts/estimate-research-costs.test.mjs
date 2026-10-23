import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./estimate-research-costs.mjs', import.meta.url));
async function fixture(t, model = 'gpt-6.1-sol') {
  const root = await mkdtemp(path.join(tmpdir(), 'research-costs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const campaign = path.join(root, 'next');
  const put = async (name, value) => {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  };
  const previous = [
    { scenario: 'base', tier: 'standard', research_usd: 0.2, review_usd: 0.6, search_proxy_usd: 0.2, total_usd: 1 },
    { scenario: 'base', tier: 'fast', research_usd: 0.4, review_usd: 1.2, search_proxy_usd: 0.2, total_usd: 1.8 },
  ];
  const rounds = [{ campaign: 'prior', scenarios: previous }];
  const baseline = {
    pricing_checked_date: '2026-10-19',
    rates: { 'gpt-6-luna': { input_per_million: 0.1, output_per_million: 0.5 }, 'gpt-6.1-sol': { input_per_million: 1, output_per_million: 5 } },
    assumptions: { base: { input_per_role_per_portrait: 1_000_000, output_per_role_per_portrait: 100_000 } },
    web_search_price_per_1000_calls: 10,
    limitations: [],
    portraits: ['carmel', 'monterey-county'].map(slug => ({ slug, scenarios: previous, rounds })),
  };
  await put('baseline.json', baseline);
  await put('next/pricing.json', { pricing_checked_date: '2026-10-23', rates: { 'gpt-6.1-sol': { input_per_million: 2, output_per_million: 10 } }, web_search_price_per_1000_calls: 10 });
  await put('next/review-activity.json', { reviewer_model: 'gpt-6.1-sol', web_tool_calls: 2 });
  for (const [slug, calls] of [['carmel', 3], ['monterey-county', 5]]) await put(`next/${slug}/activity.json`, { model, reasoning_effort: 'medium', web_tool_calls: calls });
  return { campaign, baseline, root, run: () => execFileSync(process.execPath, [script, path.join(root, 'baseline.json'), campaign], { encoding: 'utf8', stdio: 'pipe' }) };
}

test('prices the recorded Sol research model, preserves prior costs, and allocates shared review calls once', async t => {
  const f = await fixture(t);
  f.run();
  const ledger = JSON.parse(await readFile(path.join(f.campaign, 'cost-ledger.json'), 'utf8'));
  assert.equal(ledger.actual_tokens, null);
  assert.equal(ledger.actual_billed_usd, null);
  assert.equal(ledger.pricing_checked_date, '2026-10-23');
  assert.match(ledger.prior_ledger.sha256, /^[a-f0-9]{64}$/);
  for (const [index, p] of ledger.portraits.entries()) {
    assert.deepEqual(p.rounds[0], f.baseline.portraits[index].rounds[0]);
    const next = p.rounds[1];
    assert.equal(next.recorded_activity.reasoning_effort, 'medium');
    assert.equal(next.scenarios[0].research_usd, 3);
    assert.equal(next.scenarios[0].review_usd, 3);
    assert.equal(next.scenarios[1].research_usd, 6);
    assert.equal(p.scenarios[0].total_usd, index ? 7.06 : 7.04);
  }
  assert.equal(ledger.portraits.reduce((sum, p) => sum + p.rounds[1].scenarios[0].search_proxy_usd, 0), 0.1);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, 'baseline.json'), 'utf8')), f.baseline);
  const csv = await readFile(path.join(f.campaign, 'cost-ledger.csv'), 'utf8');
  assert.match(csv, /"gpt-6.1-sol","medium","gpt-6.1-sol"/);
});

test('refuses an unknown model instead of silently charging the old Luna rate', async t => {
  const f = await fixture(t, 'unpriced-model');
  assert.throws(f.run, /Missing price for recorded model/);
  await assert.rejects(access(path.join(f.campaign, 'cost-ledger.json')));
});
