import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobHelpers } from 'graphile-worker';
import { getTableColumns } from 'drizzle-orm';
import { researchRuns } from '@deep-fryer/db';
import { researchApply } from './research-apply.js';
import { policyAnalyze } from './policy-analyze.js';

/**
 * What the worker writes to its log when a research run or a policy analysis
 * fails on a database query. No Postgres here: the tasks run against the
 * ORM's real query path on a driver that answers the claim queries and then
 * fails, as Postgres or the network would, the one query that binds a
 * resident's address. The failure line must say what the database said and
 * never carry the query's SQL or that address.
 */
const db = vi.hoisted(() => ({
  resident: 'resident@example.org',
  failure: null as Error | null,
  /** Rows for a statement that returns some, by its leading words. */
  rows: [] as { startsWith: string; row: unknown[] }[],
}));

vi.mock('@deep-fryer/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deep-fryer/db')>();
  const { drizzle } = await import('drizzle-orm/pg-proxy');
  const proxy = drizzle(async (sql, params) => {
    if (params.includes(db.resident)) throw db.failure;
    const answer = db.rows.find((r) => sql.startsWith(r.startsWith));
    return { rows: answer ? [answer.row] : [] };
  });
  return { ...actual, getDb: () => proxy };
});

// Choosing the run's key is the first step inside each task's try: here it
// looks up a resident by address, the query the driver fails.
vi.mock('../org-key.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../org-key.js')>();
  const { eq } = await import('drizzle-orm');
  const { users } = await import('@deep-fryer/db');
  return {
    ...actual,
    sessionApiKey: vi.fn(async (executor: import('@deep-fryer/db').DbExecutor) => {
      await executor.select({ id: users.id }).from(users).where(eq(users.email, db.resident));
      return null;
    }),
  };
});
vi.mock('../features.js', () => ({ portraitFeatures: vi.fn(async () => ({ policy_analysis: true })) }));
vi.mock('../notify.js', () => ({ notifyRunFinished: vi.fn(async () => {}), send: vi.fn(async () => {}) }));
vi.mock('../storage.js', () => ({ tenantStorage: vi.fn(async () => ({})) }));

const RUN_ID = '00000000-0000-4000-8000-000000000001';
const ANALYSIS_ID = '00000000-0000-4000-8000-000000000002';
const TENANT_ID = '00000000-0000-4000-8000-000000000003';

const helpers = {
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
} as unknown as JobHelpers;

function seedClaims() {
  // The claimed run, in the column order the ORM reads a returned row.
  const run: Record<string, unknown> = {
    id: RUN_ID,
    tenantId: TENANT_ID,
    status: 'running',
    plan: { sessions: [] },
    configSnapshot: {},
    funding: 'plan',
  };
  db.rows = [
    { startsWith: 'update "research_runs" set "status"', row: Object.keys(getTableColumns(researchRuns)).map((k) => run[k] ?? null) },
    // policy-analyze's claim returns id, tenant, title, brief, source URL and funding.
    { startsWith: 'update "policy_analyses" set "status"', row: [ANALYSIS_ID, TENANT_ID, 'Policy', 'Brief', null, 'plan'] },
  ];
}

/** Every line the task logged as an error, as one text. */
function errorLog(): string {
  return vi
    .mocked(helpers.logger.error)
    .mock.calls.map((args) => args.join(' '))
    .join('\n');
}

const failures = {
  'a Postgres error': {
    error: () => Object.assign(new Error('permission denied for table users'), { name: 'PostgresError', code: '42501', severity: 'ERROR' }),
    logged: 'permission denied for table users (42501)',
  },
  'a refused connection': {
    error: () => Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED', syscall: 'connect' }),
    logged: 'connect ECONNREFUSED 10.0.0.5:5432',
  },
};

describe.each(Object.entries(failures))('a task failing on %s', (_name, { error, logged }) => {
  beforeEach(() => {
    vi.mocked(helpers.logger.error).mockClear();
    db.failure = error();
    seedClaims();
  });

  function expectSafe(text: string, prefix: string) {
    expect(text).toContain(`${prefix} failed: ${logged}`);
    expect(text).not.toContain(db.resident);
    expect(text.toLowerCase()).not.toContain('select');
    expect(text).not.toContain('Failed query');
  }

  it('logs the research run failure without the SQL or the bound value', async () => {
    await researchApply({ runId: RUN_ID }, helpers);
    expectSafe(errorLog(), `run ${RUN_ID}`);
  });

  it('logs the policy analysis failure without the SQL or the bound value', async () => {
    await policyAnalyze({ analysisId: ANALYSIS_ID }, helpers);
    expectSafe(errorLog(), `policy analysis ${ANALYSIS_ID}`);
  });
});
