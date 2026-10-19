import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ActionButton } from '@/components/admin/ActionButton';
import { tenantDimensions } from '@/lib/admin-data';
import { requireAdminPage } from '@/lib/admin-guard';
import { adminPageMetadata } from '@/lib/page-meta';
import { moderationQueue, RECENTLY_REMOVED_LIMIT, type QueueComment } from '@/lib/discussion';
import { moderateComment } from '@/lib/discussion-actions';
import { requireFeature } from '@/lib/features';

export const dynamic = 'force-dynamic';

/** Discussion · Admin · <portrait> (WCAG 2.4.2): the generic site title named none of the staff pages. */
export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  return adminPageMetadata((await params).tenant, 'Discussion');
}

/** Staff timestamps: unambiguous, on the portrait's own clock, with the zone named. */
function when(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(date);
}

function Chip({ tone = 'neutral', title, children }: { tone?: 'neutral' | 'warn' | 'staff'; title?: string; children: React.ReactNode }) {
  const tones = {
    neutral: 'bg-black/10',
    warn: 'bg-amber-100 text-amber-900',
    staff: 'bg-sky-100 text-sky-900',
  };
  return (
    <span title={title} className={`rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Where a comment lives: its dimension's name, linked to the public thread (the slug is the route). */
interface DimensionRef {
  name: string;
  slug: string;
}

function CommentCard({
  tenantSlug,
  comment: c,
  dimension,
  timeZone,
  children,
}: {
  tenantSlug: string;
  comment: QueueComment;
  dimension: DimensionRef | undefined;
  timeZone: string;
  /** The moderation buttons for this comment's state. */
  children: React.ReactNode;
}) {
  const stateLine =
    c.state === 'held'
      ? `Posted ${when(c.createdAt, timeZone)}`
      : `${c.state === 'declined' ? 'Declined' : 'Removed'} ${c.removedAt ? when(c.removedAt, timeZone) : ''} · posted ${when(c.createdAt, timeZone)}`;
  return (
    <li className="rounded border border-black/10 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {dimension ? (
            <Link className="font-semibold underline" href={`/${tenantSlug}/dim/${dimension.slug}`}>
              {dimension.name}
            </Link>
          ) : (
            <span className="font-semibold">A dimension no longer on the portrait</span>
          )}
          {c.isReply ? <Chip>reply</Chip> : null}
          {c.state === 'declined' ? <Chip>declined — only its author sees it</Chip> : null}
          {c.state === 'removed' ? <Chip>removed — the public sees a placeholder</Chip> : null}
        </p>
        <p className="text-xs text-[color:var(--color-muted)]">{stateLine}</p>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        {/* The name residents see beside the comment: a display name, or the portrait's pseudonym for the account. */}
        <span className="font-medium">{c.author}</span>
        {c.staff ? (
          <Chip tone="staff" title="Member of this portrait’s team">
            Staff
          </Chip>
        ) : null}
      </p>
      {/* Residents write in any language: dir="auto" lets each comment take its own direction. */}
      <p
        dir="auto"
        className={`mt-2 whitespace-pre-wrap text-sm ${c.state === 'held' ? '' : 'text-[color:var(--color-muted)]'}`}
      >
        {c.body}
      </p>
      {c.reason ? (
        <p className="mt-1 text-xs text-[color:var(--color-muted)]" dir="auto">
          Reason logged: {c.reason}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </li>
  );
}

/**
 * The discussion queue (SPEC-v6 §3.2). A first comment from a new account
 * is held until a moderator reads it here — or in its thread, where
 * moderators see it too — and approves or declines it. Below the queue, the
 * most recent removals and declines, so a mistake can be undone.
 *
 * Moderators and above. Every button calls the same moderateComment action
 * the thread uses, under the moderator's own role, and each action is
 * logged with its reason.
 */
export default async function DiscussionAdminPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  // Behind the portrait's `discussion` feature, like every page of it (SPEC-v7 §3): off means 404.
  await requireFeature(tenant, 'discussion');
  const ctx = await requireAdminPage(tenant, 'moderator', `/${tenant}/admin/discussion`);
  const slug = ctx.tenant.slug;
  const [queue, dims] = await Promise.all([moderationQueue(ctx.tenant.id), tenantDimensions(ctx.tenant.id)]);
  const dimensionById = new Map<string, DimensionRef>(
    dims.map(({ dimension, published, latest }) => [
      dimension.id,
      { slug: dimension.slug, name: published?.data.name ?? latest?.data.name ?? dimension.slug },
    ]),
  );
  const tz = queue.timeZone;
  const bind = (commentId: string, action: 'approve' | 'decline' | 'restore') =>
    moderateComment.bind(null, { tenantSlug: slug, commentId, action });

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="text-sm">
          <Link className="underline" href={`/${slug}/admin`}>
            ← Admin
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Discussion</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          When the portrait requires approval for first posts, a new account’s first comment waits here. Until a
          moderator approves it, only its author and the moderators can see it — the public sees nothing, not even a
          placeholder. Declined comments stay visible to their author only. Every action is logged.
        </p>

        <section className="mt-8" aria-labelledby="held">
          <h2 id="held" className="text-lg font-semibold">
            Awaiting approval ({queue.heldTotal})
          </h2>
          {queue.held.length === 0 ? (
            <p className="mt-2 rounded border border-dashed border-black/20 p-4 text-sm text-[color:var(--color-muted)]">
              Nothing is waiting. New residents’ first comments will appear here.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                Oldest first.
                {queue.heldTotal > queue.held.length
                  ? ` Showing the oldest ${queue.held.length} of ${queue.heldTotal}; the rest appear as these are reviewed.`
                  : ''}
              </p>
              <ul className="mt-3 space-y-2">
                {queue.held.map((c) => (
                  <CommentCard
                    key={c.id}
                    tenantSlug={slug}
                    comment={c}
                    dimension={dimensionById.get(c.dimensionId)}
                    timeZone={tz}
                  >
                    <ActionButton
                      action={bind(c.id, 'approve')}
                      pendingLabel="Approving…"
                      className="rounded bg-black px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Approve
                    </ActionButton>
                    <ActionButton action={bind(c.id, 'decline')} pendingLabel="Declining…">
                      Decline
                    </ActionButton>
                  </CommentCard>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="mt-10" aria-labelledby="removed">
          <h2 id="removed" className="text-lg font-semibold">
            Recently removed
          </h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            The last {RECENTLY_REMOVED_LIMIT} comments a moderator removed or declined, most recent first. Restoring a
            removed comment or approving a declined one publishes it again.
          </p>
          {queue.recentlyRemoved.length === 0 ? (
            <p className="mt-2 rounded border border-dashed border-black/20 p-4 text-sm text-[color:var(--color-muted)]">
              No comments have been removed or declined.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {queue.recentlyRemoved.map((c) => (
                <CommentCard
                  key={c.id}
                  tenantSlug={slug}
                  comment={c}
                  dimension={dimensionById.get(c.dimensionId)}
                  timeZone={tz}
                >
                  {c.state === 'declined' ? (
                    <ActionButton action={bind(c.id, 'approve')} pendingLabel="Approving…">
                      Approve
                    </ActionButton>
                  ) : (
                    <ActionButton action={bind(c.id, 'restore')} pendingLabel="Restoring…">
                      Restore
                    </ActionButton>
                  )}
                </CommentCard>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
