'use client';

import { useState } from 'react';
import { PROVIDER_META, RESEARCH_PROVIDERS, type ResearchProvider } from '@deep-fryer/core';
import { removeApiKey, saveApiKey } from '@/lib/api-key-actions';
import { useAction } from '@/lib/use-action';

const field = 'mt-1 w-full rounded border border-field-border bg-white px-2 py-1.5 font-mono text-sm';
const selectField = 'mt-1 w-full rounded border border-field-border bg-white px-2 py-1.5 text-sm sm:w-auto';

export interface StoredProviderKeySummary {
  provider: ResearchProvider;
  keyHint: string;
  createdAt: string;
  validatedAt: string | null;
}

/**
 * Add, replace, or remove an organization's own model-provider API keys
 * (Anthropic, OpenAI, Google Gemini) on the billing page.
 *
 * Each key travels one way: typed into a password field, posted once to
 * saveApiKey, and forgotten here as soon as it is accepted. Nothing sent
 * back to this component contains the key — the page shows only the masked
 * hint (last four characters) and dates for each configured provider.
 */
export function ApiKeyForm({
  orgSlug,
  onFile,
  canSave,
}: {
  orgSlug: string;
  /** Configured provider keys on file (hints and dates only). */
  onFile: readonly StoredProviderKeySummary[];
  /** False when the server cannot store keys (no DF_SECRETS_KEY); removal still works. */
  canSave: boolean;
}) {
  const save = useAction();
  const remove = useAction();
  const [provider, setProvider] = useState<ResearchProvider>('anthropic');
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState<{ provider: ResearchProvider; keyHint: string } | null>(null);
  const [removingProvider, setRemovingProvider] = useState<ResearchProvider | null>(null);

  const selectedMeta = PROVIDER_META[provider];
  const existingForSelected = onFile.find((entry) => entry.provider === provider) ?? null;

  return (
    <div className="space-y-4">
      {onFile.length > 0 ? (
        <ul className="space-y-2">
          {onFile.map((entry) => {
            const meta = PROVIDER_META[entry.provider];
            const isRemoving = remove.pending && removingProvider === entry.provider;
            return (
              <li
                key={entry.provider}
                className="flex flex-wrap items-center justify-between gap-3 rounded border border-black/10 bg-black/[0.03] p-3 text-sm"
              >
                <p>
                  <span className="font-medium">{meta.displayName}:</span>{' '}
                  <span className="font-mono">
                    {meta.keyHintPrefix}
                    {entry.keyHint}
                  </span>
                  <span className="text-[color:var(--color-muted)]">
                    {' '}
                    · added {entry.createdAt.slice(0, 10)}
                    {entry.validatedAt ? ` · accepted by ${meta.displayName} ${entry.validatedAt.slice(0, 10)}` : ''}
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
                          `Remove this ${meta.displayName} API key? Research started from now on using ${meta.displayName} will run on your plan (if configured) and count against its session allowance. Queued runs on this key that have not started will not run; they can be started again.`,
                        )
                      ) {
                        return;
                      }
                      setSaved(null);
                      setRemovingProvider(entry.provider);
                      remove.run(async () => {
                        try {
                          return await removeApiKey(orgSlug, entry.provider);
                        } finally {
                          setRemovingProvider(null);
                        }
                      });
                    }}
                  >
                    {isRemoving ? 'Removing…' : 'Remove key'}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {remove.error ? (
        <p role="alert" className="text-xs text-red-700">
          {remove.error}
        </p>
      ) : null}

      {canSave ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(null);
            const submittedKey = key;
            const submittedProvider = provider;
            save.run(async () => {
              const result = await saveApiKey(orgSlug, submittedKey, submittedProvider);
              if (result.ok) {
                setKey('');
                setSaved({ provider: result.data.provider, keyHint: result.data.keyHint });
              }
              return result;
            });
          }}
        >
          <label className="block text-sm">
            <span className="block font-medium">Model provider</span>
            <select
              className={selectField}
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as ResearchProvider);
                setKey('');
                setSaved(null);
              }}
            >
              {RESEARCH_PROVIDERS.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_META[id].displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium">
              {existingForSelected
                ? `Replace ${selectedMeta.displayName} API key`
                : `${selectedMeta.displayName} API key`}
            </span>
            <input
              className={field}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={selectedMeta.keyPlaceholder}
              autoComplete="off"
              spellCheck={false}
              required
              aria-describedby="api-key-help"
            />
          </label>
          <p id="api-key-help" className="text-xs text-[color:var(--color-muted)]">
            Checked with one call to {selectedMeta.displayName}&apos;s Models API (no tokens are used), stored
            encrypted, and never shown again — only its last four characters. Create a key in {selectedMeta.consoleName}.
          </p>
          <button
            className="rounded bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={save.pending || key.trim() === ''}
          >
            {save.pending
              ? `Checking with ${selectedMeta.displayName}…`
              : existingForSelected
                ? 'Replace key'
                : 'Save key'}
          </button>
          {save.error ? (
            <p role="alert" className="text-sm text-red-700">
              {save.error}
            </p>
          ) : saved ? (
            <p role="status" className="text-sm text-green-800">
              Saved. {PROVIDER_META[saved.provider].displayName} research for this organization now runs on the key
              ending {saved.keyHint}.
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
