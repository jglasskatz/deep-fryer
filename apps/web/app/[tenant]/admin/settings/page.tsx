import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { SettingsForms } from '@/components/admin/SettingsForms';
import { tenantConfigMap } from '@/lib/admin-data';
import { requireAdminPage } from '@/lib/admin-guard';
import { EmbedSettings } from '@/components/admin/EmbedSettings';
import { appUrl } from '@/lib/env';
import { deploymentDisabled } from '@/lib/features';
import { TRANSLATION_REQUEST_WINDOW_DAYS, translationRequestCounts } from '@/lib/translation-requests';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const ctx = await requireAdminPage(tenant, 'owner');
  const [config, requests] = await Promise.all([
    tenantConfigMap(ctx.tenant.id),
    translationRequestCounts(ctx.tenant.id),
  ]);

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin`}>
            ← Admin
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Every human judgment is explicit, versioned configuration (SPEC §6). Changes are
          audited and reflected on the public methodology page.
        </p>
        <div className="mt-8">
          <SettingsForms
            tenantSlug={tenant}
            region={config.region ?? null}
            sourcePriority={config.source_priority ?? null}
            recency={config.recency ?? null}
            scalePolicy={config.scale_policy ?? null}
            thresholdOverrides={config.threshold_overrides ?? null}
            reviewPolicy={config.review_policy ?? null}
            retention={config.retention ?? null}
            notifications={config.notifications ?? null}
            progress={config.progress ?? null}
            features={config.features ?? null}
            deploymentDisabled={[...deploymentDisabled()]}
            translationRequests={requests}
            translationRequestDays={TRANSLATION_REQUEST_WINDOW_DAYS}
          />
        </div>
        <div className="mt-6">
          <EmbedSettings
            tenantSlug={ctx.tenant.slug}
            origins={ctx.tenant.embedOrigins ?? []}
            appUrl={appUrl()}
          />
        </div>
      </main>
    </>
  );
}
