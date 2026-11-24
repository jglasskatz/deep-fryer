import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  RAG_MAX_QUESTION_CHARS,
  RAG_MIN_QUESTION_CHARS,
  RAG_REFUSAL_ANSWER,
  SLUG_RE,
  buildRagPrompt,
  chunkDimensionVersion,
  extractVerifiedCitations,
  rankChunksLexically,
  type KnowledgeVisibility,
  type RetrievedChunk,
} from '@deep-fryer/core';
import { retrievePortraitChunks, tenantBySlug } from '@deep-fryer/db';
import { askPortraitLimiter } from '@/lib/ask-rate-limit';
import { getAuth, getRole } from '@/lib/auth';
import { clientAddress } from '@/lib/client-address';
import { userDb } from '@/lib/db';
import { hasDatabase } from '@/lib/env';
import { portraitFeatures } from '@/lib/features';
import { mockPortrait } from '@/lib/mock-data';
import { RagServiceUnavailableError, generateGroundedAnswer } from '@/lib/rag-answer';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

const requestSchema = z.object({
  question: z
    .string()
    .trim()
    .min(RAG_MIN_QUESTION_CHARS, `Ask a question of at least ${RAG_MIN_QUESTION_CHARS} characters.`)
    .max(RAG_MAX_QUESTION_CHARS, `Questions may be at most ${RAG_MAX_QUESTION_CHARS} characters.`),
  includeDrafts: z.boolean().optional().default(false),
  dimensionSlug: z.string().regex(SLUG_RE).optional(),
});

/**
 * POST /api/portraits/[tenant]/ask
 *
 * Evidence-grounded Q&A over a portrait's indexed `knowledge_chunks`:
 * - Feature-flagged behind `ask_portrait` (404 when off or disabled via
 *   DF_DISABLED_FEATURES).
 * - Strictly RLS-safe: reads run through `userDb` (deep_fryer_app + app.user_id),
 *   never exposing unpublished portraits or member-only chunks to anonymous
 *   visitors or non-members. `includeDrafts` is accepted ONLY for authenticated
 *   members of that portrait.
 * - Refuses cleanly without calling the model when retrieval finds no chunks.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant: tenantSlug } = await params;
  if (!SLUG_RE.test(tenantSlug)) {
    return NextResponse.json({ error: 'unknown portrait' }, { status: 404, headers: NO_STORE });
  }

  // Feature guard: off means gone (404).
  const features = await portraitFeatures(tenantSlug);
  if (!features.ask_portrait) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400, headers: NO_STORE });
  }

  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message ?? 'Invalid question.';
    return NextResponse.json({ error: issue }, { status: 400, headers: NO_STORE });
  }

  const { question, includeDrafts, dimensionSlug } = parsed.data;
  const auth = await getAuth();

  // Bounded per-session / per-IP sliding-window rate limit.
  const rateKey = auth.userId ? `user:${auth.userId}` : `ip:${clientAddress(request.headers)}`;
  const limit = askPortraitLimiter.check(rateKey);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many questions in a short period. Please wait a moment and try again.' },
      {
        status: 429,
        headers: { ...NO_STORE, 'retry-after': String(limit.retryAfterSec) },
      },
    );
  }

  let portraitName: string;
  let portraitRegion: string | null = null;
  let scope: KnowledgeVisibility = 'public';
  let chunks: RetrievedChunk[] = [];

  if (!hasDatabase()) {
    if (tenantSlug !== mockPortrait.tenant.slug) {
      return NextResponse.json({ error: 'unknown portrait' }, { status: 404, headers: NO_STORE });
    }
    if (includeDrafts && !auth.devMode) {
      return NextResponse.json(
        { error: 'Sign in as a portrait member to include draft and internal sources.' },
        { status: 401, headers: NO_STORE },
      );
    }
    portraitName = mockPortrait.tenant.name;
    portraitRegion = mockPortrait.tenant.region;
    scope = includeDrafts && auth.devMode ? 'member' : 'public';
    const drafts = mockPortrait.dimensions.flatMap((dim) =>
      chunkDimensionVersion({
        tenantSlug,
        dimensionSlug: dim.slug,
        ring: dim.ring,
        versionNum: dim.version_num,
        data: dim.data,
        visibility: 'public',
      }),
    );
    chunks = rankChunksLexically(question, drafts, { dimensionSlug });
  } else {
    // 1. Resolve portrait under the caller's RLS context (unpublished portraits are 404 to non-members).
    const tenantRow = await userDb((db) => tenantBySlug(db, tenantSlug));
    if (!tenantRow) {
      return NextResponse.json({ error: 'unknown portrait' }, { status: 404, headers: NO_STORE });
    }

    // 2. Role check runs OUTSIDE userDb (single-connection pool rule, lib/db.ts).
    if (includeDrafts) {
      if (!auth.userId && !auth.devMode) {
        return NextResponse.json(
          { error: 'Sign in as a portrait member to include draft and internal sources.' },
          { status: 401, headers: NO_STORE },
        );
      }
      const role = await getRole(tenantRow.id);
      if (!role) {
        return NextResponse.json(
          { error: 'Only portrait members can include draft and internal sources.' },
          { status: 403, headers: NO_STORE },
        );
      }
      scope = 'member';
    } else {
      scope = 'public';
    }

    portraitName = tenantRow.name;
    portraitRegion = tenantRow.region;

    // 3. Retrieve chunks through userDb (deep_fryer_app + RLS enforced independently).
    chunks = await userDb((db) =>
      retrievePortraitChunks(db, {
        tenantId: tenantRow.id,
        question,
        includeMember: scope === 'member',
        dimensionSlug,
      }),
    );
  }

  // Empty retrieval: refuse cleanly without invoking the model or inventing facts.
  if (chunks.length === 0) {
    return NextResponse.json(
      {
        answer: RAG_REFUSAL_ANSWER,
        citations: [],
        scope,
        grounded: false,
      },
      { status: 200, headers: NO_STORE },
    );
  }

  const prompt = buildRagPrompt({
    portraitName,
    region: portraitRegion,
    question,
    chunks,
    scope,
  });

  try {
    const rawAnswer = await generateGroundedAnswer({
      system: prompt.system,
      user: prompt.user,
    });
    const verified = extractVerifiedCitations(rawAnswer, prompt.numberedChunks);
    return NextResponse.json(
      {
        answer: verified.cleanedAnswer,
        citations: verified.citations,
        scope,
        grounded: verified.grounded,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    if (err instanceof RagServiceUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: err.status, headers: NO_STORE });
    }
    return NextResponse.json(
      { error: 'Could not answer that question right now.' },
      { status: 500, headers: NO_STORE },
    );
  }
}
