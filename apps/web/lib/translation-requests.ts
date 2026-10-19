import 'server-only';
import { createHmac } from 'node:crypto';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { tenantBySlug, translationRequests } from '@deep-fryer/db';
import { UserError } from './action-result';
import { userDb } from './db';
import { portraitFeaturesIn } from './features';
import { purposeKey } from './form-token';
import { LOCALES, localeInfo, type Locale } from './i18n/locales';
import { translationScope } from './translation-policy';

/**
 * "Request a translation" (SPEC-v7 §3.5): a reader of a portrait whose
 * translation feature is off asks for their language. No account is needed;
 * the request is a count for staff, not a message, so it carries only the
 * language and the page. Limits: a supported non-English language; a page of
 * this portrait; ten requests an hour from one network address per portrait
 * (stored only as a keyed hash, under its own purpose key so the hash cannot
 * be matched against the involvement form's).
 */

const PER_ADDRESS_PER_HOUR = 10;

/**
 * Advisory-lock namespace (the first key of pg_advisory_xact_lock(int, int))
 * that makes the count and the insert atomic per portrait and address:
 * without it a burst of parallel requests all count the same "0 so far"
 * before any insert commits, and about one pool's worth more than the limit
 * is stored. The second key hashes tenant + address; a collision only
 * serializes two unrelated requests briefly. Distinct from the involvement
 * form's namespaces (lib/involvement-actions.ts, 61_001 and 61_002).
 */
const LOCK_ADDRESS = 61_003;
const REQUESTABLE = new Set<string>(LOCALES.filter((l) => l.code !== 'en').map((l) => l.code));

export type TranslationRequestResult = { status: 'sent' | 'limited' | 'not_needed' };

/** The keyed stand-in for an address, for this purpose only. */
function requestAddressHash(address: string): string {
  return createHmac('sha256', purposeKey('translation-request-address'))
    .update(address.trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

/** Record one request; `address` is the client's network address (lib/client-address.ts). */
export async function recordTranslationRequest(input: {
  tenantSlug: string;
  locale: string;
  path: string;
  address: string;
}): Promise<TranslationRequestResult> {
  if (!REQUESTABLE.has(input.locale)) throw new UserError('That language is not available.');
  const path = String(input.path ?? '').split('?')[0]!.slice(0, 300);
  const scope = translationScope(path);
  if (!path.startsWith('/') || scope?.kind !== 'tenant' || scope.slug !== input.tenantSlug) {
    throw new UserError('That page is not part of this portrait.');
  }
  const ipHash = requestAddressHash(input.address);

  return userDb(async (db) => {
    const tenant = await tenantBySlug(db, input.tenantSlug);
    if (!tenant || tenant.archivedAt) throw new UserError('That portrait does not exist.');
    // A translated portrait already has the language; nothing to ask for.
    // Read on this transaction, not through portraitFeaturesById: that would
    // wait for a second pooled connection while this one is held, and a burst
    // of anonymous requests would leave every connection waiting forever.
    if ((await portraitFeaturesIn(db, tenant.id)).translation) return { status: 'not_needed' as const };

    // Held until this transaction commits or rolls back (see LOCK_ADDRESS).
    await db.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_ADDRESS}::int, hashtext(${`${tenant.id}:${ipHash}`}))`);
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const [row] = await db.execute<{ count: string }>(
      sql`SELECT translation_request_count(${tenant.id}::uuid, ${ipHash}, ${since.toISOString()}::timestamptz) AS count`,
    );
    if (Number(row?.count ?? 0) >= PER_ADDRESS_PER_HOUR) return { status: 'limited' as const };

    await db.insert(translationRequests).values({
      tenantId: tenant.id,
      locale: input.locale as Locale,
      path,
      ipHash,
    });
    return { status: 'sent' as const };
  });
}

/**
 * How far back the owner's counts look: recent demand is what an owner weighs
 * when deciding whether to turn translation on, and a burst of requests from
 * long ago should not keep looking current.
 */
export const TRANSLATION_REQUEST_WINDOW_DAYS = 90;

/**
 * Requests per language in the last TRANSLATION_REQUEST_WINDOW_DAYS, for the
 * settings page (members read them, RLS), most-asked first, with each
 * language's English name for staff.
 */
export async function translationRequestCounts(
  tenantId: string,
  now: Date = new Date(),
): Promise<{ language: string; count: number }[]> {
  const since = new Date(now.getTime() - TRANSLATION_REQUEST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await userDb((db) =>
    db
      .select({ locale: translationRequests.locale, n: count() })
      .from(translationRequests)
      .where(and(eq(translationRequests.tenantId, tenantId), gte(translationRequests.createdAt, since)))
      .groupBy(translationRequests.locale)
      .orderBy(desc(count())),
  );
  return rows
    .filter((r) => REQUESTABLE.has(r.locale))
    .map((r) => ({ language: localeInfo(r.locale as Locale).english, count: Number(r.n) }));
}
