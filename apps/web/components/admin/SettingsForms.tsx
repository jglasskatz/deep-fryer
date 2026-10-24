'use client';

import { useId, useState, useTransition } from 'react';
import {
  FEATURE_REGISTRY,
  PORTRAIT_FEATURES,
  resolvePortraitFeatures,
  defaultProgressConfig,
  defaultNotifications,
  defaultRetention,
  defaultReviewPolicy,
  type FeaturesConfig,
  type NotificationConfig,
  type ProgressConfig,
  type PortraitConfig,
  type RetentionConfig,
  type ReviewPolicyConfig,
  type TenantConfigKey,
} from '@deep-fryer/core';
import { updateConfig } from '@/lib/actions';

const field = 'w-full rounded border border-field-border bg-white px-2 py-1 text-sm';

/**
 * A settings section. `ids` lets a lone field inside take the heading as its
 * label and the description as its description (JsonEditor), where a
 * visible <label> would only repeat the heading.
 */
function Section({
  title,
  description,
  ids,
  children,
}: {
  title: string;
  description?: string;
  ids?: { heading: string; description: string };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-black/15 p-4">
      <h2 id={ids?.heading} className="text-base font-semibold">
        {title}
      </h2>
      {description ? (
        <p id={ids?.description} className="mt-1 text-xs text-[color:var(--color-muted)]">
          {description}
        </p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
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

function JsonEditor({
  label,
  description,
  configKey,
  initial,
  onSave,
  pending,
  status,
}: {
  label: string;
  description: string;
  configKey: TenantConfigKey;
  initial: unknown;
  onSave: (key: TenantConfigKey, value: unknown) => void;
  pending: boolean;
  status?: string;
}) {
  const [text, setText] = useState(JSON.stringify(initial ?? {}, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  // The textarea is named by the section heading and described by its text
  // (and by the parse error while one shows); without these a screen reader
  // announces only the raw JSON, with no field name (WCAG 1.3.1 / 4.1.2).
  const id = useId();
  const ids = { heading: `${id}-heading`, description: `${id}-description` };
  const errorId = `${id}-error`;
  return (
    <Section title={label} description={description} ids={ids}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const value = JSON.parse(text);
            setParseError(null);
            onSave(configKey, value);
          } catch {
            setParseError('Invalid JSON');
          }
        }}
      >
        <textarea
          className={`${field} font-mono text-xs`}
          rows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-labelledby={ids.heading}
          aria-describedby={parseError ? `${ids.description} ${errorId}` : ids.description}
          aria-invalid={parseError ? true : undefined}
        />
        {parseError ? (
          <p id={errorId} className="mt-1 text-xs text-red-700">
            {parseError}
          </p>
        ) : null}
        {status ? <p className="mt-1 text-xs">{status}</p> : null}
        <SaveButton pending={pending} />
      </form>
    </Section>
  );
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

      <JsonEditor
        label="Source priority tiers"
        description="Ordered tiers; a research session must exhaust tier N before accepting tier N+1. Every finding records the tier that satisfied it."
        configKey="source_priority"
        initial={sourcePriority}
        onSave={save}
        pending={isPending('source_priority')}
        status={status.source_priority}
      />

      <JsonEditor
        label="Geographic scale policy"
        description="Accepted scales in preference order, with per-dimension exceptions (e.g. ocean acidification may accept regional data)."
        configKey="scale_policy"
        initial={scalePolicy}
        onSave={save}
        pending={isPending('scale_policy')}
        status={status.scale_policy}
      />

      <JsonEditor
        label="Threshold overrides"
        description="threshold_ref → { target, rationale, target_year? }. A rationale is required and is rendered verbatim on the public methodology page; target_year (when the goal is due) drives the progress glidepath."
        configKey="threshold_overrides"
        initial={thresholdOverrides}
        onSave={save}
        pending={isPending('threshold_overrides')}
        status={status.threshold_overrides}
      />
    </div>
  );
}
