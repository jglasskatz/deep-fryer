import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { AcceptInvitation } from '@/components/account/AcceptInvitation';
import { getAuth } from '@/lib/auth';
import { liveInvitation } from '@/lib/invitations';

export const metadata: Metadata = { title: 'Invitation', robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [view, auth] = await Promise.all([liveInvitation(token), getAuth()]);

  return (
    <>
      <SiteHeader variant="account" />
      <main id="main" className="mx-auto max-w-md px-4 py-16 sm:px-6">
        {!view ? (
          <>
            <h1 className="text-2xl font-bold">Invitation unavailable</h1>
            <p className="mt-3 text-sm text-[color:var(--color-muted)]">
              This link has expired, was revoked, or was already used. Ask the person who invited
              you for a new one.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Join {view.targetName}</h1>
            <p className="mt-3 text-sm">
              You are invited as <strong>{view.invitation.role}</strong>. This invitation is for{' '}
              <strong>{view.invitation.email}</strong> and expires{' '}
              {view.invitation.expiresAt.toISOString().slice(0, 10)}.
            </p>
            <div className="mt-6">
              {!auth.userId ? (
                <Link
                  className="inline-block rounded bg-black px-4 py-2 text-sm font-medium text-white"
                  href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                >
                  Sign in as {view.invitation.email} to accept
                </Link>
              ) : auth.email?.toLowerCase() !== view.invitation.email ? (
                <p className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
                  You are signed in as {auth.email ?? 'an account without an email'}. Sign out and
                  sign in as {view.invitation.email} to accept.
                </p>
              ) : (
                <AcceptInvitation token={token} />
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
