'use client';

import { useId, useState, useTransition } from 'react';
import { framework, getThreshold } from '@deep-fryer/contract';
import {
  FEATURE_REGISTRY,
  PORTRAIT_FEATURES,
  resolvePortraitFeatures,
  defaultProgressConfig,
  defaultNotifications,
  defaultRetention,
  defaultReviewPolicy,
  geographicScaleSchema,
  scalePolicyConfigSchema,
  sourcePriorityConfigSchema,
  thresholdOverridesConfigSchema,
  type FeaturesConfig,
  type GeographicScale,
  type MappingFunctionName,
  type NotificationConfig,
  type ProgressConfig,
  type PortraitConfig,
  type RetentionConfig,
  type ReviewPolicyConfig,
  type TenantBranding,
  type TenantConfigKey,
} from '@deep-fryer/core';
import { updateBranding, updateConfig } from '@/lib/actions';
import {
  BRAND_FONTS,
  DEFAULT_BRAND_FONT,
  LOGO_TOO_LARGE,
  MAX_LOGO_BYTES,
  brandColourProblem,
  brandFont,
} from '@/components/site-header/branding';

const field = 'w-full rounded border border-field-border bg-white px-2 py-1 text-sm';
const smallButton = 'rounded border border-black/15 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-40';
const hint = 'mt-1 block text-xs text-[color:var(--color-muted)]';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-black/15 p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-xs text-[color:var(--color-muted)]">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------------
 * The three list settings (source tiers, scale policy, threshold overrides)
 * are edited as drafts: what the fields hold, as typed. A draft is made from
 * the stored value, and turned back into a value only on Save, with a plain
 * reason when it cannot be. An untouched draft gives back exactly the value
 * it was made from, so saving without changes never alters a setting.
 * --------------------------------------------------------------------- */

export type DraftResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** A number as a field shows it; -0 keeps its sign, so it reads back the same. */
function numberText(n: number | undefined): string {
  if (n === undefined) return '';
  return Object.is(n, -0) ? '-0' : String(n);
}

/** A field's number, or null when it is empty or not a number. */
function fieldNumber(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Move one list item up or down by one place. */
function moved<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** The schema's first complaint, for anything the form's own checks did not catch. */
function schemaError(issues: { path: PropertyKey[]; message: string }[]): string {
  const first = issues[0];
  return first ? `${first.path.map(String).join(' → ')}: ${first.message}` : 'This setting could not be saved.';
}

// ---- Source tiers

export type SourcePriority = PortraitConfig['source_priority'];

export interface TierDraft {
  tier: string;
  name: string;
  description: string;
  examplesText: string;
  /** The stored examples, given back as they were until the field is edited. */
  examples: string[] | undefined;
  examplesEdited: boolean;
}

export function tierDrafts(value: SourcePriority | null): TierDraft[] {
  return (value?.tiers ?? []).map((t) => ({
    tier: numberText(t.tier),
    name: t.name,
    description: t.description,
    examplesText: (t.examples ?? []).join('\n'),
    examples: t.examples,
    examplesEdited: false,
  }));
}

export function newTierDraft(drafts: TierDraft[]): TierDraft {
  const highest = Math.max(0, ...drafts.map((d) => fieldNumber(d.tier) ?? 0));
  return { tier: String(Math.floor(highest) + 1), name: '', description: '', examplesText: '', examples: undefined, examplesEdited: true };
}

export function sourcePriorityValue(drafts: TierDraft[]): DraftResult<SourcePriority> {
  if (drafts.length === 0) return { ok: false, error: 'Add at least one tier.' };
  const tiers: SourcePriority['tiers'] = [];
  for (const [i, d] of drafts.entries()) {
    const tier = fieldNumber(d.tier);
    if (tier === null || !Number.isInteger(tier) || tier < 1) {
      return { ok: false, error: `Tier ${i + 1} needs a whole number of 1 or more.` };
    }
    const lines = d.examplesText.split('\n').map((l) => l.trim()).filter(Boolean);
    const examples = d.examplesEdited ? (lines.length ? lines : undefined) : d.examples;
    tiers.push({ tier, name: d.name, description: d.description, ...(examples !== undefined ? { examples } : {}) });
  }
  const parsed = sourcePriorityConfigSchema.safeParse({ tiers });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: schemaError(parsed.error.issues) };
}

// ---- Geographic scale

export type ScalePolicy = PortraitConfig['scale_policy'];

export const SCALE_LABELS: Record<GeographicScale, string> = {
  city: 'City',
  county: 'County',
  regional: 'Region',
  state: 'State',
  national: 'Country',
  global: 'Whole world',
};

const SCALES = geographicScaleSchema.options as readonly GeographicScale[];

export interface ScaleExceptionDraft {
  dimension: string;
  /** True when the dimension is typed by hand rather than picked from the list. */
  other: boolean;
  scales: GeographicScale[];
  /** The key as stored, for an exception loaded from the saved value. */
  stored?: string;
}

export interface ScalePolicyDraft {
  defaults: GeographicScale[];
  exceptions: ScaleExceptionDraft[];
  /** Whether the stored value had a per-dimension list at all (even an empty one). */
  hadPerDimension: boolean;
}

const frameworkDimensionSlugs = new Set(framework.dimensions.map((d) => d.slug));

export function scalePolicyDraft(value: ScalePolicy | null): ScalePolicyDraft {
  return {
    defaults: [...(value?.default_accepted ?? [])],
    exceptions: Object.entries(value?.per_dimension ?? {}).map(([dimension, scales]) => ({
      dimension,
      other: !frameworkDimensionSlugs.has(dimension),
      scales: [...scales],
      stored: dimension,
    })),
    hadPerDimension: value?.per_dimension !== undefined,
  };
}

/**
 * The key to save for a dimension or indicator: one carried over unchanged
 * from the stored value is kept exactly as it was; one the owner typed or
 * picked loses any spaces around it.
 */
const keyOf = (typed: string, stored: string | undefined) => (typed === stored ? typed : typed.trim());

const dimensionName = (slug: string) => framework.dimensions.find((d) => d.slug === slug)?.name ?? slug;

export function scalePolicyValue(draft: ScalePolicyDraft): DraftResult<ScalePolicy> {
  if (draft.defaults.length === 0) return { ok: false, error: 'Choose at least one accepted scale.' };
  const entries: [string, GeographicScale[]][] = [];
  const seen = new Set<string>();
  for (const e of draft.exceptions) {
    const slug = keyOf(e.dimension, e.stored);
    if (!slug.trim()) return { ok: false, error: 'Choose the dimension for each exception.' };
    if (seen.has(slug)) return { ok: false, error: `${dimensionName(slug)} has two exceptions. Keep one.` };
    if (e.scales.length === 0) return { ok: false, error: `Choose at least one scale for ${dimensionName(slug)}.` };
    seen.add(slug);
    entries.push([slug, [...e.scales]]);
  }
  const value = {
    default_accepted: [...draft.defaults],
    ...(draft.exceptions.length || draft.hadPerDimension ? { per_dimension: Object.fromEntries(entries) } : {}),
  };
  const parsed = scalePolicyConfigSchema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: schemaError(parsed.error.issues) };
}

// ---- Threshold overrides

export type ThresholdOverrides = NonNullable<PortraitConfig['threshold_overrides']>;

export const FUNCTION_LABELS: Record<MappingFunctionName, string> = {
  higher_is_better: 'Higher is better',
  lower_is_better: 'Lower is better',
  band: 'Best inside a range',
};

export interface OverrideDraft {
  ref: string;
  /** True when the indicator is typed by hand rather than picked from the list. */
  other: boolean;
  target: string;
  rationale: string;
  targetYear: string;
  fn: MappingFunctionName | '';
  scale: string;
  low: string;
  high: string;
  /** The key as stored, for a target loaded from the saved value. */
  stored?: string;
}

const frameworkRefs = new Set(framework.dimensions.flatMap((d) => d.indicators.map((i) => i.threshold_ref)));

export function overrideDrafts(value: ThresholdOverrides | null): OverrideDraft[] {
  return Object.entries(value ?? {}).map(([ref, o]) => ({
    ref,
    other: !frameworkRefs.has(ref),
    target: numberText(o.target),
    rationale: o.rationale,
    targetYear: numberText(o.target_year),
    fn: o.function ?? '',
    scale: numberText(o.scale),
    low: numberText(o.low),
    high: numberText(o.high),
    stored: ref,
  }));
}

export function newOverrideDraft(drafts: OverrideDraft[]): OverrideDraft {
  const used = new Set(drafts.map((d) => d.ref));
  const ref = [...frameworkRefs].find((r) => !used.has(r)) ?? '';
  return { ref, other: ref === '', target: '', rationale: '', targetYear: '', fn: '', scale: '', low: '', high: '' };
}

const indicatorName = (ref: string) => {
  for (const d of framework.dimensions) {
    const i = d.indicators.find((x) => x.threshold_ref === ref);
    if (i) return `${d.name}: ${i.name}`;
  }
  return ref;
};

export function thresholdOverridesValue(drafts: OverrideDraft[]): DraftResult<ThresholdOverrides> {
  const entries: [string, ThresholdOverrides[string]][] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    const ref = keyOf(d.ref, d.stored);
    if (!ref.trim()) return { ok: false, error: 'Choose the indicator for each target.' };
    const name = indicatorName(ref);
    if (seen.has(ref)) return { ok: false, error: `${name} has two targets. Keep one.` };
    seen.add(ref);
    const target = fieldNumber(d.target);
    if (target === null) return { ok: false, error: `${name} needs a target number.` };
    if (d.rationale === '') {
      return { ok: false, error: `${name} needs a reason for its target. The reason is shown on your public methodology page.` };
    }
    const optional = (text: string, label: string): number | undefined | string => {
      if (text.trim() === '') return undefined;
      const n = fieldNumber(text);
      return n === null ? `${name}: ${label} must be a number.` : n;
    };
    const year = optional(d.targetYear, 'the year');
    const scale = optional(d.scale, 'the scale');
    const low = optional(d.low, 'the low end of the range');
    const high = optional(d.high, 'the high end of the range');
    for (const v of [year, scale, low, high]) if (typeof v === 'string') return { ok: false, error: v };
    if (typeof year === 'number' && (!Number.isInteger(year) || year < 1900 || year > 2200)) {
      return { ok: false, error: `${name}: the year must be a whole year between 1900 and 2200.` };
    }
    if (typeof scale === 'number' && scale <= 0) return { ok: false, error: `${name}: the scale must be more than 0.` };
    entries.push([ref, {
      target,
      rationale: d.rationale,
      ...(d.fn ? { function: d.fn } : {}),
      ...(typeof scale === 'number' ? { scale } : {}),
      ...(typeof low === 'number' ? { low } : {}),
      ...(typeof high === 'number' ? { high } : {}),
      ...(typeof year === 'number' ? { target_year: year } : {}),
    }]);
  }
  // Built from entries, so a key such as "constructor" is the portrait's own and never the object's.
  const parsed = thresholdOverridesConfigSchema.safeParse(Object.fromEntries(entries));
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: schemaError(parsed.error.issues) };
}

/* ------------------------------------------------------------------------
 * The forms
 * --------------------------------------------------------------------- */

interface ListFormProps<T> {
  initial: T | null;
  onSave: (key: TenantConfigKey, value: unknown) => void;
  pending: boolean;
  status?: string;
}

/** The form's own refusal or the server's answer, read out when it appears. */
function FormStatus({ error, status }: { error: string | null; status?: string }) {
  return (
    <p role="status" className={`mt-2 text-xs ${error ? 'text-red-700' : ''}`}>
      {error ?? status ?? ''}
    </p>
  );
}

function ScaleList({
  label,
  scales,
  onChange,
}: {
  label: string;
  scales: GeographicScale[];
  onChange: (next: GeographicScale[]) => void;
}) {
  const unused = SCALES.find((s) => !scales.includes(s));
  return (
    <div>
      <ol className="space-y-1">
        {scales.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1">
            <span className="w-5 text-xs text-[color:var(--color-muted)]">{i + 1}.</span>
            <select
              className={`${field} w-auto min-h-9`}
              aria-label={`${label}, choice ${i + 1}`}
              value={s}
              onChange={(e) => onChange(scales.map((x, j) => (j === i ? (e.target.value as GeographicScale) : x)))}
            >
              {SCALES.map((o) => (
                <option key={o} value={o}>
                  {SCALE_LABELS[o]}
                </option>
              ))}
            </select>
            <button type="button" className={smallButton} disabled={i === 0} onClick={() => onChange(moved(scales, i, -1))} aria-label={`Move ${SCALE_LABELS[s]} up`}>
              ↑
            </button>
            <button type="button" className={smallButton} disabled={i === scales.length - 1} onClick={() => onChange(moved(scales, i, 1))} aria-label={`Move ${SCALE_LABELS[s]} down`}>
              ↓
            </button>
            <button type="button" className={smallButton} onClick={() => onChange(scales.filter((_, j) => j !== i))} aria-label={`Remove ${SCALE_LABELS[s]}`}>
              Remove
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className={`${smallButton} mt-1`} disabled={!unused} onClick={() => unused && onChange([...scales, unused])}>
        Add a scale
      </button>
    </div>
  );
}

const OTHER = '__other__';

function SourceTiersForm({ initial, onSave, pending, status }: ListFormProps<SourcePriority>) {
  const [drafts, setDrafts] = useState(() => tierDrafts(initial));
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, patch: Partial<TierDraft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <Section
      title="Source priority tiers"
      description="Where research looks for data, best first. Research uses a lower tier only when no higher tier has the figure, and every figure records the tier it came from."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const result = sourcePriorityValue(drafts);
          setError(result.ok ? null : result.error);
          if (result.ok) onSave('source_priority', result.value);
        }}
        className="space-y-3"
      >
        {drafts.map((d, i) => (
          <fieldset key={i} className="rounded border border-black/10 p-3 text-sm" data-tier-row>
            <legend className="px-1 font-medium">Tier {i + 1}</legend>
            <div className="grid gap-2 sm:grid-cols-[6rem_1fr]">
              <label className="block">
                <span className="font-medium">Tier number</span>
                <input className={field} type="number" min={1} step={1} name={`tier-${i}-number`} value={d.tier} onChange={(e) => set(i, { tier: e.target.value })} />
              </label>
              <label className="block">
                <span className="font-medium">Name</span>
                <input className={field} name={`tier-${i}-name`} value={d.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="e.g. Official local government" />
              </label>
            </div>
            <label className="mt-2 block">
              <span className="font-medium">What counts</span>
              <textarea className={field} rows={2} name={`tier-${i}-description`} value={d.description} onChange={(e) => set(i, { description: e.target.value })} />
            </label>
            <label className="mt-2 block">
              <span className="font-medium">Examples (one per line, optional)</span>
              <textarea
                className={field}
                rows={3}
                name={`tier-${i}-examples`}
                value={d.examplesText}
                onChange={(e) => set(i, { examplesText: e.target.value, examplesEdited: true })}
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-1">
              <button type="button" className={smallButton} disabled={i === 0} onClick={() => setDrafts(moved(drafts, i, -1))} aria-label={`Move tier ${i + 1} up`}>
                Move up
              </button>
              <button type="button" className={smallButton} disabled={i === drafts.length - 1} onClick={() => setDrafts(moved(drafts, i, 1))} aria-label={`Move tier ${i + 1} down`}>
                Move down
              </button>
              <button type="button" className={smallButton} onClick={() => setDrafts(drafts.filter((_, j) => j !== i))} aria-label={`Remove tier ${i + 1}`}>
                Remove
              </button>
            </div>
          </fieldset>
        ))}
        <button type="button" className={smallButton} onClick={() => setDrafts([...drafts, newTierDraft(drafts)])}>
          Add a tier
        </button>
        <FormStatus error={error} status={status} />
        <SaveButton pending={pending} />
      </form>
    </Section>
  );
}

function ScalePolicyForm({ initial, onSave, pending, status }: ListFormProps<ScalePolicy>) {
  const [draft, setDraft] = useState(() => scalePolicyDraft(initial));
  const [error, setError] = useState<string | null>(null);
  const setException = (i: number, patch: Partial<ScaleExceptionDraft>) =>
    setDraft({ ...draft, exceptions: draft.exceptions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const usedDimensions = new Set(draft.exceptions.map((x) => x.dimension));
  return (
    <Section
      title="Geographic scale policy"
      description="Which areas a figure may describe, best first: research uses the first scale on this list it can find data for, then the next. A dimension can have its own list (for example, ocean data is often only measured for a whole region)."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const result = scalePolicyValue(draft);
          setError(result.ok ? null : result.error);
          if (result.ok) onSave('scale_policy', result.value);
        }}
        className="space-y-4 text-sm"
      >
        <fieldset>
          <legend className="font-medium">Accepted scales, best first</legend>
          <div className="mt-1">
            <ScaleList label="Accepted scale" scales={draft.defaults} onChange={(defaults) => setDraft({ ...draft, defaults })} />
          </div>
        </fieldset>
        <fieldset>
          <legend className="font-medium">Exceptions for one dimension</legend>
          {draft.exceptions.length === 0 ? <p className={hint}>None: every dimension uses the list above.</p> : null}
          <div className="mt-1 space-y-3">
            {draft.exceptions.map((x, i) => (
              <div key={i} className="rounded border border-black/10 p-3" data-scale-exception>
                <label className="block">
                  <span className="font-medium">Dimension</span>
                  <select
                    className={`${field} min-h-9`}
                    value={x.other ? OTHER : x.dimension}
                    onChange={(e) =>
                      e.target.value === OTHER
                        ? setException(i, { other: true, dimension: '' })
                        : setException(i, { other: false, dimension: e.target.value })
                    }
                  >
                    {framework.dimensions.map((d) => (
                      <option key={d.slug} value={d.slug} disabled={d.slug !== x.dimension && usedDimensions.has(d.slug)}>
                        {d.name}
                      </option>
                    ))}
                    <option value={OTHER}>Another dimension (type its short name)</option>
                  </select>
                </label>
                {x.other ? (
                  <label className="mt-2 block">
                    <span className="font-medium">Short name of the dimension</span>
                    <input className={field} required value={x.dimension} onChange={(e) => setException(i, { dimension: e.target.value })} />
                    <span className={hint}>As it appears in the dimension page’s web address, for example “water”.</span>
                  </label>
                ) : null}
                <div className="mt-2">
                  <span className="font-medium">Accepted scales for this dimension, best first</span>
                  <div className="mt-1">
                    <ScaleList label={`${dimensionName(x.dimension)} scale`} scales={x.scales} onChange={(scales) => setException(i, { scales })} />
                  </div>
                </div>
                <button
                  type="button"
                  className={`${smallButton} mt-2`}
                  onClick={() => setDraft({ ...draft, exceptions: draft.exceptions.filter((_, j) => j !== i) })}
                >
                  Remove this exception
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className={`${smallButton} mt-2`}
            onClick={() => {
              const free = framework.dimensions.find((d) => !usedDimensions.has(d.slug));
              setDraft({
                ...draft,
                exceptions: [
                  ...draft.exceptions,
                  { dimension: free?.slug ?? '', other: !free, scales: [...(draft.defaults.length ? draft.defaults : ['city' as const])] },
                ],
              });
            }}
          >
            Add an exception
          </button>
        </fieldset>
        <FormStatus error={error} status={status} />
        <SaveButton pending={pending} />
      </form>
    </Section>
  );
}

function ThresholdOverridesForm({ initial, onSave, pending, status }: ListFormProps<ThresholdOverrides>) {
  const [drafts, setDrafts] = useState(() => overrideDrafts(initial));
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const set = (i: number, patch: Partial<OverrideDraft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const used = new Set(drafts.map((d) => d.ref));
  return (
    <Section
      title="Threshold overrides"
      description="Your own target for an indicator, in place of the standard one: for example a goal your city has adopted. Each target needs a reason, which is shown word for word on your public methodology page. A year the goal is due draws an on-track line on the progress page."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const result = thresholdOverridesValue(drafts);
          setError(result.ok ? null : result.error);
          if (result.ok) onSave('threshold_overrides', result.value);
        }}
        className="space-y-3 text-sm"
      >
        {drafts.length === 0 ? <p className={hint}>None yet: every indicator uses its standard target.</p> : null}
        {drafts.map((d, i) => {
          const standard = d.other ? undefined : getThreshold(d.ref);
          const reasonHint = `${id}-${i}-reason-hint`;
          return (
            <fieldset key={i} className="rounded border border-black/10 p-3" data-override-row>
              <legend className="px-1 font-medium">Target {i + 1}</legend>
              <label className="block">
                <span className="font-medium">Indicator</span>
                <select
                  className={`${field} min-h-9`}
                  value={d.other ? OTHER : d.ref}
                  onChange={(e) =>
                    e.target.value === OTHER ? set(i, { other: true, ref: '' }) : set(i, { other: false, ref: e.target.value })
                  }
                >
                  {framework.dimensions.map((dim) => (
                    <optgroup key={dim.slug} label={dim.name}>
                      {dim.indicators.map((ind) => (
                        <option key={ind.threshold_ref} value={ind.threshold_ref} disabled={ind.threshold_ref !== d.ref && used.has(ind.threshold_ref)}>
                          {ind.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  <option value={OTHER}>Another indicator (type its code)</option>
                </select>
                {standard ? (
                  <span className={hint}>
                    Standard target: {standard.target} ({FUNCTION_LABELS[standard.function].toLowerCase()}).
                  </span>
                ) : null}
              </label>
              {d.other ? (
                <label className="mt-2 block">
                  <span className="font-medium">Indicator code</span>
                  <input className={field} required value={d.ref} onChange={(e) => set(i, { ref: e.target.value })} placeholder="e.g. housing.cost-burden" />
                </label>
              ) : null}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="font-medium">Your target</span>
                  <input className={field} type="number" step="any" required name={`override-${i}-target`} value={d.target} onChange={(e) => set(i, { target: e.target.value })} />
                </label>
                <label className="block">
                  <span className="font-medium">Year it is due (optional)</span>
                  <input className={field} type="number" min={1900} max={2200} step={1} name={`override-${i}-year`} value={d.targetYear} onChange={(e) => set(i, { targetYear: e.target.value })} />
                </label>
              </div>
              <label className="mt-2 block">
                <span className="font-medium">Why this target</span>
                <textarea
                  className={field}
                  rows={2}
                  required
                  name={`override-${i}-rationale`}
                  aria-describedby={reasonHint}
                  value={d.rationale}
                  onChange={(e) => set(i, { rationale: e.target.value })}
                />
                <span id={reasonHint} className={hint}>
                  Required. Shown word for word on your public methodology page.
                </span>
              </label>
              <details className="mt-2" open={Boolean(d.fn || d.scale || d.low || d.high)}>
                <summary className="cursor-pointer text-xs font-medium">More options</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="font-medium">How the score is worked out</span>
                    <select className={`${field} min-h-9`} value={d.fn} onChange={(e) => set(i, { fn: e.target.value as OverrideDraft['fn'] })}>
                      <option value="">As the standard sets it</option>
                      {(Object.keys(FUNCTION_LABELS) as MappingFunctionName[]).map((f) => (
                        <option key={f} value={f}>
                          {FUNCTION_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="font-medium">Scale (optional)</span>
                    <input className={field} type="number" step="any" value={d.scale} onChange={(e) => set(i, { scale: e.target.value })} />
                    <span className={hint}>How far from the target counts as fully off track. Leave empty to use the target itself.</span>
                  </label>
                  <label className="block">
                    <span className="font-medium">Range, low end (optional)</span>
                    <input className={field} type="number" step="any" value={d.low} onChange={(e) => set(i, { low: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="font-medium">Range, high end (optional)</span>
                    <input className={field} type="number" step="any" value={d.high} onChange={(e) => set(i, { high: e.target.value })} />
                  </label>
                </div>
              </details>
              <button type="button" className={`${smallButton} mt-2`} onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>
                Remove this target
              </button>
            </fieldset>
          );
        })}
        <button type="button" className={smallButton} onClick={() => setDrafts([...drafts, newOverrideDraft(drafts)])}>
          Add a target
        </button>
        <FormStatus error={error} status={status} />
        <SaveButton pending={pending} />
      </form>
    </Section>
  );
}

/**
 * The portrait's logo, colour and font (components/site-header/branding.ts).
 * Sent as form data, since it can carry a file; the server checks the same
 * rules again.
 */
function BrandingForm({ tenantSlug, branding, logoUrl }: { tenantSlug: string; branding: TenantBranding | null; logoUrl: string | null }) {
  const stored = branding?.primary_color && brandColourProblem(branding.primary_color) === null ? branding.primary_color : null;
  const [useColour, setUseColour] = useState(Boolean(stored));
  const [colour, setColour] = useState(stored ?? '#2f7d32');
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const colourProblem = useColour ? brandColourProblem(colour) : null;
  return (
    <Section
      title="Logo, colour and font"
      description="How your public pages look. Your logo sits beside your portrait’s name at the top of every public page, and your colour runs as a thin strip under it."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          data.set('tenantSlug', tenantSlug);
          if (!useColour) data.set('colour', '');
          const logo = data.get('logo');
          if (logo instanceof Blob && logo.size > MAX_LOGO_BYTES) {
            setStatus({ error: true, text: LOGO_TOO_LARGE });
            return;
          }
          if (colourProblem) {
            setStatus({ error: true, text: colourProblem });
            return;
          }
          startTransition(async () => {
            try {
              const result = await updateBranding(data);
              setStatus(result.ok ? { error: false, text: 'Saved.' } : { error: true, text: result.error });
            } catch (err) {
              setStatus({ error: true, text: err instanceof Error ? err.message : String(err) });
            }
          });
        }}
        className="space-y-4 text-sm"
      >
        <fieldset>
          <legend className="font-medium">Logo</legend>
          {logoUrl ? (
            <div className="mt-1 flex items-center gap-3">
              <img src={logoUrl} alt="Your current logo" className="h-10 w-auto max-w-40 rounded border border-black/10 object-contain" />
              <label className="flex items-center gap-2">
                <input type="checkbox" name="remove_logo" />
                Remove the logo
              </label>
            </div>
          ) : null}
          <label className="mt-2 block">
            <span>{logoUrl ? 'Replace it with a new picture' : 'Upload a picture'}</span>
            <input className="mt-1 block text-sm" type="file" name="logo" accept="image/png,image/jpeg,image/webp" />
            <span className={hint}>A PNG, JPEG or WebP picture under 500 KB. It is shown about 28 pixels tall.</span>
          </label>
        </fieldset>
        <fieldset>
          <legend className="font-medium">Colour</legend>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={useColour} onChange={(e) => setUseColour(e.target.checked)} />
            Show a strip of your colour on your public pages
          </label>
          <label className="mt-2 flex items-center gap-2">
            <input
              type="color"
              name="colour"
              value={colour}
              disabled={!useColour}
              aria-describedby={`${id}-colour-check`}
              aria-invalid={colourProblem ? true : undefined}
              onChange={(e) => setColour(e.target.value)}
              className="h-9 w-14 rounded border border-field-border"
            />
            <span>Your colour</span>
          </label>
          <span id={`${id}-colour-check`} className={`mt-1 block text-xs ${colourProblem ? 'text-red-700' : 'text-[color:var(--color-muted)]'}`}>
            {colourProblem ?? 'It has to show clearly on both the light and the dark page.'}
          </span>
        </fieldset>
        <label className="block">
          <span className="font-medium">Font</span>
          <select className={`${field} min-h-9`} name="font" defaultValue={brandFont(branding?.font)?.key ?? DEFAULT_BRAND_FONT}>
            {BRAND_FONTS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <p role="status" className={`text-xs ${status?.error ? 'text-red-700' : ''}`}>
          {status?.text ?? ''}
        </p>
        <SaveButton pending={pending} />
      </form>
    </Section>
  );
}

function SaveButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-3 rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

/**
 * One save path for every section, with pending tracked per config key so
 * saving one form never disables (or mislabels) the others.
 */
function useSave(tenantSlug: string) {
  const [, startTransition] = useTransition();
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Record<string, string>>({});
  const save = (key: TenantConfigKey, value: unknown) => {
    setPendingKeys((p) => new Set(p).add(key));
    startTransition(async () => {
      try {
        const result = await updateConfig({ tenantSlug, key, value });
        setStatus((s) => ({ ...s, [key]: result.ok ? 'Saved.' : result.error }));
      } catch (e) {
        setStatus((s) => ({ ...s, [key]: e instanceof Error ? e.message : String(e) }));
      } finally {
        setPendingKeys((p) => {
          const next = new Set(p);
          next.delete(key);
          return next;
        });
      }
    });
  };
  const isPending = (key: TenantConfigKey) => pendingKeys.has(key);
  return { isPending, status, save };
}

export function SettingsForms({
  tenantSlug,
  region,
  sourcePriority,
  recency,
  scalePolicy,
  thresholdOverrides,
  reviewPolicy,
  retention,
  notifications,
  progress,
  features,
  deploymentDisabled = [],
  translationRequests = [],
  translationRequestDays,
  branding = null,
  logoUrl = null,
}: {
  tenantSlug: string;
  region: PortraitConfig['region'] | null;
  sourcePriority: PortraitConfig['source_priority'] | null;
  recency: PortraitConfig['recency'] | null;
  scalePolicy: PortraitConfig['scale_policy'] | null;
  thresholdOverrides: NonNullable<PortraitConfig['threshold_overrides']> | null;
  reviewPolicy: ReviewPolicyConfig | null;
  retention: RetentionConfig | null;
  notifications: NotificationConfig | null;
  progress: ProgressConfig | null;
  features: FeaturesConfig | null;
  /** Features the deployment's operator switched off everywhere (DF_DISABLED_FEATURES). */
  deploymentDisabled?: string[];
  /** Readers' translation requests while translation is off, per language (SPEC-v7 §3.5). */
  translationRequests?: { language: string; count: number }[];
  /** The window those counts cover (lib/translation-requests.ts). */
  translationRequestDays: number;
  /** The portrait's stored logo, colour and font (tenants.branding). */
  branding?: TenantBranding | null;
  /** The public address of its stored logo, for the preview. */
  logoUrl?: string | null;
}) {
  const { isPending, status, save } = useSave(tenantSlug);

  const [regionState, setRegionState] = useState(
    region ?? { name: '', definition: '', context_notes: '' },
  );
  const [recencyYears, setRecencyYears] = useState(recency?.default_max_age_years ?? 5);
  const [review, setReview] = useState<ReviewPolicyConfig>(reviewPolicy ?? defaultReviewPolicy);
  const [retentionDays, setRetentionDays] = useState(
    retention?.transcript_days ?? defaultRetention.transcript_days,
  );
  const [notif, setNotif] = useState<NotificationConfig>(notifications ?? defaultNotifications);
  const [prog, setProg] = useState<ProgressConfig>(progress ?? defaultProgressConfig);
  // Every feature shown with the value in effect: stored, or the registry
  // default for one this portrait never set.
  const [feat, setFeat] = useState<FeaturesConfig>(() => resolvePortraitFeatures(features));

  return (
    <div className="space-y-6">
      <Section
        title="Region"
        description="The precise geography research sessions target, and context notes injected into the region-context session."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save('region', regionState);
          }}
          className="space-y-2"
        >
          <label className="block text-sm">
            <span className="font-medium">Name</span>
            <input
              className={field}
              value={regionState.name}
              onChange={(e) => setRegionState({ ...regionState, name: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Definition</span>
            <input
              className={field}
              value={regionState.definition}
              onChange={(e) => setRegionState({ ...regionState, definition: e.target.value })}
              placeholder="e.g. City of Santa Cruz municipal boundary"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Context notes</span>
            <textarea
              className={field}
              rows={4}
              value={regionState.context_notes ?? ''}
              onChange={(e) => setRegionState({ ...regionState, context_notes: e.target.value })}
              placeholder="Institutions, data portals, local framing the researcher should know."
            />
          </label>
          {status.region ? <p className="text-xs">{status.region}</p> : null}
          <SaveButton pending={isPending('region')} />
        </form>
      </Section>

      <Section
        title="Recency"
        description="Maximum acceptable data age; drives staleness flags and the year-over-year refresh loop."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save('recency', {
              ...(recency ?? {}),
              default_max_age_years: recencyYears,
            });
          }}
        >
          <label className="block text-sm">
            <span className="font-medium">Default max age (years)</span>
            <input
              className={field}
              type="number"
              min={1}
              value={recencyYears}
              onChange={(e) => setRecencyYears(Number(e.target.value))}
            />
          </label>
          {status.recency ? <p className="mt-1 text-xs">{status.recency}</p> : null}
          <SaveButton pending={isPending('recency')} />
        </form>
      </Section>

      <Section title="Review policy" description="What needs approval and who approves it.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save('review_policy', review);
          }}
          className="space-y-2 text-sm"
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={review.require_approval === 'all'}
              onChange={(e) =>
                setReview({ ...review, require_approval: e.target.checked ? 'all' : 'none' })
              }
            />
            Everything requires human approval before publish
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={review.dual_review_on_edits}
              onChange={(e) => setReview({ ...review, dual_review_on_edits: e.target.checked })}
            />
            Dual review on human edits
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={review.first_post_requires_approval}
              onChange={(e) =>
                setReview({ ...review, first_post_requires_approval: e.target.checked })
              }
            />
            First discussion post from a new account requires approval
          </label>
          <label className="block pt-2">
            <span className="block font-medium">Apply machine-audit recommendations</span>
            <select className={`${field} mt-1 min-h-11`} value={review.audit_apply ?? 'per_card'} onChange={event => setReview({ ...review, audit_apply: event.target.value as 'per_card' | 'bulk' })}>
              <option value="per_card">Review and apply one dimension at a time</option>
              <option value="bulk">Allow applying a reviewed run in bulk</option>
            </select>
            <span className="mt-1 block text-xs text-[color:var(--color-muted)]">Both modes show the proposed changes first. Applying an audit creates a draft or a research plan; publishing remains separate.</span>
          </label>
          {status.review_policy ? <p className="text-xs">{status.review_policy}</p> : null}
          <SaveButton pending={isPending('review_policy')} />
        </form>
      </Section>

      <Section
        title="Transcript retention"
        description="How long full session transcripts are kept (municipal records requirements vary)."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save('retention', { transcript_days: retentionDays });
          }}
        >
          <label className="block text-sm">
            <span className="font-medium">Days</span>
            <input
              className={field}
              type="number"
              min={1}
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
            />
          </label>
          {status.retention ? <p className="mt-1 text-xs">{status.retention}</p> : null}
          <SaveButton pending={isPending('retention')} />
        </form>
      </Section>

      <Section title="Notifications" description="Email notifications for tenant staff.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save('notifications', notif);
          }}
          className="space-y-2 text-sm"
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={notif.email_on_run_complete}
              onChange={(e) => setNotif({ ...notif, email_on_run_complete: e.target.checked })}
            />
            Email when a research run completes
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={notif.email_on_flagged_finding}
              onChange={(e) => setNotif({ ...notif, email_on_flagged_finding: e.target.checked })}
            />
            Email when the verifier flags a finding
          </label>
          {status.notifications ? <p className="text-xs">{status.notifications}</p> : null}
          <SaveButton pending={isPending('notifications')} />
        </form>
      </Section>

      <Section
        title="Progress tracking"
        description="The baseline every indicator's movement is measured from, shown on the public progress page. Targets with a due year (threshold overrides → target_year) get an on-track/off-track glidepath from this baseline."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save('progress', prog);
          }}
          className="space-y-2"
        >
          <label className="block text-sm">
            <span className="font-medium">Baseline data year</span>
            <input
              className={field}
              type="number"
              min={1900}
              max={2200}
              placeholder="Earliest published measurement"
              value={prog.baseline_year ?? ''}
              onChange={(e) =>
                setProg({
                  ...prog,
                  baseline_year: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
            <span className="mt-1 block text-xs text-[color:var(--color-muted)]">
              The latest data year that counts as the starting point — e.g. 2025 for conditions
              inherited in January 2026. Leave empty to use each indicator&apos;s first
              published value.
            </span>
          </label>
          <label className="block text-sm">
            <span className="font-medium">Baseline label (public)</span>
            <input
              className={field}
              value={prog.baseline_label}
              maxLength={120}
              onChange={(e) => setProg({ ...prog, baseline_label: e.target.value })}
            />
          </label>
          {status.progress ? <p className="text-xs">{status.progress}</p> : null}
          <SaveButton pending={isPending('progress')} />
        </form>
      </Section>

      <Section
        title="Features"
        description="The core portrait — the doughnut, dimension pages with their evidence, progress, and publishing — is always on. Everything else is a feature: off until you turn it on here. Changes reach public pages within a minute."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save('features', feat);
          }}
          className="space-y-3 text-sm"
        >
          {PORTRAIT_FEATURES.map((f) => {
            const blocked = deploymentDisabled.includes(f);
            return (
              <label key={f} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={Boolean(feat[f]) && !blocked}
                  disabled={blocked}
                  onChange={(e) => setFeat({ ...feat, [f]: e.target.checked })}
                />
                <span>
                  <span className="font-medium">{FEATURE_REGISTRY[f].label}</span>
                  <span className="block text-xs text-[color:var(--color-muted)]">
                    {FEATURE_REGISTRY[f].description}
                    {blocked ? ' Turned off for this whole deployment by its operator (DF_DISABLED_FEATURES).' : ''}
                  </span>
                  {f === 'translation' && translationRequests.length ? (
                    <span className="mt-1 block text-xs">
                      Readers asked for (last {translationRequestDays} days):{' '}
                      {translationRequests.map((r) => `${r.language} (${r.count.toLocaleString('en-US')})`).join(', ')}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
          {status.features ? <p className="text-xs">{status.features}</p> : null}
          <SaveButton pending={isPending('features')} />
        </form>
      </Section>

      <SourceTiersForm
        initial={sourcePriority}
        onSave={save}
        pending={isPending('source_priority')}
        status={status.source_priority}
      />

      <ScalePolicyForm
        initial={scalePolicy}
        onSave={save}
        pending={isPending('scale_policy')}
        status={status.scale_policy}
      />

      <ThresholdOverridesForm
        initial={thresholdOverrides}
        onSave={save}
        pending={isPending('threshold_overrides')}
        status={status.threshold_overrides}
      />

      <BrandingForm tenantSlug={tenantSlug} branding={branding} logoUrl={logoUrl} />
    </div>
  );
}
