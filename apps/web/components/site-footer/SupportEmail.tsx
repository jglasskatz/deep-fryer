'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * The deployment's support address (SUPPORT_EMAIL) for client components
 * that cannot read the server's environment — the route error page
 * (app/error.tsx), which must say where to report a failure. The root
 * layout reads it once per request and provides it around every page, so
 * the error boundary inside the layout finds it; a root-layout failure
 * (app/global-error.tsx) has no layout and so no address.
 */
const SupportEmailContext = createContext<string | null>(null);

export function SupportEmailProvider({ email, children }: { email: string | null; children: ReactNode }) {
  return <SupportEmailContext.Provider value={email}>{children}</SupportEmailContext.Provider>;
}

/** The support address, or null when the operator has not set one (allowed outside production). */
export function useSupportEmail(): string | null {
  return useContext(SupportEmailContext);
}
