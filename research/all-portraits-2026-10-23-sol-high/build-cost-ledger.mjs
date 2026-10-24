// Reproduce sensitivity assumptions, never infer measured tokens from tool counts.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(readFileSync(path.join(root, name), 'utf8'));
const hash = name => createHash('sha256').update(readFileSync(path.join(root, name))).digest('hex');
const researcher = read('cost-sensitivity.json');
const reviewer = read('reviews/reviewer-cost-sensitivity.json');
const baseline = read('baseline/portraits.json');
const round = n => Math.round(n * 1000000) / 1000000;
const correctionTokens = { low: [100000, 5000], base: [250000, 10000], high: [1000000, 30000] };
const roles = ['researcher', 'reviewer_including_correction_authorship', 'independent_correction_reviewer'];
const scenarios = ['low', 'base', 'high'].flatMap(scenario => ['standard', 'fast'].map(tier => {
  const r = researcher.scenarios.find(s => s.scenario === scenario);
  const v = reviewer.scenarios.find(s => s.scenario === scenario);
  const [input, output] = correctionTokens[scenario];
  const correction = round((input * 2 + output * 10) / 1000000 * (tier === 'fast' ? 2 : 1));
  const role_usd = { researcher: r[`${tier}_total_usd`], reviewer_including_correction_authorship: v[tier === 'fast' ? 'fast_total_usd_assuming_2x' : 'standard_total_usd'], independent_correction_reviewer: correction };
  const total_usd = round(Object.values(role_usd).reduce((a, b) => a + b, 0));
  const prior_tracked_usd = round(baseline.cost_scenarios.portraits.reduce((sum, p) => sum + p.scenarios.find(s => s.scenario === scenario && s.tier === tier).total_usd, 0));
  return { scenario, tier, role_usd, total_usd, prior_tracked_usd, cumulative_tracked_usd: round(prior_tracked_usd + total_usd) };
}));
const ledger = {
  schema_version: 1, campaign: 'all-portraits-2026-10-23-sol-high',
  model: 'gpt-6.1-sol', reasoning_effort: 'high', budget_usd: null,
  actual_tokens: null, actual_billed_usd: null,
  scope: 'One shared researcher, one shared initial reviewer including corrective authorship, and a different independent reviewer of the five corrections. Each role counted once across all 11 portraits.',
  assumptions: {
    price_assumption_date: '2026-10-23', input_per_million_usd: 2, output_per_million_usd: 10,
    fast_multiplier: 2, web_tool_call_proxy_usd: 0.01,
    researcher_and_initial_reviewer: 'Each role uses assumed low/base/high totals of 500k/2M/10M input and 30k/80k/250k output including reasoning tokens. These are sensitivity inputs, not measured usage or predictions.',
    independent_correction_reviewer: { assumed_tokens_by_scenario: correctionTokens, note: 'Smaller assumed workload for checking five corrected amendments; no additional web calls. Only research review is allocated here; the same agent also did engineering, which is excluded.' },
    web_calls: { researcher: 19, reviewer_including_correction_authorship: 2, independent_correction_reviewer: 0 },
    limitations: ['Session token telemetry and invoices are unavailable. Actual spend stays unknown.', 'Prices are dated assumptions inherited from the prior ledger, not freshly verified rates.', 'Browser requests and local renders have no separate price in this scenario.', 'Engineering, UI, orchestration, hosting and baseline SC/NYC research before this tracked campaign are excluded.', 'Cumulative totals combine prior tracked Carmel/Monterey research with this shared round; they are not the all-time cost of every portrait.'],
  },
  inputs: ['cost-sensitivity.json', 'reviews/reviewer-cost-sensitivity.json', 'reviews/corrections-independent-sol-high.json', 'baseline/portraits.json'].map(name => ({ path: name, sha256: hash(name) })),
  scenarios,
};
writeFileSync(path.join(root, 'cost-ledger.json'), JSON.stringify(ledger, null, 2) + '\n');
const header = ['scenario', 'tier', ...roles.map(r => `${r}_usd`), 'shared_round_usd', 'prior_tracked_usd', 'cumulative_tracked_usd', 'actual_billed_usd'];
writeFileSync(path.join(root, 'cost-ledger.csv'), [header, ...scenarios.map(s => [s.scenario, s.tier, ...roles.map(r => s.role_usd[r]), s.total_usd, s.prior_tracked_usd, s.cumulative_tracked_usd, 'unknown'])].map(row => row.join(',')).join('\n') + '\n');
console.log(JSON.stringify(scenarios.filter(s => s.scenario === 'base')));
