'use client';

import { useState } from 'react';
import { framework } from '@deep-fryer/contract';
import {
  HAZARD_KINDS,
  RESOURCE_KINDS,
  type EmergencyConfig,
  type EmergencyPlanInputDraft,
  type EmergencyResourceInputDraft,
  type HazardInputDraft,
} from '@deep-fryer/core';
import {
  createHazard,
  createPlan,
  createResource,
  saveEmergencyConfig,
  updateHazard,
  updatePlan,
  updateResource,
} from '@/lib/emergency-actions';
import type { HazardView, PlanView, ResourceView } from '@/lib/emergency';
import { useAction } from '@/lib/use-action';

/**
 * Staff forms for /{tenant}/admin/emergency (English, like every staff
 * page). Each form posts to one server action through useAction, which
 * shows the action's validation message (from the shared core schemas)
 * and refreshes the page on success. The server re-validates everything;
 * the client only shapes input (comma lists into arrays, selects into
 * numbers) and never decides what is valid.
 *
 * The edit forms copy their record into local state once. The admin page
 * keys each one by the record's id and updatedAt, so a refresh that brings
 * a changed record (published elsewhere, or relinked when a hazard was
 * renamed or deleted) remounts the form with the new values instead of
 * leaving stale ones to be saved back. Visibility is not part of an edit at
 * all: a record can be published as it is created, and afterwards only
 * the row's Publish / Unpublish button changes it.
 */

const field = 'w-full rounded border border-field-border bg-white px-2 py-1 text-sm';
const label = 'block text-sm';
const hint = 'mt-0.5 block text-xs text-[color:var(--color-muted)]';

/** "a, b,, c" → ["a", "b", "c"]; commas or new lines both separate. */
function list(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
    >
      {pending ? 'Saving…' : children}
    </button>
  );
}

function Status({ error, saved }: { error: string | null; saved: boolean }) {
  if (error) {
    return (
      <p role="alert" className="text-xs text-red-700">
        {error}
      </p>
    );
  }
  return saved ? (
    <p role="status" className="text-xs">
      Saved.
    </p>
  ) : null;
}

const KIND_LABEL = (kind: string) => kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// ---- Alert configuration (owners) --------------------------------------------------

const TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Puerto_Rico',
];

export function EmergencyConfigForm({
  tenantSlug,
  initial,
  canEdit,
}: {
  tenantSlug: string;
  initial: EmergencyConfig;
  /** Owners edit; editors see the values (tenant_config is owner-write). */
  canEdit: boolean;
}) {
  const { run, pending, error } = useAction();
  const [saved, setSaved] = useState(false);
  const [zones, setZones] = useState(initial.nws_zones.join(', '));
  const [signupUrl, setSignupUrl] = useState(initial.alerts_signup_url ?? '');
  const [signupLabel, setSignupLabel] = useState(initial.alerts_signup_label ?? '');
  const [emergencyPhone, setEmergencyPhone] = useState(initial.emergency_phone ?? '');
  const [infoPhone, setInfoPhone] = useState(initial.info_phone ?? '');
  const [timeZone, setTimeZone] = useState(initial.time_zone);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(async () => {
          const r = await saveEmergencyConfig({
            tenantSlug,
            config: {
              nws_zones: list(zones).map((z) => z.toUpperCase()),
              alerts_signup_url: orNull(signupUrl),
              alerts_signup_label: orNull(signupLabel),
              emergency_phone: orNull(emergencyPhone),
              info_phone: orNull(infoPhone),
              time_zone: timeZone.trim(),
            },
          });
          if (r.ok) setSaved(true);
          return r;
        });
      }}
    >
      <fieldset disabled={!canEdit} className="space-y-3">
        <label className={label}>
          <span className="font-medium">NWS zones</span>
          <input className={field} value={zones} onChange={(e) => setZones(e.target.value)} placeholder="NYC061, NYC047" />
          <span className={hint}>
            UGC codes, comma-separated: list both the counties (NYC061) and the forecast zones (NYZ072) for your area.
            The NWS issues most heat, winter storm, coastal flood, wind, and air quality alerts by forecast zone, and
            tornado, severe thunderstorm, and flash flood warnings by county, so counties alone miss most alerts. The
            worker checks api.weather.gov for these every five minutes. Leave empty to turn alerts off.
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            <span className="font-medium">Official alert sign-up link</span>
            <input className={field} type="url" value={signupUrl} onChange={(e) => setSignupUrl(e.target.value)} placeholder="https://…" />
          </label>
          <label className={label}>
            <span className="font-medium">Sign-up link text</span>
            <input className={field} value={signupLabel} maxLength={80} onChange={(e) => setSignupLabel(e.target.value)} placeholder="Notify NYC" />
            <span className={hint}>Shown as entered (a proper name reads the same in every language).</span>
          </label>
          <label className={label}>
            <span className="font-medium">Emergency phone</span>
            <input className={field} type="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} placeholder="911" />
          </label>
          <label className={label}>
            <span className="font-medium">Information phone</span>
            <input className={field} type="tel" value={infoPhone} onChange={(e) => setInfoPhone(e.target.value)} placeholder="311" />
          </label>
          <label className={label}>
            <span className="font-medium">Time zone</span>
            <input className={field} list="emergency-time-zones" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
            <datalist id="emergency-time-zones">
              {TIME_ZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
            <span className={hint}>Alert times on the public page are shown on this clock (IANA name).</span>
          </label>
        </div>
      </fieldset>
      {canEdit ? (
        <div className="flex items-center gap-3">
          <Submit pending={pending}>Save alert settings</Submit>
          <Status error={error} saved={saved} />
        </div>
      ) : (
        <p className="text-xs text-[color:var(--color-muted)]">Only portrait owners can change these settings.</p>
      )}
    </form>
  );
}

// ---- Hazards ------------------------------------------------------------------------------

type HazardInput = HazardInputDraft;
type Impact = 'low' | 'moderate' | 'high';

const RINGS = [
  { ring: 'social', title: 'Social foundation' },
  { ring: 'ecological', title: 'Ecological ceiling' },
] as const;

export function HazardForm({ tenantSlug, hazard }: { tenantSlug: string; hazard?: HazardView }) {
  const { run, pending, error } = useAction();
  const [saved, setSaved] = useState(false);
  const blank = {
    slug: '',
    name: '',
    kind: 'other' as HazardInput['kind'],
    description: '',
    likelihood: 3,
    severity: 3,
    impacts: {} as Record<string, Impact>,
    nwsEvents: '',
    displayOrder: 0,
    published: false,
  };
  const start = hazard
    ? {
        slug: hazard.slug,
        name: hazard.name,
        kind: hazard.kind,
        description: hazard.description,
        likelihood: hazard.likelihood,
        severity: hazard.severity,
        impacts: Object.fromEntries(hazard.dimensions.map((d) => [d.dimension_slug, d.impact])) as Record<string, Impact>,
        nwsEvents: hazard.nwsEvents.join(', '),
        displayOrder: hazard.displayOrder,
        published: hazard.published,
      }
    : blank;
  const [s, set] = useState(start);
  const prefix = hazard ? `hz-${hazard.id}` : 'hz-new';

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        const input: Omit<HazardInput, 'published'> = {
          slug: s.slug,
          name: s.name,
          kind: s.kind,
          description: s.description,
          likelihood: s.likelihood,
          severity: s.severity,
          dimensions: Object.entries(s.impacts).map(([dimension_slug, impact]) => ({ dimension_slug, impact })),
          nws_events: list(s.nwsEvents),
          display_order: s.displayOrder,
        };
        run(async () => {
          const r = hazard
            ? await updateHazard({ tenantSlug, id: hazard.id, hazard: input })
            : await createHazard({ tenantSlug, hazard: { ...input, published: s.published } });
          if (r.ok) {
            setSaved(true);
            if (!hazard) set(blank);
          }
          return r;
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={label}>
          <span className="font-medium">Name</span>
          <input className={field} required value={s.name} onChange={(e) => set({ ...s, name: e.target.value })} placeholder="Extreme heat" />
        </label>
        <label className={label}>
          <span className="font-medium">Slug</span>
          <input
            className={`${field} font-mono`}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={s.slug}
            onChange={(e) => set({ ...s, slug: e.target.value })}
            placeholder="extreme-heat"
          />
          <span className={hint}>Lowercase, digits, dashes. Used in links (?hazard=…).</span>
        </label>
        <label className={label}>
          <span className="font-medium">Kind</span>
          <select className={field} value={s.kind} onChange={(e) => set({ ...s, kind: e.target.value as HazardInput['kind'] })}>
            {HAZARD_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL(k)}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span className="font-medium">Likelihood (1–5)</span>
          <select className={field} value={s.likelihood} onChange={(e) => set({ ...s, likelihood: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span className="font-medium">Severity (1–5)</span>
          <select className={field} value={s.severity} onChange={(e) => set({ ...s, severity: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <p className="self-end text-sm">
          Risk <strong>{s.likelihood * s.severity}</strong> of 25
        </p>
      </div>
      <label className={label}>
        <span className="font-medium">Description</span>
        <textarea className={field} rows={2} maxLength={2000} value={s.description} onChange={(e) => set({ ...s, description: e.target.value })} />
        <span className={hint}>Plain language, for residents. Published in English.</span>
      </label>
      <label className={label}>
        <span className="font-medium">NWS event names</span>
        <input
          className={field}
          value={s.nwsEvents}
          onChange={(e) => set({ ...s, nwsEvents: e.target.value })}
          placeholder="Heat Advisory, Excessive Heat Warning"
        />
        <span className={hint}>An active alert with one of these exact event names marks this hazard &ldquo;active now&rdquo;.</span>
      </label>
      <fieldset className="rounded border border-black/10 p-3">
        <legend className="px-1 text-sm font-medium">Doughnut dimensions it threatens</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {RINGS.map(({ ring, title }) => (
            <div key={ring}>
              <p className="text-xs font-medium text-[color:var(--color-muted)]">{title}</p>
              <ul className="mt-1 space-y-1">
                {framework.dimensions
                  .filter((d) => d.ring === ring)
                  .map((d) => {
                    const impact = s.impacts[d.slug];
                    const id = `${prefix}-dim-${d.slug}`;
                    return (
                      <li key={d.slug} className="flex items-center gap-2 text-sm">
                        <input
                          id={id}
                          type="checkbox"
                          checked={Boolean(impact)}
                          onChange={(e) => {
                            const next = { ...s.impacts };
                            if (e.target.checked) next[d.slug] = 'moderate';
                            else delete next[d.slug];
                            set({ ...s, impacts: next });
                          }}
                        />
                        <label htmlFor={id} className="flex-1">
                          {d.name}
                        </label>
                        {impact ? (
                          <select
                            aria-label={`Impact on ${d.name}`}
                            className="rounded border border-field-border bg-white px-1 py-0.5 text-xs"
                            value={impact}
                            onChange={(e) => set({ ...s, impacts: { ...s.impacts, [d.slug]: e.target.value as Impact } })}
                          >
                            <option value="low">low impact</option>
                            <option value="moderate">moderate impact</option>
                            <option value="high">high impact</option>
                          </select>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Order</span>
          <input
            className="w-20 rounded border border-field-border bg-white px-2 py-1 text-sm"
            type="number"
            min={0}
            max={10000}
            value={s.displayOrder}
            onChange={(e) => set({ ...s, displayOrder: Number(e.target.value) || 0 })}
          />
        </label>
        {hazard ? null : <PublishNow checked={s.published} onChange={(published) => set({ ...s, published })} />}
        <Submit pending={pending}>{hazard ? 'Save hazard' : 'Add hazard'}</Submit>
        <Status error={error} saved={saved} />
      </div>
    </form>
  );
}

// ---- Shared ------------------------------------------------------------------------------------

/** "Publish now" on the add forms only; existing records use the row's Publish button. */
function PublishNow({ checked, onChange }: { checked: boolean; onChange: (published: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Publish now
    </label>
  );
}

/**
 * The picked hazards that still exist. A form's state can outlive a hazard
 * (deleted or renamed in another tab); sending its old slug would only fail
 * with "Unknown hazard".
 */
function knownSlugs(picked: string[], hazards: { slug: string }[]): string[] {
  const known = new Set(hazards.map((h) => h.slug));
  return picked.filter((slug) => known.has(slug));
}

function HazardPicker({
  hazards,
  value,
  onChange,
  prefix,
}: {
  hazards: { slug: string; name: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  prefix: string;
}) {
  if (hazards.length === 0) return <p className="text-xs text-[color:var(--color-muted)]">Add hazards first to link them here.</p>;
  return (
    <fieldset>
      <legend className="text-sm font-medium">Hazards it addresses</legend>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {hazards.map((h) => {
          const id = `${prefix}-${h.slug}`;
          return (
            <li key={h.slug} className="flex items-center gap-1.5 text-sm">
              <input
                id={id}
                type="checkbox"
                checked={value.includes(h.slug)}
                onChange={(e) => onChange(e.target.checked ? [...value, h.slug] : value.filter((v) => v !== h.slug))}
              />
              <label htmlFor={id}>{h.name}</label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

// ---- Plans ---------------------------------------------------------------------------------------

type PlanInput = EmergencyPlanInputDraft;

export function PlanForm({
  tenantSlug,
  plan,
  hazards,
}: {
  tenantSlug: string;
  plan?: PlanView;
  hazards: { slug: string; name: string }[];
}) {
  const { run, pending, error } = useAction();
  const [saved, setSaved] = useState(false);
  const blank = {
    title: '',
    agency: '',
    url: '',
    adoptedYear: '',
    summary: '',
    languages: '',
    hazardSlugs: [] as string[],
    displayOrder: 0,
    published: false,
  };
  const [s, set] = useState(
    plan
      ? {
          title: plan.title,
          agency: plan.agency,
          url: plan.url,
          adoptedYear: plan.adoptedYear ? String(plan.adoptedYear) : '',
          summary: plan.summary,
          languages: plan.languages.join(', '),
          hazardSlugs: plan.hazardSlugs,
          displayOrder: plan.displayOrder,
          published: plan.published,
        }
      : blank,
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        const input: Omit<PlanInput, 'published'> = {
          title: s.title,
          agency: s.agency,
          url: s.url,
          adopted_year: s.adoptedYear.trim() ? Number(s.adoptedYear) : null,
          summary: s.summary,
          languages: list(s.languages),
          hazard_slugs: knownSlugs(s.hazardSlugs, hazards),
          display_order: s.displayOrder,
        };
        run(async () => {
          const r = plan
            ? await updatePlan({ tenantSlug, id: plan.id, plan: input })
            : await createPlan({ tenantSlug, plan: { ...input, published: s.published } });
          if (r.ok) {
            setSaved(true);
            if (!plan) set(blank);
          }
          return r;
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          <span className="font-medium">Title</span>
          <input className={field} required value={s.title} onChange={(e) => set({ ...s, title: e.target.value })} />
        </label>
        <label className={label}>
          <span className="font-medium">Agency</span>
          <input className={field} required value={s.agency} onChange={(e) => set({ ...s, agency: e.target.value })} />
        </label>
        <label className={label}>
          <span className="font-medium">Link to the plan</span>
          <input className={field} type="url" required value={s.url} onChange={(e) => set({ ...s, url: e.target.value })} placeholder="https://…" />
          <span className={hint}>The official page or document (https).</span>
        </label>
        <label className={label}>
          <span className="font-medium">Year adopted</span>
          <input className={field} inputMode="numeric" value={s.adoptedYear} onChange={(e) => set({ ...s, adoptedYear: e.target.value })} placeholder="2024" />
        </label>
      </div>
      <label className={label}>
        <span className="font-medium">Plain-language summary</span>
        <textarea className={field} rows={3} maxLength={2000} value={s.summary} onChange={(e) => set({ ...s, summary: e.target.value })} />
      </label>
      <label className={label}>
        <span className="font-medium">Languages the plan is published in</span>
        <input className={field} value={s.languages} onChange={(e) => set({ ...s, languages: e.target.value })} placeholder="en, es, zh-Hant, ru" />
        <span className={hint}>BCP 47 codes, comma-separated. Residents see each language named in its own script.</span>
      </label>
      <HazardPicker hazards={hazards} value={s.hazardSlugs} onChange={(hazardSlugs) => set({ ...s, hazardSlugs })} prefix={plan ? `pl-${plan.id}` : 'pl-new'} />
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Order</span>
          <input
            className="w-20 rounded border border-field-border bg-white px-2 py-1 text-sm"
            type="number"
            min={0}
            max={10000}
            value={s.displayOrder}
            onChange={(e) => set({ ...s, displayOrder: Number(e.target.value) || 0 })}
          />
        </label>
        {plan ? null : <PublishNow checked={s.published} onChange={(published) => set({ ...s, published })} />}
        <Submit pending={pending}>{plan ? 'Save plan' : 'Add plan'}</Submit>
        <Status error={error} saved={saved} />
      </div>
    </form>
  );
}

// ---- Help and mutual-aid resources ---------------------------------------------------------------------

type ResourceInput = EmergencyResourceInputDraft;

export function ResourceForm({
  tenantSlug,
  resource,
  hazards,
}: {
  tenantSlug: string;
  resource?: ResourceView;
  hazards: { slug: string; name: string }[];
}) {
  const { run, pending, error } = useAction();
  const [saved, setSaved] = useState(false);
  const blank = {
    name: '',
    kind: 'other' as ResourceInput['kind'],
    description: '',
    phone: '',
    url: '',
    hazardSlugs: [] as string[],
    displayOrder: 0,
    published: false,
  };
  const [s, set] = useState(
    resource
      ? {
          name: resource.name,
          kind: resource.kind,
          description: resource.description,
          phone: resource.phone ?? '',
          url: resource.url ?? '',
          hazardSlugs: resource.hazardSlugs,
          displayOrder: resource.displayOrder,
          published: resource.published,
        }
      : blank,
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        const input: Omit<ResourceInput, 'published'> = {
          name: s.name,
          kind: s.kind,
          description: s.description,
          phone: orNull(s.phone),
          url: orNull(s.url),
          hazard_slugs: knownSlugs(s.hazardSlugs, hazards),
          display_order: s.displayOrder,
        };
        run(async () => {
          const r = resource
            ? await updateResource({ tenantSlug, id: resource.id, resource: input })
            : await createResource({ tenantSlug, resource: { ...input, published: s.published } });
          if (r.ok) {
            setSaved(true);
            if (!resource) set(blank);
          }
          return r;
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          <span className="font-medium">Name</span>
          <input className={field} required value={s.name} onChange={(e) => set({ ...s, name: e.target.value })} />
        </label>
        <label className={label}>
          <span className="font-medium">Kind</span>
          <select className={field} value={s.kind} onChange={(e) => set({ ...s, kind: e.target.value as ResourceInput['kind'] })}>
            {RESOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL(k)}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span className="font-medium">Phone</span>
          <input className={field} type="tel" value={s.phone} onChange={(e) => set({ ...s, phone: e.target.value })} placeholder="311" />
        </label>
        <label className={label}>
          <span className="font-medium">Website</span>
          <input className={field} type="url" value={s.url} onChange={(e) => set({ ...s, url: e.target.value })} placeholder="https://… (optional)" />
        </label>
      </div>
      <label className={label}>
        <span className="font-medium">What it offers</span>
        <textarea className={field} rows={2} maxLength={2000} value={s.description} onChange={(e) => set({ ...s, description: e.target.value })} />
        <span className={hint}>Mutual-aid groups: confirm they are active and consent to being listed before publishing.</span>
      </label>
      <HazardPicker
        hazards={hazards}
        value={s.hazardSlugs}
        onChange={(hazardSlugs) => set({ ...s, hazardSlugs })}
        prefix={resource ? `rs-${resource.id}` : 'rs-new'}
      />
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Order</span>
          <input
            className="w-20 rounded border border-field-border bg-white px-2 py-1 text-sm"
            type="number"
            min={0}
            max={10000}
            value={s.displayOrder}
            onChange={(e) => set({ ...s, displayOrder: Number(e.target.value) || 0 })}
          />
        </label>
        {resource ? null : <PublishNow checked={s.published} onChange={(published) => set({ ...s, published })} />}
        <Submit pending={pending}>{resource ? 'Save resource' : 'Add resource'}</Submit>
        <Status error={error} saved={saved} />
      </div>
    </form>
  );
}
