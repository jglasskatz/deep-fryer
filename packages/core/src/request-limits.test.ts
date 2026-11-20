import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { emergencyConfigSchema, emergencyPlanInputSchema, emergencyResourceInputSchema, hazardInputSchema } from './emergency.js';
import { involvementListingInputSchema, involvementSubmissionInputSchema } from './involvement.js';
import { policyEvaluationContextSchema } from './policy-impact-graph.js';
import { boundedRecord, REQUEST_LIMITS as R } from './request-limits.js';
import { dimensionDataSchema, tenantConfigSchemas } from './validators.js';

/**
 * Every schema here reads what a request sends: the web app's server
 * actions parse with them (lib/actions.ts, emergency-actions.ts,
 * involvement-actions.ts, involvement-admin-actions.ts, policy-actions.ts).
 */
const REQUEST_SCHEMAS: Record<string, z.ZodType> = {
  dimensionData: dimensionDataSchema,
  ...Object.fromEntries(Object.entries(tenantConfigSchemas).map(([key, schema]) => [`config.${key}`, schema])),
  emergencyConfig: emergencyConfigSchema,
  hazardInput: hazardInputSchema,
  emergencyPlanInput: emergencyPlanInputSchema,
  emergencyResourceInput: emergencyResourceInputSchema,
  involvementListingInput: involvementListingInputSchema,
  involvementSubmissionInput: involvementSubmissionInputSchema,
  policyEvaluationContext: policyEvaluationContextSchema,
};

/** Every list and record those schemas read, by path, with the most entries it takes. */
const EXPECTED: Record<string, number> = {
  'dimensionData.indicators': R.indicatorsPerDimension,
  'dimensionData.indicators[].scoring.inputs': R.scoringInputs,
  'dimensionData.gaps': R.gapsPerDimension,
  'dimensionData.gaps[].scales_tried': R.scales,
  'dimensionData.actions': R.actionsPerDimension,
  'dimensionData.action_sources': R.actionsPerDimension,
  'config.source_priority.tiers': R.sourceTiers,
  'config.source_priority.tiers[].examples': R.tierExamples,
  'config.recency.per_dimension': R.dimensions,
  'config.scale_policy.default_accepted': R.scales,
  'config.scale_policy.per_dimension': R.dimensions,
  'config.scale_policy.per_dimension{}': R.scales,
  'config.threshold_overrides': R.thresholdOverrides,
  // Bounded before this check existed; listed so a change to them is seen.
  'emergencyConfig.nws_zones': 50,
  'hazardInput.dimensions': 21,
  'hazardInput.nws_events': 30,
  'emergencyPlanInput.languages': 40,
  'emergencyPlanInput.hazard_slugs': 30,
  'emergencyResourceInput.hazard_slugs': 30,
  'involvementListingInput.dimension_slugs': 200,
};

interface Collection {
  path: string;
  kind: 'array' | 'record';
  /** The maximum the schema declares; undefined for a record (boundedRecord checks it, unlabelled). */
  declared: number | undefined;
  bounded: boolean;
  schema: z.ZodType;
}

type Def = Record<string, unknown> & { type: string; checks?: { _zod: { def: Record<string, unknown> } }[] };
const defOf = (schema: unknown): Def => (schema as { _zod: { def: Def } })._zod.def;

/** The array's own maximum, as zod applies it before reading items: size checks up to the first other check. */
function arrayMaximum(def: Def): number | undefined {
  let max: number | undefined;
  for (const check of def.checks ?? []) {
    const d = check._zod.def;
    if (!/_(length|size)$|_equals$/.test(String(d.check))) break;
    const m = (d.maximum ?? d.length ?? d.size) as number | undefined;
    if (typeof m === 'number') max = max === undefined ? m : Math.min(max, m);
  }
  return max;
}

/** Walk a schema and list every array and record in it. */
function collections(schema: z.ZodType, path: string, out: Collection[] = [], seen = new Set<unknown>()): Collection[] {
  if (seen.has(schema)) return out;
  seen.add(schema);
  const def = defOf(schema);
  const walk = (child: unknown, at = path) => collections(child as z.ZodType, at, out, seen);
  switch (def.type) {
    case 'object':
      for (const [key, child] of Object.entries(def.shape as Record<string, unknown>)) walk(child, `${path}.${key}`);
      if (def.catchall) walk(def.catchall, `${path}.*`);
      break;
    case 'array': {
      const declared = arrayMaximum(def);
      out.push({ path, kind: 'array', declared, bounded: declared !== undefined, schema });
      walk(def.element, `${path}[]`);
      break;
    }
    case 'record':
      out.push({ path, kind: 'record', declared: undefined, bounded: false, schema });
      walk(def.valueType, `${path}{}`);
      break;
    case 'pipe': {
      const input = defOf(def.in);
      const output = defOf(def.out);
      if (input.type === 'unknown' && (input.checks?.length ?? 0) > 0 && output.type === 'record') {
        // boundedRecord: the entry count is checked on the raw input, before the record reads it.
        out.push({ path, kind: 'record', declared: undefined, bounded: true, schema });
        walk(output.valueType, `${path}{}`);
      } else {
        walk(def.in);
        walk(def.out);
      }
      break;
    }
    case 'optional': case 'nullable': case 'default': case 'prefault': case 'catch': case 'readonly': case 'nonoptional':
      walk(def.innerType);
      break;
    case 'union':
      for (const option of def.options as unknown[]) walk(option);
      break;
    case 'intersection':
      walk(def.left);
      walk(def.right);
      break;
    case 'tuple':
      (def.items as unknown[]).forEach((item, i) => walk(item, `${path}[${i}]`));
      if (def.rest) out.push({ path, kind: 'array', declared: undefined, bounded: false, schema });
      break;
    case 'lazy':
      walk((def.getter as () => unknown)());
      break;
    case 'map': case 'set':
      out.push({ path, kind: 'array', declared: arrayMaximum(def), bounded: arrayMaximum(def) !== undefined, schema });
      break;
    default:
      break;
  }
  return out;
}

const found = Object.entries(REQUEST_SCHEMAS).flatMap(([name, schema]) => collections(schema, name));

function oversized(c: Collection, n: number): unknown {
  return c.kind === 'array'
    ? Array.from({ length: n }, () => null)
    : Object.fromEntries(Array.from({ length: n }, (_, i) => [`key-${i}`, null]));
}

const tooBig = (issues: z.core.$ZodIssue[]) => issues.filter((i) => i.code === 'too_big' || /^Too big/.test(i.message));

describe('request schemas bound every list and record', () => {
  it('finds exactly the lists and records listed, each with a maximum', () => {
    expect(Object.fromEntries(found.map((c) => [c.path, c.bounded]))).toEqual(
      Object.fromEntries(Object.keys(EXPECTED).map((path) => [path, true])),
    );
  });

  it('declares the stated maximum on every list', () => {
    for (const c of found.filter((f) => f.kind === 'array')) expect(c.declared, c.path).toBe(EXPECTED[c.path]);
  });

  it('refuses one entry over the maximum with that single issue, before reading any entry', () => {
    for (const c of found) {
      const max = EXPECTED[c.path]!;
      const over = c.schema.safeParse(oversized(c, max + 1));
      expect(over.success, c.path).toBe(false);
      const issues = over.success ? [] : over.error.issues;
      expect(issues, c.path).toHaveLength(1);
      expect(tooBig(issues), c.path).toHaveLength(1);
    }
  });

  it('takes exactly the maximum: entries that many are read one by one, not refused by count', () => {
    for (const c of found) {
      const at = c.schema.safeParse(oversized(c, EXPECTED[c.path]!));
      expect(at.success ? [] : tooBig(at.error.issues), c.path).toEqual([]);
    }
  });
});

describe('boundedRecord', () => {
  const notes = boundedRecord(z.string(), z.string(), 3);

  it('reads a record within the bound as z.record does', () => {
    expect(notes.parse({ a: 'x', b: 'y' })).toEqual({ a: 'x', b: 'y' });
    expect(notes.safeParse({ a: 1 }).success).toBe(false);
  });

  it('leaves what is not an object for z.record to report', () => {
    for (const value of ['text', 4, null, ['a']]) {
      const parsed = notes.safeParse(value);
      expect(parsed.success).toBe(false);
      expect(parsed.success ? null : parsed.error.issues[0]?.code).toBe('invalid_type');
    }
  });

  it('passes a well-formed config the size of the largest real one', () => {
    const overrides = Object.fromEntries(
      Array.from({ length: 13 }, (_, i) => [`ref-${i}`, { target: i, rationale: 'adopted city law' }]),
    );
    expect(tenantConfigSchemas.threshold_overrides.safeParse(overrides).success).toBe(true);
    const perDimension = Object.fromEntries(Array.from({ length: 22 }, (_, i) => [`dimension-${i}`, ['city', 'county']]));
    expect(tenantConfigSchemas.scale_policy.safeParse({ default_accepted: ['city'], per_dimension: perDimension }).success).toBe(true);
  });
});
