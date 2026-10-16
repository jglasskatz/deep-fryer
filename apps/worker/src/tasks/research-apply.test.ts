import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import type { JobHelpers } from 'graphile-worker';
import { encryptSecret, keyHint, parseSecretsKey } from '@deep-fryer/core/secrets';

/**
 * researchApply and the organization's own key (SPEC-v7 §4), against
 * Postgres with the model sessions mocked: every session of a run uses the
 * organization's key when one is on file, and a key that cannot be
 * decrypted fails the run with the reason recorded — no session starts on
 * the deployment's key instead.
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

  /** A portrait with a key encrypted under `secretsKey`, and a planned two-session run. */
  async function seed(secretsKey: string) {
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
    await m.upsertOrganizationApiKey(db, {
      organizationId: tenant.organizationId,
      ciphertext: await encryptSecret(API_KEY, parseSecretsKey(secretsKey), tenant.organizationId),
      keyHint: keyHint(API_KEY),
      createdBy: null,
      validatedAt: new Date(),
    });
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
      })
      .returning();
    return { db, m, eq, run: run! };
  }

  it('runs every session on the organization key', async () => {
    const secretsKey = randomSecretsKey();
    process.env.DF_SECRETS_KEY = secretsKey;
    const { db, m, eq, run } = await seed(secretsKey);
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
    const { db, m, eq, run } = await seed(randomSecretsKey());
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
});
