'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { CommentView } from '@/lib/discussion';
import { moderateComment, postComment, voteComment } from '@/lib/discussion-actions';
import { useAction } from '@/lib/use-action';
import { unwrap } from '@/lib/action-result';
import { fmt, rich } from '@/lib/i18n/format';
import type { Messages } from '@/lib/i18n/messages/en';

/** The thread's words in the reader's language (lib/i18n catalogs). */
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
            className="w-full rounded border border-black/20 px-3 py-2 text-sm"
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

  return (
    <li className={isReply ? 'ms-8' : ''}>
      <div className="rounded border border-black/10 p-3">
        <div className="flex items-center gap-3 text-xs text-[color:var(--color-muted)]">
          <span className="font-medium text-[color:var(--color-fg,black)]">
            {c.mine ? labels.you : c.author}
          </span>
          <span>{c.createdAt.toISOString().slice(0, 10)}</span>
          {c.locked ? <span className="rounded bg-black/10 px-1.5 py-0.5">{labels.locked}</span> : null}
          {c.removed ? <span className="rounded bg-black/10 px-1.5 py-0.5">{labels.removed}</span> : null}
        </div>
        {c.removed ? (
          <p className="mt-2 text-sm">
            <em className="text-[color:var(--color-muted)]">{labels.removedBody}</em>
          </p>
        ) : (
          // Comments are residents' own words in whatever language they wrote;
          // dir="auto" lets an Arabic comment read right-to-left on an English page.
          <p dir="auto" className="mt-2 whitespace-pre-wrap text-sm">
            {c.body}
          </p>
        )}
        <div className="mt-2 flex items-center gap-3 text-xs">
          <button
            className={`rounded px-1.5 py-0.5 ${c.myVote === 1 ? 'bg-black text-white' : 'border hover:bg-black/5'}`}
            disabled={!canPost || pending}
            onClick={() => vote(1)}
            aria-label={labels.upvote}
            aria-pressed={c.myVote === 1}
          >
            <span aria-hidden>▲</span>
          </button>
          <span className="font-medium" aria-label={fmt(labels.score, { n: c.score })}>
            {c.score}
          </span>
          <button
            className={`rounded px-1.5 py-0.5 ${c.myVote === -1 ? 'bg-black text-white' : 'border hover:bg-black/5'}`}
            disabled={!canPost || pending}
            onClick={() => vote(-1)}
            aria-label={labels.downvote}
            aria-pressed={c.myVote === -1}
          >
            <span aria-hidden>▼</span>
          </button>
          {!isReply && canPost && !c.locked ? (
            <button className="underline" aria-expanded={replyOpen} onClick={() => setReplyOpen((o) => !o)}>
              {labels.reply}
            </button>
          ) : null}
          {isModerator ? (
            <span className="ms-auto flex gap-2">
              {c.removed ? (
                <button
                  className="underline"
                  onClick={() =>
                    act(() =>
                      moderateComment({ tenantSlug, commentId: c.id, action: 'restore' }),
                    )
                  }
                >
                  {labels.restore}
                </button>
              ) : (
                <button
                  className="underline"
                  onClick={() => {
                    const reason = window.prompt(labels.removeReason);
                    if (reason !== null) {
                      act(() =>
                        moderateComment({ tenantSlug, commentId: c.id, action: 'remove', reason }),
                      );
                    }
                  }}
                >
                  {labels.remove}
                </button>
              )}
              {!isReply && !c.locked ? (
                <button
                  className="underline"
                  onClick={() => {
                    const reason = window.prompt(labels.lockReason);
                    if (reason !== null) {
                      act(() =>
                        moderateComment({ tenantSlug, commentId: c.id, action: 'lock', reason }),
                      );
                    }
                  }}
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
              className="w-full rounded border border-black/20 px-2 py-1 text-sm"
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
