'use client';

import { useState, useTransition } from 'react';
import { requestTranslation } from '@/lib/translation-request-actions';

export interface RequestTranslationLabels {
  button: string;
  intro: string;
  language: string;
  send: string;
  sending: string;
  /** Contains {language}. */
  sent: string;
  limited: string;
  failed: string;
}

/**
 * "Request a translation" (SPEC-v7 §3.5), in the header where the language
 * menu sits on translated portraits. The page is English, but these labels
 * come in the reader's preferred language when we know it (remembered choice
 * or browser language), and `lang`/`dir` follow them, so a reader who cannot
 * read English can still ask. A <details> disclosure like the language menu,
 * sharing its exclusive-open group.
 */
export function RequestTranslation({
  tenantSlug,
  path,
  labels,
  labelsLang,
  labelsDir,
  languages,
  initial,
}: {
  tenantSlug: string;
  path: string;
  labels: RequestTranslationLabels;
  labelsLang: string;
  labelsDir: 'ltr' | 'rtl';
  /** Requestable languages, each in its own script. */
  languages: { code: string; name: string; dir: 'ltr' | 'rtl' }[];
  /** The reader's preferred language, when it is one of them. */
  initial: string | null;
}) {
  const [code, setCode] = useState(initial ?? languages[0]?.code ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = languages.find((l) => l.code === code);

  return (
    <details name="df-header-menu" className="relative" lang={labelsLang} dir={labelsDir}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-2 py-1.5 hover:bg-black/5">
        <svg aria-hidden width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M2.5 10h15M10 2.5c2.2 2.3 3.2 4.8 3.2 7.5s-1 5.2-3.2 7.5c-2.2-2.3-3.2-4.8-3.2-7.5s1-5.2 3.2-7.5z" />
        </svg>
        <span className="hidden sm:inline">{labels.button}</span>
        <span className="sr-only sm:hidden">{labels.button}</span>
      </summary>
      <div className="absolute end-0 z-50 mt-1 w-72 rounded border border-black/10 bg-white p-3 text-sm shadow-lg">
        <p>{labels.intro}</p>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setMessage(null);
            start(async () => {
              const res = await requestTranslation({ tenantSlug, locale: code, path });
              if (!res.ok) return setMessage(labels.failed);
              setMessage(
                res.data.status === 'limited'
                  ? labels.limited
                  : labels.sent.replace('{language}', chosen?.name ?? code),
              );
            });
          }}
        >
          <label className="grow">
            <span className="block text-xs">{labels.language}</span>
            <select
              className="mt-1 w-full rounded border border-black/20 bg-white px-2 py-1.5"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code} lang={l.code} dir={l.dir}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={pending || !code}
            className="rounded bg-black px-3 py-1.5 font-medium text-white disabled:opacity-50"
          >
            {pending ? labels.sending : labels.send}
          </button>
        </form>
        <p role="status" className="mt-2 min-h-5 text-xs">
          {message}
        </p>
      </div>
    </details>
  );
}
