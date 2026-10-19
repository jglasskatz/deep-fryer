'use client';

import { useState } from 'react';
import { updateLanguageHelp } from '@/lib/org-actions';
import { useAction } from '@/lib/use-action';

/** Owner setting: where residents get help in their language (shown on translated pages). */
export function LanguageHelpForm({ orgSlug, initial }: { orgSlug: string; initial: string | null }) {
  const { run, pending, error } = useAction();
  const [value, setValue] = useState(initial ?? '');
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="rounded-lg border border-black/10 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(async () => {
          const r = await updateLanguageHelp({ orgSlug, languageHelp: value });
          if (r.ok) setSaved(true);
          return r;
        });
      }}
    >
      <label htmlFor="language-help" className="text-lg font-semibold">
        Language access contact
      </label>
      <p className="mt-1 text-sm text-[color:var(--color-muted)]">
        Shown on every translated page of your portraits: &ldquo;For free help in your language,
        contact: …&rdquo; — in the reader&apos;s language. A phone number, short code, email, or web
        address (NYC: 311). Leave empty to show only the translation notice.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          id="language-help"
          className="min-w-0 flex-1 rounded border border-field-border bg-white px-3 py-1.5 text-sm"
          maxLength={120}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="311"
        />
        <button
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={pending}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      {saved ? <p className="mt-1 text-xs">Saved.</p> : null}
    </form>
  );
}
