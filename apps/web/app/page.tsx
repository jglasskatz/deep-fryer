import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-4xl font-bold tracking-tight">deep-fryer</h1>
      <p className="mt-4 text-lg text-[color:var(--color-muted)]">
        A multi-tenant SaaS for hosting Doughnut Economics portraits for
        municipalities. Each city gets a public interactive doughnut, an
        admin UI for staff, and an embeddable widget.
      </p>
      <p className="mt-8">
        <Link
          href="/santacruz"
          className="text-[color:var(--color-accent)] underline underline-offset-4"
        >
          View the Santa Cruz demo tenant →
        </Link>
      </p>
    </main>
  );
}
