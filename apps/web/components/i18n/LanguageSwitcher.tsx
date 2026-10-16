import { cookies, headers } from 'next/headers';
import { LOCALES, localeInfo } from '@/lib/i18n/locales';
import { messagesFor } from '@/lib/i18n/messages';
import { preferredLocale } from '@/lib/i18n/preferred';
import { isLocalizablePath, localizeHref } from '@/lib/i18n/routing';
import { rich } from '@/lib/i18n/format';
import { getI18n, getRequestPath } from '@/lib/i18n/server';
import { translationOnFor, translationScope } from '@/lib/translation-policy';
import { RequestTranslation } from './RequestTranslation';

/**
 * Language menu for the public plane (NYC Local Law 30): every language
 * listed in its own script, each linking to this same page in that language.
 * English is reached through `?hl=en`, which also clears a remembered choice
 * (middleware.ts). A <details> disclosure — no JavaScript, works offline.
 */
export async function LanguageSwitcher() {
  const { locale, info, m } = await getI18n();
  const full = await getRequestPath();
  const cut = full.indexOf('?');
  const path = cut === -1 ? full : full.slice(0, cut);
  if (!isLocalizablePath(path)) return null;

  // A portrait with translation off (SPEC-v7 §3.5) is English only: instead
  // of the language menu, readers may ask for their language. Its labels are
  // in the reader's preferred language when we know it.
  if (!(await translationOnFor(path))) {
    const scope = translationScope(path);
    if (scope?.kind !== 'tenant') return null;
    const preferred = preferredLocale(
      (await cookies()).get('df_lang')?.value,
      (await headers()).get('accept-language'),
    );
    const shownIn = preferred ?? 'en';
    return (
      <RequestTranslation
        tenantSlug={scope.slug}
        path={path}
        labels={messagesFor(shownIn).translationRequest}
        labelsLang={shownIn}
        labelsDir={localeInfo(shownIn).dir}
        languages={LOCALES.filter((l) => l.code !== 'en').map((l) => ({ code: l.code, name: l.name, dir: l.dir }))}
        initial={preferred}
      />
    );
  }

  const query = new URLSearchParams(cut === -1 ? '' : full.slice(cut + 1));
  query.delete('hl');

  const hrefFor = (code: (typeof LOCALES)[number]['code']) => {
    if (code === 'en') {
      const q = new URLSearchParams(query);
      q.set('hl', 'en');
      return `${path}?${q.toString()}`;
    }
    const q = query.toString();
    return `${localizeHref(code, path)}${q ? `?${q}` : ''}`;
  };

  return (
    <details name="df-header-menu" className="relative">
      <summary
        className="flex cursor-pointer list-none items-center gap-1.5 rounded px-2 py-1.5 hover:bg-black/5"
        aria-label={`${m.language.choose} (${info.name})`}
      >
        <svg aria-hidden width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M2.5 10h15M10 2.5c2.2 2.3 3.2 4.8 3.2 7.5s-1 5.2-3.2 7.5c-2.2-2.3-3.2-4.8-3.2-7.5s1-5.2 3.2-7.5z" />
        </svg>
        <span className="hidden sm:inline">{info.name}</span>
      </summary>
      <div className="absolute end-0 z-50 mt-1 w-56 rounded border border-black/10 bg-white p-1 text-sm shadow-lg">
        <p className="px-3 py-1.5 text-xs text-[color:var(--color-muted)]">{m.language.label}</p>
        <ul>
          {LOCALES.map((l) => (
            <li key={l.code}>
              <a
                href={hrefFor(l.code)}
                lang={l.code}
                hrefLang={l.code}
                dir={l.dir}
                aria-current={l.code === locale ? 'true' : undefined}
                className={`block rounded px-3 py-2 hover:bg-black/5 ${l.code === locale ? 'font-semibold' : ''}`}
              >
                {l.name}
                {l.code !== 'en' ? (
                  <span lang="en" dir="ltr" className="ms-2 text-xs text-[color:var(--color-muted)]">
                    {l.english}
                  </span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * Shown under the header on every translated page: what is and is not
 * translated, and where to get help in the reader's language — the
 * organization's language access contact (NYC: 311).
 */
export async function LanguageNotice({ languageHelp }: { languageHelp: string | null }) {
  const { locale, m } = await getI18n();
  if (locale === 'en') return null;
  const path = (await getRequestPath()).split('?')[0]!;
  if (!isLocalizablePath(path)) return null;
  return (
    <div className="border-t border-black/5 bg-amber-50/70 text-amber-950 print:hidden">
      <p className="mx-auto max-w-6xl px-4 py-2 text-xs sm:px-6">
        {m.language.contentNotice}
        {languageHelp ? (
          <>
            {' '}
            <strong className="font-semibold">
              {rich(m.language.help, { contact: <bdi dir="ltr">{languageHelp}</bdi> })}
            </strong>
          </>
        ) : null}
      </p>
    </div>
  );
}
