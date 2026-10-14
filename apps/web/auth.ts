import NextAuth, { type DefaultSession, type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import Nodemailer from 'next-auth/providers/nodemailer';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { and, eq, gt, sql } from 'drizzle-orm';
import { accounts, getDb, sessions, users, verificationTokens } from '@deep-fryer/db';
import { sendEmail, simpleHtml } from '@/lib/email';
import { emailSignInEnabled, googleConfigured, microsoftConfigured } from '@/lib/env';

/**
 * Accounts (SPEC-v3 §2.1): Auth.js v5 on our own Postgres. Database sessions
 * (not JWTs) so access is revocable server-side — removing a member or
 * signing out everywhere takes effect on the next request.
 *
 * Sign-in methods are enabled by environment:
 * - Google (AUTH_GOOGLE_ID/SECRET) — residents and Google Workspace cities.
 * - Microsoft Entra ID (AUTH_MICROSOFT_ENTRA_ID_ID/SECRET/ISSUER) — most
 *   municipal staff, NYC agencies included, sign in with Microsoft 365.
 * - Email magic link (SMTP_URL + EMAIL_FROM) — anyone, no IdP required.
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

/** Magic links live 15 minutes; at most this many may be outstanding per address. */
const MAGIC_LINK_MAX_AGE_S = 15 * 60;
const MAX_OUTSTANDING_LINKS = 3;

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
          // Throttle per address in the database (works across replicas).
          // Auth.js writes this request's token concurrently with this call,
          // so the count may or may not include it — the bound is approximate
          // by one, which is fine for abuse prevention.
          const [row] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(verificationTokens)
            .where(
              and(
                eq(verificationTokens.identifier, identifier),
                gt(verificationTokens.expires, new Date()),
              ),
            );
          if ((row?.n ?? 0) > MAX_OUTSTANDING_LINKS) {
            throw new Error('too many sign-in links requested; try again in 15 minutes');
          }
          const host = new URL(url).host;
          await sendEmail({
            to: identifier,
            subject: `Sign in to ${host}`,
            text: `Use this link to sign in to ${host}. It expires in 15 minutes and works once.\n\n${url}\n\nIf you did not ask to sign in, ignore this email.`,
            html: simpleHtml(
              [
                `Use the button below to sign in to ${host}.`,
                'The link expires in 15 minutes and works once. If you did not ask to sign in, ignore this email.',
              ],
              { href: url, label: 'Sign in' },
            ),
          });
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
    pages: { signIn: '/login', verifyRequest: '/login?sent=1', error: '/login' },
    callbacks: {
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
