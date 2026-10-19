#!/usr/bin/env tsx
/**
 * NYC "how to get involved" proposal (SPEC-v6 §4.4).
 *
 *   tsx scripts/nyc-involvement.ts            # dry run: check the links, print the proposal
 *   tsx scripts/nyc-involvement.ts --apply    # write it (run provision-nyc first)
 *
 * --apply needs DATABASE_URL. The dry run never writes; when DATABASE_URL is
 * set it also reads each portrait's existing listings to show what --apply
 * would add and what it would leave alone.
 *
 * It proposes "how to get involved" listings for the six NYC portraits from
 * the New York City programs, public bodies, and organizations in
 * scripts/nyc-involvement-data.ts. Sources: each listing links the program's
 * own page, and keeps in `source_url` the public page that confirmed it in
 * the October 2026 fact-check (the data file describes that check and lists
 * the candidates it left out). The whole-city portrait (nyc) gets every
 * listing; each borough portrait gets the citywide listings plus its own.
 *
 * Every listing is written UNPUBLISHED. Which programs the City points
 * residents to is a staff decision, so City staff read each listing against
 * its source, check the link, and publish at /{portrait}/admin/involvement.
 * Order follows the data file: display_order 0, 10, 20, … — the same on
 * every portrait, with room for staff to slot listings in between.
 *
 * Links. Each distinct link is fetched once, in the dry run and at --apply
 * alike (GET, 10 s, following at most five https redirects, a User-Agent
 * that names deep-fryer and carries no personal contact). `link_checked_at`
 * — which residents see as the date the link was checked — is set only when
 * the link led to a page that answered 2xx from where the script ran. A link
 * that did not answer is still written, with link_checked_at empty, for
 * staff to check by hand ("Link checked today"). A machine without internet
 * access gets no answer from any of them, and the script says so plainly
 * rather than reporting the links as broken.
 *
 * Idempotent and conservative: a listing already on a portrait — same name
 * (the table's unique key, `insert … on conflict (tenant_id, name) do
 * nothing`) or same link (staff may have renamed it) — is left exactly as
 * staff set it; only missing ones are inserted, and the counts of added and
 * kept are printed per portrait. A listing staff deleted is proposed again
 * by a later --apply, so re-run it only to add new entries. Every entry is
 * validated with the admin form's schema (involvementListingInputSchema)
 * when the script loads, so one bad entry stops it before anything is
 * fetched or written.
 */
import { eq, inArray } from 'drizzle-orm';
import { POLICY_DIMENSION_SLUGS, involvementListingInputSchema, type InvolvementListingInput } from '@deep-fryer/core';
import { getDb, involvementListings, tenants } from '@deep-fryer/db';
import { NYC_BOROUGHS, NYC_INVOLVEMENT, type NycInvolvementEntry } from './nyc-involvement-data.js';

/** The six NYC portraits: the whole city first, then the boroughs. */
const PORTRAITS = ['nyc', ...NYC_BOROUGHS] as const;
type Portrait = (typeof PORTRAITS)[number];

/** Gap between consecutive listings' display_order, so staff can insert between them. */
const DISPLAY_ORDER_STEP = 10;
/** A dimension with fewer listings than this on a portrait is flagged as thin. */
const THIN_BELOW = 2;

// ---- Validation (dry run and apply alike) -------------------------------------------

/** One entry of the data file, and the record it becomes. */
interface Proposal {
  entry: NycInvolvementEntry;
  listing: InvolvementListingInput & { url: string; source_url: string };
}

/**
 * Validate every entry exactly as the admin form would, plus what this
 * proposal promises on top: both links present (staff check each listing
 * against its source), its dimensions named (an empty list means "every
 * dimension", which no NYC program is), and names and links unique (the
 * name is the per-portrait conflict key, and a repeated link would make the
 * already-there match ambiguous). Throws on the first bad entry, naming it.
 */
function loadProposals(entries: NycInvolvementEntry[]): Proposal[] {
  const names = new Set<string>();
  const urls = new Set<string>();
  return entries.map((entry, i) => {
    const fail = (why: string): never => {
      throw new Error(`nyc-involvement-data.ts entry ${i + 1} "${entry.name}": ${why}`);
    };
    const parsed = involvementListingInputSchema.safeParse({
      name: entry.name,
      description: entry.description,
      url: entry.url,
      phone: entry.phone,
      kind: entry.kind,
      dimension_slugs: entry.dimension_slugs,
      source_url: entry.source_url,
      display_order: i * DISPLAY_ORDER_STEP,
      published: false,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues.map((issue) => `${issue.path.join('.') || 'entry'}: ${issue.message}`).join('; '));
    }
    const listing = parsed.data;
    const { url, source_url } = listing;
    if (!url || !source_url) return fail('needs both url and source_url');
    if (listing.dimension_slugs.length === 0) fail('name the dimensions it serves (an empty list would show it on every dimension page)');
    if (entry.boroughs !== 'citywide' && (entry.boroughs.length === 0 || new Set(entry.boroughs).size !== entry.boroughs.length)) {
      fail('boroughs must be "citywide" or a list of distinct boroughs');
    }
    if (names.has(listing.name)) fail('another entry has the same name');
    if (urls.has(url)) fail('another entry has the same url');
    names.add(listing.name);
    urls.add(url);
    return { entry, listing: { ...listing, url, source_url } };
  });
}

const PROPOSALS = loadProposals(NYC_INVOLVEMENT);

/** Whether a listing goes on a portrait: the whole city gets every one, a borough its own and the citywide ones. */
function serves(entry: NycInvolvementEntry, portrait: Portrait): boolean {
  return portrait === 'nyc' || entry.boroughs === 'citywide' || entry.boroughs.includes(portrait);
}

const proposalsFor = (portrait: Portrait) => PROPOSALS.filter((p) => serves(p.entry, portrait));

// ---- Link check ---------------------------------------------------------------------

const LINK_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
/** Links checked at once: quick, without hammering nyc.gov, which hosts most of them. */
const LINK_CONCURRENCY = 4;

/**
 * The outcome of fetching one link. `reached` separates a server that
 * answered with an error (the link may really be broken) from no answer at
 * all (DNS, connection, timeout — often the network this ran on, not the
 * link), so a run from a sandbox does not read as a list of dead links.
 */
type LinkCheck =
  | { ok: true; status: number; finalUrl: string; checkedAt: Date }
  | { ok: false; reached: boolean; reason: string };

/** A network failure in a few words: undici reports "fetch failed" and keeps the useful part (ENOTFOUND, ECONNREFUSED) in `cause.code`. */
function networkReason(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') return `no answer within ${LINK_TIMEOUT_MS / 1000} s`;
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  const code = typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : null;
  return code ? `${err.message} (${code})` : err.message;
}

/**
 * GET the link and follow its redirects (at most five, https only) to the
 * page it really lands on, which must answer 2xx within 10 s overall — the
 * rule scripts/nyc-emergency.ts applies to plan links. A redirect alone is
 * not confirmation: a moved page can land on a 404 or a parked domain, and
 * link_checked_at tells residents the link was found working.
 */
async function checkLink(url: string): Promise<LinkCheck> {
  const signal = AbortSignal.timeout(LINK_TIMEOUT_MS);
  let current = url;
  let reached = false;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (new URL(current).protocol !== 'https:') return { ok: false, reached, reason: `redirected to a non-https link ${current}` };
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': 'deep-fryer/1.0 (link check)', Accept: 'text/html,application/xhtml+xml,*/*' },
      });
      reached = true;
      // Only the status matters; drop the body rather than download it.
      await res.body?.cancel();
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).href;
        continue;
      }
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, finalUrl: current, checkedAt: new Date() };
      return { ok: false, reached, reason: `${current === url ? '' : `landed on ${current}, which `}answered ${res.status}` };
    }
    return { ok: false, reached, reason: `more than ${MAX_REDIRECTS} redirects` };
  } catch (err) {
    return { ok: false, reached, reason: `${current === url ? '' : `after redirecting to ${current}: `}${networkReason(err)}` };
  }
}

/** Check every distinct link once, a few at a time. */
async function checkLinks(urls: string[]): Promise<Map<string, LinkCheck>> {
  const distinct = [...new Set(urls)];
  const results = new Map<string, LinkCheck>();
  let next = 0;
  const worker = async () => {
    while (next < distinct.length) {
      const url = distinct[next++]!;
      results.set(url, await checkLink(url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(LINK_CONCURRENCY, distinct.length) }, worker));
  return results;
}

/** The check for a proposal's link (every proposal's link was checked). */
function checkOf(checks: Map<string, LinkCheck>, p: Proposal): LinkCheck {
  const check = checks.get(p.listing.url);
  if (!check) throw new Error(`link of "${p.listing.name}" was not checked`);
  return check;
}

/** One link's outcome, and what it means for link_checked_at. */
function describeCheck(check: LinkCheck, url: string): string {
  if (check.ok) return `answered ${check.status}${check.finalUrl === url ? '' : ` (lands on ${check.finalUrl})`} — link_checked_at set`;
  return `${check.reached ? 'not confirmed' : 'no answer from here'}: ${check.reason} — link_checked_at left empty`;
}

/**
 * The link check in a few lines, ending with what it means for the write.
 * When no link reached a server at all, the cause is almost certainly the
 * machine's network, and the summary says so in as many words.
 */
function printLinkSummary(checks: Map<string, LinkCheck>) {
  const all = [...checks.values()];
  const answered = all.filter((c) => c.ok).length;
  const failed = all.filter((c): c is Extract<LinkCheck, { ok: false }> => !c.ok);
  const errored = failed.filter((c) => c.reached);
  const unreached = failed.filter((c) => !c.reached);
  console.log(`# Link check: GET from this machine, ${LINK_TIMEOUT_MS / 1000} s, at most ${MAX_REDIRECTS} https redirects\n`);
  console.log(`  ${answered} of ${all.length} distinct links answered 2xx — written with link_checked_at set to when they answered`);
  console.log(
    `  ${errored.length} reached a server but did not lead to a working page, ${unreached.length} gave no answer — written with link_checked_at empty`,
  );
  if (unreached.length) {
    const reasons = new Map<string, number>();
    for (const c of unreached) reasons.set(c.reason, (reasons.get(c.reason) ?? 0) + 1);
    console.log(`  no answer: ${[...reasons].map(([reason, n]) => `${reason} ×${n}`).join('; ')}`);
  }
  if (answered === 0 && errored.length === 0) {
    console.log(
      '  NO LINK ANSWERED, and none reached a server: this machine cannot reach these sites (no internet access, or a\n' +
        '  sandbox or firewall blocks them), so this says nothing about whether the links work. --apply still writes every\n' +
        '  listing, unpublished, with link_checked_at empty; staff open each link and press "Link checked today" at\n' +
        '  /{portrait}/admin/involvement. Run from a machine with internet access to have the script stamp the date.',
    );
  } else if (failed.length) {
    console.log('  Staff check the links that did not answer by hand before publishing ("Link checked today").');
  }
}

// ---- What is already there ----------------------------------------------------------

interface ExistingListing {
  name: string;
  url: string | null;
}

/**
 * Split a portrait's proposals into those to insert and those already
 * there. A row with the same name is the same listing (the unique key); a
 * row with the same link is too — staff may have renamed it — and either way
 * it stays exactly as staff left it.
 */
function partition(proposals: Proposal[], existing: ExistingListing[]) {
  const byName = new Set(existing.map((e) => e.name));
  const byUrl = new Map<string, string>();
  for (const e of existing) if (e.url) byUrl.set(e.url, e.name);
  const toInsert: Proposal[] = [];
  const renamed: { proposed: string; existing: string }[] = [];
  for (const p of proposals) {
    if (byName.has(p.listing.name)) continue;
    const sameLink = byUrl.get(p.listing.url);
    if (sameLink !== undefined) renamed.push({ proposed: p.listing.name, existing: sameLink });
    else toInsert.push(p);
  }
  return { toInsert, renamed };
}

/** The six portraits' ids by slug; throws if any is missing (provision-nyc creates them). */
async function portraitIds(db: ReturnType<typeof getDb>): Promise<Map<Portrait, string>> {
  const rows = await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants).where(inArray(tenants.slug, [...PORTRAITS]));
  const ids = new Map<Portrait, string>();
  for (const portrait of PORTRAITS) {
    const row = rows.find((r) => r.slug === portrait);
    if (row) ids.set(portrait, row.id);
  }
  const missing = PORTRAITS.filter((p) => !ids.has(p));
  if (missing.length) throw new Error(`NYC portrait(s) ${missing.join(', ')} not found — run provision-nyc first`);
  return ids;
}

async function existingListings(db: ReturnType<typeof getDb>, tenantId: string): Promise<ExistingListing[]> {
  return db
    .select({ name: involvementListings.name, url: involvementListings.url })
    .from(involvementListings)
    .where(eq(involvementListings.tenantId, tenantId));
}

// ---- Dry run ------------------------------------------------------------------------

const portraitsLabel = (entry: NycInvolvementEntry) =>
  entry.boroughs === 'citywide' ? 'all six portraits' : `nyc, ${entry.boroughs.join(', ')}`;

async function printProposal(checks: Map<string, LinkCheck>) {
  console.log(`# NYC "how to get involved" proposal (SPEC-v6 §4.4): ${PROPOSALS.length} listings, all written UNPUBLISHED\n`);
  for (const p of PROPOSALS) {
    const l = p.listing;
    console.log(`  [${l.display_order}] ${l.name} (${l.kind})`);
    console.log(`       dimensions ${l.dimension_slugs.join(', ')} · on ${portraitsLabel(p.entry)}`);
    console.log(`       run by     ${p.entry.operator}`);
    console.log(`       link       ${l.url}${l.phone ? `   phone ${l.phone}` : ''}`);
    console.log(`       checked    ${describeCheck(checkOf(checks, p), l.url)}`);
    console.log(`       source     ${l.source_url === l.url ? '(the same page)' : l.source_url}`);
  }

  console.log('\n# Per portrait\n');
  const citywide = PROPOSALS.filter((p) => p.entry.boroughs === 'citywide').length;
  for (const portrait of PORTRAITS) {
    const own = proposalsFor(portrait).filter((p) => p.entry.boroughs !== 'citywide');
    const ownText = own.length
      ? `${citywide} citywide + ${own.length} for ${portrait === 'nyc' ? 'boroughs' : 'this borough'}: ${own.map((p) => p.listing.name).join('; ')}`
      : `${citywide} citywide`;
    console.log(`  ${portrait.padEnd(14)} ${String(citywide + own.length).padStart(2)} listings (${ownText})`);
  }

  // How many listings each dimension page would show, per portrait. Every
  // proposal names its dimensions, so this is the whole of each page's list.
  console.log(`\n# Listings per dimension page, per portrait (! = fewer than ${THIN_BELOW})\n`);
  const widths = PORTRAITS.map((p) => Math.max(p.length, 3));
  const slugWidth = Math.max(...POLICY_DIMENSION_SLUGS.map((s) => s.length));
  console.log(`  ${'dimension'.padEnd(slugWidth)}  ${PORTRAITS.map((p, i) => p.padStart(widths[i]!)).join('  ')}`);
  const thin: string[] = [];
  for (const slug of POLICY_DIMENSION_SLUGS) {
    const counts = PORTRAITS.map((portrait) => proposalsFor(portrait).filter((p) => p.listing.dimension_slugs.includes(slug)).length);
    const cells = counts.map((n, i) => `${n}${n < THIN_BELOW ? '!' : ' '}`.padStart(widths[i]! + 1));
    console.log(`  ${slug.padEnd(slugWidth)} ${cells.join(' ')}`.trimEnd());
    if (counts.some((n) => n < THIN_BELOW)) thin.push(slug);
  }
  console.log(
    `\n  ${thin.length} of ${POLICY_DIMENSION_SLUGS.length} dimensions have fewer than ${THIN_BELOW} listings on at least one portrait: ${thin.join(', ')}.\n` +
      '  The candidates the fact-check could not yet confirm are listed in scripts/nyc-involvement-data.ts.\n',
  );

  printLinkSummary(checks);

  console.log('\n# Against the database\n');
  if (!process.env.DATABASE_URL) {
    console.log("  DATABASE_URL is not set, so the proposal was not compared with the portraits' existing listings.");
  } else {
    const db = getDb();
    const ids = await portraitIds(db);
    for (const portrait of PORTRAITS) {
      const proposals = proposalsFor(portrait);
      const { toInsert, renamed } = partition(proposals, await existingListings(db, ids.get(portrait)!));
      console.log(`  ${portrait.padEnd(14)} would add ${toInsert.length}, keep ${proposals.length - toInsert.length} already there`);
      for (const r of renamed) console.log(`  ${''.padEnd(14)} keeps "${r.existing}" (same link as proposed "${r.proposed}")`);
    }
  }
  console.log('\nDry run. Re-run with --apply to write (unpublished; listings already there are left as staff set them).');
}

// ---- Apply --------------------------------------------------------------------------

async function apply(checks: Map<string, LinkCheck>) {
  const db = getDb();
  const ids = await portraitIds(db);
  console.log('\n# Writing, unpublished\n');
  for (const portrait of PORTRAITS) {
    const tenantId = ids.get(portrait)!;
    const proposals = proposalsFor(portrait);
    const { toInsert, renamed } = partition(proposals, await existingListings(db, tenantId));
    // One statement per portrait. ON CONFLICT covers a row staff added under
    // the same name between the read above and this insert, and RETURNING
    // counts what was really added (fine here, unlike the public submission
    // insert: whoever may write listings may also read them back).
    const inserted = toInsert.length
      ? await db
          .insert(involvementListings)
          .values(
            toInsert.map((p) => {
              const check = checkOf(checks, p);
              return {
                tenantId,
                name: p.listing.name,
                description: p.listing.description,
                url: p.listing.url,
                phone: p.listing.phone,
                kind: p.listing.kind,
                dimensionSlugs: p.listing.dimension_slugs,
                sourceUrl: p.listing.source_url,
                linkCheckedAt: check.ok ? check.checkedAt : null,
                displayOrder: p.listing.display_order,
                published: false,
              };
            }),
          )
          .onConflictDoNothing({ target: [involvementListings.tenantId, involvementListings.name] })
          .returning({ id: involvementListings.id })
      : [];
    console.log(
      `  ${portrait.padEnd(14)} ${inserted.length} added unpublished, ${proposals.length - inserted.length} kept (already there, left as staff set them)`,
    );
    for (const r of renamed) console.log(`  ${''.padEnd(14)} kept "${r.existing}" (same link as proposed "${r.proposed}")`);
  }
}

async function main() {
  const writing = process.argv.includes('--apply');
  // Links are checked before anything is printed or written, in both modes,
  // so the dry run shows which listings a run from this machine would stamp
  // with link_checked_at.
  const checks = await checkLinks(PROPOSALS.map((p) => p.listing.url));
  if (writing) {
    printLinkSummary(checks);
    await apply(checks);
    console.log('\nNYC involvement proposal written. Review each listing against its source and publish at /{portrait}/admin/involvement.');
  } else {
    await printProposal(checks);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
