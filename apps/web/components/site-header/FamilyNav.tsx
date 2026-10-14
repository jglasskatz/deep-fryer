import Link from 'next/link';
import type { Family } from '@/lib/family';
import { fmt } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';

/**
 * Portrait-family switcher: one pill per portrait plus the family compare,
 * insights, and progress views. Rendered as a sub-bar of the site header for
 * portraits whose organization holds more than one.
 */
export async function FamilyNav({
  family,
  currentSlug,
  currentView,
}: {
  family: Family;
  currentSlug?: string;
  currentView?: 'compare' | 'insights' | 'progress';
}) {
  const { m, href } = await getI18n();
  const base = `/o/${family.organization.slug}`;
  const pill = (active: boolean) =>
    `whitespace-nowrap rounded-full px-3 py-1 ${
      active
        ? 'bg-[color:var(--color-accent)] text-white'
        : 'text-[color:var(--color-muted)] hover:bg-black/5'
    }`;
  return (
    <div className="border-t border-black/5 bg-[color:var(--color-bg)]/85">
      <nav
        aria-label={fmt(m.nav.familyPortraits, { org: family.organization.name })}
        className="mx-auto flex h-10 max-w-6xl items-center gap-1 overflow-x-auto px-4 text-sm sm:px-6"
      >
        {family.members.map((member) => (
          <Link
            key={member.slug}
            href={href(`/${member.slug}`)}
            aria-current={member.slug === currentSlug ? 'page' : undefined}
            className={pill(member.slug === currentSlug)}
          >
            {member.name.replace(/^The /, '')}
          </Link>
        ))}
        <span aria-hidden className="mx-1 text-black/15">
          |
        </span>
        <Link href={href(`${base}/compare`)} className={pill(currentView === 'compare')}>
          {m.nav.compare} <span aria-hidden>⇆</span>
        </Link>
        <Link href={href(`${base}/insights`)} className={pill(currentView === 'insights')}>
          {m.nav.insights}
        </Link>
        <Link href={href(`${base}/progress`)} className={pill(currentView === 'progress')}>
          {m.nav.progress}
        </Link>
      </nav>
    </div>
  );
}
