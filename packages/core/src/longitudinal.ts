import { z } from 'zod';

/** Measured statistical series, not policy effects. Native units and coverage
 * stay attached to every series; no aggregation, interpolation or causal
 * attribution is performed by these helpers. */
const text = z.string().trim().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'must be a real calendar date');
const timestamp = z.string().datetime({ offset: true });
const geography = z.object({ id: text, name: text, level: text, coverage: text }).passthrough();
const archivePath = text.refine(value => !value.startsWith('/') && !value.split('/').some(p => p === '..' || p === '.') && !value.includes('\\') && !value.includes('\0'), 'archive path must stay relative');
export const longitudinalSourceSchema = z.object({
  id: text, title: text, publisher: text,
  url: z.string().url().refine(value => new URL(value).protocol === 'https:', 'source must use HTTPS'),
  path: archivePath, sha256: z.string().regex(/^[a-f0-9]{64}$/), retrieved_at: timestamp,
  release_date: date.nullable(),
}).passthrough();
export const longitudinalIndicatorSchema = z.object({
  id: text, label: text, dimension: z.enum(['social', 'ecological', 'context']), unit: text,
  direction: z.enum(['higher', 'lower', 'context']), frequency: z.enum(['annual', 'semester', 'monthly']),
  geography, epistemic_type: z.literal('estimate'),
  target: z.number().finite().nullable(), target_rationale: z.string().nullable(), target_source_id: text.optional(),
  comparability_notes: z.union([z.string(), z.array(z.string())]),
}).passthrough();
export const longitudinalObservationSchema = z.object({
  indicator_id: text, epistemic_type: z.enum(['observed', 'retrospective-estimate', 'projection']),
  status: z.enum(['source-supported-observation', 'source-supported-projection', 'missing']), period_start: date, period_end: date, observation_year: z.number().int(),
  value: z.number().finite().nullable(), source_id: text.nullable(), source_locator: z.string(),
  release_date: date.nullable(), retrieved_at: timestamp,
  comparability_group: text, break_flags: z.array(text), missing_reason: text.nullable(),
  uncertainty: z.object({ lower:z.number().finite(), upper:z.number().finite(), method:text, confidence_level:z.number().gt(0).lte(1).optional() }).nullable().optional(),
  provisional: z.boolean().optional(),
  confidence_interval: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  confidence_level: z.number().gt(0).lt(1).optional(),
  confidence_source_id: text.optional(), confidence_locator: text.optional(),
  statistical_comparisons: z.array(z.object({
    reference_period_start: date, reference_period_end: date,
    conclusion: z.enum(['no-significant-change', 'significant-increase', 'significant-decrease']),
    producer_statement: text, source_id: text, source_locator: text,
  })).optional(),
}).passthrough();

export const longitudinalEventSchema = z.object({
  id: text, date, date_end: date.optional(), category: z.enum(['election','inauguration','policy','context']),
  label: text, source_id: text, source_locator: text, date_precision: text.optional(),
  causal_status: z.literal('chronology only; not an estimated treatment effect'),
}).passthrough();

export const longitudinalDatasetSchema = z.object({
  schema_version: z.literal('1.0.0'), as_of: z.union([date, timestamp]), geography,
  scope: z.union([text, z.record(z.unknown())]),
  indicators: z.array(longitudinalIndicatorSchema), observations: z.array(longitudinalObservationSchema),
  sources: z.array(longitudinalSourceSchema), events: z.array(longitudinalEventSchema).default([]),
}).superRefine((dataset, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const sources = new Map(dataset.sources.map(source => [source.id, source]));
  const indicators = new Map(dataset.indicators.map(indicator => [indicator.id, indicator]));
  const asOf = dataset.as_of.slice(0, 10);
  if (sources.size !== dataset.sources.length) issue(['sources'], 'source ids must be unique');
  if (indicators.size !== dataset.indicators.length) issue(['indicators'], 'indicator ids must be unique');
  dataset.sources.forEach((source, index) => {
    if (source.release_date && source.release_date > asOf) issue(['sources', index, 'release_date'], 'source was not released as of this dataset');
    if (source.retrieved_at.slice(0, 10) > asOf) issue(['sources', index, 'retrieved_at'], 'retrieval is after dataset as_of');
  });
  dataset.indicators.forEach((indicator, index) => {
    if (indicator.target !== null && (!indicator.target_rationale?.trim() || !indicator.target_source_id || !sources.has(indicator.target_source_id))) {
      issue(['indicators', index, 'target'], 'fixed targets need an explicit rationale and archived target source');
    }
  });
  const eventIds = new Set<string>();
  dataset.events.forEach((event,index)=>{
    if(eventIds.has(event.id)) issue(['events',index,'id'],'event ids must be unique');
    eventIds.add(event.id);
    if(event.date>asOf || (event.date_end && (event.date_end>asOf || event.date_end<event.date))) issue(['events',index,'date'],'chronology must be available as_of with an ordered interval');
    if(!sources.has(event.source_id)) issue(['events',index,'source_id'],'event requires an archived source');
  });
  const seen = new Set<string>();
  dataset.observations.forEach((observation, index) => {
    const path = ['observations', index];
    const indicator = indicators.get(observation.indicator_id);
    if (!indicator) issue([...path, 'indicator_id'], 'unknown indicator');
    const key = `${observation.indicator_id}:${observation.period_start}:${observation.period_end}`;
    if (seen.has(key)) issue(path, 'duplicate observation period: resolve revisions explicitly');
    seen.add(key);
    if (observation.period_start > observation.period_end) issue(path, 'observation interval is reversed');
    if (observation.epistemic_type !== 'projection' && observation.period_end > asOf) issue([...path, 'period_end'], 'future observations must not be presented as measured history');
    if (observation.observation_year !== Number(observation.period_end.slice(0, 4))) issue([...path, 'observation_year'], 'year must name the observation period, not the release');
    if (observation.release_date && (observation.release_date > asOf || (observation.epistemic_type !== 'projection' && observation.release_date < observation.period_end))) issue([...path, 'release_date'], 'release must follow the observation period and be available as_of');
    if (observation.retrieved_at.slice(0, 10) > asOf) issue([...path, 'retrieved_at'], 'retrieval is after dataset as_of');
    if (observation.uncertainty && (observation.value === null || observation.uncertainty.lower > observation.value || observation.uncertainty.upper < observation.value || observation.uncertainty.lower > observation.uncertainty.upper)) issue([...path, 'uncertainty'], 'reported uncertainty bounds must contain an available estimate');
    if (observation.confidence_interval) {
      const [lower, upper] = observation.confidence_interval;
      if (observation.value === null || lower > observation.value || upper < observation.value || lower > upper) issue([...path, 'confidence_interval'], 'reported interval must contain an available estimate');
      if (!observation.confidence_level || !observation.confidence_source_id || !sources.has(observation.confidence_source_id) || !observation.confidence_locator) issue([...path, 'confidence_interval'], 'confidence intervals need a level, archived source and locator');
    } else if (observation.confidence_level || observation.confidence_source_id || observation.confidence_locator) issue([...path, 'confidence_interval'], 'confidence metadata requires reported bounds');
    for (const comparison of observation.statistical_comparisons ?? []) {
      const reference = dataset.observations.find(row => row.indicator_id === observation.indicator_id && row.period_start === comparison.reference_period_start && row.period_end === comparison.reference_period_end);
      if (!reference || reference.value === null || observation.value === null || reference.period_end >= observation.period_start) issue([...path, 'statistical_comparisons'], 'producer comparisons need an available earlier reference period for this indicator');
      if (!sources.has(comparison.source_id)) issue([...path, 'statistical_comparisons'], 'producer comparisons need an archived source');
    }
    if (observation.value === null && observation.status !== 'missing') issue([...path, 'status'], 'null values must be explicitly missing');
    if (observation.value !== null && observation.status !== (observation.epistemic_type === 'projection' ? 'source-supported-projection' : 'source-supported-observation')) issue([...path, 'status'], 'status must distinguish a sourced observation from a projection');
    if (observation.value === null && !observation.missing_reason) issue([...path, 'missing_reason'], 'null observations need an explicit missing-data reason');
    if (observation.value !== null && observation.missing_reason !== null) issue([...path, 'missing_reason'], 'an available value cannot also be marked missing');
    if (observation.value !== null && (!observation.source_id || !sources.has(observation.source_id) || !observation.source_locator.trim())) issue([...path, 'source_id'], 'values require an archived source and locator');
    if (observation.source_id && !sources.has(observation.source_id)) issue([...path, 'source_id'], 'unknown source');
    if (indicator) {
      const start = observation.period_start.slice(5), end = observation.period_end.slice(5);
      const expected = indicator.frequency === 'annual' ? start === '01-01' && end === '12-31'
        : indicator.frequency === 'semester' ? (start === '01-01' && end === '06-30') || (start === '07-01' && end === '12-31')
        : start.endsWith('-01') && observation.period_start.slice(0, 7) === observation.period_end.slice(0, 7) && new Date(`${observation.period_end}T00:00:00Z`).getUTCDate() === new Date(Date.UTC(Number(observation.period_end.slice(0, 4)), Number(observation.period_end.slice(5, 7)), 0)).getUTCDate();
      if (!expected) issue(path, `interval must match ${indicator.frequency} frequency`);
    }
  });
});
export type LongitudinalDataset = z.infer<typeof longitudinalDatasetSchema>;
export type LongitudinalIndicator = z.infer<typeof longitudinalIndicatorSchema>;
export type LongitudinalObservation = z.infer<typeof longitudinalObservationSchema>;

/** Nulls remain real rows in chronological tables. Chart segments never join
 * across missing/unreported periods, a method break or changed coverage. */
export function longitudinalSeries(dataset: LongitudinalDataset, indicatorId: string) {
  const indicator = dataset.indicators.find(record => record.id === indicatorId);
  if (!indicator) throw new Error('Unknown longitudinal indicator');
  const observations = dataset.observations.filter(record => record.indicator_id === indicatorId)
    .slice().sort((a, b) => a.period_start.localeCompare(b.period_start));
  const segments: LongitudinalObservation[][] = [];
  let segment: LongitudinalObservation[] = [];
  for (const observation of observations) {
    const previous = segment.at(-1);
    const adjacent = previous && new Date(new Date(`${previous.period_end}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10) === observation.period_start;
    if (observation.value === null || observation.epistemic_type === 'projection' || (previous && (!adjacent || previous.comparability_group !== observation.comparability_group || observation.break_flags.length > 0))) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (observation.value !== null && observation.epistemic_type !== 'projection') segment.push(observation);
  }
  if (segment.length) segments.push(segment);
  return { indicator, observations, segments };
}

/** Endpoint change, not a fitted trend or treatment effect. Missing periods
 * break the line but may be bridged descriptively with an explicit caveat;
 * known method/coverage breaks remain incomparable. No interpolation occurs. */
export function longitudinalChange(dataset: LongitudinalDataset, indicatorId: string, from: string, to: string):
  { comparable: true; delta: number; unit: string; relative_pct: number | null; missing_between: number; caveats: string[]; interpretation: 'descriptive-change-only' } |
  { comparable: false; reason: string } {
  const series = longitudinalSeries(dataset, indicatorId);
  const start = series.observations.find(record => record.period_start === from);
  const end = series.observations.find(record => record.period_start === to);
  if (!start || !end || from >= to) return { comparable: false, reason: 'Choose two reported periods in chronological order.' };
  if (start.value === null || end.value === null || start.epistemic_type === 'projection' || end.epistemic_type === 'projection') return { comparable: false, reason: 'Both endpoints need reported observations, not missing values or projections.' };
  const between = series.observations.filter(record => record.period_start > from && record.period_start <= to);
  if (start.comparability_group !== end.comparability_group || between.some(record => record.comparability_group !== start.comparability_group || record.break_flags.length > 0)) return { comparable: false, reason: 'Known methodology or coverage breaks prevent a comparable endpoint difference.' };
  const periodsPerYear = series.indicator.frequency === 'annual' ? 1 : series.indicator.frequency === 'semester' ? 2 : 12;
  const position = (period: string) => Number(period.slice(0,4)) * periodsPerYear + Math.floor((Number(period.slice(5,7))-1) * periodsPerYear / 12);
  const missing = Math.max(0, position(to) - position(from) - 1 - between.filter(record => record.period_start < to && record.value !== null && record.epistemic_type !== 'projection').length);
  const caveats = ['Descriptive endpoint difference only; no policy effect or causal attribution is estimated.'];
  if (missing) caveats.push(`${missing} intervening period${missing === 1 ? ' is' : 's are'} missing or unreported; no value was interpolated.`);
  if (start.break_flags.length) caveats.push(`The baseline carries source cautions: ${start.break_flags.join('; ')}.`);
  if (series.indicator.frequency === 'semester' && from.slice(5,7) !== to.slice(5,7)) caveats.push('Different semesters are compared; seasonal differences may contribute.');
  return { comparable: true, delta: end.value - start.value,
    unit: series.indicator.unit === '%' ? 'percentage points' : series.indicator.unit,
    relative_pct: start.value === 0 ? null : (end.value - start.value) / Math.abs(start.value) * 100,
    missing_between:missing,caveats,interpretation: 'descriptive-change-only' };
}

/** Exact-period lookup. Missing years are not silently filled from the past. */
export function longitudinalObservationAt(dataset: LongitudinalDataset, indicatorId: string, periodStart: string) {
  return dataset.observations.find(record => record.indicator_id === indicatorId && record.period_start === periodStart) ?? null;
}

/** A partial social-threshold view using a cited analytical benchmark.
 * Shortfall = max(0, (target-value)/target * 100). The radial display alone
 * clips attainment to [0,1]; the numeric ratio/value retains overshooting.
 * No cross-indicator average or country ecological allocation is implied. */
export function socialThresholdAtPeriod(dataset: LongitudinalDataset, indicatorId: string, periodStart: string):
  { status: 'assessed'; value: number; target: number; attainment_ratio: number; display_fraction: number; shortfall_pct: number; target_source_id: string; observation: LongitudinalObservation } |
  { status: 'unknown'; reason: string } {
  const indicator = dataset.indicators.find(record => record.id === indicatorId);
  if (!indicator || indicator.dimension !== 'social' || indicator.direction !== 'higher') return { status: 'unknown', reason: 'This view requires a social indicator with an explicit higher-is-better benchmark.' };
  if (indicator.target === null || indicator.target <= 0 || !indicator.target_source_id || !dataset.sources.some(source => source.id === indicator.target_source_id) || !indicator.target_rationale?.trim()) return { status: 'unknown', reason: 'No positive, source-backed fixed benchmark is configured.' };
  const observation = longitudinalObservationAt(dataset, indicatorId, periodStart);
  if (observation?.epistemic_type === 'projection') return { status: 'unknown', reason: 'A modeled projection cannot fill a historical social-threshold observation.' };
  if (!observation || observation.value === null || observation.status !== 'source-supported-observation') return { status: 'unknown', reason: observation?.missing_reason ?? 'No observation is reported for this exact period.' };
  if (observation.value < 0) return { status: 'unknown', reason: 'A negative value cannot be represented by this social attainment view.' };
  const ratio = observation.value / indicator.target;
  return { status: 'assessed', value: observation.value, target: indicator.target, attainment_ratio: ratio,
    display_fraction: Math.min(1, ratio), shortfall_pct: Math.max(0, (1 - ratio) * 100),
    target_source_id: indicator.target_source_id, observation };
}
