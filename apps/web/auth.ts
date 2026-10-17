import NextAuth, { type DefaultSession, type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import Nodemailer from 'next-auth/providers/nodemailer';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { headers } from 'next/headers';
import { accounts, getDb, sessions, users, verificationTokens } from '@deep-fryer/db';
import { loginErrorHref } from '@/app/login/sign-in';
import { signInEmail } from '@/app/login/sign-in-email';
import { clientAddress } from '@/lib/client-address';
import { sendEmail } from '@/lib/email';
import { emailSignInEnabled, googleConfigured, microsoftConfigured } from '@/lib/env';
import { signInEmailRefusal } from '@/lib/sign-in-limit';

/**
 * Accounts (SPEC-v3 §2.1): Auth.js v5 on our own Postgres. Database sessions
 * (not JWTs) so access is revocable server-side — removing a member or
 * signing out everywhere takes effect on the next request.
 *
 * Sign-in methods are enabled by environment:
 * - Google (AUTH_GOOGLE_ID/SECRET) — residents and Google Workspace cities.
 * - Microsoft Entra ID (AUTH_MICROSOFT_ENTRA_ID_ID/SECRET/ISSUER) — most
 *   municipal staff, NYC agencies included, sign in with Microsoft 365.
 * - Email magic link (SMTP_URL + EMAIL_FROM) — anyone, no IdP required,
 *   within the per-inbox and per-network limits of lib/sign-in-limit.ts.
 */

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      displayName: string | null;
      isStaff: boolean;
    } & DefaultSession['user'];
  }
}

/** Magic links live 15 minutes (how many may be outstanding: lib/sign-in-limit.ts). */
const MAGIC_LINK_MAX_AGE_S = 15 * 60;

function config(): NextAuthConfig {
  const db = getDb();
  const providers: NextAuthConfig['providers'] = [];

  if (googleConfigured()) {
    // Google only issues verified addresses, so linking by email is safe
    // here: an invited official who first used a magic link can later use
    // Google with the same address.
    providers.push(Google({ allowDangerousEmailAccountLinking: true }));
  }
  if (microsoftConfigured()) {
    providers.push(
      MicrosoftEntraID({
        issuer:
          process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ??
          'https://login.microsoftonline.com/common/v2.0',
        // Identity comes from the ID token alone. The stock provider also
        // asks for Graph's User.Read and downloads the profile photo on every
        // sign-in: a scope many municipal tenants block from user consent, a
        // network call that fails sign-in when Graph is unreachable, and a
        // staff photo we have no use for. Microsoft omits the email claim
        // when the domain is unverified (removeUnverifiedEmailClaim, the
        // default for app registrations since 2023), so `email` here is
        // domain-verified or absent — never linked to an existing account.
        authorization: { params: { scope: 'openid profile email' } },
        profile: (profile) => ({
          id: profile.sub,
          name: profile.name ?? null,
          email: typeof profile.email === 'string' ? profile.email.toLowerCase() : null,
          image: null,
        }),
      }),
    );
  }
  if (emailSignInEnabled()) {
    providers.push(
      Nodemailer({
        // The transport lives in lib/email (shared with invitations);
        // Auth.js only needs a non-empty server value to accept the config.
        server: process.env.SMTP_URL || 'smtp://localhost',
        from: process.env.EMAIL_FROM || 'deep-fryer <no-reply@localhost>',
        maxAge: MAGIC_LINK_MAX_AGE_S,
        async sendVerificationRequest({ identifier, url }) {
          // Whether to send at all was decided in callbacks.signIn below,
          // before Auth.js stored the token.
          await sendEmail({ to: identifier, ...signInEmail(url, MAGIC_LINK_MAX_AGE_S / 60) });
        },
      }),
    );
  }

  return {
    adapter: DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    providers,
    session: { strategy: 'database', maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
    // Self-hosted behind Caddy: trust the forwarded host (AUTH_URL pins it).
    trustHost: true,
    // verifyRequest is a page of its own: Auth.js appends `?provider=…` to
    // it, which turned the old '/login?sent=1' into a malformed URL. The
    // sign-in form goes there itself, carrying `next` (app/login/sign-in.ts
    // afterEmailSignIn); Auth.js's own redirect lands there for any other caller.
    pages: { signIn: '/login', verifyRequest: '/login/check-email', error: '/login' },
    callbacks: {
      /**
       * The limits on sign-in emails (lib/sign-in-limit.ts), for every way a
       * link can be asked for: the sign-in form's server action and a direct
       * POST to /api/auth/signin/nodemailer both come through here. Auth.js
       * calls this with `email.verificationRequest` before it makes the
       * token or sends anything, and a string answer is where it sends the
       * browser instead: the sign-in page with the reason, which the form's
       * action reads back out of that URL (app/login/sign-in.ts
       * afterEmailSignIn). The address comes from the request headers
       * (next/headers holds them for both paths); OAuth sign-ins and the
       * link's own callback pass straight through.
       */
      async signIn({ user, account, email }) {
        if (!email?.verificationRequest) return true;
        const refusal = await signInEmailRefusal({
          email: account?.providerAccountId ?? user.email ?? '',
          address: clientAddress(await headers()),
        });
        return refusal ? loginErrorHref(refusal) : true;
      },
      async session({ session, user }) {
        const row = user as typeof user & { displayName?: string | null; isStaff?: boolean };
        session.user.id = user.id;
        session.user.displayName = row.displayName ?? null;
        session.user.isStaff = Boolean(row.isStaff);
        return session;
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => config());
