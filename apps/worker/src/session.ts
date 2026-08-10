import { gzipSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { SessionTokenUsage } from '@deep-fryer/core';
import { DEFAULT_SESSION_MAX_TURNS, DEFAULT_SESSION_MODEL } from '@deep-fryer/research';
import { captureEvidence, type SourceCaptureRecord } from './evidence.js';
import type { TenantStorage } from './storage.js';

export interface SessionResult {
  resultText: string;
  transcript: Buffer;
  usage: SessionTokenUsage;
  succeeded: boolean;
}

/**
 * Transient transport failures ("Connection closed mid-response", overloaded,
 * 5xx) and turn-cap exhaustion kill an entire session. The SDK surfaces some
 * of these as THROWN errors, not unsuccessful results — so the retry must
 * catch throws, and a double failure must return a failed result rather than
 * propagate, or one bad session kills the surrounding 21-session run. Usage
 * from both attempts is summed — the spend was real either way.
 */
export async function runSessionWithRetry(
  input: Parameters<typeof runSession>[0],
): Promise<SessionResult> {
  const attempt = async (): Promise<SessionResult> => {
    try {
      return await runSession(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        resultText: '',
        transcript: gzipSync(JSON.stringify({ type: 'session_error', message })),
        usage: { input_tokens: 0, output_tokens: 0 },
        succeeded: false,
      };
    }
  };
  const first = await attempt();
  if (first.succeeded) return first;
  const second = await attempt();
  return {
    ...second,
    usage: {
      input_tokens: first.usage.input_tokens + second.usage.input_tokens,
      output_tokens: first.usage.output_tokens + second.usage.output_tokens,
      cache_read_tokens:
        (first.usage.cache_read_tokens ?? 0) + (second.usage.cache_read_tokens ?? 0),
      cache_write_tokens:
        (first.usage.cache_write_tokens ?? 0) + (second.usage.cache_write_tokens ?? 0),
    },
  };
}

const MODEL = () => process.env.ANTHROPIC_MODEL ?? DEFAULT_SESSION_MODEL;

/**
 * Orchestrated mode: when RESEARCH_SUBAGENT_MODEL is set (e.g. 'claude-sonnet-5'),
 * researcher sessions get a source-scout subagent on that model and the Task
 * tool to dispatch it. The main session stays the single synthesizer — scouts
 * gather, they never conclude. Verifier sessions are excluded by construction
 * (their allowlist has no WebSearch).
 */
const SCOUT_MODEL = () => process.env.RESEARCH_SUBAGENT_MODEL;

const SCOUT_AGENT = (model: string) => ({
  'source-scout': {
    description:
      'Fast scout for breadth work. Dispatch it for every initial source sweep (one scout per tier or portal), to check whether a portal/publisher has a candidate dataset before you descend a tier, and to skim a candidate page for the exact figure. It reports raw material only — you evaluate and synthesize.',
    prompt:
      'You are a source scout for a civic research orchestrator. Execute exactly the search or fetch task you were given and report raw material: for each candidate source — URL, publisher, publication date, the exact quoted text containing any relevant figure (with enough surrounding text to locate it), the geography and year the figure covers, and your best guess at its source tier. Report dead ends honestly ("portal has no dataset for X"). Do NOT synthesize, conclude, score, or recommend which source to accept. Never state a figure you did not see verbatim on a fetched page.',
    tools: ['WebSearch', 'WebFetch'],
    model,
  },
});

const DELEGATION_NOTE = `

## Delegation (execution policy)

A 'source-scout' subagent is available via the Task tool. Dispatch scouts for breadth work — tier sweeps, portal checks, page skims — and reserve your own turns for judgment: source evaluation, tier decisions, value extraction from evidence you capture yourself, scoring math, and composing findings. Every scout dispatch must state: objective, expected report format, and boundaries (per the delegation contract). You remain the single synthesizer; scout reports are raw material, not conclusions. Capture evidence yourself for every accepted source.`;

/**
 * One research session = one Agent SDK session in a scratch workspace
 * (SPEC.md §8 Apply). The full message stream is retained as the audit
 * transcript (gzipped JSONL). In production each session additionally runs
 * inside an ephemeral container behind the egress allowlist proxy — that
 * isolation lives in the deploy layer (see apps/worker/README.md), not here.
 */
export async function runSession(input: {
  prompt: string;
  allowedTools: string[];
  storage?: TenantStorage;
  /**
   * Best-effort knowledge-base recorder for each evidence capture (SPEC.md
   * §8 source library). Errors are swallowed — a db blip must never void a
   * capture mid-session; the backfill script sweeps any gaps later.
   */
  onCapture?: (record: SourceCaptureRecord) => Promise<void>;
  maxTurns?: number;
  model?: string;
}): Promise<SessionResult> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'df-session-'));
  const transcriptLines: string[] = [];
  let resultText = '';
  let succeeded = false;
  const usage: SessionTokenUsage = { input_tokens: 0, output_tokens: 0 };

  const mcpServers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};
  if (input.storage) {
    const storage = input.storage;
    mcpServers.evidence = createSdkMcpServer({
      name: 'evidence',
      version: '1.0.0',
      tools: [
        tool(
          'capture_evidence',
          'Capture an evidence snapshot of a source you have decided to accept: a full-page screenshot, plus the PDF when the source is a document. Returns storage paths for the finding\'s evidence field.',
          {
            url: z.string().describe('The exact URL the value was read from'),
            pdf_url: z.string().optional().describe('Direct PDF URL when the source is a document'),
          },
          async (args) => {
            try {
              const record = await captureEvidence(storage, args.url, args.pdf_url);
              if (input.onCapture) {
                await input.onCapture(record).catch((err) => {
                  console.error('source record failed (capture kept):', err);
                });
              }
              // The model sees ONLY the evidence-field paths: extra fields
              // here would tempt it to copy them into `evidence`, which the
              // finding schema closes with additionalProperties:false.
              const result = {
                snapshot_path: record.snapshot_path,
                pdf_path: record.pdf_path,
                captured_at: record.captured_at,
              };
              return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      error: `capture failed: ${err instanceof Error ? err.message : String(err)}`,
                    }),
                  },
                ],
              };
            }
          },
        ),
      ],
    });
  }

  const scoutModel = SCOUT_MODEL();
  const orchestrated = Boolean(scoutModel) && input.allowedTools.includes('WebSearch');

  try {
    const q = query({
      prompt: orchestrated ? input.prompt + DELEGATION_NOTE : input.prompt,
      options: {
        model: input.model ?? MODEL(),
        cwd: workspace,
        // No permission bypass: the explicit allowlist from the rendered plan
        // is the entire tool surface (SPEC §8); everything else is denied.
        // Orchestrated mode adds only Task + the scout definition.
        allowedTools: orchestrated ? [...input.allowedTools, 'Task'] : input.allowedTools,
        maxTurns: input.maxTurns ?? DEFAULT_SESSION_MAX_TURNS,
        ...(orchestrated && scoutModel ? { agents: SCOUT_AGENT(scoutModel) } : {}),
        ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
      },
    });

    for await (const message of q) {
      transcriptLines.push(JSON.stringify(message));
      if (message.type === 'result') {
        succeeded = message.subtype === 'success';
        if ('result' in message && typeof message.result === 'string') {
          resultText = message.result;
        }
        const u = message.usage as
          | {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            }
          | undefined;
        if (u) {
          usage.input_tokens = u.input_tokens ?? 0;
          usage.output_tokens = u.output_tokens ?? 0;
          usage.cache_read_tokens = u.cache_read_input_tokens;
          usage.cache_write_tokens = u.cache_creation_input_tokens;
        }
      }
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  return {
    resultText,
    transcript: gzipSync(transcriptLines.join('\n')),
    usage,
    succeeded,
  };
}

/** Extract the first JSON value from a session's result text (fences tolerated). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error('no JSON found in session output');
  return JSON.parse(candidate.slice(start));
}
