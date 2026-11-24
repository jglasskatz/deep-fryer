import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  priceSessionUsage,
  type FindingPayload,
  type Ring,
  type SessionTokenUsage,
} from '@deep-fryer/core';
import {
  CALIFORNIA_REPORT_BLOCKLIST,
  auditSourceLeaks,
  type SourceBlocklist,
  type SourceLeakAuditResult,
} from './source-blocklist.js';

/**
 * California 2025 Golden-Test Dataset Loader & Scorer.
 *
 * Loads the 42 report-verified indicators from `site/imports/california/doughnut.json`
 * and `site/imports/california/report-audit.json` and scores independently
 * researched findings against the published 2025 California Doughnut Snapshot
 * & Report — while enforcing strict source-leak blocking so the report itself
 * can never be used as an answer key.
 */

export interface CaliforniaGoldenIndicator {
  /** Legacy numeric id from `doughnut.json`. */
  id: number;
  /** Deterministic slug derived from indicator name (e.g. `housing-cost-burden`). */
  slug: string;
  /** Optional corresponding Deep Fryer framework indicator slug when one exists. */
  frameworkIndicatorSlug?: string;
  /** Indicator name from `doughnut.json`. */
  name: string;
  /** Exact indicator label printed in the 2025 report tables (p84–85). */
  reportName: string;
  /** Canonical Deep Fryer dimension slug (e.g. `housing`, `air-pollution`, `income-work`). */
  dimensionSlug: string;
  /** Original category slug in `site/imports/california/doughnut.json`. */
  californiaDimensionSlug: string;
  /** Human-readable dimension title. */
  dimensionName: string;
  ring: Ring;
  /** Verified indicator definition from `report-audit.json`. */
  definition: string;
  /** Native ground-truth measurement string from the 2025 report (e.g. `"55%"`, `"0.47%"`, `"19.6"`). */
  value: string;
  /** Parsed single numeric measurement when unambiguous, else `null` (e.g. categorical `"Yes"` or compound `"25.2% / 16.2%"`). */
  numericValue: number | null;
  /** Normalized measurement unit (e.g. `"%"`, `"Tonnes CO2 eq"`, `"Dobson Units"`, `"Yes/No"`). */
  unit: string;
  /** Primary measured year (for ranges like `"2021-2023"`, uses the end year `2023`). */
  year: number | null;
  /** Exact measured period string from `report-audit.json` (e.g. `"2023"`, `"2021-2023"`). */
  period: string;
  /** Verified native target string from `report-audit.json` (e.g. `"0%"`, `"100%"`, `"0.985"`, `">276"`). */
  target: string;
  /** Parsed numeric target when unambiguous, else `null`. */
  numericTarget: number | null;
  /** Verified shortfall/overshoot percentage score from the 2025 report. */
  score: number;
  /** Exact score display text from the 2025 report (e.g. `"55%"`, `"No Overshoot"`). */
  scoreText: string;
  metric: 'shortfall' | 'overshoot';
  /** Underlying primary source citation listed in `doughnut.json`. */
  source: string;
  /** Underlying primary source URL listed in `doughnut.json`. */
  sourceUrl: string;
  /** Page number in the 2025 California report (84 for social, 85 for ecological). */
  page: number;
  caveats: string[];
}

export interface CaliforniaGoldenReportMeta {
  title: string;
  authors: string;
  publicationDate: string;
  doi: string;
  recordUrl: string;
  downloadUrl: string;
  pages: number;
  tablePages: number[];
}

export interface CaliforniaGoldenDataset {
  report: CaliforniaGoldenReportMeta;
  indicators: CaliforniaGoldenIndicator[];
  /** Indicators grouped by canonical dimension slug (`housing`, `air-pollution`, `income-work`, ...). */
  byDimension: Record<string, CaliforniaGoldenIndicator[]>;
  /** All canonical dimension slugs present in the dataset, in report order. */
  dimensionSlugs: string[];
}

/**
 * Mapping from California report category slugs (`doughnut.json`) to canonical
 * Deep Fryer framework dimension slugs (`packages/contract/framework/framework.json`).
 */
export const CALIFORNIA_TO_CANONICAL_DIMENSION: Readonly<Record<string, string>> = Object.freeze({
  'connectivity-and-transportation': 'networks',
  education: 'education',
  energy: 'energy',
  equity: 'gender-equality',
  food: 'food',
  health: 'health',
  housing: 'housing',
  'income-and-work': 'income-work',
  'peace-and-justice': 'peace-justice',
  'political-voice': 'political-voice',
  'social-cohesion': 'social-equity',
  'water-and-sanitation': 'water-sanitation',
  'air-pollution': 'air-pollution',
  'biodiversity-loss': 'biodiversity-loss',
  'chemical-pollution': 'chemical-pollution',
  'climate-change': 'climate-change',
  'freshwater-use': 'freshwater-withdrawals',
  'land-use-change': 'land-conversion',
  'nitrogen-and-phosphorus': 'nitrogen-phosphorus-loading',
  'ocean-acidification': 'ocean-acidification',
  'ozone-depletion': 'ozone-depletion',
});

/** Optional mapping from California golden indicator slugs to Deep Fryer framework indicator slugs. */
const CALIFORNIA_TO_FRAMEWORK_INDICATOR: Readonly<Record<string, string>> = Object.freeze({
  'connectivity-internet-access': 'broadband-access',
  'energy-burden': 'energy-burden',
  'gender-pay-gap': 'gender-pay-ratio',
  'food-insecurity': 'food-insecurity-rate',
  'life-expectancy': 'life-expectancy',
  homelessness: 'homelessness-rate',
  'housing-cost-burden': 'cost-burdened-renters',
  poverty: 'poverty-rate',
  'unemployment-u-6': 'unemployment-rate',
  'violent-crime': 'violent-crime-rate',
  'voter-turnout': 'voter-turnout',
  'income-inequality': 'gini-index',
  'water-quality': 'safe-drinking-water',
  'particulate-matter': 'pm25-annual',
  'protected-area': 'protected-land-share',
  'toxic-chemicals-released': 'tri-releases-per-capita',
  'greenhouse-gas-footprint': 'ghg-per-capita',
  'ozone-depleting-substances': 'ods-phaseout-compliance',
});

/** Normalize a dimension slug (accepting either California or canonical framework slugs). */
export function resolveCaliforniaDimensionSlug(rawSlug: string): string {
  const normalized = rawSlug.trim().toLowerCase().replace(/_/g, '-');
  return CALIFORNIA_TO_CANONICAL_DIMENSION[normalized] ?? normalized;
}

export function slugifyIndicatorName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findRepoRootFromModule(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'site', 'imports', 'california', 'report-audit.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function parseLeadingNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Compound values like "25.2% / 16.2%" or "33.1% / 29.7%" are not a single scalar.
  if (trimmed.includes('/')) return null;
  const cleaned = trimmed.replace(/,/g, '').replace(/^[<>≤≥~≈]+\s*/, '').replace(/%$/, '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parsePeriodYear(period: string): number | null {
  const matches = [...period.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]));
  if (matches.length === 0) return null;
  return matches[matches.length - 1] ?? null;
}

function inferUnit(auditUnit: string, auditValue: string, doughnutUnit: string | null): string {
  const trimmedAudit = auditUnit.trim();
  if (trimmedAudit) return trimmedAudit;
  const trimmedDoughnut = doughnutUnit?.trim() ?? '';
  if (trimmedDoughnut) return trimmedDoughnut;
  if (auditValue.includes('%')) return '%';
  return '';
}

interface RawDoughnutIndicator {
  id: number;
  name: string;
  description: string;
  value: string;
  unit: string | null;
  year: number;
  shortfall_pct: number | null;
  overshoot_pct: number | null;
  target: string;
  source: string;
  source_url: string;
}

interface RawDoughnutCategory {
  id: number;
  slug: string;
  name: string;
  ring: Ring;
  indicators: RawDoughnutIndicator[];
}

interface RawDoughnutFile {
  social: RawDoughnutCategory[];
  ecological: RawDoughnutCategory[];
}

interface RawReportAuditIndicator {
  name: string;
  report_name: string;
  ring: Ring;
  page: number;
  metric: 'shortfall' | 'overshoot';
  score_pct: number;
  score_text: string;
  measurement: {
    definition: string;
    value: string;
    unit: string;
    target: string;
    period: string;
  };
  caveats?: string[];
}

interface RawReportAuditFile {
  report: {
    title: string;
    authors: string;
    publication_date: string;
    doi: string;
    record_url: string;
    download_url: string;
    pages: number;
    table_pages: number[];
  };
  indicators: RawReportAuditIndicator[];
}

/**
 * Load all 42 report-verified California 2025 indicators from
 * `site/imports/california/doughnut.json` + `report-audit.json`, grouped by
 * canonical dimension slug (`housing`, `air-pollution`, `income-work`, etc.).
 */
export function loadCaliforniaGolden(repoRoot?: string): CaliforniaGoldenDataset {
  const root = repoRoot ?? findRepoRootFromModule();
  const baseDir = path.join(root, 'site', 'imports', 'california');
  const doughnutPath = path.join(baseDir, 'doughnut.json');
  const auditPath = path.join(baseDir, 'report-audit.json');

  const doughnut = JSON.parse(readFileSync(doughnutPath, 'utf8')) as RawDoughnutFile;
  const audit = JSON.parse(readFileSync(auditPath, 'utf8')) as RawReportAuditFile;

  const auditByKey = new Map<string, RawReportAuditIndicator>();
  for (const row of audit.indicators) {
    auditByKey.set(`${row.ring}:${row.name}`, row);
  }

  const indicators: CaliforniaGoldenIndicator[] = [];
  const byDimension: Record<string, CaliforniaGoldenIndicator[]> = {};
  const dimensionSlugs: string[] = [];

  for (const ring of ['social', 'ecological'] as const) {
    for (const category of doughnut[ring]) {
      const canonicalSlug = resolveCaliforniaDimensionSlug(category.slug);
      if (!byDimension[canonicalSlug]) {
        byDimension[canonicalSlug] = [];
        dimensionSlugs.push(canonicalSlug);
      }
      for (const rec of category.indicators) {
        const verified = auditByKey.get(`${ring}:${rec.name}`);
        if (!verified) {
          throw new Error(`California golden indicator missing in report-audit.json: ${ring}/${rec.name}`);
        }
        const slug = slugifyIndicatorName(rec.name);
        const unit = inferUnit(verified.measurement.unit, verified.measurement.value, rec.unit);
        const indicator: CaliforniaGoldenIndicator = {
          id: rec.id,
          slug,
          ...(CALIFORNIA_TO_FRAMEWORK_INDICATOR[slug]
            ? { frameworkIndicatorSlug: CALIFORNIA_TO_FRAMEWORK_INDICATOR[slug] }
            : {}),
          name: rec.name,
          reportName: verified.report_name,
          dimensionSlug: canonicalSlug,
          californiaDimensionSlug: category.slug,
          dimensionName: category.name,
          ring,
          definition: verified.measurement.definition,
          value: verified.measurement.value,
          numericValue: parseLeadingNumber(verified.measurement.value),
          unit,
          year: parsePeriodYear(verified.measurement.period) ?? (Number.isFinite(rec.year) ? rec.year : null),
          period: verified.measurement.period,
          target: verified.measurement.target,
          numericTarget: parseLeadingNumber(verified.measurement.target),
          score: verified.score_pct,
          scoreText: verified.score_text,
          metric: verified.metric,
          source: rec.source,
          sourceUrl: rec.source_url,
          page: verified.page,
          caveats: [...(verified.caveats ?? [])],
        };
        indicators.push(indicator);
        byDimension[canonicalSlug]!.push(indicator);
      }
    }
  }

  if (indicators.length !== 42) {
    throw new Error(`Expected 42 verified California golden indicators, loaded ${indicators.length}`);
  }

  return {
    report: {
      title: audit.report.title,
      authors: audit.report.authors,
      publicationDate: audit.report.publication_date,
      doi: audit.report.doi,
      recordUrl: audit.report.record_url,
      downloadUrl: audit.report.download_url,
      pages: audit.report.pages,
      tablePages: [...audit.report.table_pages],
    },
    indicators,
    byDimension,
    dimensionSlugs,
  };
}

/** Select golden indicators for one or more canonical or California dimension slugs. */
export function selectCaliforniaGoldenDimensions(
  dataset: CaliforniaGoldenDataset,
  requestedSlugs: readonly string[],
): { dimensionSlugs: string[]; indicators: CaliforniaGoldenIndicator[] } {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const raw of requestedSlugs) {
    const slug = resolveCaliforniaDimensionSlug(raw);
    if (!dataset.byDimension[slug]) {
      throw new Error(
        `Unknown California golden dimension "${raw}". Available canonical dimensions: ${dataset.dimensionSlugs.join(', ')}`,
      );
    }
    if (!seen.has(slug)) {
      seen.add(slug);
      resolved.push(slug);
    }
  }
  const indicators = resolved.flatMap((slug) => dataset.byDimension[slug] ?? []);
  return { dimensionSlugs: resolved, indicators };
}

// ---------------------------------------------------------------------------
// Unit Compatibility & Normalization
// ---------------------------------------------------------------------------

type UnitKind =
  | 'percent'
  | 'proportion'
  | 'per_1k'
  | 'per_10k'
  | 'per_100k'
  | 'tonnes_co2'
  | 'cubic_meters_water'
  | 'global_hectares'
  | 'tonnes_n'
  | 'kg_n_eq'
  | 'kg_so2_eq'
  | 'dobson_units'
  | 'ph'
  | 'yes_no'
  | 'dimensionless'
  | 'other';

function classifyUnit(unit: string, valueStr?: string): UnitKind {
  const u = unit.trim().toLowerCase();
  if (!u) {
    if (valueStr?.includes('%')) return 'percent';
    if (valueStr && /^(?:yes|no|true|false)$/i.test(valueStr.trim())) return 'yes_no';
    return 'dimensionless';
  }
  if (u === 'yes/no' || u === 'boolean' || u === 'compliance') return 'yes_no';
  if (/\bper\s*100[,.]?000\b|\b\/\s*100[,.]?000\b|\bper\s*100k\b/.test(u)) return 'per_100k';
  if (/\bper\s*10[,.]?000\b|\b\/\s*10[,.]?000\b|\bper\s*10k\b/.test(u)) return 'per_10k';
  if (/\bper\s*1[,.]?000\b|\b\/\s*1[,.]?000\b|\bper\s*1k\b/.test(u)) return 'per_1k';
  if (u.includes('%') || /\bpercent(?:age)?\b/.test(u) || /\bpct\b/.test(u)) return 'percent';
  if (/\b(?:proportion|fraction|decimal|ratio)\b/.test(u)) return 'proportion';
  if (/\b(?:tco2e?|tonnes?\s*co2|metric\s*tons?\s*co2)\b/.test(u)) return 'tonnes_co2';
  if (/\b(?:cubic\s*meters?|m3|m³)\b/.test(u)) return 'cubic_meters_water';
  if (/\b(?:global\s*hectares?|gha)\b/.test(u)) return 'global_hectares';
  if (/\btonnes?\s*nitrogen\b/.test(u)) return 'tonnes_n';
  if (/\bkg\s*n\b/.test(u)) return 'kg_n_eq';
  if (/\bkg\s*so2\b/.test(u)) return 'kg_so2_eq';
  if (/\b(?:dobson|du)\b/.test(u)) return 'dobson_units';
  if (/\bph\b/.test(u)) return 'ph';
  if (/\b(?:score|index|points?|out\s*of\s*\d+)\b/.test(u)) return 'dimensionless';
  return 'other';
}

function normalizeNumericToGoldenUnit(
  findingValue: number,
  findingUnit: string,
  golden: CaliforniaGoldenIndicator,
): { compatible: boolean; normalizedValue: number | null; note?: string } {
  const gKind = classifyUnit(golden.unit, golden.value);
  const fKind = classifyUnit(findingUnit);

  if (gKind === fKind && gKind !== 'other') {
    return { compatible: true, normalizedValue: findingValue };
  }

  // Exact raw string match for custom/other units.
  if (
    gKind === 'other' &&
    findingUnit.trim().toLowerCase() === golden.unit.trim().toLowerCase()
  ) {
    return { compatible: true, normalizedValue: findingValue };
  }

  // Safe conversions into `%` (e.g. per-10,000 homelessness rate -> % of population).
  if (gKind === 'percent') {
    if (fKind === 'per_10k') {
      return {
        compatible: true,
        normalizedValue: findingValue / 100,
        note: `normalized ${findingValue} (${findingUnit}) -> ${(findingValue / 100).toFixed(4)}%`,
      };
    }
    if (fKind === 'per_100k') {
      return {
        compatible: true,
        normalizedValue: findingValue / 1000,
        note: `normalized ${findingValue} (${findingUnit}) -> ${(findingValue / 1000).toFixed(4)}%`,
      };
    }
    if (fKind === 'per_1k') {
      return {
        compatible: true,
        normalizedValue: findingValue / 10,
        note: `normalized ${findingValue} (${findingUnit}) -> ${(findingValue / 10).toFixed(4)}%`,
      };
    }
    if (fKind === 'proportion' && findingValue >= 0 && findingValue <= 1) {
      return {
        compatible: true,
        normalizedValue: findingValue * 100,
        note: `normalized proportion ${findingValue} -> ${(findingValue * 100).toFixed(2)}%`,
      };
    }
    // Empty unit on finding when value is a plain percentage scalar (e.g. 55 vs "55%").
    if (!findingUnit.trim() && fKind === 'dimensionless') {
      return { compatible: true, normalizedValue: findingValue };
    }
  }

  // Dimensionless score scales (e.g. Transit Report Card 6/10, Racial Equity Index 60/100).
  if (gKind === 'dimensionless' && (fKind === 'dimensionless' || fKind === 'percent')) {
    if (fKind === 'dimensionless') return { compatible: true, normalizedValue: findingValue };
    if (golden.numericTarget === 100) return { compatible: true, normalizedValue: findingValue };
  }

  return { compatible: false, normalizedValue: null };
}

function parseYesNo(raw: string | number | boolean): boolean | null {
  if (typeof raw === 'boolean') return raw;
  const s = String(raw).trim().toLowerCase();
  if (/^(?:yes|true|compliant|in compliance|full compliance|100%?)$/.test(s)) return true;
  if (/^(?:no|false|non-?compliant|0%?)$/.test(s)) return false;
  return null;
}

function parseCompoundNumbers(raw: string): number[] | null {
  if (!raw.includes('/')) return null;
  const parts = raw.split('/').map((p) => parseLeadingNumber(p));
  if (parts.length >= 2 && parts.every((n): n is number => n !== null)) {
    return parts;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Finding Scoring Against Golden Indicator
// ---------------------------------------------------------------------------

export type GoldenMatchBand =
  | 'exact'
  | 'close'
  | 'directional'
  | 'divergent'
  | 'gap_or_missing'
  | 'source_leak';

export type GoldenTemporalNote = 'newer_primary_data' | 'same_year' | 'older_data' | null;

/** Flexible finding shape accepted by `scoreFindingAgainstGolden` and `scoreGoldenRun`. */
export interface GoldenFindingLike {
  indicator_slug?: string;
  indicatorSlug?: string;
  dimensionSlug?: string;
  kind?: 'indicator' | 'gap' | 'proxy';
  value?: number | string;
  unit?: string;
  year?: number;
  target?: number | string | null;
  level_pct?: number;
  source?: string;
  source_name?: string;
  source_url?: string;
  notes?: string;
  sources_checked?: unknown;
  narrative_draft?: unknown;
  payload?: FindingPayload;
}

export interface GoldenIndicatorScore {
  dimensionSlug: string;
  dimensionName: string;
  indicatorSlug: string;
  indicatorName: string;
  goldenValue: string;
  goldenNumericValue: number | null;
  goldenUnit: string;
  goldenYear: number | null;
  goldenPeriod: string;
  goldenTarget: string;
  goldenScore: number;
  goldenPage: number;
  researchedValue: string | null;
  researchedNumericValue: number | null;
  normalizedResearchedValue: number | null;
  researchedUnit: string | null;
  researchedYear: number | null;
  researchedSourceName: string | null;
  researchedSourceUrl: string | null;
  matched: boolean;
  unitsCompatible: boolean;
  numericDelta: number | null;
  relativeErrorPct: number | null;
  sameSideOfTarget: boolean | null;
  matchBand: GoldenMatchBand;
  yearDelta: number | null;
  newerPrimaryData: boolean;
  temporalNote: GoldenTemporalNote;
  sourceLeakDetected: boolean;
  sourceLeakReasons: string[];
  notes: string[];
}

export interface ScoreFindingOptions {
  blocklist?: SourceBlocklist;
}

function unwrapFinding(raw: GoldenFindingLike | null | undefined): {
  kind?: string;
  slug?: string;
  value?: number | string;
  unit?: string;
  year?: number;
  target?: number | string | null;
  level_pct?: number;
  source?: string;
  source_name?: string;
  source_url?: string;
  rawObject?: unknown;
} | null {
  if (!raw) return null;
  if (raw.payload && typeof raw.payload === 'object') {
    const p = raw.payload;
    if (p.kind === 'gap') {
      return { kind: 'gap', slug: p.indicator_slug, rawObject: raw };
    }
    return {
      kind: p.kind,
      slug: p.indicator_slug,
      value: p.value,
      unit: p.unit,
      year: p.year,
      target: p.target,
      level_pct: p.level_pct,
      source_name: p.source,
      source_url: p.source_url,
      rawObject: raw,
    };
  }
  return {
    kind: raw.kind ?? (raw.value !== undefined ? 'indicator' : undefined),
    slug: raw.indicator_slug ?? raw.indicatorSlug,
    value: raw.value,
    unit: raw.unit,
    year: raw.year,
    target: raw.target,
    level_pct: raw.level_pct,
    source_name: raw.source_name ?? raw.source,
    source_url: raw.source_url,
    rawObject: raw,
  };
}

function isSameSideOfTarget(
  goldenValue: number | null,
  goldenTarget: number | null,
  goldenScore: number,
  findingNormalizedValue: number | null,
  findingLevelPct: number | undefined,
  findingRawValue: number | null,
  findingTarget: number | null,
): boolean | null {
  // Primary check: both numeric values against the golden target.
  if (goldenValue !== null && goldenTarget !== null && findingNormalizedValue !== null) {
    const gDiff = goldenValue - goldenTarget;
    const fDiff = findingNormalizedValue - goldenTarget;
    if (gDiff === 0 && fDiff === 0) return true;
    if (gDiff === 0 || fDiff === 0) return Math.abs(fDiff - gDiff) <= 2;
    return Math.sign(gDiff) === Math.sign(fDiff);
  }
  // Fallback when units differ: compare whether both show shortfall/overshoot (score > 0) vs within-boundary (score === 0).
  const goldenBeyondBoundary = goldenScore > 0;
  if (typeof findingLevelPct === 'number' && Number.isFinite(findingLevelPct)) {
    const findingBeyondBoundary = findingLevelPct > 0;
    return goldenBeyondBoundary === findingBeyondBoundary;
  }
  if (findingRawValue !== null && findingTarget !== null) {
    return goldenBeyondBoundary === (findingRawValue !== findingTarget);
  }
  return null;
}

/**
 * Score a single researched finding against one California 2025 golden indicator.
 *
 * Match bands:
 * - `'source_leak'`: finding cites or references a blocked report URL/domain/DOI (automatic fail).
 * - `'gap_or_missing'`: no finding returned or finding is `kind: 'gap'`.
 * - `'exact'`: compatible units with `<= 2%` relative error (or exact categorical match).
 * - `'close'`: compatible units with `<= 10%` relative error.
 * - `'directional'`: `<= 25%` relative error, or same side of target when golden is 0 or units differ.
 * - `'divergent'`: `> 25%` relative error on compatible units (or opposite side / incompatible mismatch).
 *
 * Newer primary data (`yearDelta > 0`) is recorded explicitly as
 * `temporalNote: 'newer_primary_data'` and never penalized as wrong.
 */
export function scoreFindingAgainstGolden(
  finding: GoldenFindingLike | null | undefined,
  golden: CaliforniaGoldenIndicator,
  opts: ScoreFindingOptions = {},
): GoldenIndicatorScore {
  const blocklist = opts.blocklist ?? CALIFORNIA_REPORT_BLOCKLIST;
  const unwrapped = unwrapFinding(finding);

  const base: GoldenIndicatorScore = {
    dimensionSlug: golden.dimensionSlug,
    dimensionName: golden.dimensionName,
    indicatorSlug: golden.slug,
    indicatorName: golden.name,
    goldenValue: golden.value,
    goldenNumericValue: golden.numericValue,
    goldenUnit: golden.unit,
    goldenYear: golden.year,
    goldenPeriod: golden.period,
    goldenTarget: golden.target,
    goldenScore: golden.score,
    goldenPage: golden.page,
    researchedValue: null,
    researchedNumericValue: null,
    normalizedResearchedValue: null,
    researchedUnit: null,
    researchedYear: null,
    researchedSourceName: null,
    researchedSourceUrl: null,
    matched: false,
    unitsCompatible: false,
    numericDelta: null,
    relativeErrorPct: null,
    sameSideOfTarget: null,
    matchBand: 'gap_or_missing',
    yearDelta: null,
    newerPrimaryData: false,
    temporalNote: null,
    sourceLeakDetected: false,
    sourceLeakReasons: [],
    notes: [],
  };

  if (!unwrapped) {
    base.notes.push('No finding returned for indicator');
    return base;
  }

  // 1. Source-leak check runs before everything else (including gaps that might mention the report).
  const leakAudit = auditSourceLeaks([unwrapped.rawObject], null, blocklist);
  if (!leakAudit.clean) {
    base.sourceLeakDetected = true;
    base.sourceLeakReasons = leakAudit.findingLeaks.map((l) => `${l.field ?? 'finding'}: ${l.match.reason}`);
    base.matchBand = 'source_leak';
    base.matched = false;
    base.researchedValue = unwrapped.value !== undefined ? String(unwrapped.value) : null;
    base.researchedUnit = unwrapped.unit ?? null;
    base.researchedYear = typeof unwrapped.year === 'number' ? unwrapped.year : null;
    base.researchedSourceName = unwrapped.source_name ?? null;
    base.researchedSourceUrl = unwrapped.source_url ?? null;
    base.notes.push('AUTOMATIC FAIL: blocked California 2025 report answer-key source referenced');
    return base;
  }

  // 2. Gap finding.
  if (unwrapped.kind === 'gap' || unwrapped.value === undefined) {
    base.matchBand = 'gap_or_missing';
    base.matched = false;
    base.notes.push('Research session returned a data gap');
    return base;
  }

  base.researchedValue = String(unwrapped.value);
  base.researchedUnit = unwrapped.unit ?? '';
  base.researchedYear = typeof unwrapped.year === 'number' && Number.isFinite(unwrapped.year) ? unwrapped.year : null;
  base.researchedSourceName = unwrapped.source_name ?? null;
  base.researchedSourceUrl = unwrapped.source_url ?? null;

  // 3. Temporal comparison (never penalizes newer primary data).
  if (base.researchedYear !== null && golden.year !== null) {
    base.yearDelta = base.researchedYear - golden.year;
    if (base.yearDelta > 0) {
      base.newerPrimaryData = true;
      base.temporalNote = 'newer_primary_data';
      base.notes.push(
        `newer_primary_data: researched ${base.researchedYear} primary release (+${base.yearDelta}y vs report's ${golden.period})`,
      );
    } else if (base.yearDelta === 0) {
      base.temporalNote = 'same_year';
    } else {
      base.temporalNote = 'older_data';
      base.notes.push(`older_data: researched ${base.researchedYear} (${base.yearDelta}y vs report's ${golden.period})`);
    }
  }

  // 4. Categorical Yes/No indicators (e.g. Ozone-Depleting Substances).
  if (classifyUnit(golden.unit, golden.value) === 'yes_no') {
    const gBool = parseYesNo(golden.value);
    const fBool = parseYesNo(unwrapped.value);
    if (gBool !== null && fBool !== null) {
      base.unitsCompatible = true;
      base.sameSideOfTarget = gBool === fBool;
      base.relativeErrorPct = gBool === fBool ? 0 : 100;
      base.numericDelta = gBool === fBool ? 0 : 1;
      base.matchBand = gBool === fBool ? 'exact' : 'divergent';
      base.matched = gBool === fBool;
      return base;
    }
  }

  // 5. Parse finding numeric value.
  const findingNumeric =
    typeof unwrapped.value === 'number' && Number.isFinite(unwrapped.value)
      ? unwrapped.value
      : parseLeadingNumber(String(unwrapped.value));
  base.researchedNumericValue = findingNumeric;

  const findingTargetNumeric =
    typeof unwrapped.target === 'number' && Number.isFinite(unwrapped.target)
      ? unwrapped.target
      : typeof unwrapped.target === 'string'
        ? parseLeadingNumber(unwrapped.target)
        : null;

  // 6. Compound slash golden values (e.g. "25.2% / 16.2%").
  const goldenCompound = parseCompoundNumbers(golden.value);
  if (goldenCompound && golden.numericValue === null) {
    const findingCompound = parseCompoundNumbers(String(unwrapped.value));
    const gMean = goldenCompound.reduce((a, b) => a + b, 0) / goldenCompound.length;
    const fScalar = findingCompound
      ? findingCompound.reduce((a, b) => a + b, 0) / findingCompound.length
      : findingNumeric;
    if (fScalar !== null) {
      const norm = normalizeNumericToGoldenUnit(fScalar, unwrapped.unit ?? '', {
        ...golden,
        numericValue: gMean,
      });
      if (norm.compatible && norm.normalizedValue !== null) {
        base.unitsCompatible = true;
        base.normalizedResearchedValue = norm.normalizedValue;
        base.numericDelta = norm.normalizedValue - gMean;
        base.relativeErrorPct = gMean === 0 ? 0 : (Math.abs(base.numericDelta) / Math.abs(gMean)) * 100;
        base.sameSideOfTarget = isSameSideOfTarget(
          gMean,
          golden.numericTarget,
          golden.score,
          norm.normalizedValue,
          unwrapped.level_pct,
          findingNumeric,
          findingTargetNumeric,
        );
        base.matchBand =
          base.relativeErrorPct <= 2
            ? 'exact'
            : base.relativeErrorPct <= 10
              ? 'close'
              : base.relativeErrorPct <= 25
                ? 'directional'
                : 'divergent';
        base.matched = base.matchBand !== 'divergent';
        base.notes.push(`compared against mean of compound golden value (${golden.value})`);
        return base;
      }
    }
  }

  // 7. Standard scalar numeric comparison with safe unit normalization.
  if (golden.numericValue !== null && findingNumeric !== null) {
    const norm = normalizeNumericToGoldenUnit(findingNumeric, unwrapped.unit ?? '', golden);
    if (norm.compatible && norm.normalizedValue !== null) {
      base.unitsCompatible = true;
      base.normalizedResearchedValue = norm.normalizedValue;
      if (norm.note) base.notes.push(norm.note);

      const delta = norm.normalizedValue - golden.numericValue;
      base.numericDelta = Number(delta.toFixed(6));

      const relErr =
        golden.numericValue === 0
          ? norm.normalizedValue === 0
            ? 0
            : Infinity
          : (Math.abs(delta) / Math.abs(golden.numericValue)) * 100;
      base.relativeErrorPct = Number.isFinite(relErr) ? Number(relErr.toFixed(4)) : Infinity;

      base.sameSideOfTarget = isSameSideOfTarget(
        golden.numericValue,
        golden.numericTarget,
        golden.score,
        norm.normalizedValue,
        unwrapped.level_pct,
        findingNumeric,
        findingTargetNumeric,
      );

      if (base.relativeErrorPct <= 2) {
        base.matchBand = 'exact';
      } else if (base.relativeErrorPct <= 10) {
        base.matchBand = 'close';
      } else if (base.relativeErrorPct <= 25) {
        base.matchBand = 'directional';
      } else if (
        golden.numericValue === 0 &&
        base.sameSideOfTarget === true &&
        Math.abs(delta) <= 10
      ) {
        base.matchBand = 'directional';
        base.notes.push('zero-baseline directional agreement on same side of target');
      } else {
        base.matchBand = 'divergent';
      }
      base.matched = base.matchBand !== 'divergent';
      return base;
    }
  }

  // 8. Incompatible units or non-numeric scalar: check directional agreement against target.
  base.unitsCompatible = false;
  base.sameSideOfTarget = isSameSideOfTarget(
    golden.numericValue,
    golden.numericTarget,
    golden.score,
    null,
    unwrapped.level_pct,
    findingNumeric,
    findingTargetNumeric,
  );
  if (base.sameSideOfTarget === true) {
    base.matchBand = 'directional';
    base.matched = true;
    base.notes.push(
      `incompatible units (golden "${golden.unit || golden.value}" vs researched "${unwrapped.unit ?? ''}"), same side of target`,
    );
  } else {
    base.matchBand = 'divergent';
    base.matched = false;
    base.notes.push(
      `incompatible units (golden "${golden.unit || golden.value}" vs researched "${unwrapped.unit ?? ''}")`,
    );
  }
  return base;
}

// ---------------------------------------------------------------------------
// Full Run Scoring & Markdown Scorecard
// ---------------------------------------------------------------------------

export interface ScoreGoldenRunOptions {
  blocklist?: SourceBlocklist;
  transcript?: string | Buffer | readonly unknown[] | null;
  usage?: SessionTokenUsage | null;
  /** Optional per-dimension token usage map for per-row cost display. */
  dimensionUsage?: Readonly<Record<string, SessionTokenUsage>>;
  provider?: string;
  model?: string;
  strategy?: string;
  runId?: string;
  generatedAt?: string;
}

export interface GoldenRunScorecard {
  runId: string;
  generatedAt: string;
  provider: string | null;
  model: string | null;
  strategy: string | null;
  dimensions: string[];
  totalIndicators: number;
  evaluatedCount: number;
  matchedCount: number;
  exactCount: number;
  closeCount: number;
  directionalCount: number;
  divergentCount: number;
  gapOrMissingCount: number;
  sourceLeakCount: number;
  newerPrimaryDataCount: number;
  meanRelativeErrorPct: number | null;
  medianRelativeErrorPct: number | null;
  clean: boolean;
  sourceLeakAudit: SourceLeakAuditResult;
  tokens: SessionTokenUsage | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  unpricedModels: string[];
  dimensionCosts: Record<string, { tokens: number; usd: number | null }>;
  rows: GoldenIndicatorScore[];
}

function matchFindingToGolden(
  golden: CaliforniaGoldenIndicator,
  findings: readonly GoldenFindingLike[],
): GoldenFindingLike | undefined {
  const candidates = new Set<string>([
    golden.slug.toLowerCase(),
    slugifyIndicatorName(golden.reportName),
    ...(golden.frameworkIndicatorSlug ? [golden.frameworkIndicatorSlug.toLowerCase()] : []),
  ]);

  // First pass: exact slug match.
  for (const f of findings) {
    const slug = (f.payload?.indicator_slug ?? f.indicator_slug ?? f.indicatorSlug ?? '').trim().toLowerCase();
    if (slug && candidates.has(slug)) return f;
  }

  // Second pass: dimension + fuzzy slug overlap.
  for (const f of findings) {
    const dim = f.dimensionSlug ? resolveCaliforniaDimensionSlug(f.dimensionSlug) : null;
    if (dim && dim !== golden.dimensionSlug) continue;
    const slug = (f.payload?.indicator_slug ?? f.indicator_slug ?? f.indicatorSlug ?? '').trim().toLowerCase();
    if (!slug) continue;
    for (const c of candidates) {
      if (slug.includes(c) || c.includes(slug)) return f;
    }
  }
  return undefined;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Score a set of researched findings (and optional transcript + token usage)
 * against the target California 2025 golden indicators.
 */
export function scoreGoldenRun(
  findings: readonly GoldenFindingLike[],
  goldenIndicators: readonly CaliforniaGoldenIndicator[],
  opts: ScoreGoldenRunOptions = {},
): GoldenRunScorecard {
  const blocklist = opts.blocklist ?? CALIFORNIA_REPORT_BLOCKLIST;
  const leakAudit = auditSourceLeaks(findings, opts.transcript ?? null, blocklist);
  const leakedSlugSet = new Set(leakAudit.leakedIndicatorSlugs.map((s) => s.toLowerCase()));

  const rows: GoldenIndicatorScore[] = goldenIndicators.map((golden) => {
    const found = matchFindingToGolden(golden, findings);
    const scored = scoreFindingAgainstGolden(found, golden, { blocklist });
    if (
      !scored.sourceLeakDetected &&
      (leakedSlugSet.has(golden.slug.toLowerCase()) ||
        (golden.frameworkIndicatorSlug && leakedSlugSet.has(golden.frameworkIndicatorSlug.toLowerCase())))
    ) {
      scored.sourceLeakDetected = true;
      scored.matchBand = 'source_leak';
      scored.matched = false;
      scored.sourceLeakReasons.push('flagged by run-level source leak audit');
    }
    return scored;
  });

  const exactCount = rows.filter((r) => r.matchBand === 'exact').length;
  const closeCount = rows.filter((r) => r.matchBand === 'close').length;
  const directionalCount = rows.filter((r) => r.matchBand === 'directional').length;
  const divergentCount = rows.filter((r) => r.matchBand === 'divergent').length;
  const gapOrMissingCount = rows.filter((r) => r.matchBand === 'gap_or_missing').length;
  const sourceLeakCount = rows.filter((r) => r.matchBand === 'source_leak').length;
  const matchedCount = exactCount + closeCount + directionalCount;
  const evaluatedCount = rows.length - gapOrMissingCount;
  const newerPrimaryDataCount = rows.filter((r) => r.newerPrimaryData).length;

  const finiteRelErrors = rows
    .filter((r) => !r.sourceLeakDetected && r.relativeErrorPct !== null && Number.isFinite(r.relativeErrorPct))
    .map((r) => r.relativeErrorPct!);
  const meanRelativeErrorPct =
    finiteRelErrors.length > 0
      ? Number((finiteRelErrors.reduce((a, b) => a + b, 0) / finiteRelErrors.length).toFixed(2))
      : null;
  const med = median(finiteRelErrors);
  const medianRelativeErrorPct = med !== null ? Number(med.toFixed(2)) : null;

  const usage = opts.usage ?? null;
  const totalTokens = usage ? usage.input_tokens + usage.output_tokens : null;
  const priced = usage ? priceSessionUsage(usage) : null;
  const estimatedCostUsd = priced ? Number(priced.dollars.toFixed(4)) : null;

  const dimensionCosts: Record<string, { tokens: number; usd: number | null }> = {};
  if (opts.dimensionUsage) {
    for (const [dim, dimUsage] of Object.entries(opts.dimensionUsage)) {
      const dimPriced = priceSessionUsage(dimUsage);
      dimensionCosts[dim] = {
        tokens: dimUsage.input_tokens + dimUsage.output_tokens,
        usd: dimPriced.unpriced.length === 0 ? Number(dimPriced.dollars.toFixed(4)) : null,
      };
    }
  }

  const dimensions = [...new Set(goldenIndicators.map((g) => g.dimensionSlug))];

  return {
    runId: opts.runId ?? `ca-golden-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    provider: opts.provider ?? null,
    model: opts.model ?? null,
    strategy: opts.strategy ?? null,
    dimensions,
    totalIndicators: rows.length,
    evaluatedCount,
    matchedCount,
    exactCount,
    closeCount,
    directionalCount,
    divergentCount,
    gapOrMissingCount,
    sourceLeakCount,
    newerPrimaryDataCount,
    meanRelativeErrorPct,
    medianRelativeErrorPct,
    clean: leakAudit.clean && sourceLeakCount === 0,
    sourceLeakAudit: leakAudit,
    tokens: usage,
    totalTokens,
    estimatedCostUsd,
    unpricedModels: priced ? priced.unpriced : [],
    dimensionCosts,
    rows,
  };
}

function formatUsd(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return 'n/a';
  return `$${usd.toFixed(4)}`;
}

function formatTokensCost(tokens: number | null, usd: number | null): string {
  if (tokens === null && usd === null) return '—';
  const tokStr = tokens !== null ? `${tokens.toLocaleString('en-US')} tok` : '—';
  const usdStr = usd !== null ? formatUsd(usd) : 'unpriced';
  return `${tokStr} / ${usdStr}`;
}

function escapePipe(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Render a human-readable Markdown scorecard comparing researched California
 * findings against the 2025 California Doughnut Report ground truth.
 */
export function renderGoldenScorecardMarkdown(report: GoldenRunScorecard): string {
  const lines: string[] = [
    '# California 2025 Golden-Test Benchmark Scorecard',
    '',
    `- **Run ID:** \`${report.runId}\``,
    `- **Generated:** ${report.generatedAt}`,
    `- **Dimensions:** ${report.dimensions.map((d) => `\`${d}\``).join(', ')}`,
    ...(report.provider || report.model || report.strategy
      ? [
          `- **Runtime:** provider=${report.provider ?? 'default'}, model=${report.model ?? 'default'}, strategy=${report.strategy ?? 'default'}`,
        ]
      : []),
    `- **Source-Leak Audit:** ${report.clean ? 'PASS (0 leaks)' : `FAIL (${report.sourceLeakAudit.leakCount} leak(s) detected)`}`,
    `- **Match Summary:** ${report.matchedCount}/${report.totalIndicators} matched (` +
      `exact=${report.exactCount}, close=${report.closeCount}, directional=${report.directionalCount}, ` +
      `divergent=${report.divergentCount}, gap/missing=${report.gapOrMissingCount}, source_leak=${report.sourceLeakCount})`,
    `- **Error (compatible numeric):** mean=${report.meanRelativeErrorPct !== null ? `${report.meanRelativeErrorPct.toFixed(2)}%` : 'n/a'}, median=${report.medianRelativeErrorPct !== null ? `${report.medianRelativeErrorPct.toFixed(2)}%` : 'n/a'}`,
    `- **Newer Primary Data:** ${report.newerPrimaryDataCount} indicator(s)`,
    `- **Total Spend:** ${formatTokensCost(report.totalTokens, report.estimatedCostUsd)}${
      report.unpricedModels.length ? ` (unpriced models: ${report.unpricedModels.join(', ')})` : ''
    }`,
    '',
    '| Indicator | Golden CA Report Value (Year) | Researched Value (Year) | Relative Diff | Match Band | Source Leak? | Tokens / USD Cost |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  const countByDim = new Map<string, number>();
  for (const r of report.rows) {
    countByDim.set(r.dimensionSlug, (countByDim.get(r.dimensionSlug) ?? 0) + 1);
  }

  for (const row of report.rows) {
    const goldenUnitSuffix =
      row.goldenUnit && !row.goldenValue.includes(row.goldenUnit) ? ` ${row.goldenUnit}` : '';
    const goldenCell = `${row.goldenValue}${goldenUnitSuffix} (${row.goldenPeriod})`;

    let researchedCell = '*(gap / missing)*';
    if (row.researchedValue !== null) {
      const unitSuffix =
        row.researchedUnit && !row.researchedValue.includes(row.researchedUnit)
          ? ` ${row.researchedUnit}`
          : '';
      const yearPart = row.researchedYear !== null ? ` (${row.researchedYear})` : '';
      const newerTag = row.newerPrimaryData ? ' `[newer_primary_data]`' : '';
      researchedCell = `${row.researchedValue}${unitSuffix}${yearPart}${newerTag}`;
    }

    const diffCell =
      row.relativeErrorPct === null
        ? '—'
        : !Number.isFinite(row.relativeErrorPct)
          ? '∞'
          : `${row.numericDelta !== null && row.numericDelta >= 0 ? '+' : '-'}${row.relativeErrorPct.toFixed(1)}%`;

    const leakCell = row.sourceLeakDetected ? '**YES (FAIL)**' : 'No';

    const dimCost = report.dimensionCosts[row.dimensionSlug];
    let costCell = '—';
    if (dimCost) {
      const dimCount = countByDim.get(row.dimensionSlug) ?? 1;
      costCell = `${formatTokensCost(Math.round(dimCost.tokens / dimCount), dimCost.usd !== null ? dimCost.usd / dimCount : null)} (est.)`;
    } else if (report.totalTokens !== null && report.totalIndicators > 0) {
      costCell = `${formatTokensCost(
        Math.round(report.totalTokens / report.totalIndicators),
        report.estimatedCostUsd !== null ? report.estimatedCostUsd / report.totalIndicators : null,
      )} (avg)`;
    }

    lines.push(
      `| ${escapePipe(`${row.dimensionName}: ${row.indicatorName}`)} | ${escapePipe(goldenCell)} | ${escapePipe(researchedCell)} | ${escapePipe(diffCell)} | \`${row.matchBand}\` | ${leakCell} | ${escapePipe(costCell)} |`,
    );
  }

  // Primary sources & notes section
  const annotated = report.rows.filter(
    (r) => r.researchedSourceUrl || r.notes.length > 0,
  );
  if (annotated.length > 0) {
    lines.push('', '## Sources & Comparison Notes', '');
    for (const row of annotated) {
      const src = row.researchedSourceUrl
        ? `${row.researchedSourceName ?? 'Source'} (${row.researchedSourceUrl})`
        : 'none';
      const noteText = row.notes.length ? ` — ${row.notes.join('; ')}` : '';
      lines.push(`- **${row.indicatorName}** (\`${row.matchBand}\`): ${src}${noteText}`);
    }
  }

  if (!report.clean) {
    lines.push('', '## Source-Leak Audit Failures', '');
    for (const leak of report.sourceLeakAudit.leaks) {
      const where = [
        leak.location,
        leak.indicatorSlug ? `indicator=${leak.indicatorSlug}` : null,
        leak.toolName ? `tool=${leak.toolName}` : null,
        leak.field ? `field=${leak.field}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      lines.push(`- **[${where}]** \`${leak.matchedText}\` — ${leak.match.reason}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
