import Link from 'next/link';
import { NYC_FAMILY, inNycFamily } from '@/lib/nyc-family';

/**
 * Portrait-family switcher: one pill per portrait plus the compare view.
 * Rendered as a sub-bar of the site header for tenants in a family.
 */
export function FamilyNav({ currentSlug }: { currentSlug?: string }) {
  if (currentSlug && !inNycFamily(currentSlug)) return null;
  return (
    <div className="border-t border-black/5 bg-[color:var(--color-bg)]/85">
      <nav className="mx-auto flex h-10 max-w-6xl items-center gap-1 overflow-x-auto px-6 text-sm">
        {NYC_FAMILY.map((m) => (
          <Link
            key={m.slug}
            href={`/${m.slug}`}
            className={`whitespace-nowrap rounded-full px-3 py-1 hover:bg-black/5 ${
              m.slug === currentSlug
                ? 'bg-[color:var(--color-accent)] text-white hover:opacity-90 hover:bg-[color:var(--color-accent)]'
                : 'text-[color:var(--color-muted)]'
            }`}
          >
            {m.slug === 'nyc' ? m.name : m.name.replace('The ', '')}
          </Link>
        ))}
        <span className="mx-1 text-black/15">|</span>
        <Link
          href="/compare"
          className={`whitespace-nowrap rounded-full px-3 py-1 hover:bg-black/5 ${
            currentSlug === undefined ? 'bg-black/10 font-medium' : 'text-[color:var(--color-muted)]'
          }`}
        >
          Compare ⇆
        </Link>
      </nav>
    </div>
  );
}
