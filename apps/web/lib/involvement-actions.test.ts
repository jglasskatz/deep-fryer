import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setPortraitFeatures } from './test-features';
import { issueFormToken } from './form-token';
import type { InvolvementField, SubmitInvolvementInput } from './involvement-actions';

/**
 * The public organization form's server action (SPEC-v6 §4.2), as an
 * anonymous visitor's request runs it: AUTH_SECRET is set, there is no
 * session, so userDb runs as the enforced `deep_fryer_app` role with no
 * user and every write passes the insert policy of migration 0010.
 *
 * The checks before the database — honeypot, form token, validation — are
 * tested without one; storing, the portrait check, and both rate limits
 * (including a burst of parallel requests from one address) against the
 * dev database.
 */

// The request: where it came from (Caddy's X-Forwarded-For) and its
// language (middleware's x-df-locale).
let requestHeaders = new Headers();
vi.mock('next/headers', () => ({ headers: vi.fn(async () => requestHeaders) }));
// An anonymous resident: no session.
vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `ia-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const fields = {
  kind: 'listing',
  dimension_slug: 'housing',
  org_name: 'Flatbush Tenant Coalition',
  about: 'A coalition of tenant associations in central Brooklyn.',
  pitch: 'Join a building meeting, or come to our free Thursday tenant clinic.',
  website: 'https://example.org/ftc',
  contact_name: 'Ana Rivera',
  email: 'ana@example.org',
  phone: '',
} satisfies Partial<Record<InvolvementField, string>>;

/** A token issued long enough ago for a person to have filled the form. */
const filledToken = (scope: string) => issueFormToken(scope, Date.now() - 10_000);

function from(address: string, locale = 'en') {
  requestHeaders = new Headers({ 'x-forwarded-for': address, 'x-df-locale': locale });
}

describe('submitInvolvement', () => {
  const saved = process.env.AUTH_SECRET;
  beforeAll(() => {
    process.env.AUTH_SECRET = 'involvement-actions-test-secret';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
  });

  async function submit(input: Partial<SubmitInvolvementInput>) {
    const { submitInvolvement } = await import('./involvement-actions');
    return submitInvolvement({ tenantSlug: 'nyc', token: filledToken('nyc'), honeypot: '', fields, ...input });
  }

  describe('before the database', () => {
    it('thanks a filled honeypot without checking anything else', async () => {
      from('203.0.113.1');
      expect(await submit({ honeypot: 'https://spam.example', token: 'junk', tenantSlug: 'no-such-portrait' })).toEqual({
        status: 'thanks',
      });
    });

    it('refuses a token that is too fresh, too old, from another portrait, or missing', async () => {
      from('203.0.113.1');
      expect(await submit({ token: issueFormToken('nyc') })).toEqual({ status: 'tooFast' });
      expect(await submit({ token: issueFormToken('nyc', Date.now() - 25 * 60 * 60 * 1000) })).toEqual({ status: 'expired' });
      expect(await submit({ token: filledToken('brooklyn') })).toEqual({ status: 'expired' });
      expect(await submit({ token: '' })).toEqual({ status: 'expired' });
      expect(await submit({ tenantSlug: '' })).toEqual({ status: 'failed' });
    });

    it('names the fields to fix, never the schema’s English messages', async () => {
      from('203.0.113.1');
      expect(await submit({ fields: { ...fields, org_name: '', about: ' ' } })).toEqual({
        status: 'invalid',
        fields: ['org_name', 'about'],
      });
      expect(
        await submit({ fields: { ...fields, email: 'not an email', website: 'javascript:alert(1)', phone: 'call me' } }),
      ).toEqual({ status: 'invalid', fields: ['website', 'email', 'phone'] });
      expect(await submit({ fields: { ...fields, dimension_slug: 'vibes', kind: 'advert' } })).toEqual({
        status: 'invalid',
        fields: ['kind', 'dimension_slug'],
      });
      expect(await submit({ fields: { ...fields, pitch: 'x'.repeat(2001) } })).toEqual({ status: 'invalid', fields: ['pitch'] });
    });
  });

  describe.skipIf(!hasDb)('with the database', () => {
    const created: { tenantId: string; organizationId: string }[] = [];
    afterAll(async () => {
      if (!created.length) return;
      const m = await import('@deep-fryer/db');
      const { inArray } = await import('drizzle-orm');
      const db = m.getDb();
      await db.delete(m.tenants).where(inArray(m.tenants.id, created.map((c) => c.tenantId)));
      await db.delete(m.organizations).where(inArray(m.organizations.id, created.map((c) => c.organizationId)));
    });

    async function portrait() {
      const m = await import('@deep-fryer/db');
      const { tenant } = await m.provisionTenant(m.getDb(), { slug: uniq(), name: 'Involvement City' });
      await setPortraitFeatures(tenant.id, { involvement: true });
      created.push({ tenantId: tenant.id, organizationId: tenant.organizationId });
      return tenant;
    }

    /** What staff will see: read in the system context (the submitter cannot read it back). */
    async function stored(tenantId: string) {
      const m = await import('@deep-fryer/db');
      const { asc, eq } = await import('drizzle-orm');
      return m
        .getDb()
        .select()
        .from(m.involvementSubmissions)
        .where(eq(m.involvementSubmissions.tenantId, tenantId))
        .orderBy(asc(m.involvementSubmissions.createdAt));
    }

    const as = (slug: string, overrides: Partial<Record<InvolvementField, string>> = {}) => ({
      tenantSlug: slug,
      token: filledToken(slug),
      fields: { ...fields, ...overrides },
    });

    it('stores an anonymous submission as new, with the language and a hash of the address only', async () => {
      const tenant = await portrait();
      from('198.51.100.23', 'es');
      expect(await submit(as(tenant.slug, { phone: '(718) 555-0100' }))).toEqual({ status: 'thanks' });
      const rows = await stored(tenant.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'listing',
        dimensionSlug: 'housing',
        orgName: 'Flatbush Tenant Coalition',
        website: 'https://example.org/ftc',
        contactName: 'Ana Rivera',
        email: 'ana@example.org',
        phone: '(718) 555-0100',
        locale: 'es',
        status: 'new',
        reviewedBy: null,
        listingId: null,
      });
      expect(rows[0]!.ipHash).toMatch(/^[0-9a-f]{32}$/);
      expect(rows[0]!.ipHash).not.toContain('198.51');

      // A suggestion needs no organization; "several / not sure" stores no dimension.
      expect(
        await submit(as(tenant.slug, { kind: 'suggestion', org_name: '', about: '', dimension_slug: '', email: 'b@example.org' })),
      ).toEqual({ status: 'thanks' });
      expect((await stored(tenant.id))[1]).toMatchObject({ kind: 'suggestion', orgName: null, about: null, dimensionSlug: null });
    });

    it('thanks a bot without storing anything', async () => {
      const tenant = await portrait();
      from('198.51.100.24');
      expect(await submit({ ...as(tenant.slug), honeypot: 'http://spam.example' })).toEqual({ status: 'thanks' });
      expect(await stored(tenant.id)).toHaveLength(0);
    });

    it('fails for a portrait that does not exist or is archived', async () => {
      from('198.51.100.25');
      const missing = uniq();
      expect(await submit(as(missing))).toEqual({ status: 'failed' });
      const tenant = await portrait();
      const m = await import('@deep-fryer/db');
      const { eq } = await import('drizzle-orm');
      await m.getDb().update(m.tenants).set({ archivedAt: new Date() }).where(eq(m.tenants.id, tenant.id));
      expect(await submit(as(tenant.slug))).toEqual({ status: 'failed' });
      expect(await stored(tenant.id)).toHaveLength(0);
    });

    it('fails, storing nothing, while Get involved is off for the portrait (SPEC-v7 §3)', async () => {
      const tenant = await portrait();
      await setPortraitFeatures(tenant.id, { involvement: false });
      from('198.51.100.26');
      expect(await submit(as(tenant.slug))).toEqual({ status: 'failed' });
      expect(await stored(tenant.id)).toHaveLength(0);
    });

    it('limits submissions per address per hour, per portrait', async () => {
      const tenant = await portrait();
      from('198.51.100.30');
      for (let i = 0; i < 5; i++) {
        expect(await submit(as(tenant.slug, { email: `person${i}@example.org` }))).toEqual({ status: 'thanks' });
      }
      expect(await submit(as(tenant.slug, { email: 'person5@example.org' }))).toEqual({ status: 'rateLimited' });
      // Another address is not held back by this one…
      from('198.51.100.31');
      expect(await submit(as(tenant.slug, { email: 'person6@example.org' }))).toEqual({ status: 'thanks' });
      // …nor is the same address on another portrait.
      const other = await portrait();
      from('198.51.100.30');
      expect(await submit(as(other.slug, { email: 'person7@example.org' }))).toEqual({ status: 'thanks' });
      expect(await stored(tenant.id)).toHaveLength(6);
    });

    it('limits submissions per email per day, whatever the address or letter case', async () => {
      const tenant = await portrait();
      for (let i = 0; i < 3; i++) {
        from(`198.51.100.${40 + i}`);
        expect(await submit(as(tenant.slug, { email: 'Ana@Example.org' }))).toEqual({ status: 'thanks' });
      }
      from('198.51.100.49');
      expect(await submit(as(tenant.slug, { email: 'ana@example.org' }))).toEqual({ status: 'rateLimited' });
      expect(await stored(tenant.id)).toHaveLength(3);
    });

    it('holds the address limit under a burst of parallel requests', async () => {
      const tenant = await portrait();
      from('198.51.100.60');
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => submit(as(tenant.slug, { email: `burst${i}@example.org` }))),
      );
      expect(results.filter((r) => r.status === 'thanks')).toHaveLength(5);
      expect(results.filter((r) => r.status === 'rateLimited')).toHaveLength(3);
      expect(await stored(tenant.id)).toHaveLength(5);
    });
  });
});
