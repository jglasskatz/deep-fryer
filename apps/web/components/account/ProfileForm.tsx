'use client';

import { useState } from 'react';
import { updateProfile } from '@/lib/account-actions';
import { useAction } from '@/lib/use-action';

export function ProfileForm({
  displayName,
  name,
}: {
  displayName: string | null;
  name: string | null;
}) {
  const { run, pending, error } = useAction();
  const [dn, setDn] = useState(displayName ?? '');
  const [nm, setNm] = useState(name ?? '');
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(async () => {
          const r = await updateProfile({ displayName: dn, name: nm });
          if (r.ok) setSaved(true);
          return r;
        });
      }}
    >
      <label className="block text-sm">
        <span className="font-medium">Display name</span>
        <span className="block text-xs text-[color:var(--color-muted)]">
          Shown on public discussion boards. Without one you appear under a per-portrait
          pseudonym.
        </span>
        <input
          className="mt-1 w-full rounded border border-black/20 bg-white px-2 py-1.5"
          value={dn}
          maxLength={40}
          onChange={(e) => setDn(e.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Full name</span>
        <span className="block text-xs text-[color:var(--color-muted)]">
          Visible only to teammates on portraits you work on.
        </span>
        <input
          className="mt-1 w-full rounded border border-black/20 bg-white px-2 py-1.5"
          value={nm}
          maxLength={120}
          onChange={(e) => setNm(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={pending}
        >
          {pending ? 'Saving…' : 'Save profile'}
        </button>
        {saved ? <span className="text-sm text-green-800">Saved.</span> : null}
        {error ? (
          <span role="alert" className="text-sm text-red-700">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
