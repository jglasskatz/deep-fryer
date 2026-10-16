import Link from 'next/link';
import { nwsAlertRecordUrl } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ActionButton } from '@/components/admin/ActionButton';
import { EmergencyConfigForm, HazardForm, PlanForm, ResourceForm } from '@/components/emergency/AdminForms';
import { requireAdminPage } from '@/lib/admin-guard';
import { roleAtLeast } from '@/lib/auth';
import { emergencyAdminView, type SyncState } from '@/lib/emergency';
import {
  deleteHazard,
  deletePlan,
  deleteResource,
  setEmergencyPublished,
  type EmergencyEntity,
} from '@/lib/emergency-actions';
import { requireFeature } from '@/lib/features';
import { safeHref } from '@/lib/safe-url';

export const dynamic = 'force-dynamic';

/** Staff timestamps: unambiguous, in the portrait's own zone. */
function when(date: Date | null, timeZone: string): string {
  if (!date) return 'never';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'long', timeZone }).format(date);
}

function SyncSummary({ sync, zones, timeZone }: { sync: SyncState; zones: string[]; timeZone: string }) {
  if (zones.length === 0) {
    return <p className="text-sm text-[color:var(--color-muted)]">Alerts are off: no NWS zones configured.</p>;
  }
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
      <dt className="font-medium">Zones</dt>
      <dd className="font-mono">{zones.join(', ')}</dd>
      <dt className="font-medium">Last checked</dt>
      <dd>{when(sync.lastAttemptAt, timeZone)}</dd>
      <dt className="font-medium">Last success</dt>
      <dd>
        {when(sync.lastSuccessAt, timeZone)}
        {sync.stale ? (
          <span className="ms-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
            stale — the public page tells residents to check the NWS directly
          </span>
        ) : null}
      </dd>
      {sync.lastError ? (
        <>
          {/* A successful run can leave a note (alerts it could not read and kept as stored). */}
          <dt className="font-medium">
            {sync.lastSuccessAt && sync.lastAttemptAt && sync.lastSuccessAt.getTime() === sync.lastAttemptAt.getTime()
              ? 'Note from the last check'
              : 'Last error'}
          </dt>
          <dd className="text-red-700">{sync.lastError}</dd>
        </>
      ) : null}
    </dl>
  );
}

function PublishedChip({ published }: { published: boolean }) {
  return published ? (
    <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-900">published</span>
  ) : (
    <span className="rounded bg-black/10 px-1.5 py-0.5 text-xs font-medium">draft</span>
  );
}

function RowActions({
  tenantSlug,
  entity,
  id,
  published,
  name,
  remove,
}: {
  tenantSlug: string;
  entity: EmergencyEntity;
  id: string;
  published: boolean;
  name: string;
  remove: typeof deleteHazard;
}) {
  return (
    <span className="flex flex-wrap items-start gap-2">
      <ActionButton action={setEmergencyPublished.bind(null, { tenantSlug, entity, id, published: !published })} pendingLabel="Saving…">
        {published ? 'Unpublish' : 'Publish'}
      </ActionButton>
      <ActionButton
        action={remove.bind(null, { tenantSlug, id })}
        pendingLabel="Deleting…"
        confirm={`Delete “${name}”? This cannot be undone.`}
        className="rounded border border-red-300 px-2 py-1 text-xs text-red-800 hover:bg-red-50 disabled:opacity-50"
      >
        Delete
      </ActionButton>
    </span>
  );
}

/**
 * Staff curation for the emergency view (SPEC-v5 §3). Editors rate and
 * publish hazards, plans, and help resources; owners set which official
 * alerts the portrait shows (NWS zones) and the official sign-up and phone
 * numbers. Nothing here originates an alert: the alert list is the worker's
 * copy of the NWS feed, shown so staff can see what residents see.
 */
export default async function EmergencyAdminPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  await requireFeature(tenant, 'emergency');
  const ctx = await requireAdminPage(tenant, 'editor', `/${tenant}/admin/emergency`);
  const view = await emergencyAdminView(ctx.tenant);
  const slug = ctx.tenant.slug;
  const tz = view.config.time_zone;
  const hazardOptions = view.hazards.map((h) => ({ slug: h.slug, name: h.name }));
  const hazardName = new Map(view.hazards.map((h) => [h.slug, h.name]));

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="text-sm">
          <Link className="underline" href={`/${slug}/admin`}>
            ← Admin
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Emergency view</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Official alerts, threats rated by risk, adopted plans, and help — the public page at{' '}
          <Link className="underline" href={`/${slug}/emergency`}>
            /{slug}/emergency
          </Link>
          . Only published rows are public; every change is audited. Ratings are a staff judgment: likelihood × severity,
          each 1–5.
        </p>

        <section className="mt-8 rounded border border-black/15 p-4" aria-labelledby="sync">
          <h2 id="sync" className="text-base font-semibold">
            Official alerts (National Weather Service)
          </h2>
          <div className="mt-3">
            <SyncSummary sync={view.sync} zones={view.config.nws_zones} timeZone={tz} />
          </div>
          {view.alertsConfigured ? (
            view.alerts.length === 0 ? (
              <p className="mt-3 text-sm">No current alerts in the last sync.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {view.alerts.map((a) => (
                  <li key={a.id} className="rounded border border-black/10 p-2">
                    <span className="font-medium">{a.event}</span> · {a.severity} · until {when(a.until, tz)}
                    {a.hazardSlugs.length ? (
                      <span className="text-[color:var(--color-muted)]">
                        {' '}
                        — marks {a.hazardSlugs.map((s) => hazardName.get(s) ?? s).join(', ')} active
                      </span>
                    ) : null}
                    {a.headline ? <span className="block text-xs text-[color:var(--color-muted)]">{a.headline}</span> : null}
                    <span className="flex flex-wrap gap-x-3 text-xs">
                      {safeHref(a.url) ? (
                        <a className="underline" href={safeHref(a.url)} rel="noopener noreferrer">
                          Page residents open
                        </a>
                      ) : null}
                      {nwsAlertRecordUrl(a.sourceId) ? (
                        <a className="underline" href={nwsAlertRecordUrl(a.sourceId)!} rel="noopener noreferrer">
                          NWS record (JSON)
                        </a>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>

        <section className="mt-6 rounded border border-black/15 p-4" aria-labelledby="config">
          <h2 id="config" className="text-base font-semibold">
            Alert settings
          </h2>
          {!view.configSaved ? (
            <p className="mt-1 text-sm text-[color:var(--color-muted)]">
              Not set up yet. Until an owner saves these, the public page says official alerts are not set up and shows
              no sign-up link or phone numbers.
            </p>
          ) : null}
          {view.configInvalid ? (
            <p role="alert" className="mt-2 text-sm text-red-700">
              The saved settings no longer validate ({view.configInvalid}); the form shows defaults and saving replaces
              them. Until then the public page treats alerts as not set up.
            </p>
          ) : null}
          <div className="mt-3">
            <EmergencyConfigForm tenantSlug={slug} initial={view.config} canEdit={roleAtLeast(ctx.role, 'owner')} />
          </div>
        </section>

        <section className="mt-10" aria-labelledby="hazards">
          <h2 id="hazards" className="text-lg font-semibold">
            Hazards ({view.hazards.length})
          </h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            Highest risk first. Risk bands: 1–4 low, 5–9 moderate, 10–16 high, 20–25 very high.
          </p>
          <ul className="mt-3 space-y-2">
            {view.hazards.map((h) => (
              <li key={h.id} className="rounded border border-black/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium">{h.name}</span> <span className="font-mono text-xs">({h.slug})</span> · risk{' '}
                    {h.risk} ({h.band.replace('_', ' ')}) · L{h.likelihood} × S{h.severity} <PublishedChip published={h.published} />
                    {h.activeNow ? (
                      <span className="ms-1 rounded bg-red-800 px-1.5 py-0.5 text-xs font-medium text-white">active now</span>
                    ) : null}
                  </div>
                  <RowActions tenantSlug={slug} entity="hazard" id={h.id} published={h.published} name={h.name} remove={deleteHazard} />
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm underline">Edit</summary>
                  <div className="mt-3">
                    {/* Keyed by updatedAt: a changed record remounts with its new values (AdminForms). */}
                    <HazardForm key={`${h.id}:${h.updatedAt.getTime()}`} tenantSlug={slug} hazard={h} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <details className="mt-3 rounded border border-dashed border-black/20 p-3" open={view.hazards.length === 0}>
            <summary className="cursor-pointer text-sm font-medium">Add a hazard</summary>
            <div className="mt-3">
              <HazardForm tenantSlug={slug} />
            </div>
          </details>
        </section>

        <section className="mt-10" aria-labelledby="plans">
          <h2 id="plans" className="text-lg font-semibold">
            Plans ({view.plans.length})
          </h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            Adopted plans residents should know about. Link the official page and check it before publishing.
          </p>
          <ul className="mt-3 space-y-2">
            {view.plans.map((p) => (
              <li key={p.id} className="rounded border border-black/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium">{p.title}</span> · {p.agency}
                    {p.adoptedYear ? `, ${p.adoptedYear}` : ''} <PublishedChip published={p.published} />
                    {safeHref(p.url) ? (
                      <a className="ms-2 text-xs underline" href={safeHref(p.url)} rel="noopener noreferrer">
                        open link
                      </a>
                    ) : null}
                  </div>
                  <RowActions tenantSlug={slug} entity="emergency_plan" id={p.id} published={p.published} name={p.title} remove={deletePlan} />
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm underline">Edit</summary>
                  <div className="mt-3">
                    <PlanForm key={`${p.id}:${p.updatedAt.getTime()}`} tenantSlug={slug} plan={p} hazards={hazardOptions} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <details className="mt-3 rounded border border-dashed border-black/20 p-3" open={view.plans.length === 0}>
            <summary className="cursor-pointer text-sm font-medium">Add a plan</summary>
            <div className="mt-3">
              <PlanForm tenantSlug={slug} hazards={hazardOptions} />
            </div>
          </details>
        </section>

        <section className="mt-10" aria-labelledby="resources">
          <h2 id="resources" className="text-lg font-semibold">
            Help and mutual aid ({view.resources.length})
          </h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            Cooling centers, shelters, hotlines, mutual-aid groups. Residents can call the number with one tap.
          </p>
          <ul className="mt-3 space-y-2">
            {view.resources.map((r) => (
              <li key={r.id} className="rounded border border-black/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium">{r.name}</span> · {r.kind.replace('_', ' ')}
                    {r.phone ? ` · ${r.phone}` : ''} <PublishedChip published={r.published} />
                  </div>
                  <RowActions
                    tenantSlug={slug}
                    entity="emergency_resource"
                    id={r.id}
                    published={r.published}
                    name={r.name}
                    remove={deleteResource}
                  />
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm underline">Edit</summary>
                  <div className="mt-3">
                    <ResourceForm key={`${r.id}:${r.updatedAt.getTime()}`} tenantSlug={slug} resource={r} hazards={hazardOptions} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <details className="mt-3 rounded border border-dashed border-black/20 p-3" open={view.resources.length === 0}>
            <summary className="cursor-pointer text-sm font-medium">Add a resource</summary>
            <div className="mt-3">
              <ResourceForm tenantSlug={slug} hazards={hazardOptions} />
            </div>
          </details>
        </section>
      </main>
    </>
  );
}
