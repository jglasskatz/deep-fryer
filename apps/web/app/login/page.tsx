'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

function LoginInner() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/';

  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  const signIn = async () => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  };

  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-2xl font-bold">Sign in</h1>
      {configured ? (
        <button
          onClick={signIn}
          className="mt-8 w-full rounded bg-black px-4 py-2.5 text-sm font-medium text-white"
        >
          Continue with Google
        </button>
      ) : (
        <p className="mt-8 text-sm text-[color:var(--color-muted)]">
          Supabase auth is not configured in this environment. Local development runs the admin
          surface in dev mode without sign-in.
        </p>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
