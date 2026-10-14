import Link from 'next/link';
import type { Family } from '@/lib/family';

/**
 * Portrait-family switcher: one pill per portrait plus the family compare,
 * insights, and progress views. Rendered as a sub-bar of the site header for
 * portraits whose organization holds more than one.
 */
export function FamilyNav({
  family,
  currentSlug,
  currentView,
}: {
  family: Family;
  currentSlug?: string;
  currentView?: 'compare' | 'insights' | 'progress';
}) {
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
        aria-label={`${family.organization.name} portraits`}
        className="mx-auto flex h-10 max-w-6xl items-center gap-1 overflow-x-auto px-4 text-sm sm:px-6"
      >
        {family.members.map((m) => (
          <Link
            key={m.slug}
            href={`/${m.slug}`}
            aria-current={m.slug === currentSlug ? 'page' : undefined}
            className={pill(m.slug === currentSlug)}
          >
            {m.name.replace(/^The /, '')}
          </Link>
        ))}
        <span aria-hidden className="mx-1 text-black/15">
          |
        </span>
        <Link href={`${base}/compare`} className={pill(currentView === 'compare')}>
          Compare ⇆
        </Link>
        <Link href={`${base}/insights`} className={pill(currentView === 'insights')}>
          Insights
        </Link>
        <Link href={`${base}/progress`} className={pill(currentView === 'progress')}>
          Progress
        </Link>
      </nav>
    </div>
  );
}
