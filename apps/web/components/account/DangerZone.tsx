'use client';

import { useState } from 'react';
import { deleteAccount, signOutEverywhere } from '@/lib/account-actions';
import { useAction } from '@/lib/use-action';

export function DangerZone({ email }: { email: string | null }) {
  const everywhere = useAction();
  const del = useAction();
  const [confirm, setConfirm] = useState('');
  return (
    <div className="space-y-6">
      <div>
        <button
          className="rounded border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50"
          disabled={everywhere.pending}
          onClick={() => everywhere.run(() => signOutEverywhere())}
        >
          Sign out of all devices
        </button>
        {everywhere.error ? <p className="mt-1 text-sm text-red-700">{everywhere.error}</p> : null}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          del.run(() => deleteAccount({ confirm }));
        }}
        className="rounded border border-red-700/30 p-4"
      >
        <p className="text-sm font-medium text-red-900">Delete my account</p>
        <p className="mt-1 text-xs text-[color:var(--color-muted)]">
          Removes your email, name, sign-in methods, and every role you hold. Comments you posted
          stay on the public record as &ldquo;Deleted account&rdquo;. Type{' '}
          <strong>{email}</strong> to confirm.
        </p>
        <input
          className="mt-2 w-full rounded border border-field-border bg-white px-2 py-1.5 text-sm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-label="Type your email to confirm"
        />
        <button
          className="mt-2 rounded bg-red-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={del.pending || !confirm}
        >
          Delete account
        </button>
        {del.error ? (
          <p role="alert" className="mt-1 text-sm text-red-700">
            {del.error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
