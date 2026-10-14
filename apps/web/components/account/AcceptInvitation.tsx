'use client';

import { useRouter } from 'next/navigation';
import { acceptInvitationAction } from '@/lib/member-actions';
import { unwrap } from '@/lib/action-result';
import { useAction } from '@/lib/use-action';

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  return (
    <div>
      <button
        className="rounded bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          run(
            async () => {
              const { href } = unwrap(await acceptInvitationAction({ token }));
              router.push(href);
            },
            { refresh: false },
          )
        }
      >
        {pending ? 'Joining…' : 'Accept invitation'}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
