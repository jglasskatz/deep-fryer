/** A stable, announced fallback while a route loads its published data. */
export function RouteLoading({ label }: { label: string }) {
  return (
    <main id="main" lang="en" dir="ltr" className="mx-auto max-w-6xl px-4 py-10 sm:px-6" aria-busy="true">
      <p role="status" className="text-base font-medium">{label}</p>
      <div aria-hidden="true" className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="aspect-square max-h-96 rounded-lg bg-black/5" />
        <div className="space-y-4">
          <div className="h-8 w-2/3 rounded bg-black/5" />
          <div className="h-24 rounded bg-black/5" />
        </div>
      </div>
    </main>
  );
}
