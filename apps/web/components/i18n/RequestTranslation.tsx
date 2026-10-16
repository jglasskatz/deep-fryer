'use client';

import { useState, useTransition } from 'react';
import { requestTranslation } from '@/lib/translation-request-actions';
import type { TranslationRequestResult } from '@/lib/translation-requests';

export interface RequestTranslationLabels {
  button: string;
  intro: string;
  language: string;
  send: string;
  sending: string;
  /** Contains {language}. */
  sent: string;
  limited: string;
  notNeeded: string;
  failed: string;
}

/**
 * A language's name in the language the confirmation is written in ("asked
 * for Spanish" in English, "pidió español" in Spanish), so the sentence reads
 * as one language; the language's own name when the runtime cannot name it.
 */
export function languageNameIn(labelsLang: string, code: string, ownName: string): string {
  try {
    // fallback 'none': no name rather than a made-up one ("xx (UNKNOWN)").
    const name = new Intl.DisplayNames([labelsLang], { type: 'language', fallback: 'none' }).of(code);
    return name && name !== code ? name : ownName;
  } catch {
    return ownName;
  }
}

/**
 * What the reader is told once the server has answered. Each status gets its
 * own words, because only `sent` recorded anything: `limited` (this network
 * has sent its hourly share, which on shared Wi-Fi may be other people's) and
 * `not_needed` (the portrait was translated after this page loaded) must not
 * be thanked as if staff will see the request.
 */
export function confirmationFor(
  status: TranslationRequestResult['status'],
  labels: Pick<RequestTranslationLabels, 'sent' | 'limited' | 'notNeeded'>,
  language: string,
): string {
  if (status === 'limited') return labels.limited;
  if (status === 'not_needed') return labels.notNeeded;
  return labels.sent.replace('{language}', language);
}

/**
 * "Request a translation" (SPEC-v7 §3.5), in the header where the language
 * menu sits on translated portraits. The page is English, but these labels
 * come in the reader's preferred language when we know it (remembered choice
 * or browser language), and `lang`/`dir` follow them, so a reader who cannot
 * read English can still ask. A <details> disclosure like the language menu,
 * sharing its exclusive-open group — and so its Escape / focus-out /
 * press-outside dismissal (site-header/header-menus.ts), which keys on the
 * group's name.
 *
 * `lang`/`dir` go on the text, never on the <details> or its positioned
 * panel. Those two stay in the page's direction: the panel is pinned with
 * `end-0`, which a browser resolves against the panel's own direction, so in
 * an Arabic or Urdu panel "end" would become the left edge and the panel
 * would grow rightward off the screen, instead of lining up with the other
 * header menus at the right (SiteHeader's small-screen layout relies on it).
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
    <details name="df-header-menu" className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-2 py-1.5 hover:bg-black/5">
        <svg aria-hidden width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M2.5 10h15M10 2.5c2.2 2.3 3.2 4.8 3.2 7.5s-1 5.2-3.2 7.5c-2.2-2.3-3.2-4.8-3.2-7.5s1-5.2 3.2-7.5z" />
        </svg>
        <span className="hidden sm:inline" lang={labelsLang} dir={labelsDir}>
          {labels.button}
        </span>
        <span className="sr-only sm:hidden" lang={labelsLang} dir={labelsDir}>
          {labels.button}
        </span>
      </summary>
      <div className="absolute end-0 z-50 mt-1 w-72 rounded border border-black/10 bg-white p-3 text-sm shadow-lg">
        <div lang={labelsLang} dir={labelsDir}>
          <p>{labels.intro}</p>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setMessage(null);
              start(async () => {
                const res = await requestTranslation({ tenantSlug, locale: code, path });
                if (!res.ok) return setMessage(labels.failed);
                const language = languageNameIn(labelsLang, code, chosen?.name ?? code);
                setMessage(confirmationFor(res.data.status, labels, language));
              });
            }}
          >
            <label className="grow">
              <span className="block text-xs">{labels.language}</span>
              <select
                className="mt-1 w-full rounded border border-field-border bg-white px-2 py-1.5"
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
      </div>
    </details>
  );
}
