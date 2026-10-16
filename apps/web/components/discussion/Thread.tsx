'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { CommentView, ModerationVerb } from '@/lib/discussion';
import { moderateComment, postComment, voteComment } from '@/lib/discussion-actions';
import { useAction } from '@/lib/use-action';
import { unwrap } from '@/lib/action-result';
import { fmt, rich } from '@/lib/i18n/format';
import type { Messages } from '@/lib/i18n/messages/en';

/**
 * The thread's words in the reader's language (lib/i18n catalogs). The page
 * spreads the whole `discussion` catalog, so this includes the moderation
 * words of SPEC-v6 §3.1/§3.3 — awaitingApproval / awaitingNote, declined /
 * declinedNote, approve / decline, staff / staffTitle — beside v1's.
 */
export type ThreadLabels = Messages['discussion'] & { signIn: string };

export function Thread({
  tenantSlug,
  dimensionId,
  comments,
  viewerId,
  canPost,
  isModerator,
  sort,
  labels,
  signInHref,
}: {
  tenantSlug: string;
  dimensionId: string;
  comments: CommentView[];
  viewerId: string | null;
  canPost: boolean;
  isModerator: boolean;
  sort: 'top' | 'new';
  labels: ThreadLabels;
  /** Sign-in link that returns to this page in the reader's language. */
  signInHref: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const { run: act, pending, error } = useAction();

  const setSort = (s: 'top' | 'new') => {
    const next = new URLSearchParams(params);
    next.set('sort', s);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{labels.title}</h2>
        <div role="group" aria-label={labels.sortLabel} className="flex gap-1 text-xs">
          {(['top', 'new'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className={`rounded px-2 py-1 ${sort === s ? 'bg-black text-white' : 'border hover:bg-black/5'}`}
            >
              {s === 'top' ? labels.sortTop : labels.sortNew}
            </button>
          ))}
        </div>
      </div>

      {canPost ? (
        <div className="mt-4">
          <textarea
            className="w-full rounded border border-field-border px-3 py-2 text-sm"
            rows={3}
            aria-label={labels.title}
            placeholder={labels.placeholder}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button
            className="mt-2 rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={pending || !body.trim()}
            onClick={() =>
              act(async () => {
                const res = unwrap(await postComment({ tenantSlug, dimensionId, body }));
                setBody('');
                setNotice(res.pendingApproval ? labels.pendingApproval : null);
              })
            }
          >
            {labels.post}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[color:var(--color-muted)]">
          {rich(labels.signInToJoin, {
            link: (
              <a className="underline" href={signInHref}>
                {labels.signIn}
              </a>
            ),
          })}
        </p>
      )}
      {notice ? (
        <p role="status" className="mt-2 text-sm text-green-800">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <ul className="mt-6 space-y-4">
        {comments.length === 0 ? (
          <li className="text-sm text-[color:var(--color-muted)]">{labels.empty}</li>
        ) : (
          comments.map((c) => (
            <CommentItem
              key={c.id}
              c={c}
              tenantSlug={tenantSlug}
              dimensionId={dimensionId}
              viewerId={viewerId}
              canPost={canPost}
              isModerator={isModerator}
              act={act}
              pending={pending}
              labels={labels}
            />
          ))
        )}
      </ul>
    </section>
  );
}

/** A small inline label beside the author's name. */
function Chip({ children, title, tone = 'neutral' }: { children: React.ReactNode; title?: string; tone?: 'neutral' | 'pending' | 'staff' }) {
  const tones = {
    neutral: 'bg-black/10',
    pending: 'bg-amber-100 text-amber-900',
    staff: 'bg-sky-100 text-sky-900',
  };
  return (
    <span title={title} className={`rounded px-1.5 py-0.5 font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/**
 * A moderation button. Staff moderate from phones too, so each is a 44 px
 * target with room between them (the group's gap): a thumb meant for
 * "approve" must not land on "decline".
 */
const MODERATE_BUTTON = 'inline-flex min-h-11 items-center underline';

/**
 * One comment and its replies. What the viewer is shown was decided on the
 * server (lib/discussion.ts commentDisclosure): a held or declined comment
 * only reaches its author and moderators, and `body` is null exactly when
 * this viewer gets the removal placeholder. This component only chooses the
 * labels and the actions each state allows (SPEC-v6 §3.1):
 *
 * - visible  — votes, reply; moderators remove / lock.
 * - held     — "Awaiting approval"; the author is told only they and the
 *              moderators can see it; moderators approve / decline. No votes
 *              or replies: it is not public yet.
 * - declined — "Not approved"; the author is told so; moderators can still
 *              approve it.
 * - removed  — the placeholder for the public; moderators read the text and
 *              restore it.
 */
function CommentItem({
  c,
  tenantSlug,
  dimensionId,
  viewerId,
  canPost,
  isModerator,
  act,
  pending,
  labels,
  isReply = false,
}: {
  c: CommentView;
  tenantSlug: string;
  dimensionId: string;
  viewerId: string | null;
  canPost: boolean;
  isModerator: boolean;
  act: (fn: () => Promise<unknown>, opts?: { refresh?: boolean }) => void;
  pending: boolean;
  labels: ThreadLabels;
  isReply?: boolean;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');

  const vote = (v: 1 | -1) =>
    act(() =>
      voteComment({ tenantSlug, commentId: c.id, vote: c.myVote === v ? 0 : v }),
    );
  const moderate = (action: ModerationVerb, reason?: string) =>
    act(() => moderateComment({ tenantSlug, commentId: c.id, action, reason }));
  /** Remove and lock ask for a reason first; cancelling the prompt does nothing. */
  const moderateWithReason = (action: 'remove' | 'lock', question: string) => {
    const reason = window.prompt(question);
    if (reason !== null) moderate(action, reason);
  };

  // Held and declined comments were never published: no score, no replies.
  const unpublished = c.state === 'held' || c.state === 'declined';
  const ownNote = c.mine ? (c.state === 'held' ? labels.awaitingNote : c.state === 'declined' ? labels.declinedNote : null) : null;

  return (
    <li className={isReply ? 'ms-8' : ''}>
      <div className={`rounded border p-3 ${unpublished ? 'border-dashed border-black/30' : 'border-black/10'}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--color-muted)]">
          <span className="font-medium text-[color:var(--color-fg,black)]">
            {c.mine ? labels.you : c.author}
          </span>
          {c.staff ? (
            <Chip tone="staff" title={labels.staffTitle}>
              {labels.staff}
            </Chip>
          ) : null}
          <time dateTime={c.createdAt.toISOString()}>{c.createdAt.toISOString().slice(0, 10)}</time>
          {c.locked ? <Chip>{labels.locked}</Chip> : null}
          {c.state === 'held' ? <Chip tone="pending">{labels.awaitingApproval}</Chip> : null}
          {c.state === 'declined' ? <Chip>{labels.declined}</Chip> : null}
          {c.state === 'removed' ? <Chip>{labels.removed}</Chip> : null}
        </div>
        {c.body === null ? (
          <p className="mt-2 text-sm">
            <em className="text-[color:var(--color-muted)]">{labels.removedBody}</em>
          </p>
        ) : (
          // Comments are residents' own words in whatever language they wrote;
          // dir="auto" lets an Arabic comment read right-to-left on an English page.
          // A removed comment's text reaches moderators only, dimmed so it is
          // not mistaken for something the public can read.
          <p
            dir="auto"
            className={`mt-2 whitespace-pre-wrap text-sm ${c.state === 'removed' ? 'text-[color:var(--color-muted)]' : ''}`}
          >
            {c.body}
          </p>
        )}
        {ownNote ? <p className="mt-2 text-xs text-[color:var(--color-muted)]">{ownNote}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          {unpublished ? null : (
            <>
              <button
                className={`rounded px-1.5 py-0.5 ${c.myVote === 1 ? 'bg-black text-white' : 'border hover:bg-black/5'}`}
                disabled={!canPost || pending || c.state !== 'visible'}
                onClick={() => vote(1)}
                aria-label={labels.upvote}
                aria-pressed={c.myVote === 1}
              >
                <span aria-hidden>▲</span>
              </button>
              {/* The score's wording is real (visually hidden) text, not an aria-label: a name
                  on a plain span is prohibited in ARIA 1.2, and screen readers read only the
                  bare number between the two vote buttons. */}
              <span className="font-medium">
                <span aria-hidden>{c.score}</span>
                <span className="sr-only">{fmt(labels.score, { n: c.score })}</span>
              </span>
              <button
                className={`rounded px-1.5 py-0.5 ${c.myVote === -1 ? 'bg-black text-white' : 'border hover:bg-black/5'}`}
                disabled={!canPost || pending || c.state !== 'visible'}
                onClick={() => vote(-1)}
                aria-label={labels.downvote}
                aria-pressed={c.myVote === -1}
              >
                <span aria-hidden>▼</span>
              </button>
            </>
          )}
          {!isReply && canPost && !c.locked && !unpublished ? (
            <button className="underline" aria-expanded={replyOpen} onClick={() => setReplyOpen((o) => !o)}>
              {labels.reply}
            </button>
          ) : null}
          {isModerator ? (
            <span className="ms-auto flex gap-4">
              {c.state === 'held' || c.state === 'declined' ? (
                <button className={MODERATE_BUTTON} disabled={pending} onClick={() => moderate('approve')}>
                  {labels.approve}
                </button>
              ) : null}
              {c.state === 'held' ? (
                <button className={MODERATE_BUTTON} disabled={pending} onClick={() => moderate('decline')}>
                  {labels.decline}
                </button>
              ) : null}
              {c.state === 'removed' ? (
                <button className={MODERATE_BUTTON} disabled={pending} onClick={() => moderate('restore')}>
                  {labels.restore}
                </button>
              ) : null}
              {c.state === 'visible' ? (
                <button
                  className={MODERATE_BUTTON}
                  disabled={pending}
                  onClick={() => moderateWithReason('remove', labels.removeReason)}
                >
                  {labels.remove}
                </button>
              ) : null}
              {!isReply && !c.locked && !unpublished ? (
                <button
                  className={MODERATE_BUTTON}
                  disabled={pending}
                  onClick={() => moderateWithReason('lock', labels.lockReason)}
                >
                  {labels.lock}
                </button>
              ) : null}
            </span>
          ) : null}
        </div>

        {replyOpen ? (
          <div className="mt-3">
            <textarea
              className="w-full rounded border border-field-border px-2 py-1 text-sm"
              rows={2}
              aria-label={labels.replyLabel}
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
            />
            <button
              className="mt-1 rounded bg-black px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              disabled={pending || !replyBody.trim()}
              onClick={() =>
                act(async () => {
                  unwrap(
                    await postComment({
                      tenantSlug,
                      dimensionId,
                      parentId: c.id,
                      body: replyBody,
                    }),
                  );
                  setReplyBody('');
                  setReplyOpen(false);
                })
              }
            >
              {labels.replySubmit}
            </button>
          </div>
        ) : null}
      </div>

      {c.replies.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {c.replies.map((r) => (
            <CommentItem
              key={r.id}
              c={r}
              tenantSlug={tenantSlug}
              dimensionId={dimensionId}
              viewerId={viewerId}
              canPost={canPost}
              isModerator={isModerator}
              act={act}
              pending={pending}
              labels={labels}
              isReply
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
