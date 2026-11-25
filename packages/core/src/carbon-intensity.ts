import type { ResearchProvider } from './providers.js';
import type { ResearchStrategy } from './types.js';

/**
 * Carbon-aware research routing & intensity assessment.
 *
 * Defaults new runs to Google Cloud low-CO₂ / high Carbon-Free Energy (CFE)
 * regions (assuming benchmark parity) with optional Vertex AI Batch execution
 * for deferrable portrait builds (~50% lower token cost + solar/off-peak
 * scheduling). Emits warnings ONLY when a run's resolved carbon intensity band
 * is `medium` or `high` — never noisy banners on `low` / carbon-free runs.
 */

export const CARBON_ROUTING_MODES = [
  'carbon_free_first',
  'vertex_batch_low_carbon',
  'schedule_low_carbon',
  'run_now',
] as const;

export type CarbonRoutingMode = (typeof CARBON_ROUTING_MODES)[number];

export type CarbonIntensityBand = 'low' | 'medium' | 'high';

export interface CloudCarbonRegion {
  readonly id: string;
  readonly label: string;
  readonly provider: ResearchProvider;
  /** Published annual Carbon-Free Energy share (0–100%), when disclosed by the cloud provider. */
  readonly cfePct: number | null;
  /** Typical marginal/average grid carbon intensity in gCO₂eq / kWh. */
  readonly gco2PerKwh: number;
  /** Whether Vertex AI Batch Prediction is supported in this region. */
  readonly supportsVertexBatch: boolean;
  /** Electricity Maps zone key for optional real-time grid intensity lookups. */
  readonly electricityMapsZone?: string;
}

/**
 * Curated cloud region carbon profiles (Google Cloud published CFE% +
 * Electricity Maps reference grid intensities). Google's high-CFE regions
 * (`>= 75%` CFE / `< 100 gCO₂eq/kWh`) sit first as carbon-free defaults.
 */
export const CLOUD_CARBON_REGIONS: readonly CloudCarbonRegion[] = Object.freeze([
  Object.freeze({
    id: 'northamerica-northeast1',
    label: 'Google Cloud · Montréal (northamerica-northeast1 · ~100% CFE hydro)',
    provider: 'google',
    cfePct: 100,
    gco2PerKwh: 20,
    supportsVertexBatch: true,
    electricityMapsZone: 'CA-QC',
  }),
  Object.freeze({
    id: 'europe-west6',
    label: 'Google Cloud · Zürich (europe-west6 · ~97% CFE hydro/nuclear)',
    provider: 'google',
    cfePct: 97,
    gco2PerKwh: 30,
    supportsVertexBatch: true,
    electricityMapsZone: 'CH',
  }),
  Object.freeze({
    id: 'europe-north1',
    label: 'Google Cloud · Finland (europe-north1 · ~98% CFE wind/hydro/nuclear)',
    provider: 'google',
    cfePct: 98,
    gco2PerKwh: 35,
    supportsVertexBatch: true,
    electricityMapsZone: 'FI',
  }),
  Object.freeze({
    id: 'us-west1',
    label: 'Google Cloud · Oregon (us-west1 · ~92% CFE hydro/wind)',
    provider: 'google',
    cfePct: 92,
    gco2PerKwh: 65,
    supportsVertexBatch: true,
    electricityMapsZone: 'US-NW-BPAT',
  }),
  Object.freeze({
    id: 'us-west2',
    label: 'Google Cloud · Los Angeles (us-west2 · solar-peaking CAISO grid)',
    provider: 'google',
    cfePct: 62,
    gco2PerKwh: 175,
    supportsVertexBatch: true,
    electricityMapsZone: 'US-CAL-CISO',
  }),
  Object.freeze({
    id: 'us-central1',
    label: 'Google Cloud · Iowa (us-central1 · mixed wind/coal grid)',
    provider: 'google',
    cfePct: 68,
    gco2PerKwh: 210,
    supportsVertexBatch: true,
    electricityMapsZone: 'US-MIDW-MISO',
  }),
  Object.freeze({
    id: 'us-east4',
    label: 'Google Cloud · Northern Virginia (us-east4 · higher-carbon grid)',
    provider: 'google',
    cfePct: 42,
    gco2PerKwh: 340,
    supportsVertexBatch: true,
    electricityMapsZone: 'US-MIDA-PJM',
  }),
  Object.freeze({
    id: 'openai-us-default',
    label: 'OpenAI API · US multi-region (grid mix undisclosed)',
    provider: 'openai',
    cfePct: null,
    gco2PerKwh: 320,
    supportsVertexBatch: false,
  }),
  Object.freeze({
    id: 'anthropic-us-default',
    label: 'Anthropic API · US multi-region (grid mix undisclosed)',
    provider: 'anthropic',
    cfePct: null,
    gco2PerKwh: 310,
    supportsVertexBatch: false,
  }),
]);

export const DEFAULT_CARBON_FREE_REGION_ID = 'northamerica-northeast1';

export interface CarbonRoutingPreference {
  mode: CarbonRoutingMode;
  provider: ResearchProvider;
  regionId: string;
}

/** Default policy: Google models routed to a carbon-free (high-CFE) region. */
export const DEFAULT_CARBON_ROUTING: Readonly<CarbonRoutingPreference> = Object.freeze({
  mode: 'carbon_free_first',
  provider: 'google',
  regionId: DEFAULT_CARBON_FREE_REGION_ID,
});

export interface CarbonIntensityClassification {
  band: CarbonIntensityBand;
  gco2PerKwh: number;
  cfePct: number | null;
  /** True ONLY for `medium` or `high` intensity runs; `low` stays quiet. */
  shouldWarn: boolean;
  warningHeadline: string | null;
  warningRecommendation: string | null;
}

/**
 * Classify a region/grid's carbon intensity into `low`, `medium`, or `high`.
 * Warnings are emitted strictly for `medium` and `high` runs.
 */
export function classifyCarbonIntensity(
  gco2PerKwh: number,
  cfePct: number | null = null,
): CarbonIntensityClassification {
  const intensity = Math.max(0, Math.round(gco2PerKwh));

  if (intensity < 100 || (cfePct !== null && cfePct >= 75 && intensity < 120)) {
    return {
      band: 'low',
      gco2PerKwh: intensity,
      cfePct,
      shouldWarn: false,
      warningHeadline: null,
      warningRecommendation: null,
    };
  }

  if (intensity <= 250) {
    return {
      band: 'medium',
      gco2PerKwh: intensity,
      cfePct,
      shouldWarn: true,
      warningHeadline: `Medium carbon intensity (~${intensity} gCO₂eq/kWh)`,
      warningRecommendation:
        'Route to a carbon-free Google Cloud region (Montréal or Oregon) or use Vertex AI Batch during peak solar hours to cut run emissions by ~60–90%.',
    };
  }

  return {
    band: 'high',
    gco2PerKwh: intensity,
    cfePct,
    shouldWarn: true,
    warningHeadline: `High carbon intensity (~${intensity} gCO₂eq/kWh)`,
    warningRecommendation:
      'Switch to Carbon-free first (Google Montréal ~100% CFE / Oregon ~92% CFE) or schedule via Vertex AI Batch during a low-carbon window to cut run emissions by ~80–95%.',
  };
}

export function carbonRegionById(regionId: string): CloudCarbonRegion | undefined {
  return CLOUD_CARBON_REGIONS.find((r) => r.id === regionId);
}

/**
 * Rough order-of-magnitude SCI-for-AI energy factor per research session (Wh),
 * used only to display comparative carbon estimates alongside cost estimates.
 */
const ESTIMATED_WH_PER_SESSION: Record<ResearchStrategy, number> = {
  standard: 4.5,
  hybrid: 6.5,
  deep: 11.0,
};

export interface RunCarbonAssessment {
  effectiveMode: CarbonRoutingMode;
  effectiveProvider: ResearchProvider;
  effectiveRegion: CloudCarbonRegion;
  classification: CarbonIntensityClassification;
  useVertexBatch: boolean;
  deferIfHighCarbon: boolean;
  /** Estimated operational emissions in grams CO₂eq for the selected sessions. */
  estimatedGramsCo2: number;
}

/**
 * Resolve effective provider/region routing and emit a carbon intensity
 * assessment for a planned research run.
 */
export function assessRunCarbon(input: {
  mode: CarbonRoutingMode;
  regionId?: string;
  sessions: number;
  strategy: ResearchStrategy;
  /** Optional real-time grid carbon intensity from Electricity Maps / WattTime. */
  liveIntensityGco2PerKwh?: number | null;
}): RunCarbonAssessment {
  const defaultRegion = carbonRegionById(DEFAULT_CARBON_FREE_REGION_ID)!;
  const requested = input.regionId ? carbonRegionById(input.regionId) : undefined;

  let effectiveRegion: CloudCarbonRegion;
  if (input.mode === 'carbon_free_first' || input.mode === 'vertex_batch_low_carbon') {
    // Honor a user-chosen Google region if provided, otherwise default to Montréal (100% CFE).
    effectiveRegion =
      requested && requested.provider === 'google' ? requested : defaultRegion;
  } else {
    effectiveRegion = requested ?? defaultRegion;
  }

  const activeGco2 =
    typeof input.liveIntensityGco2PerKwh === 'number' && Number.isFinite(input.liveIntensityGco2PerKwh)
      ? input.liveIntensityGco2PerKwh
      : effectiveRegion.gco2PerKwh;

  // When a live grid signal is passed, classify strictly from the live gCO₂eq/kWh reading.
  const effectiveCfe =
    typeof input.liveIntensityGco2PerKwh === 'number' && Number.isFinite(input.liveIntensityGco2PerKwh)
      ? null
      : effectiveRegion.cfePct;

  const classification = classifyCarbonIntensity(activeGco2, effectiveCfe);
  const whPerSession =
    ESTIMATED_WH_PER_SESSION[input.strategy] ?? ESTIMATED_WH_PER_SESSION.standard ?? 4.5;
  const totalKwh = (Math.max(0, input.sessions) * whPerSession) / 1000;
  const estimatedGramsCo2 = Math.round(totalKwh * classification.gco2PerKwh * 10) / 10;

  return {
    effectiveMode: input.mode,
    effectiveProvider: effectiveRegion.provider,
    effectiveRegion,
    classification,
    useVertexBatch: input.mode === 'vertex_batch_low_carbon' && effectiveRegion.supportsVertexBatch,
    deferIfHighCarbon: input.mode === 'schedule_low_carbon' && classification.shouldWarn,
    estimatedGramsCo2,
  };
}
