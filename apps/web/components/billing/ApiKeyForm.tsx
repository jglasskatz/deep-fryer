'use client';

import { useState } from 'react';
import { PROVIDER_META, RESEARCH_PROVIDERS, type ResearchProvider } from '@deep-fryer/core';
import { removeApiKey, saveApiKey } from '@/lib/api-key-actions';
import { useAction } from '@/lib/use-action';

const field = 'mt-1 w-full rounded border border-field-border bg-white px-2 py-1.5 font-mono text-sm';
const selectField = 'mt-1 w-full rounded border border-field-border bg-white px-2 py-1.5 text-sm sm:w-auto';

export interface ProviderKeyGuide {
  consoleUrl: string;
  keyPageLabel: string;
  billingNote: string;
  estimatedBuildCost: string;
}

export const PROVIDER_KEY_GUIDES: Readonly<Record<ResearchProvider, ProviderKeyGuide>> = {
  anthropic: {
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    keyPageLabel: 'Anthropic Console → API Keys',
    billingNote: 'Add $15–$25 in API credits under Plans & Billing and set a monthly spending cap.',
    estimatedBuildCost: '~$8–$20 for a full first portrait (Sonnet / hybrid)',
  },
  openai: {
    consoleUrl: 'https://platform.openai.com/api-keys',
    keyPageLabel: 'OpenAI Platform → API Keys',
    billingNote: 'Add $15–$25 in prepaid credit under Settings → Billing and set a monthly budget limit.',
    estimatedBuildCost: '~$6–$18 for a full first portrait (GPT-5 / mini)',
  },
  google: {
    consoleUrl: 'https://aistudio.google.com/apikey',
    keyPageLabel: 'Google AI Studio → API Keys',
    billingNote: 'Link a Google Cloud billing account with a budget alert so rate limits don’t pause your build.',
    estimatedBuildCost: '~$4–$15 for a full first portrait (Gemini 2.5 Pro / Flash)',
  },
};

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
  const selectedGuide = PROVIDER_KEY_GUIDES[provider];
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
            encrypted, and never shown again — only its last four characters.
          </p>
          <details className="rounded border border-black/10 bg-black/[0.02] px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-[color:var(--color-ink)]">
              How to get a key from {selectedMeta.displayName} (3 steps)
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[color:var(--color-muted)]">
              <li>
                Open{' '}
                <a
                  href={selectedGuide.consoleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[color:var(--color-ink)] underline underline-offset-2"
                >
                  {selectedGuide.keyPageLabel} ↗
                </a>{' '}
                and sign in.
              </li>
              <li>
                {selectedGuide.billingNote}{' '}
                <span className="text-[color:var(--color-ink)]">Typical cost: {selectedGuide.estimatedBuildCost}.</span>
              </li>
              <li>
                Click <strong>Create key</strong>, copy the value (starts with{' '}
                <code className="rounded bg-black/5 px-1 py-0.5 font-mono">{selectedMeta.keyPlaceholder}</code>), and
                paste it above.
              </li>
            </ol>
          </details>
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
