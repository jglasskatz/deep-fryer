/** Extend an explicit cost sensitivity model; never infer measured token usage. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [baselinePath, campaign] = process.argv.slice(2);
if (!baselinePath || !campaign) throw new Error('Usage: node scripts/estimate-research-costs.mjs <baseline-ledger.json> <expansion-campaign>');
const read = async filename => JSON.parse(await readFile(filename, 'utf8'));
const baseline = await read(baselinePath);
const reviewer = await read(path.join(campaign, 'review-activity.json'));
const reviewCalls = reviewer.web_tool_calls ?? reviewer.web_calls ?? 0;
const portraits = [];
const csv = [['portrait', 'round', 'scenario', 'service_tier', 'research_input_assumed', 'research_output_assumed', 'review_input_assumed', 'review_output_assumed', 'search_calls_proxy', 'research_usd', 'review_usd', 'search_usd', 'total_usd', 'measured']];
for (const previous of baseline.portraits) {
  const activity = await read(path.join(campaign, previous.slug, 'activity.json'));
  const searchCalls = (activity.web_tool_calls ?? 0) + reviewCalls / baseline.portraits.length;
  const scenarios = [];
  for (const [scenario, quantities] of Object.entries(baseline.assumptions)) {
    for (const [tier, multiplier] of [['standard', 1], ['fast', 2]]) {
      const input = quantities.input_per_role_per_portrait;
      const output = quantities.output_per_role_per_portrait;
      const cost = model => multiplier * (input * baseline.rates[model].input_per_million + output * baseline.rates[model].output_per_million) / 1_000_000;
      const research = cost('gpt-6-luna');
      const review = cost('gpt-6.1-sol');
      const search = searchCalls * baseline.web_search_price_per_1000_calls / 1000;
      const total = Number((research + review + search).toFixed(4));
      scenarios.push({ scenario, tier, research_usd: research, review_usd: review, search_proxy_usd: search, total_usd: total });
      csv.push([previous.slug, path.basename(campaign), scenario, tier, input, output, input, output, searchCalls, research, review, search, total, false]);
    }
  }
  const combined = scenarios.map(next => {
    const prior = previous.scenarios.find(p => p.scenario === next.scenario && p.tier === next.tier);
    if (!prior) throw new Error('Baseline scenario missing');
    return { scenario: next.scenario, tier: next.tier, ...Object.fromEntries(['research_usd', 'review_usd', 'search_proxy_usd', 'total_usd'].map(key => [key, Number((prior[key] + next[key]).toFixed(4))])) };
  });
  portraits.push({ slug: previous.slug,
    rounds: [...(previous.rounds ?? [{ campaign: path.basename(path.dirname(baselinePath)), recorded_activity: previous.recorded_activity, reviewer_web_calls_allocated: previous.reviewer_web_calls_allocated, scenarios: previous.scenarios }]),
      { campaign: path.basename(campaign), recorded_activity: activity, reviewer_web_calls_allocated: reviewCalls / baseline.portraits.length, scenarios }],
    scenarios: combined });
}
const ledger = { ...baseline, generated_at: new Date().toISOString(), actual_tokens: null, actual_billed_usd: null, portraits,
  assumptions_scope: 'The low/base/high token quantities apply separately to each research round, each role and each portrait. Combined totals sum the original pass and expansion. These quantities are assumptions, not measurements.',
  reviewer_activity: reviewer,
  limitations: [...baseline.limitations, 'Expansion scenarios reuse the explicitly dated price assumptions from the baseline ledger; this is not a current invoice or billing telemetry. The CSV details the incremental expansion; JSON includes both rounds and cumulative totals.'] };
await writeFile(path.join(campaign, 'cost-ledger.json'), JSON.stringify(ledger, null, 2) + '\n');
const cell = value => `"${String(value).replaceAll('"', '""')}"`;
await writeFile(path.join(campaign, 'cost-ledger.csv'), csv.map(row => row.map(cell).join(',')).join('\n') + '\n');
console.log(JSON.stringify(portraits.map(p => ({ slug: p.slug, scenarios: p.scenarios })), null, 2));
