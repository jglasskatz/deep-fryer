import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { MembersPanel } from '@/components/admin/MembersPanel';
import { requireAdminPage } from '@/lib/admin-guard';
import { getAuth } from '@/lib/auth';
import { organizationOfTenant } from '@/lib/family';
import { pendingInvitations, tenantMembersList } from '@/lib/member-data';

export const metadata: Metadata = { title: 'Members' };

export default async function MembersPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const ctx = await requireAdminPage(tenant, 'viewer', `/${tenant}/admin/members`);
  const [members, invites, auth, org] = await Promise.all([
    tenantMembersList(ctx.tenant.id),
    ctx.role === 'owner' ? pendingInvitations({ tenantId: ctx.tenant.id }) : Promise.resolve([]),
    getAuth(),
    organizationOfTenant(ctx.tenant.slug),
  ]);

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold">Members</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          People with a role on {ctx.tenant.name}.
          {org ? (
            <>
              {' '}
              Owners of{' '}
              <a className="underline" href={`/o/${org.slug}`}>
                {org.name}
              </a>{' '}
              also administer this portrait.
            </>
          ) : null}
        </p>
        <div className="mt-8">
          <MembersPanel
            scope="tenant"
            slug={ctx.tenant.slug}
            members={members.map((m) => ({ ...m, since: m.since.toISOString() }))}
            invitations={invites.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }))}
            canManage={ctx.role === 'owner'}
            roles={['owner', 'editor', 'moderator', 'viewer']}
            currentUserId={auth.userId}
          />
        </div>
      </main>
    </>
  );
}
