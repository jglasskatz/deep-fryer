import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import type { JobHelpers } from 'graphile-worker';
import { encryptSecret, keyHint, parseSecretsKey } from '@deep-fryer/core/secrets';

/**
 * researchApply and the organization's own key (SPEC-v7 §4), against
 * Postgres with the model sessions mocked. The key follows the funding the
 * research gate stored on the run (migration 0012), not whatever is on file
 * when the job runs: every session of a key-funded run uses the
 * organization's key; a key-funded run whose key was removed, or cannot be
 * decrypted, fails with the reason recorded — no session starts on the
 * deployment's key instead; and a plan-funded run runs on the deployment's
 * key even with a key on file now.
 */
const sessions = vi.hoisted(() => ({ inputs: [] as { prompt: string; apiKey?: string }[] }));
vi.mock('../session.js', async (importOriginal) => {
  const ok = async (input: { prompt: string; apiKey?: string }) => {
    sessions.inputs.push(input);
    return { resultText: '[]', succeeded: true, transcript: Buffer.from('t'), usage: { input_tokens: 1, output_tokens: 1 } };
  };
  return { ...(await importOriginal<typeof import('../session.js')>()), runSessionWithRetry: vi.fn(ok), runSession: vi.fn(ok) };
});
// No evidence store or email in this test: storage is never written (the
// mocked sessions capture nothing) and the run-finished email is not under test.
vi.mock('../storage.js', () => ({ tenantStorage: vi.fn(async () => ({})) }));
vi.mock('../notify.js', () => ({ notifyRunFinished: vi.fn(async () => {}) }));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const randomSecretsKey = () => btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(32))));
const API_KEY = `sk-ant-api03-${'Kp4'.repeat(30)}-Lm2N`;
const helpers = {
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
} as unknown as JobHelpers;

describe.skipIf(!hasDb)('researchApply with an organization key (Postgres, mocked sessions)', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  const savedSecretsKey = process.env.DF_SECRETS_KEY;
  beforeEach(() => {
    sessions.inputs.length = 0;
  });
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
    if (savedSecretsKey === undefined) delete process.env.DF_SECRETS_KEY;
    else process.env.DF_SECRETS_KEY = savedSecretsKey;
  });

  /**
   * A portrait and a planned two-session run applied with `funding`; the
   * organization's key, encrypted under `secretsKey`, is on file unless
   * `withKey` is false (it was removed after the run was queued).
   */
  async function seed(secretsKey: string, funding: 'plan' | 'organization_key', { withKey = true } = {}) {
    const m = await import('@deep-fryer/db');
    const { defaultPortraitConfig } = await import('@deep-fryer/contract');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Key City' });
    cleanup.push(async () => {
      // Runs (and their sessions, which reference dimensions) go before the tenant.
      await db.delete(m.researchRuns).where(eq(m.researchRuns.tenantId, tenant.id));
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    });
    if (withKey) {
      await m.upsertOrganizationApiKey(db, {
        organizationId: tenant.organizationId,
        ciphertext: await encryptSecret(API_KEY, parseSecretsKey(secretsKey), tenant.organizationId),
        keyHint: keyHint(API_KEY),
        createdBy: null,
        validatedAt: new Date(),
      });
    }
    const spec = { output_schema_ref: 'finding', config_hash: 'h', tool_allowlist: ['WebSearch'] };
    const [run] = await db
      .insert(m.researchRuns)
      .values({
        tenantId: tenant.id,
        status: 'planned',
        plan: {
          sessions: [
            { kind: 'region_context', prompt: 'Describe the region.', ...spec },
            { kind: 'dimension', dimension_slug: 'housing', prompt: 'Research housing.', ...spec },
          ],
          config_hash: 'h',
          plugin_version: 'test',
        },
        configSnapshot: defaultPortraitConfig('Key City', 'The Key City municipal boundary'),
        appliedAt: new Date(),
        // As apps/web applyRun stamps it from the gate's decision.
        funding,
      })
      .returning();
    return { db, m, eq, run: run! };
  }

  it('runs every session of a key-funded run on the organization key', async () => {
    const secretsKey = randomSecretsKey();
    process.env.DF_SECRETS_KEY = secretsKey;
    const { db, m, eq, run } = await seed(secretsKey, 'organization_key');
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);

    expect(sessions.inputs.map((i) => i.prompt)).toEqual(['Describe the region.', 'Research housing.']);
    expect(sessions.inputs.every((i) => i.apiKey === API_KEY)).toBe(true);
    const [settled] = await db.select().from(m.researchRuns).where(eq(m.researchRuns.id, run.id));
    expect(settled!.status).toBe('complete');
    // Logged by its hint only.
    const logged = JSON.stringify(vi.mocked(helpers.logger.info).mock.calls);
    expect(logged).toContain('(…Lm2N)');
    expect(logged).not.toContain(API_KEY);
  });

  it('fails the run with the reason, without starting a session, when DF_SECRETS_KEY was rotated', async () => {
    const { db, m, eq, run } = await seed(randomSecretsKey(), 'organization_key');
    process.env.DF_SECRETS_KEY = randomSecretsKey();
    const { researchApply } = await import('./research-apply.js');
    const { ORG_KEY_UNREADABLE } = await import('../org-key.js');
    await researchApply({ runId: run.id }, helpers);

    // No session ran at all — in particular not on the deployment's key.
    expect(sessions.inputs).toEqual([]);
    const [settled] = await db.select().from(m.researchRuns).where(eq(m.researchRuns.id, run.id));
    expect(settled!.status).toBe('failed');
    // Each planned session is recorded as failed, its transcript saying why
    // (failed sessions are not counted against the plan).
    const rows = await db.select().from(m.researchSessions).where(eq(m.researchSessions.runId, run.id));
    expect(rows.map((r) => [r.kind, r.status]).sort()).toEqual([
      ['dimension', 'failed'],
      ['region_context', 'failed'],
    ]);
    for (const row of rows) {
      expect(JSON.parse(gunzipSync(row.transcript!).toString())).toEqual({ type: 'session_error', message: ORG_KEY_UNREADABLE });
    }
  });
  it('fails a key-funded run whose key was removed after it was queued, never using the deployment key', async () => {
    process.env.DF_SECRETS_KEY = randomSecretsKey();
    const { db, m, eq, run } = await seed(randomSecretsKey(), 'organization_key', { withKey: false });
    const { researchApply } = await import('./research-apply.js');
    const { ORG_KEY_REMOVED } = await import('../org-key.js');
    await researchApply({ runId: run.id }, helpers);

    // No session ran — the mocked runner was never called, so no session
    // environment was built, on the deployment's key or any other.
    expect(sessions.inputs).toEqual([]);
    const [settled] = await db.select().from(m.researchRuns).where(eq(m.researchRuns.id, run.id));
    expect(settled!.status).toBe('failed');
    const rows = await db.select().from(m.researchSessions).where(eq(m.researchSessions.runId, run.id));
    expect(rows.map((r) => [r.kind, r.status]).sort()).toEqual([
      ['dimension', 'failed'],
      ['region_context', 'failed'],
    ]);
    for (const row of rows) {
      expect(JSON.parse(gunzipSync(row.transcript!).toString())).toEqual({ type: 'session_error', message: ORG_KEY_REMOVED });
    }
  });

  it('runs a plan-funded run on the deployment key, even with a key on file now', async () => {
    // The key on file is readable, but a plan-funded run never looks it up:
    // it was counted against the plan, so it must not also spend the key.
    const secretsKey = randomSecretsKey();
    process.env.DF_SECRETS_KEY = secretsKey;
    const { db, m, eq, run } = await seed(secretsKey, 'plan');
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);

    expect(sessions.inputs.map((i) => i.prompt)).toEqual(['Describe the region.', 'Research housing.']);
    expect(sessions.inputs.every((i) => i.apiKey === undefined)).toBe(true);
    const [settled] = await db.select().from(m.researchRuns).where(eq(m.researchRuns.id, run.id));
    expect(settled!.status).toBe('complete');
  });
});
