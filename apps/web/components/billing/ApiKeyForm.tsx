'use client';

import { useState } from 'react';
import { removeApiKey, saveApiKey } from '@/lib/api-key-actions';
import { useAction } from '@/lib/use-action';

const field = 'mt-1 w-full rounded border border-black/20 bg-white px-2 py-1.5 font-mono text-sm';

/**
 * Add, replace, or remove the organization's Anthropic API key (SPEC-v7 §4),
 * for organization owners on the billing page.
 *
 * The key travels one way: typed into a password field, posted once to
 * saveApiKey, and forgotten here as soon as it is accepted. Nothing sent
 * back to this component contains it — the page shows only the hint (the
 * last four characters) and dates it already had. Save and remove keep their
 * own pending and error state, so a slow validation never blocks removal.
 */
export function ApiKeyForm({
  orgSlug,
  onFile,
  canSave,
}: {
  orgSlug: string;
  /** The key on file, as the page may show it; null when there is none. */
  onFile: { keyHint: string; createdAt: string; validatedAt: string | null } | null;
  /** False when the server cannot store keys (no DF_SECRETS_KEY); removal still works. */
  canSave: boolean;
}) {
  const save = useAction();
  const remove = useAction();
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {onFile ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-black/10 bg-black/[0.03] p-3 text-sm">
          <p>
            Key on file: <span className="font-mono">sk-ant-…{onFile.keyHint}</span>
            <span className="text-[color:var(--color-muted)]">
              {' '}
              · added {onFile.createdAt.slice(0, 10)}
              {onFile.validatedAt ? ` · accepted by Anthropic ${onFile.validatedAt.slice(0, 10)}` : ''}
            </span>
          </p>
          <span className="inline-flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={remove.pending}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-800 hover:bg-red-50 disabled:opacity-50"
              onClick={() => {
                if (
                  !window.confirm(
                    'Remove this API key? Research started from now on runs on your plan and counts against its session allowance.',
                  )
                ) {
                  return;
                }
                setSaved(null);
                remove.run(() => removeApiKey(orgSlug));
              }}
            >
              {remove.pending ? 'Removing…' : 'Remove key'}
            </button>
            {remove.error ? (
              <span role="alert" className="text-xs text-red-700">
                {remove.error}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      {canSave ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(null);
            const submitted = key;
            save.run(async () => {
              const result = await saveApiKey(orgSlug, submitted);
              if (result.ok) {
                setKey('');
                setSaved(result.data.keyHint);
              }
              return result;
            });
          }}
        >
          <label className="block text-sm">
            <span className="font-medium">{onFile ? 'Replace with another key' : 'Anthropic API key'}</span>
            <input
              className={field}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              required
              aria-describedby="api-key-help"
            />
          </label>
          <p id="api-key-help" className="text-xs text-[color:var(--color-muted)]">
            Checked with one call to Anthropic&apos;s Models API (no tokens are used), stored encrypted, and never
            shown again — only its last four characters. Create a key in the Anthropic Console under API keys.
          </p>
          <button
            className="rounded bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={save.pending || key.trim() === ''}
          >
            {save.pending ? 'Checking with Anthropic…' : onFile ? 'Replace key' : 'Save key'}
          </button>
          {save.error ? (
            <p role="alert" className="text-sm text-red-700">
              {save.error}
            </p>
          ) : saved ? (
            <p role="status" className="text-sm text-green-800">
              Saved. Research for this organization now runs on the key ending {saved}.
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
