'use client';

import { useState } from 'react';
import {
  changeTenantMemberRole,
  inviteOrgMember,
  inviteTenantMember,
  removeOrgMember,
  removeTenantMember,
  revokeOrgInvitation,
  revokeTenantInvitation,
} from '@/lib/member-actions';
import { unwrap } from '@/lib/action-result';
import { useAction } from '@/lib/use-action';

export interface PanelMember {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  since: string;
}

export interface PanelInvitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

const ROLE_HELP: Record<string, string> = {
  owner: 'Everything, including settings, members, and transcripts',
  editor: 'Plan research, review findings, edit and publish',
  moderator: 'Moderate the public discussion',
  viewer: 'Read the admin surface',
  billing: 'Plan, invoices, and payment methods',
};

/**
 * Team management for one scope — a portrait (tenant roles) or an
 * organization (owner / billing). Owners invite by email; when outbound mail
 * is not configured the invitation link is shown to copy instead.
 */
export function MembersPanel({
  scope,
  slug,
  members,
  invitations,
  canManage,
  roles,
  currentUserId,
}: {
  scope: 'tenant' | 'organization';
  slug: string;
  members: PanelMember[];
  invitations: PanelInvitation[];
  canManage: boolean;
  roles: string[];
  currentUserId: string | null;
}) {
  const { run, pending, error } = useAction();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roles[roles.length > 1 ? 1 : 0]!);
  const [sent, setSent] = useState<{ email: string; url: string; emailed: boolean } | null>(null);

  const invite = () =>
    run(async () => {
      const res = unwrap(
        scope === 'tenant'
          ? await inviteTenantMember({ tenantSlug: slug, email, role: role as never })
          : await inviteOrgMember({ orgSlug: slug, email, role: role as never }),
      );
      setSent(res);
      setEmail('');
    });

  return (
    <div className="space-y-8">
      {canManage ? (
        <form
          className="rounded border border-black/15 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            invite();
          }}
        >
          <h2 className="text-base font-semibold">Invite someone</h2>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor={`invite-email-${scope}`}>
              Email
            </label>
            <input
              id={`invite-email-${scope}`}
              type="email"
              required
              className="flex-1 rounded border border-black/20 bg-white px-2 py-1.5 text-sm"
              placeholder="colleague@cityofexample.gov"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label className="sr-only" htmlFor={`invite-role-${scope}`}>
              Role
            </label>
            <select
              id={`invite-role-${scope}`}
              className="rounded border border-black/20 bg-white px-2 py-1.5 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={pending || !email}
            >
              {pending ? 'Inviting…' : 'Send invitation'}
            </button>
          </div>
          <p className="mt-2 text-xs text-[color:var(--color-muted)]">
            {role}: {ROLE_HELP[role]}. Invitations expire in 7 days and only work for the invited
            address.
          </p>
          {sent ? (
            <div role="status" className="mt-3 rounded bg-green-50 p-3 text-sm">
              {sent.emailed ? (
                <>Invitation emailed to {sent.email}.</>
              ) : (
                <>
                  The invitation email could not be sent from this server — send {sent.email} this
                  link yourself:
                  <input
                    readOnly
                    className="mt-2 w-full rounded border border-black/15 bg-white px-2 py-1 font-mono text-xs"
                    value={sent.url}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </>
              )}
            </div>
          ) : null}
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section>
        <h2 className="text-base font-semibold">People ({members.length})</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b text-left text-[color:var(--color-muted)]">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-b">
                  <td className="py-2 pr-4">
                    {m.name ?? '—'}
                    {m.userId === currentUserId ? (
                      <span className="ml-1 text-xs text-[color:var(--color-muted)]">(you)</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4">{m.email ?? '—'}</td>
                  <td className="py-2 pr-4">
                    {canManage && scope === 'tenant' ? (
                      <select
                        aria-label={`Role for ${m.email ?? m.name ?? 'member'}`}
                        className="rounded border border-black/20 bg-white px-1.5 py-0.5"
                        value={m.role}
                        disabled={pending}
                        onChange={(e) =>
                          run(() =>
                            changeTenantMemberRole({
                              tenantSlug: slug,
                              userId: m.userId,
                              role: e.target.value as never,
                            }),
                          )
                        }
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      m.role
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {canManage ? (
                      <button
                        className="text-xs underline disabled:opacity-50"
                        disabled={pending}
                        onClick={() => {
                          if (!window.confirm(`Remove ${m.email ?? 'this person'}?`)) return;
                          run(() =>
                            scope === 'tenant'
                              ? removeTenantMember({ tenantSlug: slug, userId: m.userId })
                              : removeOrgMember({ orgSlug: slug, userId: m.userId }),
                          );
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {members.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 text-[color:var(--color-muted)]">
                    Nobody yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {invitations.length > 0 ? (
        <section>
          <h2 className="text-base font-semibold">Pending invitations</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 border-b py-1.5">
                <span>
                  {i.email} · {i.role}
                  <span className="ml-2 text-xs text-[color:var(--color-muted)]">
                    expires {i.expiresAt.slice(0, 10)}
                  </span>
                </span>
                {canManage ? (
                  <button
                    className="text-xs underline"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        scope === 'tenant'
                          ? revokeTenantInvitation({ tenantSlug: slug, invitationId: i.id })
                          : revokeOrgInvitation({ orgSlug: slug, invitationId: i.id }),
                      )
                    }
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
