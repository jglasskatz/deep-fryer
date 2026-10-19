import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { CommentView } from '@/lib/discussion';
import { en } from '@/lib/i18n/messages/en';
import { Thread } from './Thread';

/**
 * The thread as a moderator's phone renders it on the server: the buttons
 * that decide a held comment are touch targets, not 16 px text links 8 px
 * apart. Rendered with the App Router's contexts provided, as Next provides
 * them (as in components/portrait/PortraitCoreView.test.ts).
 */

// Vitest compiles the component's JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const held: CommentView = {
  id: 'c1',
  parentId: null,
  author: 'resident-1a2b3c',
  staff: false,
  mine: false,
  state: 'held',
  body: 'Please add protected bike lanes on 4th Avenue.',
  createdAt: new Date('2026-10-01T12:00:00Z'),
  editedAt: null,
  locked: false,
  score: 0,
  myVote: 0,
  replies: [],
};

function render(comments: CommentView[], isModerator: boolean): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams() },
        createElement(Thread, {
          tenantSlug: 'nyc',
          dimensionId: 'd1',
          comments,
          viewerId: 'm1',
          canPost: true,
          isModerator,
          sort: 'new',
          labels: { ...en.discussion, signIn: 'Sign in' },
          signInHref: '/login',
        }),
      ),
    ),
  );
}

describe('Thread moderation controls', () => {
  it('makes approve and decline 44 px targets with room between them', () => {
    const html = render([held], true);
    const group = html.match(/<span class="ms-auto flex gap-4">(.*?)<\/span>/)?.[1] ?? '';
    const buttons = [...group.matchAll(/<button class="([^"]*)"[^>]*>([^<]*)<\/button>/g)].map((b) => [b[2], b[1]]);
    expect(buttons).toEqual([
      [en.discussion.approve, 'inline-flex min-h-11 items-center underline'],
      [en.discussion.decline, 'inline-flex min-h-11 items-center underline'],
    ]);
  });

  it('shows residents no moderation controls at all', () => {
    expect(render([{ ...held, state: 'visible' }], false)).not.toContain('ms-auto flex');
  });
});

describe('Thread vote row', () => {
  it('says the score in text a screen reader reads, not in an aria-label on a plain span', () => {
    const html = render([{ ...held, state: 'visible', score: 7 }], false);
    expect(html).toContain('<span aria-hidden="true">7</span><span class="sr-only">Score 7</span>');
    expect(html).not.toMatch(/<span[^>]*aria-label="Score/);
  });
});
