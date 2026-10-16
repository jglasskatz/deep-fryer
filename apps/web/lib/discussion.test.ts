import { describe, expect, it } from 'vitest';
import {
  assembleThread,
  commentDisclosure,
  commentState,
  MODERATION_REASONS,
  MODERATION_VERBS,
  planModeration,
  pseudonym,
  SYSTEM_ACTOR_ID,
  type CommentState,
  type ModerationEvent,
  type ThreadInput,
} from './discussion';

/**
 * The moderation rules of SPEC-v6 §3.1 as pure functions: how a comment's
 * state is read from its row and history, who sees what of each state, which
 * moderator actions each state allows, and how a thread is assembled for one
 * viewer. The same rules run against Postgres in
 * discussion-actions.rls.test.ts.
 */

const MOD = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const TENANT = '44444444-4444-4444-8444-444444444444';

const at = new Date('2026-10-01T12:00:00Z');
const hold: ModerationEvent = { actorId: SYSTEM_ACTOR_ID, action: 'remove' };
const modRemove: ModerationEvent = { actorId: MOD, action: 'remove' };
const restore: ModerationEvent = { actorId: MOD, action: 'restore' };
const lock: ModerationEvent = { actorId: MOD, action: 'lock' };

const visibleRow = { removedAt: null, removedBy: null };
const heldRow = { removedAt: at, removedBy: SYSTEM_ACTOR_ID };
const modRow = { removedAt: at, removedBy: MOD };

describe('commentState', () => {
  it('reads visible and held straight off the row', () => {
    expect(commentState(visibleRow, [])).toBe('visible');
    // History does not matter once the row says it is public (e.g. approved).
    expect(commentState(visibleRow, [hold, restore])).toBe('visible');
    expect(commentState(heldRow, [hold])).toBe('held');
    // A v5 row with no log entry is still held: the row alone decides.
    expect(commentState(heldRow, [])).toBe('held');
  });

  it('tells a declined comment (never public) from a removed one (was public) by replaying the history', () => {
    expect(commentState(modRow, [hold, modRemove])).toBe('declined');
    expect(commentState(modRow, [modRemove])).toBe('removed');
    // Held, approved, later removed: it was public, so the placeholder stays.
    expect(commentState(modRow, [hold, restore, modRemove])).toBe('removed');
    // Declined, approved after all, then removed.
    expect(commentState(modRow, [hold, modRemove, restore, modRemove])).toBe('removed');
    // Removed, restored, removed again.
    expect(commentState(modRow, [modRemove, restore, modRemove])).toBe('removed');
  });

  it('ignores locks and depends on actors and actions only', () => {
    expect(commentState(modRow, [lock, hold, lock, modRemove])).toBe('declined');
    expect(commentState(modRow, [lock, modRemove, lock])).toBe('removed');
  });

  it('falls back safely when the history does not account for the row', () => {
    // Removed outside the app with nothing logged: treat as an ordinary removal.
    expect(commentState(modRow, [])).toBe('removed');
    // Held, then marked removed by a person with no decline logged: never approved, never public.
    expect(commentState(modRow, [hold])).toBe('declined');
    // removed_at without removed_by.
    expect(commentState({ removedAt: at, removedBy: null }, [])).toBe('removed');
  });
});

describe('commentDisclosure', () => {
  const nobody = { isAuthor: false, isModerator: false };
  const author = { isAuthor: true, isModerator: false };
  const moderator = { isAuthor: false, isModerator: true };

  it('shows held and declined comments to their author and moderators only, with nothing for anyone else', () => {
    for (const state of ['held', 'declined'] as const) {
      expect(commentDisclosure(state, nobody)).toBe('omit');
      expect(commentDisclosure(state, author)).toBe('text');
      expect(commentDisclosure(state, moderator)).toBe('text');
    }
  });

  it('keeps the placeholder for a removed comment, except for moderators', () => {
    expect(commentDisclosure('removed', nobody)).toBe('placeholder');
    expect(commentDisclosure('removed', author)).toBe('placeholder');
    expect(commentDisclosure('removed', moderator)).toBe('text');
  });

  it('shows visible comments to everyone', () => {
    for (const viewer of [nobody, author, moderator]) expect(commentDisclosure('visible', viewer)).toBe('text');
  });
});

describe('planModeration', () => {
  const states: CommentState[] = ['visible', 'held', 'declined', 'removed'];
  const allowed: Record<string, CommentState> = {
    'approve:held': 'visible',
    'approve:declined': 'visible',
    'decline:held': 'declined',
    'remove:visible': 'removed',
    'restore:removed': 'visible',
    'lock:visible': 'visible',
    'lock:removed': 'removed',
  };

  it('allows exactly the transitions in the table and refuses the rest with a message', () => {
    for (const verb of MODERATION_VERBS) {
      for (const state of states) {
        const plan = planModeration(state, verb, { isReply: false });
        const expected = allowed[`${verb}:${state}`];
        if (expected) {
          expect(plan, `${verb} on ${state}`).toMatchObject({ ok: true, next: expected });
        } else {
          expect(plan.ok, `${verb} on ${state}`).toBe(false);
          expect((plan as { error: string }).error.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('logs approve as a restore and decline as a remove, with their own reasons', () => {
    expect(planModeration('held', 'approve', { isReply: false })).toEqual({
      ok: true,
      next: 'visible',
      update: 'clear',
      log: 'restore',
      reason: MODERATION_REASONS.approve,
    });
    expect(planModeration('held', 'decline', { isReply: false, reason: '  off topic ' })).toEqual({
      ok: true,
      next: 'declined',
      update: 'remove',
      log: 'remove',
      reason: `${MODERATION_REASONS.decline}: off topic`,
    });
  });

  it('records the moderator’s own reason for remove, restore, and lock, and leaves the row alone on lock', () => {
    expect(planModeration('visible', 'remove', { isReply: true, reason: 'abuse' })).toMatchObject({
      update: 'remove',
      log: 'remove',
      reason: 'abuse',
    });
    expect(planModeration('removed', 'restore', { isReply: false, reason: '' })).toMatchObject({
      update: 'clear',
      log: 'restore',
      reason: null,
    });
    expect(planModeration('visible', 'lock', { isReply: false, reason: 'x'.repeat(900) })).toMatchObject({
      update: null,
      log: 'lock',
      reason: 'x'.repeat(500),
    });
  });

  it('points a moderator to the right action instead', () => {
    expect(planModeration('held', 'restore', { isReply: false })).toEqual({
      ok: false,
      error: 'This comment is awaiting approval — approve or decline it.',
    });
    expect(planModeration('declined', 'restore', { isReply: false })).toEqual({
      ok: false,
      error: 'This comment was declined — approve it to publish it.',
    });
    expect(planModeration('visible', 'lock', { isReply: true })).toMatchObject({ ok: false });
  });
});

describe('assembleThread', () => {
  // One of each state, plus a reply under the held comment and one under the visible one.
  const rows: ThreadInput['rows'] = [
    { id: 'visible', parentId: null, authorId: OTHER, body: 'public words', createdAt: new Date('2026-10-01'), editedAt: null, ...visibleRow },
    { id: 'held', parentId: null, authorId: AUTHOR, body: 'my first comment', createdAt: new Date('2026-10-02'), editedAt: null, ...heldRow },
    { id: 'declined', parentId: null, authorId: AUTHOR, body: 'declined words', createdAt: new Date('2026-10-03'), editedAt: null, ...modRow },
    { id: 'removed', parentId: null, authorId: OTHER, body: 'removed words', createdAt: new Date('2026-10-04'), editedAt: null, ...modRow },
    { id: 'reply-held', parentId: 'held', authorId: MOD, body: 'reply under held', createdAt: new Date('2026-10-05'), editedAt: null, ...visibleRow },
    { id: 'reply-late', parentId: 'visible', authorId: MOD, body: 'second reply', createdAt: new Date('2026-10-07'), editedAt: null, ...visibleRow },
    { id: 'reply-early', parentId: 'visible', authorId: AUTHOR, body: 'first reply', createdAt: new Date('2026-10-06'), editedAt: null, ...visibleRow },
  ];
  const states = new Map<string, CommentState>([
    ['declined', 'declined'],
    ['removed', 'removed'],
  ]);
  const base: Omit<ThreadInput, 'viewerId' | 'isModerator'> = {
    tenantId: TENANT,
    rows,
    states,
    names: new Map([[MOD, 'City moderator']]),
    staffIds: new Set([MOD]),
    scores: new Map([['visible', 3], ['removed', 5]]),
    myVotes: new Map(),
    locked: new Map([['visible', true]]),
    sort: 'top',
  };
  const ids = (thread: ReturnType<typeof assembleThread>) => thread.map((c) => c.id);

  it('gives the public visible comments and the removal placeholder — nothing held or declined, nor replies under them', () => {
    const thread = assembleThread({ ...base, viewerId: null, isModerator: false });
    expect(ids(thread)).toEqual(['removed', 'visible']);
    const [removed, visible] = thread;
    expect(removed).toMatchObject({ state: 'removed', body: null, mine: false });
    expect(visible).toMatchObject({ state: 'visible', body: 'public words', score: 3, locked: true });
    expect(visible!.replies.map((r) => r.id)).toEqual(['reply-early', 'reply-late']);
    // A display name where there is one, else the portrait's pseudonym; staff labelled.
    expect(visible!.replies[1]).toMatchObject({ author: 'City moderator', staff: true });
    expect(visible!.replies[0]).toMatchObject({ author: pseudonym(TENANT, AUTHOR), staff: false });
  });

  it('shows the author their own held and declined comments, with text', () => {
    const thread = assembleThread({ ...base, viewerId: AUTHOR, isModerator: false });
    expect(ids(thread)).toEqual(['removed', 'visible', 'held', 'declined']);
    expect(thread.find((c) => c.id === 'held')).toMatchObject({ state: 'held', body: 'my first comment', mine: true });
    expect(thread.find((c) => c.id === 'declined')).toMatchObject({ state: 'declined', body: 'declined words', mine: true });
    expect(thread.find((c) => c.id === 'removed')).toMatchObject({ body: null });
    expect(thread.find((c) => c.id === 'held')!.replies.map((r) => r.id)).toEqual(['reply-held']);
  });

  it('shows moderators every comment with its text', () => {
    const thread = assembleThread({ ...base, viewerId: MOD, isModerator: true, sort: 'new' });
    expect(ids(thread)).toEqual(['removed', 'declined', 'held', 'visible']);
    expect(thread.map((c) => c.body)).toEqual(['removed words', 'declined words', 'my first comment', 'public words']);
    expect(thread.map((c) => c.state)).toEqual(['removed', 'declined', 'held', 'visible']);
  });

  it('derives a state from the row when none was loaded', () => {
    const thread = assembleThread({ ...base, states: new Map(), viewerId: null, isModerator: false });
    // Without its history the declined row reads as removed — the conservative public answer.
    expect(ids(thread)).toEqual(['removed', 'visible', 'declined']);
    expect(thread.find((c) => c.id === 'declined')).toMatchObject({ state: 'removed', body: null });
  });
});
