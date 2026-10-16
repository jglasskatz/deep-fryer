import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobHelpers } from 'graphile-worker';
import { encryptSecret, keyHint, parseSecretsKey } from '@deep-fryer/core/secrets';

/**
 * policyAnalyze and the organization's own key (SPEC-v7 §4), against
 * Postgres with the session mocked. The key follows the funding the research
 * gate stored on the analysis (migration 0012), not whatever is on file when
 * the job runs: a key-funded analysis runs on the organization's key; one
 * whose key was removed, or cannot be decrypted, fails with a reason staff
 * can read on its page — the session never starts on the deployment's key
 * instead; and a plan-funded analysis runs on the deployment's key even with
 * a key on file now.
 */
const session = vi.hoisted(() => ({ inputs: [] as { apiKey?: string }[] }));
vi.mock('../session.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session.js')>()),
  runSessionWithRetry: vi.fn(async (input: { apiKey?: string }) => {
    session.inputs.push(input);
    return {
      resultText: JSON.stringify({ summary: 'No measurable effect.', impacts: [], assumptions: [], risks: [] }),
      succeeded: true,
      transcript: Buffer.from('transcript'),
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  }),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const randomSecretsKey = () => btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(32))));
const API_KEY = `sk-ant-api03-${'Pq7'.repeat(30)}-Vw3X`;
const helpers = {
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
} as unknown as JobHelpers;

describe.skipIf(!hasDb)('policyAnalyze with an organization key (Postgres, mocked session)', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  const savedSecretsKey = process.env.DF_SECRETS_KEY;
  beforeEach(() => {
    session.inputs.length = 0;
  });
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
    if (savedSecretsKey === undefined) delete process.env.DF_SECRETS_KEY;
    else process.env.DF_SECRETS_KEY = savedSecretsKey;
  });

  /**
   * A portrait with policy analysis on and a queued analysis created with
   * `funding`; the organization's key, encrypted under `secretsKey`, is on
   * file unless `withKey` is false (it was removed after the analysis was queued).
   */
  async function seed(secretsKey: string, funding: 'plan' | 'organization_key', { withKey = true } = {}) {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Key County' });
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    });
    await db
      .update(m.tenantConfig)
      .set({ value: { policy_analysis: true } })
      .where(and(eq(m.tenantConfig.tenantId, tenant.id), eq(m.tenantConfig.key, 'features')));
    if (withKey) {
      await m.upsertOrganizationApiKey(db, {
        organizationId: tenant.organizationId,
        ciphertext: await encryptSecret(API_KEY, parseSecretsKey(secretsKey), tenant.organizationId),
        keyHint: keyHint(API_KEY),
        createdBy: null,
        validatedAt: new Date(),
      });
    }
    const [analysis] = await db
      .insert(m.policyAnalyses)
      // `funding` as apps/web createPolicyAnalysis stores the gate's decision.
      .values({ tenantId: tenant.id, title: 'Cooling centers', brief: 'Open a cooling center in every district.', funding })
      .returning({ id: m.policyAnalyses.id });
    const settled = async () => {
      const [row] = await db.select().from(m.policyAnalyses).where(eq(m.policyAnalyses.id, analysis!.id));
      return row!;
    };
    return { analysisId: analysis!.id, settled };
  }

  it('runs a key-funded analysis on the organization key', async () => {
    const secretsKey = randomSecretsKey();
    process.env.DF_SECRETS_KEY = secretsKey;
    const { analysisId, settled } = await seed(secretsKey, 'organization_key');
    const { policyAnalyze } = await import('./policy-analyze.js');
    await policyAnalyze({ analysisId }, helpers);

    expect(session.inputs).toHaveLength(1);
    expect(session.inputs[0]!.apiKey).toBe(API_KEY);
    expect((await settled()).status).toBe('complete');
  });

  it('fails with a staff-readable reason, and runs nothing, when DF_SECRETS_KEY was rotated', async () => {
    const { analysisId, settled } = await seed(randomSecretsKey(), 'organization_key');
    process.env.DF_SECRETS_KEY = randomSecretsKey();
    const { policyAnalyze } = await import('./policy-analyze.js');
    const { ORG_KEY_UNREADABLE } = await import('../org-key.js');
    await policyAnalyze({ analysisId }, helpers);

    expect(session.inputs).toEqual([]);
    const row = await settled();
    expect(row.status).toBe('failed');
    // Shown verbatim on the analysis page and in the requester's email.
    expect(row.error).toBe(ORG_KEY_UNREADABLE);
  });
  it('fails a key-funded analysis whose key was removed after it was queued, never using the deployment key', async () => {
    process.env.DF_SECRETS_KEY = randomSecretsKey();
    const { analysisId, settled } = await seed(randomSecretsKey(), 'organization_key', { withKey: false });
    const { policyAnalyze } = await import('./policy-analyze.js');
    const { ORG_KEY_REMOVED } = await import('../org-key.js');
    await policyAnalyze({ analysisId }, helpers);

    // The mocked runner was never called, so no session environment was
    // built — on the deployment's key or any other.
    expect(session.inputs).toEqual([]);
    const row = await settled();
    expect(row.status).toBe('failed');
    // Within the 400 characters the row keeps, so staff read all of it.
    expect(row.error).toBe(ORG_KEY_REMOVED);
  });

  it('runs a plan-funded analysis on the deployment key, even with a key on file now', async () => {
    // A readable key is on file, but the analysis was counted against the
    // plan when it was queued, so it must not also spend the key.
    const secretsKey = randomSecretsKey();
    process.env.DF_SECRETS_KEY = secretsKey;
    const { analysisId, settled } = await seed(secretsKey, 'plan');
    const { policyAnalyze } = await import('./policy-analyze.js');
    await policyAnalyze({ analysisId }, helpers);

    expect(session.inputs).toHaveLength(1);
    expect(session.inputs[0]!.apiKey).toBeUndefined();
    expect((await settled()).status).toBe('complete');
  });
});
