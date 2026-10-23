/** Extend an explicit cost sensitivity model; never infer measured token usage. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const [baselinePath, campaign] = process.argv.slice(2);
if (!baselinePath || !campaign) throw new Error('Usage: node scripts/estimate-research-costs.mjs <baseline-ledger.json> <expansion-campaign>');
const read = async filename => JSON.parse(await readFile(filename, 'utf8'));
const baselineBytes = await readFile(baselinePath);
const baseline = JSON.parse(baselineBytes);
let pricing = baseline;
try { pricing = await read(path.join(campaign, 'pricing.json')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const rates = { ...baseline.rates, ...pricing.rates };
const reviewer = await read(path.join(campaign, 'review-activity.json'));
const reviewCalls = reviewer.web_tool_calls ?? reviewer.web_calls ?? 0;
const reviewerModel = reviewer.model ?? reviewer.reviewer_model;
const nonnegative = (value, label) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
};
const modelRates = model => {
  if (!model || !rates[model]) throw new Error(`Missing price for recorded model: ${model}`);
  nonnegative(rates[model].input_per_million, `${model} input price`);
  nonnegative(rates[model].output_per_million, `${model} output price`);
  return rates[model];
};
modelRates(reviewerModel);
nonnegative(reviewCalls, 'review search-call count');
const searchPrice = nonnegative(pricing.web_search_price_per_1000_calls, 'search price');
const portraits = [];
const csv = [['portrait', 'round', 'scenario', 'service_tier', 'research_model', 'research_reasoning_effort', 'review_model', 'research_input_assumed', 'research_output_assumed', 'review_input_assumed', 'review_output_assumed', 'search_calls_proxy', 'research_usd', 'review_usd', 'search_usd', 'total_usd', 'measured']];
for (const previous of baseline.portraits) {
  const activity = await read(path.join(campaign, previous.slug, 'activity.json'));
  const researchModel = activity.model;
  modelRates(researchModel);
  const searchCalls = nonnegative(activity.web_tool_calls ?? 0, 'research search-call count') + reviewCalls / baseline.portraits.length;
  const scenarios = [];
  for (const [scenario, quantities] of Object.entries(baseline.assumptions)) {
    for (const [tier, multiplier] of [['standard', 1], ['fast', 2]]) {
      const input = nonnegative(quantities.input_per_role_per_portrait, 'assumed input tokens');
      const output = nonnegative(quantities.output_per_role_per_portrait, 'assumed output tokens');
      const cost = model => multiplier * (input * rates[model].input_per_million + output * rates[model].output_per_million) / 1_000_000;
      const research = cost(researchModel);
      const review = cost(reviewerModel);
      const search = searchCalls * searchPrice / 1000;
      const total = Number((research + review + search).toFixed(4));
      scenarios.push({ scenario, tier, research_usd: research, review_usd: review, search_proxy_usd: search, total_usd: total });
      csv.push([previous.slug, path.basename(campaign), scenario, tier, researchModel, activity.reasoning_effort ?? '', reviewerModel, input, output, input, output, searchCalls, research, review, search, total, false]);
    }
  }
  const combined = scenarios.map(next => {
    const prior = previous.scenarios.find(p => p.scenario === next.scenario && p.tier === next.tier);
    if (!prior) throw new Error('Baseline scenario missing');
    return { scenario: next.scenario, tier: next.tier, ...Object.fromEntries(['research_usd', 'review_usd', 'search_proxy_usd', 'total_usd'].map(key => [key, Number((prior[key] + next[key]).toFixed(4))])) };
  });
  portraits.push({ slug: previous.slug,
    rounds: [...(previous.rounds ?? [{ campaign: path.basename(path.dirname(baselinePath)), recorded_activity: previous.recorded_activity, reviewer_web_calls_allocated: previous.reviewer_web_calls_allocated, scenarios: previous.scenarios }]),
      { campaign: path.basename(campaign), recorded_activity: activity, reviewer_model: reviewerModel,
        reviewer_reasoning_effort: reviewer.reasoning_effort ?? null, pricing_checked_date: pricing.pricing_checked_date,
        rates: { [researchModel]: rates[researchModel], [reviewerModel]: rates[reviewerModel] },
        web_search_price_per_1000_calls: searchPrice, reviewer_web_calls_allocated: reviewCalls / baseline.portraits.length, scenarios }],
    scenarios: combined });
}
const ledger = { ...baseline, generated_at: new Date().toISOString(), actual_tokens: null, actual_billed_usd: null, portraits,
  rates, pricing_checked_date: pricing.pricing_checked_date, web_search_price_per_1000_calls: searchPrice,
  prior_ledger: { campaign: path.basename(path.dirname(baselinePath)), sha256: createHash('sha256').update(baselineBytes).digest('hex'), pricing_checked_date: baseline.pricing_checked_date },
  assumptions_scope: 'The low/base/high token quantities apply separately to each research round, each role and each portrait, aggregated across all dimension agents. Combined totals sum all recorded rounds without repricing prior rounds. These quantities are assumptions, not measurements. Medium reasoning is recorded, not treated as a token discount.',
  reviewer_activity: reviewer,
  limitations: [...baseline.limitations, 'This round prices the models recorded in research/review activity using the dated campaign pricing file when present. The CSV details this incremental round; JSON preserves prior rounds and cumulative totals. These are uncached short-context text-token assumptions; cache writes, discounts, long-context premiums, engineering and hosting are not modeled. This is not an invoice or billing telemetry.'] };
await writeFile(path.join(campaign, 'cost-ledger.json'), JSON.stringify(ledger, null, 2) + '\n');
const cell = value => `"${String(value).replaceAll('"', '""')}"`;
await writeFile(path.join(campaign, 'cost-ledger.csv'), csv.map(row => row.map(cell).join(',')).join('\n') + '\n');
console.log(JSON.stringify(portraits.map(p => ({ slug: p.slug, scenarios: p.scenarios })), null, 2));
