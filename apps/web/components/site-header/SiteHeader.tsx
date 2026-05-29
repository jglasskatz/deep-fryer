import Link from 'next/link';

type Variant = 'landing' | 'tenant' | 'admin' | 'architecture';

interface SiteHeaderProps {
  variant: Variant;
  tenant?: { slug: string; name: string };
}

export function SiteHeader({ variant, tenant }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-black/10 bg-[color:var(--color-bg)]/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight hover:opacity-80"
        >
          <span className="text-lg">🍩</span>
          <span>deep-fryer</span>
        </Link>

        {tenant && (
          <>
            <span className="text-[color:var(--color-muted)]">/</span>
            <Link
              href={`/${tenant.slug}`}
              className={`text-sm font-medium hover:underline ${
                variant === 'tenant' ? 'text-[color:var(--color-fg)]' : ''
              }`}
            >
              {tenant.name}
            </Link>
            {variant === 'admin' && (
              <>
                <span className="text-[color:var(--color-muted)]">/</span>
                <span className="text-sm font-medium">Admin</span>
              </>
            )}
          </>
        )}

        {variant === 'architecture' && (
          <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[color:var(--color-muted)]">
            Internal
          </span>
        )}

        <nav className="ml-auto flex items-center gap-1 text-sm">
          {variant === 'landing' && (
            <>
              <Link href="/architecture" className="rounded px-3 py-1.5 hover:bg-black/5">
                Architecture
              </Link>
              <Link
                href="/santacruz"
                className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-white hover:opacity-90"
              >
                View demo →
              </Link>
            </>
          )}

          {variant === 'tenant' && tenant && (
            <>
              <Link
                href={`/${tenant.slug}/outreach`}
                className="rounded px-3 py-1.5 hover:bg-black/5"
              >
                Outreach
              </Link>
              <Link
                href={`/${tenant.slug}/admin`}
                className="rounded border border-black/15 px-3 py-1.5 hover:bg-black/5"
              >
                Admin
              </Link>
            </>
          )}

          {variant === 'admin' && tenant && (
            <>
              <Link
                href={`/${tenant.slug}/admin`}
                className="rounded px-3 py-1.5 hover:bg-black/5"
              >
                Dimensions
              </Link>
              <Link
                href={`/${tenant.slug}/admin/outreach`}
                className="rounded px-3 py-1.5 hover:bg-black/5"
              >
                Outreach
              </Link>
              <Link
                href={`/${tenant.slug}/admin/settings`}
                className="rounded px-3 py-1.5 hover:bg-black/5"
              >
                Settings
              </Link>
              <Link
                href={`/${tenant.slug}`}
                className="ml-2 rounded border border-black/15 px-3 py-1.5 hover:bg-black/5"
              >
                ← Viewer
              </Link>
            </>
          )}

          {variant === 'architecture' && (
            <Link
              href="/"
              className="rounded border border-black/15 px-3 py-1.5 hover:bg-black/5"
            >
              ← Home
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
