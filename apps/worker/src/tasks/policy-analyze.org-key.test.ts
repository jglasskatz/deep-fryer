import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobHelpers } from 'graphile-worker';
import { encryptSecret, keyHint, parseSecretsKey } from '@deep-fryer/core/secrets';

/**
 * policyAnalyze and the organization's own key (SPEC-v7 §4), against
 * Postgres with the session mocked: the analysis session runs on the
 * organization's key when one is on file, and a key that cannot be
 * decrypted fails the analysis with a reason staff can read on its page —
 * the session never starts on the deployment's key instead.
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

  /** A portrait with policy analysis on, a key encrypted under `secretsKey`, and a queued analysis. */
  async function seed(secretsKey: string) {
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
    await m.upsertOrganizationApiKey(db, {
      organizationId: tenant.organizationId,
      ciphertext: await encryptSecret(API_KEY, parseSecretsKey(secretsKey), tenant.organizationId),
      keyHint: keyHint(API_KEY),
      createdBy: null,
      validatedAt: new Date(),
    });
    const [analysis] = await db
      .insert(m.policyAnalyses)
      .values({ tenantId: tenant.id, title: 'Cooling centers', brief: 'Open a cooling center in every district.' })
      .returning({ id: m.policyAnalyses.id });
    const settled = async () => {
      const [row] = await db.select().from(m.policyAnalyses).where(eq(m.policyAnalyses.id, analysis!.id));
      return row!;
    };
    return { analysisId: analysis!.id, settled };
  }

  it('runs the session on the organization key', async () => {
    const secretsKey = randomSecretsKey();
    process.env.DF_SECRETS_KEY = secretsKey;
    const { analysisId, settled } = await seed(secretsKey);
    const { policyAnalyze } = await import('./policy-analyze.js');
    await policyAnalyze({ analysisId }, helpers);

    expect(session.inputs).toHaveLength(1);
    expect(session.inputs[0]!.apiKey).toBe(API_KEY);
    expect((await settled()).status).toBe('complete');
  });

  it('fails with a staff-readable reason, and runs nothing, when DF_SECRETS_KEY was rotated', async () => {
    const { analysisId, settled } = await seed(randomSecretsKey());
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
});
