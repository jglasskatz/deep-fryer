import { describe, expect, it } from 'vitest';

/**
 * Database-enforced access (migration 0005): these run real queries as the
 * deep_fryer_app role through withAuthContext and assert what each kind of
 * person can and cannot see or change — independently of any app code.
 */
type DbExecutor = import('./client.js').DbExecutor;
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

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
  });

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
});
