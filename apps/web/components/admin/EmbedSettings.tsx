'use client';

import { useState } from 'react';
import { updateEmbedOrigins } from '@/lib/actions';
import { useAction } from '@/lib/use-action';

/** Embed allowlist editor plus the copy-paste snippet for the city's web team. */
export function EmbedSettings({
  tenantSlug,
  origins,
  appUrl,
}: {
  tenantSlug: string;
  origins: string[];
  appUrl: string;
}) {
  const { run, pending, error } = useAction();
  const [text, setText] = useState(origins.join('\n'));
  const [saved, setSaved] = useState(false);
  const snippet = `<div data-deep-fryer="${tenantSlug}"></div>\n<script async src="${appUrl}/embed.js"></script>`;
  return (
    <section id="embedding" className="rounded border border-black/15 p-4">
      <h2 className="text-base font-semibold">Embedding</h2>
      <p className="mt-1 text-xs text-[color:var(--color-muted)]">
        Sites allowed to show this doughnut in an iframe — one origin per line (e.g.
        https://www.cityofexample.gov). Browsers refuse the embed anywhere else.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          run(async () => {
            const r = await updateEmbedOrigins({ tenantSlug, origins: text.split('\n') });
            if (r.ok) setSaved(true);
            return r;
          });
        }}
      >
        <textarea
          aria-label="Allowed embedding origins"
          className="mt-3 w-full rounded border border-black/20 bg-white px-2 py-1 font-mono text-xs"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://www.cityofexample.gov"
        />
        {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
        {saved ? <p className="mt-1 text-xs">Saved.</p> : null}
        <button
          className="mt-2 rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={pending}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </form>
      <p className="mt-4 text-xs font-medium">Snippet for your website</p>
      <textarea
        readOnly
        aria-label="Embed snippet"
        className="mt-1 w-full rounded border border-black/15 bg-black/[0.03] px-2 py-1 font-mono text-xs"
        rows={2}
        value={snippet}
        onFocus={(e) => e.currentTarget.select()}
      />
    </section>
  );
}
