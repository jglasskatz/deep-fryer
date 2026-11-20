import 'server-only';
import { auth } from '@/auth';
import { authConfigured, isProduction } from './env';

/**
 * Whether a signed-in person sent this request, for a route handler to ask
 * before it reads the request body: a member-only route answers someone
 * signed out without parsing anything they sent.
 *
 * The rule is lib/auth.ts getAuth's: without AUTH_SECRET, local development
 * acts as the local developer, and production refuses to run at all; with
 * it, the database session decides.
 */
export async function isSignedIn(): Promise<boolean> {
  if (!authConfigured()) {
    if (isProduction()) {
      throw new Error('AUTH_SECRET is not set: refusing anonymous dev mode in production');
    }
    return true;
  }
  const session = await auth();
  return Boolean(session?.user?.id);
}

/** The answer a member-only route gives a request from someone not signed in. */
export const SIGN_IN_REQUIRED = { error: 'requires sign-in' } as const;
