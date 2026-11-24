import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RAG_REFUSAL_ANSWER, type RetrievedChunk } from '@deep-fryer/core';
import { askPortraitLimiter } from '@/lib/ask-rate-limit';
import { RagServiceUnavailableError } from '@/lib/rag-answer';

let featureOn = true;
let dbConfigured = true;
let authState = {
  userId: null as string | null,
  email: null as string | null,
  name: null as string | null,
  displayName: null as string | null,
  isStaff: false,
  devMode: false,
};
let tenantRow: { id: string; slug: string; name: string; region: string | null } | null = {
  id: 'tenant-1',
  slug: 'ithaca',
  name: 'City of Ithaca',
  region: 'NY, USA',
};
let memberRole: 'owner' | 'editor' | 'viewer' | 'moderator' | null = null;
let retrievedChunks: RetrievedChunk[] = [];
const retrieveMock = vi.fn(async (_db: unknown, _input: unknown) => retrievedChunks);
const generateMock = vi.fn(async (_input: { system: string; user: string }) => 'Rent burden was 46.2% in 2024 [1][99].');

vi.mock('@/lib/features', () => ({
  portraitFeatures: vi.fn(async () => ({ ask_portrait: featureOn })),
}));
vi.mock('@/lib/env', () => ({
  hasDatabase: vi.fn(() => dbConfigured),
}));
vi.mock('@/lib/auth', () => ({
  getAuth: vi.fn(async () => authState),
  getRole: vi.fn(async () => memberRole),
}));
vi.mock('@/lib/db', () => ({
  userDb: vi.fn(async <T>(fn: (db: unknown) => Promise<T>) => fn({})),
}));
vi.mock('@deep-fryer/db', () => ({
  tenantBySlug: vi.fn(async () => tenantRow),
  retrievePortraitChunks: (db: unknown, input: unknown) => retrieveMock(db, input),
}));
vi.mock('@/lib/rag-answer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rag-answer')>('@/lib/rag-answer');
  return {
    ...actual,
    generateGroundedAnswer: (input: { system: string; user: string }) => generateMock(input),
  };
});

const sampleChunk: RetrievedChunk = {
  id: 'chunk-1',
  visibility: 'public',
  sourceKind: 'indicator',
  sourceRef: 'dim:housing:ind:rent-burden',
  dimensionSlug: 'housing',
  title: 'Housing: Rent-burdened households',
  citationLabel: 'Housing: Rent-burdened households (US Census ACS, 2024)',
  citationUrl: 'https://data.census.gov/table/ACSDP5Y2024',
  content: 'Measured value: 46.2% of renter households in 2024 (target 20%).',
  contentHash: 'hash-1',
  score: 2.5,
};

function makeRequest(body: unknown, ip = '203.0.113.10') {
  return new Request('http://localhost/api/portraits/ithaca/ask', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const params = (tenant = 'ithaca') => ({ params: Promise.resolve({ tenant }) });

describe('POST /api/portraits/[tenant]/ask', () => {
  beforeEach(() => {
    featureOn = true;
    dbConfigured = true;
    authState = { userId: null, email: null, name: null, displayName: null, isStaff: false, devMode: false };
    tenantRow = { id: 'tenant-1', slug: 'ithaca', name: 'City of Ithaca', region: 'NY, USA' };
    memberRole = null;
    retrievedChunks = [sampleChunk];
    askPortraitLimiter.clear();
    retrieveMock.mockClear();
    generateMock.mockClear();
    generateMock.mockResolvedValue('Rent burden was 46.2% in 2024 [1][99].');
  });

  it('returns 404 when ask_portrait feature is off', async () => {
    featureOn = false;
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ question: 'What is the rent burden?' }), params());
    expect(res.status).toBe(404);
    expect(retrieveMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('returns 404 for malformed tenant slugs or invisible private portraits', async () => {
    const { POST } = await import('./route');
    expect((await POST(makeRequest({ question: 'What is rent burden?' }), params('BAD SLUG'))).status).toBe(404);

    tenantRow = null;
    expect((await POST(makeRequest({ question: 'What is rent burden?' }), params('private-town'))).status).toBe(404);
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it('validates JSON and question length bounds', async () => {
    const { POST } = await import('./route');
    expect((await POST(makeRequest('not-json{'), params())).status).toBe(400);
    expect((await POST(makeRequest({ question: 'hi' }), params())).status).toBe(400);
    expect((await POST(makeRequest({ question: 'x'.repeat(501) }), params())).status).toBe(400);
  });

  it('refuses includeDrafts for unauthenticated visitors (401) and non-members (403)', async () => {
    const { POST } = await import('./route');

    // Anonymous caller
    const anonRes = await POST(makeRequest({ question: 'What do draft notes say?', includeDrafts: true }), params());
    expect(anonRes.status).toBe(401);
    expect(retrieveMock).not.toHaveBeenCalled();

    // Signed-in stranger (not a member of this portrait)
    authState = { ...authState, userId: 'stranger-1' };
    memberRole = null;
    const strangerRes = await POST(
      makeRequest({ question: 'What do draft notes say?', includeDrafts: true }),
      params(),
    );
    expect(strangerRes.status).toBe(403);
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it('allows includeDrafts for authenticated portrait members and passes includeMember: true', async () => {
    const { POST } = await import('./route');
    authState = { ...authState, userId: 'member-1' };
    memberRole = 'editor';

    const res = await POST(makeRequest({ question: 'What do draft notes say?', includeDrafts: true }), params());
    expect(res.status).toBe(200);
    expect(retrieveMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1', includeMember: true }),
    );
    const body = await res.json();
    expect(body.scope).toBe('member');
    expect(body.grounded).toBe(true);
  });

  it('refuses cleanly without calling Anthropic when retrieval returns no chunks', async () => {
    const { POST } = await import('./route');
    retrievedChunks = [];

    const res = await POST(makeRequest({ question: 'What is the moon population?' }), params());
    expect(res.status).toBe(200);
    expect(generateMock).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      answer: RAG_REFUSAL_ANSWER,
      citations: [],
      scope: 'public',
      grounded: false,
    });
  });

  it('returns grounded answer with verified citations and strips fabricated indices', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ question: 'What is the rent burden in Ithaca?' }), params());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(retrieveMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1', includeMember: false }),
    );
    const body = await res.json();
    expect(body.answer).toBe('Rent burden was 46.2% in 2024 [1].');
    expect(body.answer).not.toContain('[99]');
    expect(body.grounded).toBe(true);
    expect(body.scope).toBe('public');
    expect(body.citations).toEqual([
      {
        index: 1,
        chunkId: 'chunk-1',
        title: 'Housing: Rent-burdened households',
        citationLabel: 'Housing: Rent-burdened households (US Census ACS, 2024)',
        citationUrl: 'https://data.census.gov/table/ACSDP5Y2024',
        sourceKind: 'indicator',
        dimensionSlug: 'housing',
        visibility: 'public',
      },
    ]);
  });

  it('returns 503 gracefully when the Anthropic service is unconfigured or unavailable', async () => {
    const { POST } = await import('./route');
    generateMock.mockRejectedValueOnce(
      new RagServiceUnavailableError('Ask this portrait is not configured on this server yet.', 503),
    );
    const res = await POST(makeRequest({ question: 'What is the rent burden?' }), params());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('not configured');
    expect(body.error).not.toContain('ANTHROPIC_API_KEY');
  });

  it('enforces per-IP rate limiting with 429 and Retry-After', async () => {
    const { POST } = await import('./route');
    retrievedChunks = [];
    for (let i = 0; i < 20; i++) {
      const ok = await POST(makeRequest({ question: `Question number ${i}` }, '198.51.100.7'), params());
      expect(ok.status).toBe(200);
    }
    const blocked = await POST(makeRequest({ question: 'One too many' }, '198.51.100.7'), params());
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
