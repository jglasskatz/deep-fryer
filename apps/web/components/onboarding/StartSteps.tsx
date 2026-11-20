import type { ReactNode } from 'react';
import Link from 'next/link';
import type { SeatsInEffect } from '@/lib/invitations';
import { routeHref, type DoughnutRoute } from './routes';

/**
 * The four steps /start walks a group through, in this order. The page and
 * its tests read the titles from here, so a heading cannot drift from what
 * the tests check.
 */
export const START_STEPS = [
  'Name the place',
  'What do you already have?',
  'We make your doughnut',
  'Look it over together',
] as const;

/** Where a step stands for this group: finished, the one to do now, or still to come. */
export type StepState = 'done' | 'current' | 'upcoming';

/**
 * One step of /start: "Step 2 of 4", its heading and what to do. A list item
 * of the page's ordered list, so a screen reader announces "2 of 4" too; the
 * step to do now carries aria-current="step", a finished one says "Done" in
 * words, not only with a mark.
 */
export function StartStep({
  index,
  state,
  children,
}: {
  /** Position in START_STEPS, from 0. */
  index: number;
  state: StepState;
  children: ReactNode;
}) {
  const n = index + 1;
  const id = `step-${n}`;
  const frame =
    state === 'current'
      ? 'border-[color:var(--color-accent)] border-2'
      : state === 'done'
        ? 'border-black/10 bg-black/[0.02]'
        : 'border-black/15';
  return (
    <li aria-current={state === 'current' ? 'step' : undefined} className={`min-w-0 rounded-lg border p-4 sm:p-5 ${frame}`}>
      <section aria-labelledby={id}>
        <p className="text-sm text-[color:var(--color-muted)]">
          Step {n} of {START_STEPS.length}
          {state === 'done' ? (
            <>
              {' · '}
              <span className="font-medium text-green-800">
                <span aria-hidden>✓ </span>Done
              </span>
            </>
          ) : null}
        </p>
        <h2 id={id} className="mt-1 text-xl font-semibold">
          {START_STEPS[index]}
        </h2>
        <div className="mt-2 break-words">{children}</div>
      </section>
    </li>
  );
}

/**
 * Step two: the ways in a group can use, from the one list in routes.ts.
 * Before the place is named (`tenantSlug` null) they are described but not
 * linked, since each opens a page of the portrait.
 */
export function WhatYouHave({ routes, tenantSlug }: { routes: readonly DoughnutRoute[]; tenantSlug: string | null }) {
  if (routes.length === 0) {
    return (
      <p className="text-sm">
        You don&apos;t need anything to start. The next step says how the numbers for your doughnut are found.
      </p>
    );
  }
  return (
    <>
      <p className="text-sm text-[color:var(--color-muted)]">
        Start with whatever your group has, in any mix. Nothing you add is public until your group publishes it.
      </p>
      <ul className="mt-3 grid gap-3">
        {routes.map((route) => (
          <li key={route.id} className="rounded border border-black/10 p-3">
            <h3 className="font-medium">
              {tenantSlug ? (
                <Link className="underline" href={routeHref(route, tenantSlug)}>
                  {route.title}
                </Link>
              ) : (
                route.title
              )}
            </h3>
            <p className="mt-1 text-sm text-[color:var(--color-muted)]">{route.description}</p>
          </li>
        ))}
      </ul>
      {tenantSlug ? null : (
        <p className="mt-3 text-sm text-[color:var(--color-muted)]">You can choose once the place is named.</p>
      )}
    </>
  );
}

/**
 * Step three when research cannot run for this group yet: the doughnut can
 * still start from what the group has, so every way in that needs no
 * research is linked here rather than leaving a disabled button as the end.
 */
export function WithoutResearch({ routes, tenantSlug }: { routes: readonly DoughnutRoute[]; tenantSlug: string }) {
  return (
    <div className="mt-4 rounded border border-black/15 bg-black/[0.03] p-3 text-sm">
      <p>
        <strong>You don&apos;t have to wait for research.</strong>{' '}
        {routes.length > 0
          ? 'Your doughnut can start from what your group already has:'
          : 'Meanwhile you can invite your group and look the portrait over together, in the next step.'}
      </p>
      {routes.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 ps-5">
          {routes.map((route) => (
            <li key={route.id}>
              <Link className="underline" href={routeHref(route, tenantSlug)}>
                {route.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
const morePeople = (n: number) => `${n} more ${n === 1 ? 'person' : 'people'}`;

/**
 * Step four: where the group looks the draft over, and how many more people
 * it can invite to do it with them. The seat count is the one the invitation
 * form applies (lib/invitations.ts seatsInEffect); only owners invite, so
 * anyone else is told who can. Before the place is named, `others` is how
 * many people a new group may invite.
 */
export function LookItOver(
  props:
    | { tenantSlug: null; others: number }
    | {
        tenantSlug: string;
        tenantName: string;
        seats: SeatsInEffect;
        canInvite: boolean;
        /** Research has been applied, so the draft doughnut page has something to show. */
        hasDraft: boolean;
      },
) {
  if (props.tenantSlug === null) {
    return (
      <p className="text-sm">
        Invite up to {people(props.others)} to check every number with you. Nothing is public until your group
        publishes it.
      </p>
    );
  }
  const { tenantSlug, tenantName, seats, canInvite, hasDraft } = props;
  const base = `/${encodeURIComponent(tenantSlug)}/admin`;
  const members = (
    <Link className="underline" href={`${base}/members`}>
      Members page
    </Link>
  );
  const pending =
    seats.pending > 0 ? `, counting ${seats.pending} invitation${seats.pending === 1 ? '' : 's'} not yet accepted` : '';
  return (
    <>
      <p className="text-sm">Check every topic together before anything is published.</p>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
        <li>
          <Link className="underline" href={`${base}?welcome=1`}>
            Open the admin page for {tenantName}
          </Link>
          : every topic, what has been filled in so far, and what to do next.
        </li>
        {hasDraft ? (
          <li>
            <Link className="underline" href={`${base}/draft`}>
              See the draft doughnut
            </Link>{' '}
            the research has made so far.
          </li>
        ) : null}
      </ul>
      <p className="mt-3 text-sm">
        {seats.left > 0 ? (
          canInvite ? (
            <>
              You can invite {morePeople(seats.left)}. Send the invitations from the {members}.
            </>
          ) : (
            <>
              {morePeople(seats.left)} can join. An owner of {tenantName} can invite them from the {members}.
            </>
          )
        ) : (
          <>
            All {seats.limit} seats are taken{pending}. To invite someone else,{' '}
            {canInvite ? 'remove someone or cancel an invitation' : 'an owner can remove someone or cancel an invitation'}{' '}
            on the {members}.
          </>
        )}
      </p>
    </>
  );
}
