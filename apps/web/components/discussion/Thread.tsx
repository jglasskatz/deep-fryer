'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { CommentView } from '@/lib/discussion';
import { moderateComment, postComment, voteComment } from '@/lib/discussion-actions';
import { useAction } from '@/lib/use-action';
import { unwrap } from '@/lib/action-result';

export function Thread({
  tenantSlug,
  dimensionId,
  comments,
  viewerId,
  canPost,
  isModerator,
  sort,
}: {
  tenantSlug: string;
  dimensionId: string;
  comments: CommentView[];
  viewerId: string | null;
  canPost: boolean;
  isModerator: boolean;
  sort: 'top' | 'new';
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
        <h2 className="text-lg font-semibold">Discussion</h2>
        <div className="flex gap-1 text-xs">
          {(['top', 'new'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`rounded px-2 py-1 ${sort === s ? 'bg-black text-white' : 'border hover:bg-black/5'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {canPost ? (
        <div className="mt-4">
          <textarea
            className="w-full rounded border border-black/20 px-3 py-2 text-sm"
            rows={3}
            placeholder="What should the city do about this? Keep it civil and on topic."
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
                setNotice(
                  res.pendingApproval
                    ? 'Posted — your first comment is awaiting moderator approval.'
                    : null,
                );
              })
            }
          >
            Post
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[color:var(--color-muted)]">
          <a className="underline" href={`/login?next=${encodeURIComponent(`/${tenantSlug}`)}`}>
            Sign in
          </a>{' '}
          to join the discussion.
        </p>
      )}
      {notice ? <p className="mt-2 text-sm text-green-800">{notice}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}

      <ul className="mt-6 space-y-4">
        {comments.length === 0 ? (
          <li className="text-sm text-[color:var(--color-muted)]">No comments yet.</li>
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
  isReply?: boolean;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');

  const vote = (v: 1 | -1) =>
    act(() =>
      voteComment({ tenantSlug, commentId: c.id, vote: c.myVote === v ? 0 : v }),
    );

  return (
    <li className={isReply ? 'ml-8' : ''}>
      <div className="rounded border border-black/10 p-3">
        <div className="flex items-center gap-3 text-xs text-[color:var(--color-muted)]">
          <span className="font-medium text-[color:var(--color-fg,black)]">
            {c.mine ? 'you' : c.author}
          </span>
          <span>{c.createdAt.toISOString().slice(0, 10)}</span>
          {c.locked ? <span className="rounded bg-black/10 px-1.5 py-0.5">locked</span> : null}
          {c.removed ? <span className="rounded bg-black/10 px-1.5 py-0.5">removed</span> : null}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm">
          {c.removed ? <em className="text-[color:var(--color-muted)]">[removed by moderators]</em> : c.body}
        </p>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <button
            className={`rounded px-1.5 py-0.5 ${c.myVote === 1 ? 'bg-black text-white' : 'border hover:bg-black/5'}`}
            disabled={!canPost || pending}
            onClick={() => vote(1)}
          >
            ▲
          </button>
          <span className="font-medium">{c.score}</span>
          <button
            className={`rounded px-1.5 py-0.5 ${c.myVote === -1 ? 'bg-black text-white' : 'border hover:bg-black/5'}`}
            disabled={!canPost || pending}
            onClick={() => vote(-1)}
          >
            ▼
          </button>
          {!isReply && canPost && !c.locked ? (
            <button className="underline" onClick={() => setReplyOpen((o) => !o)}>
              reply
            </button>
          ) : null}
          {isModerator ? (
            <span className="ml-auto flex gap-2">
              {c.removed ? (
                <button
                  className="underline"
                  onClick={() =>
                    act(() =>
                      moderateComment({ tenantSlug, commentId: c.id, action: 'restore' }),
                    )
                  }
                >
                  restore
                </button>
              ) : (
                <button
                  className="underline"
                  onClick={() => {
                    const reason = window.prompt('Reason for removal (logged publicly to staff):');
                    if (reason !== null) {
                      act(() =>
                        moderateComment({ tenantSlug, commentId: c.id, action: 'remove', reason }),
                      );
                    }
                  }}
                >
                  remove
                </button>
              )}
              {!isReply && !c.locked ? (
                <button
                  className="underline"
                  onClick={() => {
                    const reason = window.prompt('Reason for locking this thread:');
                    if (reason !== null) {
                      act(() =>
                        moderateComment({ tenantSlug, commentId: c.id, action: 'lock', reason }),
                      );
                    }
                  }}
                >
                  lock
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
              Reply
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
              isReply
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
