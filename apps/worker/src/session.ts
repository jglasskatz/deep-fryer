import { gzipSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { SessionTokenUsage } from '@deep-fryer/core';
import { DEFAULT_SESSION_MAX_TURNS, DEFAULT_SESSION_MODEL } from '@deep-fryer/research';
import { captureEvidence } from './evidence.js';
import type { TenantStorage } from './storage.js';

export interface SessionResult {
  resultText: string;
  transcript: Buffer;
  usage: SessionTokenUsage;
  succeeded: boolean;
}

const MODEL = () => process.env.ANTHROPIC_MODEL ?? DEFAULT_SESSION_MODEL;

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
  maxTurns?: number;
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
              const result = await captureEvidence(storage, args.url, args.pdf_url);
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

  try {
    const q = query({
      prompt: input.prompt,
      options: {
        model: MODEL(),
        cwd: workspace,
        allowedTools: input.allowedTools,
        permissionMode: 'bypassPermissions',
        maxTurns: input.maxTurns ?? DEFAULT_SESSION_MAX_TURNS,
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
