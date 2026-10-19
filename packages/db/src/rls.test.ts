import { describe, expect, it } from 'vitest';

/**
 * Database-enforced access (migration 0005): these run real queries as the
 * deep_fryer_app role through withAuthContext and assert what each kind of
 * person can and cannot see or change — independently of any app code.
 */
type DbExecutor = import('./client.js').DbExecutor;
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Publish a dimension's newest version the way lib/publish.ts does, in the system context. */
async function publishFirstDimension(db: DbExecutor, dimensionId: string): Promise<void> {
  const m = await import('./index.js');
  const { eq } = await import('drizzle-orm');
  const v = (await m.latestVersion(db, dimensionId))!;
  await db.update(m.dimensionVersions).set({ status: 'published', publishedAt: new Date() }).where(eq(m.dimensionVersions.id, v.id));
  await db.update(m.dimensions).set({ publishedVersionId: v.id }).where(eq(m.dimensions.id, dimensionId));
}

describe.skipIf(!hasDb)('row-level security under the app role', () => {
  it('isolates portraits, drafts, findings, transcripts, and people', async () => {
    const m = await import('./index.js');
    const { eq, sql } = await import('drizzle-orm');
    const db = m.getDb();

    // Two cities in two organizations; one editor on city A; one resident.
    const a = await m.provisionTenant(db, { slug: uniq(), name: 'City A' });
    const b = await m.provisionTenant(db, { slug: uniq(), name: 'City B' });
    const [editor] = await db.insert(m.users).values({ email: `${uniq()}@a.gov`, displayName: 'ed' }).returning();
    const [resident] = await db.insert(m.users).values({ email: `${uniq()}@example.org`, displayName: 'res' }).returning();
    await db.insert(m.tenantMembers).values({ tenantId: a.tenant.id, userId: editor!.id, role: 'editor' });

    // Publish one dimension of each city; the rest stay drafts.
    for (const t of [a, b]) {
      const dimId = t.dimensions[0]!.dimensionId;
      const v = (await m.latestVersion(db, dimId))!;
      await db.update(m.dimensionVersions).set({ status: 'published', publishedAt: new Date() }).where(eq(m.dimensionVersions.id, v.id));
      await db.update(m.dimensions).set({ publishedVersionId: v.id }).where(eq(m.dimensions.id, dimId));
    }
    // A research session with a transcript, and a finding, on city B.
    const [run] = await db.insert(m.researchRuns).values({
      tenantId: b.tenant.id, plan: { sessions: [], config_hash: 'h', plugin_version: 'v' }, configSnapshot: {} as never,
    }).returning();
    const [session] = await db.insert(m.researchSessions).values({
      runId: run!.id, kind: 'dimension', dimensionId: b.dimensions[1]!.dimensionId, transcript: Buffer.from('secret'),
    }).returning();

    const anon = <T>(fn: (tx: DbExecutor) => Promise<T>) => m.withAuthContext(db, null, fn);
    const asEditor = <T>(fn: (tx: DbExecutor) => Promise<T>) => m.withAuthContext(db, editor!.id, fn);
    const asResident = <T>(fn: (tx: DbExecutor) => Promise<T>) => m.withAuthContext(db, resident!.id, fn);

    // Anonymous: published versions only, no drafts, no runs, no members.
    const anonVersions = await anon((tx) =>
      tx.select({ id: m.dimensionVersions.id, publishedAt: m.dimensionVersions.publishedAt }).from(m.dimensionVersions)
        .innerJoin(m.dimensions, eq(m.dimensions.id, m.dimensionVersions.dimensionId))
        .where(eq(m.dimensions.tenantId, a.tenant.id)),
    );
    expect(anonVersions).toHaveLength(1);
    expect(anonVersions.every((v) => v.publishedAt !== null)).toBe(true);
    expect(await anon((tx) => tx.select().from(m.researchRuns).where(eq(m.researchRuns.tenantId, b.tenant.id)))).toHaveLength(0);
    expect(await anon((tx) => tx.select().from(m.tenantMembers))).toHaveLength(0);
    // Behavior config is private even though methodology config is public.
    const anonConfig = await anon((tx) => tx.select({ key: m.tenantConfig.key }).from(m.tenantConfig).where(eq(m.tenantConfig.tenantId, a.tenant.id)));
    expect(anonConfig.map((r) => r.key)).toContain('threshold_overrides');
    expect(anonConfig.map((r) => r.key)).not.toContain('review_policy');

    // Editor of A: all of A's drafts; none of B's; cannot write B.
    const editorA = await asEditor((tx) =>
      tx.select({ id: m.dimensionVersions.id }).from(m.dimensionVersions)
        .innerJoin(m.dimensions, eq(m.dimensions.id, m.dimensionVersions.dimensionId))
        .where(eq(m.dimensions.tenantId, a.tenant.id)),
    );
    expect(editorA).toHaveLength(21);
    const editorB = await asEditor((tx) =>
      tx.select({ id: m.dimensionVersions.id }).from(m.dimensionVersions)
        .innerJoin(m.dimensions, eq(m.dimensions.id, m.dimensionVersions.dimensionId))
        .where(eq(m.dimensions.tenantId, b.tenant.id)),
    );
    expect(editorB).toHaveLength(1); // B's published version only
    await expect(
      asEditor((tx) => tx.insert(m.dimensionVersions).values({
        dimensionId: b.dimensions[2]!.dimensionId, versionNum: 99, status: 'draft',
        data: editorA as never, origin: 'human', changeNote: 'cross-tenant write',
      })),
    ).rejects.toThrow(/row-level security/);
    // …but can write A.
    const v1 = (await m.latestVersion(db, a.dimensions[2]!.dimensionId))!;
    const written = await asEditor((tx) => m.appendDimensionVersion(tx, {
      dimensionId: a.dimensions[2]!.dimensionId, status: 'draft', data: v1.data, origin: 'human', changeNote: 'in-tenant edit',
    }));
    expect(written.versionNum).toBe(2);
    // Editors cannot change their own role.
    await asEditor((tx) => tx.update(m.tenantMembers).set({ role: 'owner' }).where(eq(m.tenantMembers.userId, editor!.id)));
    const [stillEditor] = await db.select().from(m.tenantMembers).where(eq(m.tenantMembers.userId, editor!.id));
    expect(stillEditor!.role).toBe('editor');

    // Transcripts: the column is not readable by the user role at all.
    await expect(
      m.withAuthContext(db, editor!.id, (tx) => tx.execute(sql`select transcript from research_sessions where id = ${session!.id}`)),
    ).rejects.toThrow(/permission denied/);

    // Login plumbing is system-only.
    await expect(anon((tx) => tx.execute(sql`select * from sessions limit 1`))).rejects.toThrow(/permission denied/);

    // People: a resident sees only themself; display names come via the definer function.
    const residentSeesUsers = await asResident((tx) => tx.select({ id: m.users.id }).from(m.users));
    expect(residentSeesUsers.map((u) => u.id)).toEqual([resident!.id]);
    const names = await anon((tx) => tx.execute<{ display_name: string }>(sql`select display_name from public_display_names(${`{${editor!.id}}`}::uuid[])`));
    expect(names[0]?.display_name).toBe('ed');

    // Comments: residents post as themselves only, and cannot edit others'.
    const dimA = a.dimensions[0]!.dimensionId;
    await expect(
      asResident((tx) => tx.insert(m.comments).values({ tenantId: a.tenant.id, dimensionId: dimA, authorId: editor!.id, body: 'impersonation' })),
    ).rejects.toThrow(/row-level security/);
    const [mine] = await asResident((tx) =>
      tx.insert(m.comments).values({ tenantId: a.tenant.id, dimensionId: dimA, authorId: resident!.id, body: 'hello' }).returning(),
    );
    // Editors moderate (remove/restore) but can never rewrite a resident's words…
    await expect(
      asEditor((tx) => tx.update(m.comments).set({ body: 'tampered' }).where(eq(m.comments.id, mine!.id))),
    ).rejects.toThrow(/never rewrite/);
    const removed = await asEditor((tx) =>
      tx.update(m.comments).set({ removedAt: new Date(), removedBy: editor!.id }).where(eq(m.comments.id, mine!.id)).returning(),
    );
    expect(removed).toHaveLength(1);
    // …and authors can edit their text but not undo a removal.
    await expect(
      asResident((tx) => tx.update(m.comments).set({ removedAt: null, removedBy: null }).where(eq(m.comments.id, mine!.id))),
    ).rejects.toThrow(/moderation state/);
    // Another resident cannot touch it at all (no matching policy → 0 rows).
    const [stranger] = await db.insert(m.users).values({ email: `${uniq()}@example.org` }).returning();
    const strangerEdit = await m.withAuthContext(db, stranger!.id, (tx) =>
      tx.update(m.comments).set({ body: 'x' }).where(eq(m.comments.id, mine!.id)).returning(),
    );
    expect(strangerEdit).toHaveLength(0);
    await db.delete(m.users).where(eq(m.users.id, stranger!.id));

    // Cleanup (system context).
    await db.delete(m.researchSessions).where(eq(m.researchSessions.id, session!.id));
    await db.delete(m.researchRuns).where(eq(m.researchRuns.id, run!.id));
    for (const t of [a, b]) {
      await db.update(m.dimensions).set({ publishedVersionId: null }).where(eq(m.dimensions.tenantId, t.tenant.id));
      await db.delete(m.tenants).where(eq(m.tenants.id, t.tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, t.tenant.organizationId));
    }
    await db.delete(m.users).where(eq(m.users.id, editor!.id));
    await db.delete(m.users).where(eq(m.users.id, resident!.id));
    // Dozens of round trips through withAuthContext; it takes about five
    // seconds on a warm local database, so the default limit made it flaky.
  }, 60_000);

  it('keeps policy analyses staff-only and shows only published emergency content', async () => {
    const m = await import('./index.js');
    const { eq, sql } = await import('drizzle-orm');
    const db = m.getDb();
    const a = await m.provisionTenant(db, { slug: uniq(), name: 'City A' });
    const b = await m.provisionTenant(db, { slug: uniq(), name: 'City B' });
    const [editor] = await db.insert(m.users).values({ email: `${uniq()}@a.gov` }).returning();
    const [viewer] = await db.insert(m.users).values({ email: `${uniq()}@a.gov` }).returning();
    await db.insert(m.tenantMembers).values([
      { tenantId: a.tenant.id, userId: editor!.id, role: 'editor' },
      { tenantId: a.tenant.id, userId: viewer!.id, role: 'viewer' },
    ]);
    await db.insert(m.policyAnalyses).values({ tenantId: a.tenant.id, title: 'Rent relief', brief: 'b', transcript: Buffer.from('secret') });
    await db.insert(m.hazards).values([
      { tenantId: a.tenant.id, slug: 'heat', name: 'Extreme heat', kind: 'extreme_heat', likelihood: 5, severity: 4, published: true },
      { tenantId: a.tenant.id, slug: 'quake', name: 'Earthquake', kind: 'earthquake', likelihood: 1, severity: 5 },
    ]);
    await db.insert(m.emergencyAlerts).values({
      tenantId: a.tenant.id, source: 'nws', sourceId: uniq(), event: 'Heat Advisory', severity: 'Moderate', urgency: 'Expected',
      certainty: 'Likely', description: 'd', areaDesc: 'Kings', senderName: 'NWS Upton NY', url: 'https://api.weather.gov/alerts/x', effective: new Date(),
    });
    // City A is on the public plane (it has published a dimension); what a
    // portrait that has not looks like is the next test's subject.
    await publishFirstDimension(db, a.dimensions[0]!.dimensionId);
    const anon = <T>(fn: (tx: DbExecutor) => Promise<T>) => m.withAuthContext(db, null, fn);
    const asEditor = <T>(fn: (tx: DbExecutor) => Promise<T>) => m.withAuthContext(db, editor!.id, fn);
    const asViewer = <T>(fn: (tx: DbExecutor) => Promise<T>) => m.withAuthContext(db, viewer!.id, fn);

    // Analyses: never public; editors read them (SPEC-v5 §2: editors and
    // owners, migration 0009) but not the transcript; viewers of the same
    // portrait see none — a brief can be unreleased policy text; no app-role writes.
    expect(await anon((tx) => tx.select({ id: m.policyAnalyses.id }).from(m.policyAnalyses).where(eq(m.policyAnalyses.tenantId, a.tenant.id)))).toHaveLength(0);
    expect(await asEditor((tx) => tx.select({ id: m.policyAnalyses.id, title: m.policyAnalyses.title, adjustments: m.policyAnalyses.adjustments }).from(m.policyAnalyses).where(eq(m.policyAnalyses.tenantId, a.tenant.id)))).toHaveLength(1);
    expect(await asViewer((tx) => tx.select({ id: m.policyAnalyses.id }).from(m.policyAnalyses).where(eq(m.policyAnalyses.tenantId, a.tenant.id)))).toHaveLength(0);
    await expect(asEditor((tx) => tx.execute(sql`select transcript from policy_analyses`))).rejects.toThrow(/permission denied/);
    await expect(asEditor((tx) => tx.insert(m.policyAnalyses).values({ tenantId: a.tenant.id, title: 'x', brief: 'y' }))).rejects.toThrow(/row-level security/);

    // Hazards: the public sees published ones; the editor curates all of A's, none of B's.
    expect((await anon((tx) => tx.select({ slug: m.hazards.slug }).from(m.hazards).where(eq(m.hazards.tenantId, a.tenant.id)))).map((h) => h.slug)).toEqual(['heat']);
    expect(await asEditor((tx) => tx.select({ id: m.hazards.id }).from(m.hazards).where(eq(m.hazards.tenantId, a.tenant.id)))).toHaveLength(2);
    await expect(asEditor((tx) => tx.insert(m.hazards).values({ tenantId: b.tenant.id, slug: 'x', name: 'x', kind: 'other', likelihood: 1, severity: 1 }))).rejects.toThrow(/row-level security/);
    await expect(db.insert(m.hazards).values({ tenantId: a.tenant.id, slug: uniq(), name: 'bad', kind: 'other', likelihood: 6, severity: 1 })).rejects.toThrow(/hazards_likelihood_range/);

    // Alerts are official public information; only the system writes them.
    expect(await anon((tx) => tx.select({ id: m.emergencyAlerts.id }).from(m.emergencyAlerts).where(eq(m.emergencyAlerts.tenantId, a.tenant.id)))).toHaveLength(1);
    await expect(asEditor((tx) => tx.insert(m.emergencyAlerts).values({
      tenantId: a.tenant.id, source: 'nws', sourceId: uniq(), event: 'Fake', severity: 'Extreme', urgency: 'x', certainty: 'x',
      description: 'd', areaDesc: 'a', senderName: 's', url: 'https://x', effective: new Date(),
    }))).rejects.toThrow(/row-level security/);
  });

  // Migration 0015: a portrait is public only once it has published a
  // dimension version, and stays public until archived. Before that, its
  // members see it and nobody else sees it or anything in it.
  it('keeps a portrait and everything in it private until it first publishes, then public until archived', async () => {
    const m = await import('./index.js');
    const { eq, inArray, sql } = await import('drizzle-orm');
    const db = m.getDb();
    const [owner, viewer, billing, stranger] = await db
      .insert(m.users)
      .values([1, 2, 3, 4].map(() => ({ email: `${uniq()}@example.org` })))
      .returning();
    const p = await m.provisionTenant(db, { slug: uniq(), name: 'Private Town', ownerUserId: owner!.id });
    const tenantId = p.tenant.id;
    const orgId = p.tenant.organizationId;
    await db.insert(m.tenantMembers).values({ tenantId, userId: viewer!.id, role: 'viewer' });
    await db.insert(m.organizationMembers).values({ organizationId: orgId, userId: billing!.id, role: 'billing' });
    expect(p.tenant.firstPublishedAt).toBeNull();

    // Content that carries its own "published" flag, set before the portrait
    // has published any dimension — none of it may reach the public early.
    const dim = p.dimensions[0]!.dimensionId;
    await db.insert(m.hazards).values({ tenantId, slug: 'heat', name: 'Extreme heat', kind: 'extreme_heat', likelihood: 4, severity: 4, published: true });
    await db.insert(m.involvementListings).values({ tenantId, name: 'Food bank', description: 'Sort donations', kind: 'volunteer', published: true });
    await db.insert(m.emergencyAlerts).values({
      tenantId, source: 'nws', sourceId: uniq(), event: 'Heat Advisory', severity: 'Moderate', urgency: 'Expected',
      certainty: 'Likely', description: 'd', areaDesc: 'Town', senderName: 'NWS', url: 'https://api.weather.gov/alerts/y', effective: new Date(),
    });
    const [contact] = await db.insert(m.outreachContacts).values({ tenantId }).returning();
    const [contactVersion] = await db.insert(m.outreachContactVersions).values({
      contactId: contact!.id, versionNum: 1, status: 'published', data: { org: 'Library', tags: [], data_needs: [] }, publishedAt: new Date(),
    }).returning();
    await db.update(m.outreachContacts).set({ publishedVersionId: contactVersion!.id }).where(eq(m.outreachContacts.id, contact!.id));
    const [comment] = await db.insert(m.comments).values({ tenantId, dimensionId: dim, authorId: viewer!.id, body: 'draft note' }).returning();
    await db.insert(m.commentVotes).values({ commentId: comment!.id, userId: owner!.id, vote: 1 });

    const as = (userId: string | null) => <T>(fn: (tx: DbExecutor) => Promise<T>) => m.withAuthContext(db, userId, fn);
    // What one reader sees of the portrait, table by table.
    const seen = async (userId: string | null) => {
      const run = as(userId);
      const count = async (q: (tx: DbExecutor) => Promise<unknown[]>) => (await run(q)).length;
      const doughnut = await run((tx) => m.publishedDoughnut<{ tenant: { name: string }; dimensions: unknown[] }>(tx, p.tenant.slug));
      const staff = await run((tx) =>
        tx.execute<{ id: string }>(sql`select id from public_staff_ids(${tenantId}::uuid, ${`{${viewer!.id}}`}::uuid[])`),
      );
      return {
        tenant: await count((tx) => tx.select({ id: m.tenants.id }).from(m.tenants).where(eq(m.tenants.id, tenantId))),
        organization: await count((tx) => tx.select({ id: m.organizations.id }).from(m.organizations).where(eq(m.organizations.id, orgId))),
        config: await count((tx) => tx.select({ key: m.tenantConfig.key }).from(m.tenantConfig).where(eq(m.tenantConfig.tenantId, tenantId))),
        dimensions: await count((tx) => tx.select({ id: m.dimensions.id }).from(m.dimensions).where(eq(m.dimensions.tenantId, tenantId))),
        hazards: await count((tx) => tx.select({ id: m.hazards.id }).from(m.hazards).where(eq(m.hazards.tenantId, tenantId))),
        listings: await count((tx) => tx.select({ id: m.involvementListings.id }).from(m.involvementListings).where(eq(m.involvementListings.tenantId, tenantId))),
        alerts: await count((tx) => tx.select({ id: m.emergencyAlerts.id }).from(m.emergencyAlerts).where(eq(m.emergencyAlerts.tenantId, tenantId))),
        contacts: await count((tx) => tx.select({ id: m.outreachContacts.id }).from(m.outreachContacts).where(eq(m.outreachContacts.tenantId, tenantId))),
        contactVersions: await count((tx) => tx.select({ id: m.outreachContactVersions.id }).from(m.outreachContactVersions).where(eq(m.outreachContactVersions.contactId, contact!.id))),
        comments: await count((tx) => tx.select({ id: m.comments.id }).from(m.comments).where(eq(m.comments.tenantId, tenantId))),
        votes: await count((tx) => tx.select({ id: m.commentVotes.commentId }).from(m.commentVotes).where(eq(m.commentVotes.commentId, comment!.id))),
        doughnutDimensions: doughnut ? doughnut.dimensions.length : null,
        staff: staff.length,
      };
    };

    // Before the first publish: anonymous visitors and signed-in strangers see nothing at all.
    const nothing = {
      tenant: 0, organization: 0, config: 0, dimensions: 0, hazards: 0, listings: 0, alerts: 0, contacts: 0,
      contactVersions: 0, comments: 0, votes: 0, doughnutDimensions: null, staff: 0,
    };
    expect(await seen(null)).toEqual(nothing);
    expect(await seen(stranger!.id)).toEqual(nothing);
    // Members see their portrait (published_doughnut answers with no dimensions yet) and its drafts.
    const member = await seen(viewer!.id);
    expect(member).toMatchObject({ tenant: 1, organization: 1, dimensions: 21, hazards: 1, listings: 1, alerts: 1, comments: 1, votes: 1, doughnutDimensions: 0, staff: 1 });
    expect(member.config).toBeGreaterThan(0);
    expect(await as(viewer!.id)((tx) => m.publishedDoughnut<{ tenant: { name: string } }>(tx, p.tenant.slug))).toMatchObject({ tenant: { name: 'Private Town' } });
    // The organization's billing contact sees that the portrait exists, and nothing in it.
    expect(await seen(billing!.id)).toEqual({ ...nothing, tenant: 1, organization: 1, doughnutDimensions: 0 });
    // Nobody outside writes into it either.
    await expect(
      as(stranger!.id)((tx) => tx.insert(m.comments).values({ tenantId, dimensionId: dim, authorId: stranger!.id, body: 'hi' })),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(null)((tx) => tx.insert(m.translationRequests).values({ tenantId, locale: 'es', path: `/${p.tenant.slug}`, ipHash: 'h' })),
    ).rejects.toThrow(/row-level security/);
    // Its own owner cannot make it public (or, later, private) by hand.
    await expect(
      as(owner!.id)((tx) => tx.update(m.tenants).set({ firstPublishedAt: new Date() }).where(eq(m.tenants.id, tenantId))),
    ).rejects.toThrow(/set by the database/);
    // …but may still edit the rest of its row.
    await as(owner!.id)((tx) => tx.update(m.tenants).set({ description: 'Our town' }).where(eq(m.tenants.id, tenantId)));

    // The first publish, by the owner through the app role as lib/publish.ts does: the trigger records it.
    const draft = (await m.latestVersion(db, dim))!;
    const publishedAt = new Date(Date.UTC(2026, 0, 2));
    await as(owner!.id)(async (tx) => {
      const v = await m.appendDimensionVersion(tx, { dimensionId: dim, status: 'draft', data: draft.data, origin: 'human', changeNote: 'first publish' });
      await tx.update(m.dimensionVersions).set({ status: 'published', publishedAt }).where(eq(m.dimensionVersions.id, v.id));
      await tx.update(m.dimensions).set({ publishedVersionId: v.id }).where(eq(m.dimensions.id, dim));
    });
    const firstPublishedAt = async () =>
      (await db.select({ at: m.tenants.firstPublishedAt }).from(m.tenants).where(eq(m.tenants.id, tenantId)))[0]!.at;
    expect(await firstPublishedAt()).toEqual(publishedAt);

    // Now everyone sees the public record: the published dimension, published
    // content, methodology config — and still no drafts.
    const published = { tenant: 1, organization: 1, dimensions: 1, hazards: 1, listings: 1, alerts: 1, contacts: 1, contactVersions: 1, comments: 1, votes: 1, doughnutDimensions: 1, staff: 1 };
    expect(await seen(null)).toMatchObject(published);
    expect(await seen(stranger!.id)).toMatchObject(published);
    const anonConfig = await as(null)((tx) => tx.select({ key: m.tenantConfig.key }).from(m.tenantConfig).where(eq(m.tenantConfig.tenantId, tenantId)));
    expect(anonConfig.map((r) => r.key)).toContain('region');
    expect(anonConfig.map((r) => r.key)).not.toContain('review_policy');
    const anonVersions = await as(null)((tx) =>
      tx.select({ id: m.dimensionVersions.id }).from(m.dimensionVersions).where(inArray(m.dimensionVersions.dimensionId, p.dimensions.map((d) => d.dimensionId))),
    );
    expect(anonVersions).toHaveLength(1);

    // A later publish (here from a script, in the system context) never moves the date…
    await publishFirstDimension(db, p.dimensions[1]!.dimensionId);
    expect(await firstPublishedAt()).toEqual(publishedAt);
    // …and the owner cannot clear it: un-publishing a portrait is archiving it.
    await expect(
      as(owner!.id)((tx) => tx.update(m.tenants).set({ firstPublishedAt: null }).where(eq(m.tenants.id, tenantId))),
    ).rejects.toThrow(/set by the database/);

    // Archived, the portrait and everything in it leave the public plane together.
    await db.update(m.tenants).set({ archivedAt: new Date() }).where(eq(m.tenants.id, tenantId));
    expect(await seen(null)).toEqual(nothing);

    // Every portrait that has published anything is public (the backfill, then the trigger, keep this true).
    const [unrecorded] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenants t
       where t.first_published_at is null
         and exists (select 1 from dimensions d join dimension_versions v on v.dimension_id = d.id
                      where d.tenant_id = t.id and v.published_at is not null)`);
    expect(unrecorded!.n).toBe(0);

    await db.update(m.dimensions).set({ publishedVersionId: null }).where(eq(m.dimensions.tenantId, tenantId));
    await db.delete(m.tenants).where(eq(m.tenants.id, tenantId));
    await db.delete(m.organizations).where(eq(m.organizations.id, orgId));
    await db.delete(m.users).where(inArray(m.users.id, [owner!.id, viewer!.id, billing!.id, stranger!.id]));
  });
});
